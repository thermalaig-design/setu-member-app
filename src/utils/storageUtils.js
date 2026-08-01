const USER_STORAGE_KEY = 'user';
const LOGGED_IN_STORAGE_KEY = 'isLoggedIn';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const sanitizeMemberName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  const blockedNames = new Set([
    'aaaaa',
    'gau grass',
    'guest user',
    'test',
    'test user',
    'null',
    'undefined',
    'n/a',
    'na'
  ]);
  const compact = raw.replace(/\s+/g, '');
  const repeatedSingleChar = /^([a-zA-Z])\1{2,}$/.test(compact);
  if (blockedNames.has(lowered) || repeatedSingleChar) return '';
  return raw;
};

const removeLocalStorageByPrefix = (prefixes = []) => {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore storage cleanup failures
  }
};

const compactMembership = (membership = {}) => ({
  trust_id: membership?.trust_id || null,
  trust_name: membership?.trust_name || null,
  trust_icon_url: membership?.trust_icon_url || null,
  trust_remark: membership?.trust_remark || null,
  role: membership?.role || null,
  is_active: Boolean(membership?.is_active),
  member_id: membership?.member_id || membership?.members_id || null,
  members_id: membership?.members_id || membership?.member_id || null,
  membership_number: membership?.membership_number || membership?.['Membership number'] || null,
});

const normalizeTrustId = (value) => String(value || '').trim();

export const getUserHospitalMemberships = (user = {}) =>
  Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];

export const resolveSelectedTrustMembership = (user = {}, selectedTrustId = null) => {
  const memberships = getUserHospitalMemberships(user);
  if (!memberships.length) return null;

  const normalizedSelectedTrustId = normalizeTrustId(selectedTrustId);
  if (normalizedSelectedTrustId) {
    const selectedTrustMatch =
      memberships.find((membership) =>
        normalizeTrustId(membership?.trust_id) === normalizedSelectedTrustId && membership?.is_active !== false
      ) ||
      memberships.find((membership) =>
        normalizeTrustId(membership?.trust_id) === normalizedSelectedTrustId
      );
    if (selectedTrustMatch) return selectedTrustMatch;
  }

  return memberships.find((membership) => membership?.is_active && membership?.trust_id) ||
    memberships.find((membership) => membership?.trust_id) ||
    memberships[0] ||
    null;
};

export const hasAnyTrustMembership = (user = {}) =>
  getUserHospitalMemberships(user).some((membership) => Boolean(membership?.trust_id));

export const compactUserForStorage = (user = {}) => {
  const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
  const compactMemberships = memberships.slice(0, 25).map(compactMembership);
  const normalizedMembersId = isUuid(user?.members_id) ? String(user.members_id).trim() : null;
  const normalizedMemberId = isUuid(user?.member_id) ? String(user.member_id).trim() : normalizedMembersId;
  const compactMemberIds = Array.from(
    new Set(
      (Array.isArray(user?.member_ids) ? user.member_ids : [])
        .filter(Boolean)
        .filter(isUuid)
        .map((id) => String(id))
    )
  );
  const sanitizedName = sanitizeMemberName(user?.Name || user?.name || '');

  return {
    id: user?.id || normalizedMembersId || null,
    members_id: normalizedMembersId,
    member_id: normalizedMemberId,
    member_ids: compactMemberIds,
    Name: sanitizedName,
    name: sanitizedName,
    Mobile: user?.Mobile || user?.mobile || user?.phone || '',
    mobile: user?.mobile || user?.Mobile || user?.phone || '',
    phone: user?.phone || user?.Mobile || user?.mobile || '',
    'Membership number': user?.['Membership number'] || user?.membership_number || '',
    membership_number: user?.membership_number || user?.['Membership number'] || '',
    Email: user?.Email || user?.email || '',
    email: user?.email || user?.Email || '',
    primary_trust: user?.primary_trust
      ? {
        id: user.primary_trust.id || null,
        name: user.primary_trust.name || null,
      }
      : null,
    trust: user?.trust
      ? {
        id: user.trust.id || null,
        name: user.trust.name || null,
      }
      : null,
    type: user?.type || '',
    isRegisteredMember: Boolean(user?.isRegisteredMember),
    vip_status: user?.vip_status || null,
    reg_member_id: user?.reg_member_id || null,
    hospital_memberships: compactMemberships,
  };
};

const setLocalStorageWithRecovery = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    const isQuotaError = err?.name === 'QuotaExceededError';
    if (!isQuotaError) return false;

    removeLocalStorageByPrefix([
      'gallery_normalized_cache_',
      'gallery_persistent_cache_',
      'sponsors_cache_',
      'sponsors_list_cache_',
      'marquee_cache_',
      'memberTrustLinks_',
      'trust_list_cache',
      'theme_cache_',
      'directory_cache_',
    ]);

    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
};

export const persistUserSession = (user = {}) => {
  const compactUser = compactUserForStorage(user);
  const compactPayload = JSON.stringify(compactUser);
  if (setLocalStorageWithRecovery(USER_STORAGE_KEY, compactPayload)) {
    try {
      localStorage.setItem(LOGGED_IN_STORAGE_KEY, 'true');
      return { success: true };
    } catch {
      return { success: false, message: 'Unable to persist login state' };
    }
  }

  const minimalUser = {
    id: compactUser?.id || null,
    members_id: compactUser?.members_id || null,
    Name: compactUser?.Name || compactUser?.name || '',
    name: compactUser?.name || compactUser?.Name || '',
    Mobile: compactUser?.Mobile || compactUser?.mobile || '',
    mobile: compactUser?.mobile || compactUser?.Mobile || '',
    'Membership number': compactUser?.['Membership number'] || '',
    membership_number: compactUser?.membership_number || '',
  };

  if (setLocalStorageWithRecovery(USER_STORAGE_KEY, JSON.stringify(minimalUser))) {
    try {
      localStorage.setItem(LOGGED_IN_STORAGE_KEY, 'true');
      return { success: true, degraded: true };
    } catch {
      return { success: false, message: 'Unable to persist login state' };
    }
  }

  return {
    success: false,
    message: 'Device storage is full. Please clear app/browser storage and try again.',
  };
};
