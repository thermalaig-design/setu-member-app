const LOGIN_TERMS_PROMPT_KEY = 'login_terms_prompt_pending';

const normalizeTrustId = (value) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'nan'].includes(lowered)) return '';
  return normalized;
};

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
const canUseSessionStorage = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

const readStoredTrustId = (key) => {
  if (!canUseStorage()) return '';
  try {
    return normalizeTrustId(window.localStorage.getItem(key) || '');
  } catch {
    return '';
  }
};

export const resolveLegalTrustId = (fallbackTrustId = '') => {
  const selectedId = readStoredTrustId('selected_trust_id');
  if (selectedId) return selectedId;

  const persistedSelectedId = readStoredTrustId('last_selected_trust_id');
  if (persistedSelectedId) return persistedSelectedId;

  if (canUseStorage()) {
    try {
      const cachedDefault = window.localStorage.getItem('default_trust_cache');
      if (cachedDefault) {
        const parsed = JSON.parse(cachedDefault);
        const cachedDefaultId = normalizeTrustId(parsed?.id || '');
        if (cachedDefaultId) return cachedDefaultId;
      }
    } catch {
      // ignore malformed cache
    }
  }

  const fallback = normalizeTrustId(fallbackTrustId);
  if (fallback) return fallback;

  return normalizeTrustId(import.meta.env.VITE_DEFAULT_TRUST_ID || '');
};

export const parseLegalSections = (rawText) => {
  if (!rawText) return [];

  if (/<[a-z][\s\S]*>/i.test(rawText)) {
    return [{ title: '', body: rawText, isHtml: true }];
  }

  return rawText
    .split(/(?=\d+\.\s)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+)\.\s+(.+?)(?:\n|$)([\s\S]*)/);
      if (!match) {
        return { num: null, title: null, body: part, isHtml: false };
      }

      return {
        num: match[1],
        title: match[2].trim(),
        body: match[3].trim(),
        isHtml: false,
      };
    });
};

export const isLoginTermsPromptPending = () => {
  if (!canUseSessionStorage()) return false;
  try {
    return window.sessionStorage.getItem(LOGIN_TERMS_PROMPT_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setLoginTermsPromptPending = () => {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(LOGIN_TERMS_PROMPT_KEY, 'true');
  } catch {
    // ignore storage failures
  }
};

export const clearLoginTermsPromptPending = () => {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(LOGIN_TERMS_PROMPT_KEY);
  } catch {
    // ignore storage failures
  }
};
