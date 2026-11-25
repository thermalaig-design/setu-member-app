/* global process */
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';

const last10 = (value) => String(value ?? '').replace(/\D/g, '').slice(-10);

/**
 * Verifies the Setu member session JWT issued at login and sets
 * req.member = { memberId, phone (last 10 digits), trustId }.
 */
export const requireMemberSession = (req, res, next) => {
  const secret = process.env.SETU_SESSION_SECRET;
  if (!secret) {
    console.error('SETU_SESSION_SECRET is not configured');
    return res.status(500).json({ success: false, message: 'Session service is not configured.' });
  }

  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '').trim());
  if (!match) {
    return res.status(401).json({ success: false, message: 'Please sign in again to continue.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(match[1], secret);
  } catch {
    return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
  }

  const phone = last10(decoded?.phone);
  if (decoded?.purpose !== 'setu_member_session' || !decoded?.memberId || phone.length < 10) {
    return res.status(401).json({ success: false, message: 'Invalid session. Please sign in again.' });
  }

  req.member = { memberId: String(decoded.memberId), phone, trustId: decoded.trustId || null };
  return next();
};

/**
 * One phone can own several Members rows (one per trust). A member id belongs
 * to the session if it is the session's own id or its Mobile/contact matches.
 */
export const memberBelongsToSession = async (memberId, session) => {
  if (!memberId || !session) return false;
  if (String(memberId) === String(session.memberId)) return true;

  const { data, error } = await supabase
    .from('Members')
    .select('members_id, Mobile, contact')
    .eq('members_id', memberId)
    .maybeSingle();

  if (error || !data) return false;
  return last10(data.Mobile) === session.phone || last10(data.contact) === session.phone;
};
