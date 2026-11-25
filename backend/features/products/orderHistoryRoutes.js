import express from 'express';
import { supabase } from '../../shared/config/supabase.js';

const router = express.Router();

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const extractOrderRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value.purchases)) return value.purchases;
  if (Array.isArray(value.orders)) return value.orders;
  if (Array.isArray(value.history)) return value.history;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.result)) return value.result;

  return [];
};

router.post('/purchases', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const memberId = normalizeText(body.memberId || body.member_id || body.p_member_id);
    const trustId = normalizeText(body.trustId || body.trust_id || body.p_trust_id);
    const action = normalizeText(body.action || body.p_action) || 'get';
    const payload = body.payload ?? body.p_payload ?? {};

    if (!memberId || !trustId) {
      return res.status(400).json({
        success: false,
        message: 'memberId and trustId are required',
      });
    }

    const { data, error } = await supabase.rpc('manage_purchase_by_member', {
      p_member_id: memberId,
      p_trust_id: trustId,
      p_action: action,
      p_payload: payload,
    });

    if (error) {
      console.error('Error fetching order history purchases:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to load order history',
      });
    }

    if (data && typeof data === 'object' && data.success === false) {
      return res.status(400).json({
        success: false,
        message: normalizeText(data.message) || `Failed to load order history for trust ${trustId}`,
      });
    }

    const purchases = extractOrderRows(data);

    return res.json({
      success: true,
      trust_id: trustId,
      member_id: memberId,
      purchases,
      source: 'backend',
    });
  } catch (error) {
    console.error('Error in order history route:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
    });
  }
});

export default router;
