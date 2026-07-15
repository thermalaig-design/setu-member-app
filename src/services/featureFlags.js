import { supabase } from './supabaseClient';

const CACHE_KEY = 'feature_flags_cache_v3';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const FEATURE_KEY_ALIASES = {
  donation: 'feature_donation',
  feature_donation: 'feature_donation',
  executivebody: 'feature_executive_body',
  executive_body: 'feature_executive_body',
  'executive-body': 'feature_executive_body',
  feature_executive_body: 'feature_executive_body',
  feature_executivebody: 'feature_executive_body',
  contactus: 'feature_contact_us',
  contact_us: 'feature_contact_us',
  feature_contact_us: 'feature_contact_us',
  'contact-us': 'feature_contact_us',
  ContactUs: 'feature_contact_us',
  myfamily: 'feature_my_family',
  my_family: 'feature_my_family',
  'my-family': 'feature_my_family',
  feature_my_family: 'feature_my_family',
  nominationdetails: 'feature_nomination_details',
  nomination_details: 'feature_nomination_details',
  'nomination-details': 'feature_nomination_details',
  feature_nomination_details: 'feature_nomination_details',
  addcommunity: 'feature_add_community',
  add_community: 'feature_add_community',
  'add-community': 'feature_add_community',
  feature_add_community: 'feature_add_community',
};

export const normalizeFeatureKey = (...values) => {
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '_');
    if (!normalized) continue;
    if (FEATURE_KEY_ALIASES[normalized]) return FEATURE_KEY_ALIASES[normalized];
    if (normalized.startsWith('feature_')) return normalized;
    return `feature_${normalized}`;
  }
  return null;
};

const resolveCacheKey = (trustId = null, tier = 'general') => {
  const trustPart = trustId ? String(trustId) : 'global';
  const tierPart = tier ? String(tier) : 'general';
  return `${CACHE_KEY}:${trustPart}:${tierPart}`;
};

// ── Cache helpers ──────────────────────────────────────────────────
const readCache = (trustId = null, tier = 'general') => {
  try {
    const raw = sessionStorage.getItem(resolveCacheKey(trustId, tier));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.flags) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    // Return both flags (booleans) and flagsData (full metadata)
    return { flags: parsed.flags, flagsData: parsed.flagsData || {} };
  } catch {
    return null;
  }
};

const writeCache = (flags, flagsData, trustId = null, tier = 'general') => {
  try {
    sessionStorage.setItem(resolveCacheKey(trustId, tier), JSON.stringify({ ts: Date.now(), flags, flagsData }));
  } catch {
    // ignore storage errors
  }
};

export const clearFeatureFlagsCache = () => {
  try {
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

// ── Fetch feature flags for a given trust ─────────────────────────
// Uses features + feature_flags join
// Returns: { success, flags: { feature_key: boolean }, flagsData: { feature_key: { display_name, tagline, icon_url, is_enabled } }, cached? }
export const fetchFeatureFlags = async (trustId = null, opts = {}) => {
  try {
    const tier = opts?.tier || 'general';
    const cached = readCache(trustId, tier);
    if (!opts.force && cached) return { success: true, flags: cached.flags, flagsData: cached.flagsData, cached: true };

    if (!trustId) {
      // No trust selected — default all features to enabled
      return { success: true, flags: {}, flagsData: {} };
    }

    const { data: rows, error } = await supabase
      .from('feature_flags')
      .select('is_enabled, display_name, tagline, icon_url, route, quick_order, name, features(name, subname)')
      .eq('trust_id', trustId)
      .eq('tier', tier);

    if (error) {
      console.error('[FeatureFlags] Fetch error:', error.message);
      return { success: false, flags: {}, flagsData: {} };
    }

    // Build a flat boolean map: { feature_key: boolean }
    // Also build a metadata map: { feature_key: { display_name, tagline, icon_url, is_enabled } }
    const flags = {};
    const flagsData = {};
    (rows || []).forEach((row) => {
      // Prefer features.name (join), fallback to name column
      const key = normalizeFeatureKey(
        row?.features?.name,
        row?.name,
        row?.features?.subname
      );
      if (key) {
        flags[key] = !!row.is_enabled;
        flagsData[key] = {
          is_enabled: !!row.is_enabled,
          display_name: row.display_name || null,
          tagline: row.tagline || null,
          icon_url: row.icon_url || null,
          route: row.route || null,
          quick_order: row.quick_order ?? null,
        };
      }
    });

    writeCache(flags, flagsData, trustId, tier);
    return { success: true, flags, flagsData };
  } catch (err) {
    console.error('[FeatureFlags] Unexpected error:', err.message || err);
    return { success: false, flags: {}, flagsData: {} };
  }
};

// ── Subscribe to real-time feature flag changes ────────────────────
export const subscribeFeatureFlags = (trustId, onChange) => {
  try {
    const channel = supabase
      .channel(`feature-flags-${trustId || 'global'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        () => {
          clearFeatureFlagsCache();
          if (typeof onChange === 'function') onChange();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => {});
    };
  } catch {
    return () => {};
  }
};

// ── Helper: is a feature enabled? (default true when key not found) ─
// Usage: isFeatureEnabled(featureFlags, 'feature_gallery')
export const isFeatureEnabled = (flags, key) => {
  if (!flags || typeof flags !== 'object') return true;
  const normalizedKey = normalizeFeatureKey(key) || String(key || '').trim();
  if (!(normalizedKey in flags)) return true; // not configured = enabled by default
  return flags[normalizedKey] !== false;
};
