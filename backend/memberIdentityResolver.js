import { supabase } from '../config/supabase.js';

const toDigits = (value) => String(value || '').replace(/\D/g, '');

// Members."Mobile" is numeric and stores plain 10-digit numbers, but the
// incoming userId may carry a country code (+91), so we try every plausible
// digit form before giving up.
const buildMobileCandidates = (userId) => {
  const digits = toDigits(userId);
  const candidates = new Set();
  if (digits) {
    candidates.add(digits);
    if (digits.length > 10) candidates.add(digits.slice(-10));
    if (digits.length === 10) candidates.add(`91${digits}`);
  }
  return [...candidates].filter(Boolean);
};

// reg_members."Mobile" is a denormalized copy of Members."Mobile" and can be
// null on individual per-trust rows (confirmed in prod: a member's row for
// one trust had Mobile=null while their rows for other trusts had it set).
// The only reliable link between trust memberships is reg_members.members_id,
// which always points back to the master Members.members_id. So we resolve
// mobile -> Members.members_id first, then fan out to every reg_members.id
// via that members_id instead of matching reg_members.Mobile directly.
const resolveMasterMembersId = async (userId) => {
  const mobileCandidates = buildMobileCandidates(userId);
  if (!mobileCandidates.length) {
    return null;
  }

  const { data, error } = await supabase
    .from('Members')
    .select('members_id')
    .in('Mobile', mobileCandidates)
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data?.members_id || null;
};

// notification_recipients.member_id references reg_members.id — a per-trust
// membership row. A member with memberships in multiple trusts has a
// distinct reg_members.id per trust, so this returns all of them.
export const resolveMemberIdsForUser = async (userId) => {
  const masterMembersId = await resolveMasterMembersId(userId);
  if (!masterMembersId) return [];

  const { data, error } = await supabase
    .from('reg_members')
    .select('id')
    .eq('members_id', masterMembersId);

  if (error) {
    return [];
  }

  if (!data?.length) {
    return [];
  }

  return [...new Set(data.map((row) => row.id).filter(Boolean))];
};

// Returns a single reg_members.id, scoped to trustId when provided
// (needed when creating a notification for a specific trust).
export const resolveMemberIdForUser = async (userId, trustId = null) => {
  const masterMembersId = await resolveMasterMembersId(userId);
  if (!masterMembersId) return null;

  let query = supabase.from('reg_members').select('id').eq('members_id', masterMembersId);
  if (trustId) query = query.eq('trust_id', trustId);

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    return null;
  }

  return data?.id || null;
};
