const normalizeRole = (value) => String(value ?? '').trim().toLowerCase();
const normalizeIdentity = (value) => String(value ?? '').trim();

const buildIdentityVariants = (...values) => {
  const variants = new Set();

  values.flat().forEach((value) => {
    const base = normalizeIdentity(value);
    if (!base) return;

    variants.add(base);
    variants.add(base.toLowerCase());

    const digits = base.replace(/\D/g, '');
    if (!digits) return;

    variants.add(digits);
    if (digits.length >= 10) {
      variants.add(digits.slice(-10));
    }
    if (digits.length === 10) {
      variants.add(`91${digits}`);
      variants.add(`+91${digits}`);
      variants.add(`+${digits}`);
    }
  });

  return [...variants].filter(Boolean);
};

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
  const targetIdentitySet = new Set(buildIdentityVariants(userIds));
  const userIdentityVariants = buildIdentityVariants(normalizedUserId, normalizedMemberIds);
  const normalizedUserRoles = [...new Set(
    [...(Array.isArray(userRoles) ? userRoles : []), ...(typeof userRoles === 'string' ? [userRoles] : [])]
      .map(normalizeRole)
      .filter(Boolean)
  )];

  if (audienceType === 'all') return true;
  if (userIdentityVariants.some((id) => targetIdentitySet.has(id))) return true;

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
