const normalizeText = (value) => String(value ?? '').trim();

export const buildNotificationViewModel = (row = {}, userId = '') => {
  const title = normalizeText(row?.title || row?.payload?.title || '');
  const message = normalizeText(row?.message || row?.body || row?.payload?.message || '');
  const clickAction = normalizeText(row?.click_action || row?.payload?.click_action || row?.type || 'general');
  const createdAt = normalizeText(row?.created_at || row?.updated_at || '');
  const recipientStatus = normalizeText(row?.recipient_status || row?.status || '');
  const audiencePayload = row?.audience_payload || row?.payload?.audience_payload || {};
  const userIds = [
    ...(Array.isArray(audiencePayload.user_ids) ? audiencePayload.user_ids : []),
    ...(Array.isArray(audiencePayload.member_ids) ? audiencePayload.member_ids : []),
  ];

  return {
    ...row,
    id: row?.id,
    user_id: userIds[0] || normalizeText(userId || row?.user_id || ''),
    title,
    message,
    type: clickAction,
    is_read: recipientStatus.toLowerCase() === 'read',
    created_at: createdAt,
    source: row?.source || 'new_schema',
  };
};

export const mergeNotifications = (notifications = []) => {
  const mergedMap = new Map();

  for (const notification of notifications || []) {
    if (!notification?.id) continue;
    const existing = mergedMap.get(notification.id);
    if (!existing) {
      mergedMap.set(notification.id, notification);
      continue;
    }

    const existingCreated = new Date(existing.created_at || 0).getTime();
    const incomingCreated = new Date(notification.created_at || 0).getTime();
    if (incomingCreated > existingCreated) {
      mergedMap.set(notification.id, notification);
    }
  }

  return [...mergedMap.values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
};
