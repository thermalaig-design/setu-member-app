import { supabase } from '../config/supabase.js';
import { getFirebaseAdmin } from '../config/firebaseAdmin.js';
import { getAllMembers, getMembersByType } from './memberService.js';
import {
  buildDeviceIdentityVariantsFromMemberRow,
  buildNotificationDeviceIdentityVariants,
  isAdminBroadcastUserId,
} from './notificationIdentityResolver.js';

const normalizeText = (value) => String(value ?? '').trim();

const chunkArray = (items = [], size = 500) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const getNotificationPayload = (notification = {}) =>
  notification?.audience_payload ||
  notification?.payload?.audience_payload ||
  {};

const getNotificationTrustId = (notification = {}) => {
  const payload = getNotificationPayload(notification);
  return normalizeText(
    notification?.trust_id ||
    payload?.trust_id ||
    notification?.payload?.trust_id ||
    ''
  );
};

const getNotificationAudienceLabels = (notification = {}) => {
  const payload = getNotificationPayload(notification);
  const labels = [];

  const explicitTarget = normalizeText(payload?.target_audience || notification?.target_audience);
  if (explicitTarget) {
    labels.push(explicitTarget);
  }

  const audienceType = normalizeText(notification?.audience_type || payload?.audience_type).toLowerCase();
  if (!labels.length && audienceType === 'all') {
    labels.push('All');
  }

  if (!labels.length && audienceType === 'role') {
    const payloadRoles = [
      ...(Array.isArray(payload?.roles) ? payload.roles : []),
      payload?.role,
    ]
      .map(normalizeText)
      .filter(Boolean);
    labels.push(...payloadRoles);
  }

  return [...new Set(labels.filter(Boolean))];
};

const expandAudienceLabel = (label) => {
  const normalized = normalizeText(label).toLowerCase();
  if (!normalized) return [];
  if (normalized === 'both' || normalized === 'all') return ['Trustee', 'Patron'];
  if (normalized === 'trustee' || normalized === 'trustees') return ['Trustee'];
  if (normalized === 'patron' || normalized === 'patrons') return ['Patron'];
  return [];
};

const fetchMembersForAudience = async (trustId, label) => {
  if (!trustId) return [];

  const normalized = normalizeText(label).toLowerCase();
  if (!normalized) return [];

  if (normalized === 'all') {
    const members = await getAllMembers(trustId);
    return Array.isArray(members) ? members.filter(Boolean) : [];
  }

  const trustTypes = expandAudienceLabel(label);
  if (!trustTypes.length) return [];

  const memberGroups = await Promise.all(
    trustTypes.map(async (type) => {
      try {
        return await getMembersByType(type, trustId);
      } catch (error) {
        console.warn(`Unable to resolve ${type} members for push delivery:`, error?.message || error);
        return [];
      }
    })
  );

  return memberGroups.flat().filter(Boolean);
};

const fetchMembersByIds = async (memberIds = [], trustId = null) => {
  const ids = [...new Set(memberIds.map(normalizeText).filter(Boolean))];
  if (!ids.length) return [];

  let query = supabase
    .from('reg_members')
    .select(`
      id,
      trust_id,
      members_id,
      "Membership number",
      role,
      Members:members_id (
        "S.No.",
        "Name",
        "Mobile",
        members_id
      )
    `)
    .in('id', ids);

  if (trustId) {
    query = query.eq('trust_id', trustId);
  }

  const { data, error } = await query.limit(5000);
  if (error || !data) {
    if (error) {
      console.warn('Unable to resolve notification member IDs:', error.message || error);
    }
    return [];
  }

  return data;
};

const addDeviceIdentityVariants = (set, value) => {
  buildNotificationDeviceIdentityVariants(value).forEach((variant) => set.add(variant));
};

const resolveTargetUserIds = async (notification = {}) => {
  const targetUserIds = new Set();
  const payload = getNotificationPayload(notification);
  const trustId = getNotificationTrustId(notification);

  const directUserId = normalizeText(notification?.user_id);
  if (directUserId && !isAdminBroadcastUserId(directUserId)) {
    addDeviceIdentityVariants(targetUserIds, directUserId);
  }

  const userIdSources = [
    ...(Array.isArray(payload?.user_ids) ? payload.user_ids : []),
    ...(Array.isArray(notification?.user_ids) ? notification.user_ids : []),
  ];

  userIdSources
    .map(normalizeText)
    .filter((value) => Boolean(value) && !isAdminBroadcastUserId(value))
    .forEach((value) => addDeviceIdentityVariants(targetUserIds, value));

  const memberIdSources = [
    ...(Array.isArray(payload?.member_ids) ? payload.member_ids : []),
    ...(Array.isArray(payload?.recipient_member_ids) ? payload.recipient_member_ids : []),
    ...(Array.isArray(notification?.member_ids) ? notification.member_ids : []),
  ];

  const memberIds = [...new Set(memberIdSources.map(normalizeText).filter(Boolean))];
  if (memberIds.length) {
    const memberRows = await fetchMembersByIds(memberIds, trustId);
    memberRows.forEach((memberRow) => {
      buildDeviceIdentityVariantsFromMemberRow(memberRow).forEach((variant) => targetUserIds.add(variant));
    });
  }

  const audienceLabels = getNotificationAudienceLabels(notification);
  for (const audienceLabel of audienceLabels) {
    const audienceMembers = await fetchMembersForAudience(trustId, audienceLabel);
    audienceMembers.forEach((memberRow) => {
      buildDeviceIdentityVariantsFromMemberRow(memberRow).forEach((variant) => targetUserIds.add(variant));
    });
  }

  return [...targetUserIds].filter(Boolean);
};

const getTokensForUsers = async (userIds) => {
  const normalizedUserIds = [...new Set(userIds.map(normalizeText).filter(Boolean))];
  if (!normalizedUserIds.length) return [];

  const tokens = new Set();

  for (const userIdBatch of chunkArray(normalizedUserIds, 500)) {
    const { data, error } = await supabase
      .from('notification_devices')
      .select('token')
      .in('user_id', userIdBatch)
      .eq('is_active', true);

    if (error || !data) {
      if (error) {
        console.warn('Unable to resolve push tokens:', error.message || error);
      }
      continue;
    }

    data.forEach((row) => {
      const token = normalizeText(row?.token);
      if (token) tokens.add(token);
    });
  }

  return [...tokens];
};

const deactivateInvalidTokens = async (tokens) => {
  const uniqueTokens = [...new Set(tokens.map(normalizeText).filter(Boolean))];
  if (!uniqueTokens.length) return;

  await supabase
    .from('notification_devices')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in('token', uniqueTokens);
};

const buildMulticastMessage = (notification, tokens) => ({
  tokens,
  notification: {
    title: notification?.title || 'New Notification',
    body: normalizeText(notification?.message || notification?.body).slice(0, 200),
  },
  data: {
    notificationId: String(notification?.id || ''),
    type: String(notification?.type || 'general'),
    trustId: String(getNotificationTrustId(notification) || ''),
    open: 'notifications',
  },
  android: {
    priority: 'high',
  },
  apns: {
    headers: {
      'apns-priority': '10',
    },
    payload: {
      aps: {
        sound: 'default',
      },
    },
  },
});

export const sendPushForNotification = async (notification) => {
  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) return;

  const userIds = await resolveTargetUserIds(notification);
  if (!userIds.length) return;

  const tokens = await getTokensForUsers(userIds);
  if (!tokens.length) return;

  const invalidTokens = new Set();
  for (const tokenBatch of chunkArray(tokens, 500)) {
    const response = await firebaseAdmin.messaging().sendEachForMulticast(
      buildMulticastMessage(notification, tokenBatch)
    );

    response.responses.forEach((result, index) => {
      if (result?.success) return;

      const code = result?.error?.code || '';
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token')
      ) {
        invalidTokens.add(tokenBatch[index]);
      }
    });
  }

  if (invalidTokens.size > 0) {
    await deactivateInvalidTokens([...invalidTokens]);
  }
};
