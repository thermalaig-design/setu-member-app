const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeText = (value) => String(value ?? '').trim();

const toDigits = (value) => normalizeText(value).replace(/\D/g, '');

const uniquePairs = (pairs = []) => {
  const seen = new Set();
  const result = [];

  for (const [field, value] of pairs) {
    const normalizedField = normalizeText(field);
    const normalizedValue = normalizeText(value);
    if (!normalizedField || !normalizedValue) continue;

    const key = `${normalizedField}::${normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([normalizedField, normalizedValue]);
  }

  return result;
};

const addIdentityVariants = (set, rawValue) => {
  const base = normalizeText(rawValue);
  if (!base) return;

  set.add(base);
  set.add(base.toLowerCase());

  const digits = toDigits(base);
  if (!digits) return;

  set.add(digits);
  if (digits.length >= 10) {
    set.add(digits.slice(-10));
  }
  if (digits.length === 10) {
    set.add(`91${digits}`);
    set.add(`+91${digits}`);
    set.add(`+${digits}`);
  }
};

export const buildRegMemberLookupPairs = (rawUserId) => {
  const normalized = normalizeText(rawUserId);
  if (!normalized) return [];

  const pairs = [];
  const digits = toDigits(normalized);

  if (UUID_RE.test(normalized)) {
    pairs.push(['members_id', normalized]);
    pairs.push(['id', normalized]);
    return uniquePairs(pairs);
  }

  if (digits) {
    pairs.push(['mobile', digits]);
    pairs.push(['Mobile', digits]);
    pairs.push(['Membership number', digits]);
    pairs.push(['membership_number', digits]);

    if (digits.length >= 10) {
      const last10 = digits.slice(-10);
      pairs.push(['mobile', last10]);
      pairs.push(['Mobile', last10]);
      pairs.push(['Membership number', last10]);
      pairs.push(['membership_number', last10]);
    }

    if (digits.length === 10) {
      pairs.push(['mobile', `91${digits}`]);
      pairs.push(['Mobile', `91${digits}`]);
      pairs.push(['Membership number', `91${digits}`]);
      pairs.push(['membership_number', `91${digits}`]);
    }
  }

  pairs.push(['members_id', normalized]);
  pairs.push(['id', normalized]);

  return uniquePairs(pairs);
};

export const buildNotificationDeviceIdentityVariants = (...values) => {
  const variants = new Set();
  values.flat().forEach((value) => addIdentityVariants(variants, value));
  return [...variants].filter(Boolean);
};

export const buildDeviceIdentityVariantsFromMemberRow = (memberRow = {}) => {
  const variants = new Set();
  const memberSources = [memberRow, memberRow?.Members, memberRow?.member, memberRow?.reg_members].filter(Boolean);

  memberSources.forEach((source) => {
    addIdentityVariants(variants, source?.Mobile);
    addIdentityVariants(variants, source?.mobile);
    addIdentityVariants(variants, source?.phone);
    addIdentityVariants(variants, source?.id);
    addIdentityVariants(variants, source?.members_id);
    addIdentityVariants(variants, source?.['Membership number']);
    addIdentityVariants(variants, source?.membership_number);
    addIdentityVariants(variants, source?.user_id);
  });

  return [...variants].filter(Boolean);
};

export const isAdminBroadcastUserId = (userId) => normalizeText(userId).startsWith('ADMIN_BROADCAST_');
