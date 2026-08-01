import { supabase } from './supabaseClient';

const CACHE_KEY = 'contact_trust_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

const resolveCacheKey = (trustId) => `${CACHE_KEY}:${String(trustId || 'global')}`;

const readCache = (trustId) => {
  try {
    const raw = sessionStorage.getItem(resolveCacheKey(trustId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.rows)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.rows;
  } catch {
    return null;
  }
};

const writeCache = (trustId, rows) => {
  try {
    sessionStorage.setItem(resolveCacheKey(trustId), JSON.stringify({ ts: Date.now(), rows }));
  } catch {
    // ignore cache write failures
  }
};

export const clearContactTrustCache = (trustId = null) => {
  try {
    if (trustId) {
      sessionStorage.removeItem(resolveCacheKey(trustId));
      return;
    }

    const keysToDelete = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (key === CACHE_KEY || key.startsWith(`${CACHE_KEY}:`)) keysToDelete.push(key);
    }
    keysToDelete.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // ignore
  }
};

export const fetchContactTrustRows = async (trustId, opts = {}) => {
  if (!trustId) return [];
  const cached = readCache(trustId);
  if (!opts.force && cached) return cached;

  const { data, error } = await supabase
    .from('ContactTrust')
    .select('id, trust_id, facility_name, contact_number, whatsapp_number, email_id, contact_person, created_at, updated_at')
    .eq('trust_id', trustId)
    .order('facility_name', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  writeCache(trustId, rows);
  return rows;
};
