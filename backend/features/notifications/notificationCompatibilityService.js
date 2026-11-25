import { supabase } from '../../shared/config/supabase.js';
import { resolveMemberIdForUser } from '../../shared/member-api/memberIdentityResolver.js';

const normalizeText = (value) => String(value ?? '').trim();
const normalizeRole = (value) => normalizeText(value).toLowerCase();

// audience_type: 'role' / 'mixed' notifications are meant to reach every matching
// member of a trust, not just whoever's user_id happened to be on the create request.
// Resolve the full recipient list here instead of assuming a single target member.
const resolveRecipientMemberIds = async (trustId, { audienceType, audiencePayload, userId, explicitMemberId }) => {
  if (!trustId) return explicitMemberId ? [explicitMemberId] : [];

  const type = normalizeRole(audienceType);

  const fetchActiveMembersByRoles = async (roles) => {
    let query = supabase
      .from('reg_members')
      .select('id, role')
      .eq('trust_id', trustId)
      .eq('is_active', true);

    const { data, error } = await query;
    if (error || !data) return [];

    if (!roles || roles.length === 0) return data.map((row) => row.id).filter(Boolean);

    const normalizedRoles = roles.map(normalizeRole).filter(Boolean);
    return data
      .filter((row) => normalizedRoles.includes(normalizeRole(row.role)))
      .map((row) => row.id)
      .filter(Boolean);
  };

  if (type === 'all') {
    return fetchActiveMembersByRoles(null);
  }

  if (type === 'role') {
    const roles = [
      ...(Array.isArray(audiencePayload?.roles) ? audiencePayload.roles : []),
      ...(audiencePayload?.role ? [audiencePayload.role] : []),
    ];
    return fetchActiveMembersByRoles(roles);
  }

  if (type === 'mixed') {
    const targetAudience = normalizeText(audiencePayload?.target_audience);
    if (targetAudience.toLowerCase() === 'both') {
      return fetchActiveMembersByRoles(null);
    }
    if (targetAudience) {
      return fetchActiveMembersByRoles([targetAudience]);
    }
  }

  // Default: explicit single-user notification (no role/broadcast audience).
  if (explicitMemberId) return [explicitMemberId];
  if (userId) {
    const memberId = await resolveMemberIdForUser(userId, trustId, null);
    return memberId ? [memberId] : [];
  }
  return [];
};

const getDefaultTrustId = async () => {
  const envTrustId = normalizeText(process.env.VITE_DEFAULT_TRUST_ID || process.env.DEFAULT_TRUST_ID);
  if (envTrustId) return envTrustId;

  try {
    const { data, error } = await supabase
      .from('Trust')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (!error && data?.id) {
      return data.id;
    }
  } catch (error) {
    console.warn('Unable to resolve default trust for compatibility notification:', error?.message || error);
  }

  return null;
};

export const createCompatibleNotification = async (input = {}) => {
  const createdAt = input.created_at || new Date().toISOString();
  const userId = normalizeText(input.user_id);
  const title = normalizeText(input.title);
  const message = normalizeText(input.message);
  const type = normalizeText(input.type || 'general');

  const trustId = input.trust_id || (await getDefaultTrustId());

  let newNotification = null;
  let newError = null;

  if (trustId) {
    try {
      const audiencePayload = {
        ...(input.audience_payload || {}),
        ...(input.target_audience ? { target_audience: input.target_audience } : {}),
        ...(userId ? { user_ids: [userId] } : {}),
      };

      const newPayload = {
        trust_id: trustId,
        title,
        message,
        audience_type: input.audience_type || (input.target_audience ? 'mixed' : 'users'),
        audience_payload: audiencePayload,
        click_action: input.click_action || type,
        expires_at: input.expires_at || null,
        created_at: createdAt,
        updated_at: createdAt,
      };

      const { data, error } = await supabase
        .from('notification')
        .insert([newPayload])
        .select()
        .maybeSingle();

      if (!error && data) {
        newNotification = data;
      } else {
        newError = error?.message || 'Unknown new notification insert error';
      }
    } catch (error) {
      newError = error?.message || 'New notification insert failed';
    }
  }

  if (!newNotification && !newError) {
    newError = 'No trust context available for notification insert';
  }

  if (newNotification?.id) {
    try {
      let explicitMemberId = null;
      if (userId) {
        explicitMemberId = await resolveMemberIdForUser(
          userId,
          trustId,
          input.members_id || input.member_id || null
        );
      }

      const recipientMemberIds = [...new Set(
        (await resolveRecipientMemberIds(trustId, {
          audienceType: newNotification.audience_type,
          audiencePayload: newNotification.audience_payload,
          userId,
          explicitMemberId,
        })).filter(Boolean)
      )];

      if (recipientMemberIds.length > 0) {
        await supabase
          .from('notification_recipients')
          .insert(recipientMemberIds.map((memberId) => ({
            notification_id: newNotification.id,
            member_id: memberId,
            status: 'unread',
            created_at: createdAt,
            updated_at: createdAt,
          })));
      }
    } catch (recipientError) {
      console.warn('New-schema notification recipient insert skipped:', recipientError?.message || recipientError);
    }
  }

  return {
    success: !newError,
    legacyNotification: newNotification,
    legacyError: newError,
  };
};
