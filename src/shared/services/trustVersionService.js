import { supabase } from './supabaseClient';

const TRUST_VERSION_KEY_PREFIX = 'trust_version_';
const TRUST_VERSION_UPDATED_EVENT = 'trust-version-updated';

const TRUST_SCOPED_CACHE_PREFIXES = [
  'contact_trust_cache_v1:',
  'directory_data_cache_',
  'directory_cache_timestamp_',
  'achievements_cache_v1:',
  'sub_feature_flags_cache_v1:',
  'feature_flags_cache_v4:',
  'feature_flags_cache_v3:',
  'theme_cache_v3_',
  'theme_cache_persist_v3_',
  'theme_cache_trust_v3_',
  'theme_cache_persist_trust_v3_',
  'theme_cache_v2_',
  'theme_cache_persist_v2_',
  'theme_cache_trust_v2_',
  'theme_cache_persist_trust_v2_'
];

const toTrustId = (value) => String(value || '').trim();

const toSafeInt = (value) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getTrustVersionStorageKey = (trustId) => `${TRUST_VERSION_KEY_PREFIX}${toTrustId(trustId)}`;

export const readLocalTrustVersion = (trustId) => {
  const normalizedTrustId = toTrustId(trustId);
  if (!normalizedTrustId) return null;
  return toSafeInt(localStorage.getItem(getTrustVersionStorageKey(normalizedTrustId)));
};

export const writeLocalTrustVersion = (trustId, version) => {
  const normalizedTrustId = toTrustId(trustId);
  const normalizedVersion = toSafeInt(version);
  if (!normalizedTrustId || normalizedVersion === null) return;
  localStorage.setItem(getTrustVersionStorageKey(normalizedTrustId), String(normalizedVersion));
};

export const fetchTrustVersion = async (trustId) => {
  const normalizedTrustId = toTrustId(trustId);
  if (!normalizedTrustId) return null;

  const { data, error } = await supabase
    .from('Trust')
    .select('version')
    .eq('id', normalizedTrustId)
    .maybeSingle();

  if (error) throw error;
  return toSafeInt(data?.version);
};

const removeMatchingKeys = (storage, trustId) => {
  const keysToDelete = [];

  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;

    if (key.includes(trustId) || TRUST_SCOPED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix) && key.includes(trustId))) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => storage.removeItem(key));
};

export const clearTrustScopedCache = (trustId) => {
  const normalizedTrustId = toTrustId(trustId);
  if (!normalizedTrustId) return;

  try {
    removeMatchingKeys(sessionStorage, normalizedTrustId);
    removeMatchingKeys(localStorage, normalizedTrustId);
  } catch (error) {
    console.warn('[TrustVersion] failed to clear trust cache:', error?.message || error);
  }
};

export const syncTrustVersion = async (trustId, opts = {}) => {
  const normalizedTrustId = toTrustId(trustId);
  if (!normalizedTrustId) return { changed: false, trustId: '', localVersion: null, remoteVersion: null };

  const remoteVersion = await fetchTrustVersion(normalizedTrustId);
  if (remoteVersion === null) {
    return { changed: false, trustId: normalizedTrustId, localVersion: readLocalTrustVersion(normalizedTrustId), remoteVersion: null };
  }

  const localVersion = readLocalTrustVersion(normalizedTrustId);
  const changed = localVersion === null || remoteVersion > localVersion;

  if (changed && opts.clearCache !== false) {
    clearTrustScopedCache(normalizedTrustId);
  }

  writeLocalTrustVersion(normalizedTrustId, remoteVersion);

  if (changed) {
    window.dispatchEvent(new CustomEvent(TRUST_VERSION_UPDATED_EVENT, {
      detail: {
        trustId: normalizedTrustId,
        previousVersion: localVersion,
        nextVersion: remoteVersion
      }
    }));
  }

  return { changed, trustId: normalizedTrustId, localVersion, remoteVersion };
};

export { TRUST_VERSION_UPDATED_EVENT };
