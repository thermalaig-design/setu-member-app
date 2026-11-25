const normalizeAudience = (value) => String(value || '').trim().toLowerCase();
const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();

export const getUserIdVariants = (rawUser) => {
  const variants = new Set();
  const base = String(rawUser || '').trim();
  if (base) variants.add(base);

  const digits = base.replace(/\D/g, '');
  if (digits) {
    variants.add(digits);
    if (digits.length >= 10) variants.add(digits.slice(-10));
    if (!digits.startsWith('91') && digits.length === 10) variants.add(`91${digits}`);
    variants.add(`+${digits}`);
    if (digits.length === 10) variants.add(`+91${digits}`);
  }

  return [...variants].filter(Boolean);
};

const getIdentityVariants = (...values) => {
  const set = new Set();
  values.forEach((value) => {
    const base = String(value || '').trim();
    if (!base) return;
    set.add(base);
    set.add(base.toLowerCase());

    const idVariants = getUserIdVariants(base);
    idVariants.forEach((item) => {
      const trimmed = String(item || '').trim();
      if (!trimmed) return;
      set.add(trimmed);
      set.add(trimmed.toLowerCase());
    });
  });
  return [...set];
};

const getMemberTypeVariants = (rawType) => {
  const normalized = normalizeAudience(rawType);
  if (!normalized) return [];

  if (normalized === 'trustee' || normalized === 'trustees') {
    return ['Trustee', 'trustee', 'Trustees', 'trustees'];
  }
  if (normalized === 'patron' || normalized === 'patrons') {
    return ['Patron', 'patron', 'Patrons', 'patrons'];
  }

  const original = String(rawType).trim();
  return [original, normalized];
};

export const getCurrentNotificationContext = () => {
  const userRaw = localStorage.getItem('user');
  const user = userRaw ? JSON.parse(userRaw) : null;

  const idFields = [
    ['Mobile', user?.Mobile],
    ['mobile', user?.mobile],
    ['phone', user?.phone],
    ['Membership number', user?.['Membership number']],
    ['membership_number', user?.membership_number],
    ['user_identifier', user?.user_identifier],
    ['id', user?.id],
    ['Name', user?.Name],
    ['name', user?.name],
  ];
  const matchedField = idFields.find(([, value]) => Boolean(value));
  const userId = matchedField ? matchedField[1] : null;

  const userIdVariants = getIdentityVariants(
    user?.Mobile,
    user?.mobile,
    user?.phone,
    user?.['Membership number'],
    user?.membership_number,
    user?.user_identifier,
    user?.id,
    user?.Name,
    user?.name
  );
  const memberTypeVariants = getMemberTypeVariants(user?.type || user?.Type);
  const audienceVariants = [...new Set(['all', 'All', 'both', 'Both', ...memberTypeVariants])];
  const audienceNormalizedSet = new Set(audienceVariants.map(normalizeAudience).filter(Boolean));
  const userIdSet = new Set(userIdVariants.map(normalizeIdentity).filter(Boolean));
  const trustId = String(localStorage.getItem('selected_trust_id') || '').trim();

  return {
    userId,
    userIdVariants,
    audienceVariants,
    audienceNormalizedSet,
    userIdSet,
    trustId,
  };
};

export const matchesNotificationForContext = (notification, context) => {
  if (!notification || !context) return false;
  const contextTrustId = String(context.trustId || '').trim();
  const notificationTrustId = String(notification.trust_id || '').trim();
  if (contextTrustId && notificationTrustId && notificationTrustId !== contextTrustId) return false;

  const audiencePayload = notification?.audience_payload || notification?.payload?.audience_payload || {};
  const audienceType = normalizeAudience(notification?.audience_type || audiencePayload?.audience_type);
  const targetUserIds = [
    notification.user_id,
    ...(Array.isArray(audiencePayload.user_ids) ? audiencePayload.user_ids : []),
    ...(Array.isArray(audiencePayload.member_ids) ? audiencePayload.member_ids : []),
  ];

  if (targetUserIds.some((id) => context.userIdSet.has(normalizeIdentity(id)))) return true;

  if (audienceType === 'all') return true;

  const audience = normalizeAudience(notification.target_audience || audiencePayload.target_audience);
  if (audience && context.audienceNormalizedSet.has(audience)) return true;

  if (audienceType === 'role') {
    const roles = [
      ...(Array.isArray(audiencePayload.roles) ? audiencePayload.roles : []),
      audiencePayload.role,
    ].map(normalizeAudience).filter(Boolean);
    if (roles.includes('app')) return Boolean(context.userId);
    if (roles.some((role) => context.audienceNormalizedSet.has(role))) return true;
  }

  return false;
};
