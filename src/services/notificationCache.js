const CACHE_PREFIX = 'notification_cache_v1';
const CACHE_TTL_MS = 2 * 60 * 1000;

const normalizeValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'nan'].includes(lowered)) return '';
  return normalized;
};

const readCurrentUserKey = () => {
  try {
    const rawUser = localStorage.getItem('user');
    if (!rawUser) return '';
    const user = JSON.parse(rawUser);
    return normalizeValue(
      user?.Mobile ||
      user?.mobile ||
      user?.phone ||
      user?.id ||
      user?.members_id ||
      user?.member_id
    );
  } catch {
    return '';
  }
};

const getCacheKey = (trustId) => {
  const userKey = readCurrentUserKey();
  const trustKey = normalizeValue(trustId || localStorage.getItem('selected_trust_id'));
  if (!userKey || !trustKey) return '';
  return `${CACHE_PREFIX}:${userKey}:${trustKey}`;
};

export const readNotificationCache = (trustId) => {
  try {
    const key = getCacheKey(trustId);
    if (!key) return null;

    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const notifications = Array.isArray(parsed?.notifications) ? parsed.notifications : [];
    const cachedAt = Number(parsed?.cachedAt || 0);

    return {
      key,
      notifications,
      cachedAt,
      isFresh: cachedAt > 0 && (Date.now() - cachedAt) <= CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
};

export const writeNotificationCache = (trustId, notifications = []) => {
  try {
    const key = getCacheKey(trustId);
    if (!key) return;

    sessionStorage.setItem(key, JSON.stringify({
      cachedAt: Date.now(),
      notifications: Array.isArray(notifications) ? notifications : [],
    }));
  } catch {
    // Ignore cache write failures.
  }
};

export const clearNotificationCache = (trustId) => {
  try {
    const key = getCacheKey(trustId);
    if (!key) return;
    sessionStorage.removeItem(key);
  } catch {
    // Ignore cache clear failures.
  }
};
