import { supabase } from './supabaseClient';

const CACHE_KEY = 'sub_feature_flags_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

const normalizeToken = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[_\s]+/g, '-') || '';

const ROUTE_ALIASES = {
  members: 'members',
  member: 'members',
  trustee: 'members',
  trustees: 'members',
  'members-directory': 'members',
  'member-directory': 'members',
  healthcare: 'healthcare',
  'healthcare-directory': 'healthcare',
  'doctors-hospitals': 'healthcare',
  'hospitals-doctors': 'healthcare',
  committee: 'committee',
  committees: 'committee',
  'committee-directory': 'committee',
  doctors: 'doctors',
  doctor: 'doctors',
  hospitals: 'hospitals',
  hospital: 'hospitals',
  elected: 'elected',
  'elected-members': 'elected',
};

const resolveSubFeatureId = (route = null, subFeatureName = null) => {
  const routeToken = normalizeToken(route);
  const nameToken = normalizeToken(subFeatureName);
  return ROUTE_ALIASES[routeToken] || ROUTE_ALIASES[nameToken] || routeToken || nameToken;
};

const resolveCacheKey = (trustId = null, featureKey = 'feature_directory', tier = 'gen') => {
  const trustPart = trustId ? String(trustId) : 'global';
  return `${CACHE_KEY}:${trustPart}:${featureKey}:${tier}`;
};

const readCache = (trustId = null, featureKey = 'feature_directory', tier = 'gen') => {
  try {
    const raw = sessionStorage.getItem(resolveCacheKey(trustId, featureKey, tier));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.flags || !parsed.meta) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return { flags: parsed.flags, meta: parsed.meta };
  } catch {
    return null;
  }
};

const writeCache = (flags, meta, trustId = null, featureKey = 'feature_directory', tier = 'gen') => {
  try {
    sessionStorage.setItem(resolveCacheKey(trustId, featureKey, tier), JSON.stringify({ ts: Date.now(), flags, meta }));
  } catch {
    // ignore storage errors
  }
};

export const clearSubFeatureFlagsCache = () => {
  try {
    const keysToDelete = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (key.startsWith(`${CACHE_KEY}:`)) keysToDelete.push(key);
    }
    keysToDelete.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // ignore
  }
};

const fetchForTier = async ({ trustId, featureId, tier }) => {
  const { data, error } = await supabase
    .from('sub_feature_flags')
    .select('enabled, display_name, tagline, icon_url, route, quick_order, tier, sub_features!inner(id, sub_feature_name, feature_id)')
    .eq('trust_id', trustId)
    .eq('tier', tier)
    .eq('sub_features.feature_id', featureId);

  if (error) return { rows: null, error };
  return { rows: data || [], error: null };
};

export const fetchSubFeatureFlags = async (trustId = null, opts = {}) => {
  try {
    const featureKey = opts?.featureKey || 'feature_directory';
    const preferredTier = opts?.tier || 'gen';
    const cached = readCache(trustId, featureKey, preferredTier);
    if (!opts.force && cached) return { success: true, flags: cached.flags, meta: cached.meta, cached: true };

    if (!trustId) return { success: true, flags: {}, meta: {} };

    const { data: featureRow, error: featureError } = await supabase
      .from('features')
      .select('id, name')
      .eq('name', featureKey)
      .maybeSingle();

    if (featureError) {
      console.error('[SubFeatureFlags] Feature lookup error:', featureError.message);
      return { success: false, flags: {}, meta: {} };
    }
    if (!featureRow?.id) return { success: true, flags: {}, meta: {} };

    let rows = [];
    const primary = await fetchForTier({ trustId, featureId: featureRow.id, tier: preferredTier });
    if (primary.error) {
      console.error('[SubFeatureFlags] Fetch error:', primary.error.message);
      return { success: false, flags: {}, meta: {} };
    }
    rows = primary.rows || [];

    if (rows.length === 0 && preferredTier !== 'gen') {
      const fallback = await fetchForTier({ trustId, featureId: featureRow.id, tier: 'gen' });
      if (fallback.error) {
        console.error('[SubFeatureFlags] Fallback fetch error:', fallback.error.message);
        return { success: false, flags: {}, meta: {} };
      }
      rows = fallback.rows || [];
    }

    const flags = {};
    const meta = {};
    rows.forEach((row) => {
      const sub = row?.sub_features;
      const id = resolveSubFeatureId(row?.route, sub?.sub_feature_name);
      if (!id) return;

      flags[id] = !!row.enabled;
      meta[id] = {
        id: sub?.id || null,
        sub_feature_name: sub?.sub_feature_name || null,
        is_enabled: !!row.enabled,
        display_name: row.display_name || null,
        tagline: row.tagline || null,
        icon_url: row.icon_url || null,
        route: row.route || null,
        quick_order: row.quick_order ?? null,
        tier: row.tier || preferredTier,
      };
    });

    writeCache(flags, meta, trustId, featureKey, preferredTier);
    return { success: true, flags, meta };
  } catch (err) {
    console.error('[SubFeatureFlags] Unexpected error:', err?.message || err);
    return { success: false, flags: {}, meta: {} };
  }
};

export const subscribeSubFeatureFlags = (trustId, onChange) => {
  try {
    const channel = supabase
      .channel(`sub-feature-flags-${trustId || 'global'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sub_feature_flags' },
        () => {
          clearSubFeatureFlagsCache();
          if (typeof onChange === 'function') onChange();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sub_features' },
        () => {
          clearSubFeatureFlagsCache();
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
