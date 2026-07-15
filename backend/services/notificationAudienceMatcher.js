const normalizeRole = (value) => String(value ?? '').trim().toLowerCase();

export const isNotificationRelevantForUser = (notification, { memberIds, memberId, memberType, userId, userRoles = [] }) => {
  if (!notification) return false;

  const normalizedMemberIds = Array.isArray(memberIds) ? memberIds : (memberId ? [memberId] : []);

  const audienceType = normalizeRole(notification?.audience_type);
  const audiencePayload = notification?.audience_payload || {};
  const userIds = [
    ...(Array.isArray(audiencePayload.user_ids) ? audiencePayload.user_ids : []),
    ...(Array.isArray(audiencePayload.member_ids) ? audiencePayload.member_ids : []),
  ];
  const normalizedUserId = String(userId || '').trim();
  const normalizedUserRoles = [...new Set(
    [...(Array.isArray(userRoles) ? userRoles : []), ...(typeof userRoles === 'string' ? [userRoles] : [])]
      .map(normalizeRole)
      .filter(Boolean)
  )];

  if (audienceType === 'all') return true;
  if (normalizedMemberIds.some((id) => userIds.includes(id))) return true;
  if (normalizedUserId && userIds.includes(normalizedUserId)) return true;

  if (audienceType === 'role') {
    const roles = [
      ...(Array.isArray(audiencePayload.roles) ? audiencePayload.roles : []),
      ...(audiencePayload.role ? [audiencePayload.role] : []),
    ]
      .map(normalizeRole)
      .filter(Boolean);

    if (roles.includes('app')) {
      return Boolean(normalizedUserId || normalizedUserRoles.length);
    }

    if (roles.some((role) => normalizedUserRoles.includes(role))) {
      return true;
    }
  }

  if (audienceType === 'mixed') {
    const targetAudience = String(audiencePayload.target_audience || '').trim();
    if (targetAudience === 'Both') return true;
    if (memberType && targetAudience && targetAudience.toLowerCase() === String(memberType).toLowerCase()) return true;
  }

  return false;
};
