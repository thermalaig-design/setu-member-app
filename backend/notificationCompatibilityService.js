import { supabase } from '../config/supabase.js';
import { resolveMemberIdForUser } from './memberIdentityResolver.js';

const normalizeText = (value) => String(value ?? '').trim();

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

  if (newNotification?.id && userId) {
    try {
      const memberId = await resolveMemberIdForUser(userId, trustId);

      if (memberId) {
        await supabase
          .from('notification_recipients')
          .insert([
            {
              notification_id: newNotification.id,
              member_id: memberId,
              status: 'unread',
              created_at: createdAt,
              updated_at: createdAt,
            },
          ]);
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
