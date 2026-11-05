
import { supabase } from '../config/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeText = (value) => String(value || '').trim();
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
const resolveMasterMembersIdFromUuid = async (value) => {
  const normalized = normalizeText(value);
  if (!UUID_RE.test(normalized)) return null;

  const { data: memberRow, error: memberError } = await supabase
    .from('Members')
    .select('members_id')
    .eq('members_id', normalized)
    .limit(1)
    .maybeSingle();

  if (!memberError && memberRow?.members_id) {
    return memberRow.members_id;
  }

  const { data: regMemberRow, error: regMemberError } = await supabase
    .from('reg_members')
    .select('members_id')
    .or(`members_id.eq.${normalized},id.eq.${normalized}`)
    .limit(1)
    .maybeSingle();

  if (!regMemberError && regMemberRow?.members_id) {
    return regMemberRow.members_id;
  }

  return null;
};

const resolveMasterMembersId = async (userId, fallbackMembersId = null) => {
  // Prefer the explicit members_id from the caller's own logged-in session — it's
  // unambiguous. Mobile-based lookup is a last resort: two different Members rows can
  // share the same Mobile (confirmed in prod), so `.limit(1)` on a Mobile match can
  // silently resolve to the wrong person when a reliable id was available all along.
  const fallbackResolved = await resolveMasterMembersIdFromUuid(fallbackMembersId);
  if (fallbackResolved) {
    return fallbackResolved;
  }

  const mobileCandidates = buildMobileCandidates(userId);

  if (mobileCandidates.length) {
    const { data, error } = await supabase
      .from('Members')
      .select('members_id')
      .in('Mobile', mobileCandidates)
      .limit(1)
      .maybeSingle();

    if (!error && data?.members_id) {
      return data.members_id;
    }
  }

  return await resolveMasterMembersIdFromUuid(userId);
};

// The person-level id (reg_members.members_id / Members.members_id). member_session.members_id
// stores this same value, so push-token registration uses it to find a person's session rows.
export const resolvePersonIdForUser = (userId, fallbackMembersId = null) =>
  resolveMasterMembersId(userId, fallbackMembersId);

// notification_recipients.member_id references reg_members.id — a per-trust
// membership row. A member with memberships in multiple trusts has a
// distinct reg_members.id per trust, so this returns all of them.
export const resolveMemberIdsForUser = async (userId, fallbackMembersId = null) => {
  const masterMembersId = await resolveMasterMembersId(userId, fallbackMembersId);
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

// Returns the distinct role(s) (e.g. "Trustee") this user holds, scoped to trustId when
// provided. Needed for audience_type: 'role'/'mixed' notification matching — without this,
// isNotificationRelevantForUser has no roles to compare against.
export const resolveMemberRolesForUser = async (userId, trustId = null, fallbackMembersId = null) => {
  const masterMembersId = await resolveMasterMembersId(userId, fallbackMembersId);
  if (!masterMembersId) return [];

  let query = supabase.from('reg_members').select('role').eq('members_id', masterMembersId);
  if (trustId) query = query.eq('trust_id', trustId);

  const { data, error } = await query;
  if (error || !data) return [];

  return [...new Set(data.map((row) => normalizeText(row.role)).filter(Boolean))];
};

// Returns a single reg_members.id, scoped to trustId when provided
// (needed when creating a notification for a specific trust).
export const resolveMemberIdForUser = async (userId, trustId = null, fallbackMembersId = null) => {
  const masterMembersId = await resolveMasterMembersId(userId, fallbackMembersId);
  if (!masterMembersId) return null;

  let query = supabase.from('reg_members').select('id').eq('members_id', masterMembersId);
  if (trustId) query = query.eq('trust_id', trustId);

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    return null;
  }

  return data?.id || null;
};