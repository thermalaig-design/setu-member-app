const EVENT_TYPES = new Set(['login', 'logout', 'autologout']);
const LOGIN_METHODS = new Set(['otp', 'secret_code']);
const LAST_LOGIN_METHOD_KEY = 'last_login_method';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || (API_BASE_URL ? `${String(API_BASE_URL).replace(/\/$/, '')}/auth` : '');

const normalize = (value) => String(value || '').trim();
const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizeLoginMethod = (value) => {
  const normalized = normalize(value).toLowerCase();
  return LOGIN_METHODS.has(normalized) ? normalized : null;
};

const readStoredLoginMethod = () => {
  try {
    if (!canUseStorage()) return null;
    return normalizeLoginMethod(window.localStorage.getItem(LAST_LOGIN_METHOD_KEY));
  } catch {
    return null;
  }
};

const writeStoredLoginMethod = (loginMethod) => {
  try {
    if (!canUseStorage() || !loginMethod) return;
    window.localStorage.setItem(LAST_LOGIN_METHOD_KEY, loginMethod);
  } catch {
    // ignore storage issues
  }
};

const postAuthJson = async (endpoint, payload) => {
  const base = String(AUTH_API_URL || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error('Missing VITE_AUTH_API_URL');
  }

  const url = `${base}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    keepalive: true
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || 'Session event request failed');
  }

  return data;
};

const getStorageTrustId = () => {
  try {
    if (!canUseStorage()) return null;
    const trustId = normalize(
      window.localStorage.getItem('selected_trust_id') ||
      window.localStorage.getItem('last_selected_trust_id')
    );
    return trustId || null;
  } catch {
    return null;
  }
};

const resolveTrustId = (user = {}, extra = {}, actionType = 'login') => {
  const fromExtra = normalize(extra?.trust_id || extra?.trustId);
  const fromUser = normalize(user?.trust?.id || user?.primary_trust?.id || user?.trust_id);
  const fromStorage = getStorageTrustId();

  if (actionType === 'login') {
    return fromExtra || fromUser || fromStorage || '';
  }

  return fromExtra || fromStorage || fromUser || '';
};

const resolvePlatform = () => {
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').toLowerCase() : '';
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  return 'web';
};

const buildPayload = (user = {}, actionType = 'login', extra = {}) => {
  const memberId = normalize(user?.members_id || user?.member_id || user?.id);
  const memberName = normalize(user?.name || user?.Name);
  const mobile = normalize(user?.mobile || user?.Mobile || user?.phone);
  const trustId = resolveTrustId(user, extra, actionType);
  const trustName = normalize(user?.trust?.name || user?.primary_trust?.name || extra?.trust_name || extra?.trustName) || null;

  const inputLoginMethod = normalizeLoginMethod(extra?.login_method || extra?.loginMethod);
  const fallbackLoginMethod = actionType === 'login' ? null : readStoredLoginMethod();
  const loginMethod = inputLoginMethod || fallbackLoginMethod;

  return {
    members_id: memberId || null,
    member_name: memberName || null,
    mobile: mobile || null,
    action_type: EVENT_TYPES.has(actionType) ? actionType : 'login',
    login_method: loginMethod || null,
    trust_id: trustId || null,
    app_platform: resolvePlatform(),
    metadata: {
      trust_id: trustId || null,
      trust_name: trustName,
      login_method: loginMethod || null,
      ...extra
    }
  };
};

export const logUserSessionEvent = async ({ user, actionType, extra = {} }) => {
  try {
    const payload = buildPayload(user, actionType, extra);
    await postAuthJson('/session-event', payload);
    if (payload.action_type === 'login' && payload.login_method) {
      writeStoredLoginMethod(payload.login_method);
    }
    return { success: true };
  } catch (error) {
    console.warn('[SessionAudit] request failed:', error?.message || error);
    return { success: false, error };
  }
};
