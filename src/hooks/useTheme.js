import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  DEFAULT_THEME,
  buildThemeFromTemplate,
  mergeResolvedThemes,
  sanitizeCustomCss,
  getThemeToken
} from '../utils/themeUtils';
import {
  THEME_TEMPLATE_APPLIED_EVENT,
  dispatchThemeRefresh,
  dispatchThemeTemplateApplied
} from '../utils/themeEvents';

const LAST_THEME_CACHE_KEY = 'last_theme_cache_v3';
const LEGACY_LAST_THEME_CACHE_KEYS = ['last_theme_cache_v2', 'last_theme_cache_v1'];
const THEME_CACHE_VERSION = 'v3';
const LEGACY_THEME_CACHE_VERSIONS = ['v2'];
const getPersistTrustCacheIndexKey = (trustId) => `theme_cache_persist_trust_${THEME_CACHE_VERSION}_${trustId}`;
const getPersistThemeCacheEntryKey = (trustId, templateId) => `theme_cache_persist_${THEME_CACHE_VERSION}_${trustId}_${templateId || 'none'}`;
const BASE_TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const THEME_CACHE_TTL_MS = Number(import.meta.env.VITE_THEME_CACHE_TTL_MS) > 0
  ? Number(import.meta.env.VITE_THEME_CACHE_TTL_MS)
  : (import.meta.env.DEV ? 5 * 60 * 1000 : 20 * 60 * 1000);
const themeTraceEnabled = Boolean(import.meta.env.DEV)
  || String(import.meta.env.VITE_THEME_BOOT_TRACE || '').toLowerCase() === 'true';

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const deepMergeObjects = (base, override) => {
  if (!isPlainObject(base)) return isPlainObject(override) ? { ...override } : {};
  if (!isPlainObject(override)) return { ...base };
  const next = { ...base };
  Object.keys(override).forEach((key) => {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      next[key] = deepMergeObjects(baseValue, overrideValue);
      return;
    }
    next[key] = overrideValue;
  });
  return next;
};

const parseJsonObject = (value, fallback = {}) => {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return fallback;
  const parsed = safeParse(value);
  return isPlainObject(parsed) ? parsed : fallback;
};

const tagThemeSource = (theme, source) => {
  if (!theme || typeof theme !== 'object') return theme;
  return { ...theme, themeLoadSource: source };
};

const traceThemeBoot = (event, payload = {}) => {
  if (!themeTraceEnabled) return;
  console.log(`[ThemeBoot] ${event}`, payload);
};

const resolveStoredTrustId = () => {
  const selected = String(localStorage.getItem('selected_trust_id') || '').trim();
  if (selected) return selected;
  const cachedDefault = safeParse(localStorage.getItem('default_trust_cache') || '');
  const fallback = String(cachedDefault?.id || '').trim();
  if (fallback) return fallback;
  const lastTheme = safeParse(localStorage.getItem(LAST_THEME_CACHE_KEY) || '')
    || LEGACY_LAST_THEME_CACHE_KEYS.map((key) => safeParse(localStorage.getItem(key) || '')).find(Boolean);
  const lastThemeTrustId = String(lastTheme?.selectedTrustId || lastTheme?.trustId || '').trim();
  return lastThemeTrustId || '';
};

const getTrustCacheIndexKey = (trustId) => `theme_cache_trust_${THEME_CACHE_VERSION}_${trustId}`;
const getThemeCacheEntryKey = (trustId, templateId) => `theme_cache_${THEME_CACHE_VERSION}_${trustId}_${templateId || 'none'}`;
const normalizeTemplateMetaValue = (value) => String(value || '').trim() || null;

const readLastThemeCache = (trustId) => {
  const parsedV3 = safeParse(localStorage.getItem(LAST_THEME_CACHE_KEY) || '');
  const parsed = parsedV3
    || LEGACY_LAST_THEME_CACHE_KEYS.map((key) => safeParse(localStorage.getItem(key) || '')).find(Boolean);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!trustId) return parsed;
  const cachedTrustId = String(parsed.selectedTrustId || parsed.trustId || '').trim();
  return cachedTrustId && cachedTrustId === trustId ? parsed : null;
};

const readCachedThemeEntry = (trustId) => {
  if (!trustId) return null;

  const indexKey = getTrustCacheIndexKey(trustId);
  const activeEntryKey = sessionStorage.getItem(indexKey);
  if (activeEntryKey) {
    const parsed = safeParse(sessionStorage.getItem(activeEntryKey) || '');
    if (parsed && typeof parsed === 'object' && parsed.theme && typeof parsed.theme === 'object') {
      return {
        theme: parsed.theme,
        ts: Number(parsed.ts) || 0,
        templateId: parsed.templateId || null,
        cacheKey: activeEntryKey
      };
    }
  }

  const persistIndexKey = getPersistTrustCacheIndexKey(trustId);
  const persistEntryKey = localStorage.getItem(persistIndexKey);
  if (persistEntryKey) {
    const parsedPersist = safeParse(localStorage.getItem(persistEntryKey) || '');
    if (parsedPersist && typeof parsedPersist === 'object' && parsedPersist.theme && typeof parsedPersist.theme === 'object') {
      return {
        theme: parsedPersist.theme,
        ts: Number(parsedPersist.ts) || 0,
        templateId: parsedPersist.templateId || null,
        cacheKey: persistEntryKey
      };
    }
  }

  // Recovery path: if trust index keys are missing but cache entries still exist,
  // pick the newest cache entry for this trust.
  const trustSessionPrefix = `theme_cache_${THEME_CACHE_VERSION}_${trustId}_`;
  const trustPersistPrefix = `theme_cache_persist_${THEME_CACHE_VERSION}_${trustId}_`;
  let recovered = null;

  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (!key || !key.startsWith(trustSessionPrefix)) continue;
    const parsed = safeParse(sessionStorage.getItem(key) || '');
    if (!parsed?.theme || typeof parsed.theme !== 'object') continue;
    const ts = Number(parsed.ts) || 0;
    if (!recovered || ts > recovered.ts) {
      recovered = {
        theme: parsed.theme,
        ts,
        templateId: parsed.templateId || null,
        cacheKey: key
      };
    }
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(trustPersistPrefix)) continue;
    const parsed = safeParse(localStorage.getItem(key) || '');
    if (!parsed?.theme || typeof parsed.theme !== 'object') continue;
    const ts = Number(parsed.ts) || 0;
    if (!recovered || ts > recovered.ts) {
      recovered = {
        theme: parsed.theme,
        ts,
        templateId: parsed.templateId || null,
        cacheKey: key
      };
    }
  }

  if (recovered) return recovered;

  const legacyParsed = safeParse(sessionStorage.getItem(`theme_cache_${trustId}`) || '');
  if (!legacyParsed || typeof legacyParsed !== 'object') return null;

  if (legacyParsed.theme && typeof legacyParsed.theme === 'object') {
    return {
      theme: legacyParsed.theme,
      ts: Number(legacyParsed.ts) || 0,
      templateId: legacyParsed.theme?.selectedTrustTemplateId || legacyParsed.theme?.templateId || null,
      cacheKey: `theme_cache_${trustId}`
    };
  }

  return {
    theme: legacyParsed,
    ts: 0,
    templateId: legacyParsed?.selectedTrustTemplateId || legacyParsed?.templateId || null,
    cacheKey: `theme_cache_${trustId}`
  };
};

const isStale = (timestamp) => {
  const ts = Number(timestamp) || 0;
  if (!ts) return true;
  return (Date.now() - ts) > THEME_CACHE_TTL_MS;
};

const clearThemeCacheForTrust = (trustId) => {
  if (!trustId) return;
  const trustPrefix = `theme_cache_${THEME_CACHE_VERSION}_${trustId}_`;
  const persistPrefix = `theme_cache_persist_${THEME_CACHE_VERSION}_${trustId}_`;
  const indexKey = getTrustCacheIndexKey(trustId);
  const persistIndexKey = getPersistTrustCacheIndexKey(trustId);
  const legacySessionPrefixes = LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_${version}_${trustId}_`);
  const legacyPersistPrefixes = LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_persist_${version}_${trustId}_`);
  const legacyIndexKeys = LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_trust_${version}_${trustId}`);
  const legacyPersistIndexKeys = LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_persist_trust_${version}_${trustId}`);
  const keysToRemove = [];
  const localKeysToRemove = [];

  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (!key) continue;
    if (
      key === indexKey
      || key === `theme_cache_${trustId}`
      || key.startsWith(trustPrefix)
      || legacyIndexKeys.includes(key)
      || legacySessionPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      keysToRemove.push(key);
    }
  }

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key === persistIndexKey
      || key.startsWith(persistPrefix)
      || legacyPersistIndexKeys.includes(key)
      || legacyPersistPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      localKeysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  localKeysToRemove.forEach((key) => localStorage.removeItem(key));

  // Also clear localStorage last-theme cache so stale data doesn't
  // persist across sessions after a template change.
  try {
    [LAST_THEME_CACHE_KEY, ...LEGACY_LAST_THEME_CACHE_KEYS].forEach((key) => {
      const stored = safeParse(localStorage.getItem(key) || '');
      const storedTrustId = String(stored?.selectedTrustId || stored?.trustId || '').trim();
      if (storedTrustId === trustId) localStorage.removeItem(key);
    });
  } catch {
    // no-op
  }
};

const writeThemeCache = (trustId, theme) => {
  if (!trustId || !theme) return;
  const templateId = String(theme?.selectedTrustTemplateId || theme?.templateId || 'none');
  const entryKey = getThemeCacheEntryKey(trustId, templateId);
  const persistEntryKey = getPersistThemeCacheEntryKey(trustId, templateId);
  const persistIndexKey = getPersistTrustCacheIndexKey(trustId);
  const payload = {
    trustId,
    templateId,
    ts: Date.now(),
    theme
  };

  sessionStorage.setItem(entryKey, JSON.stringify(payload));
  sessionStorage.setItem(getTrustCacheIndexKey(trustId), entryKey);
  localStorage.setItem(persistEntryKey, JSON.stringify(payload));
  localStorage.setItem(persistIndexKey, persistEntryKey);
  localStorage.setItem(LAST_THEME_CACHE_KEY, JSON.stringify({
    ...theme,
    selectedTrustId: trustId,
    selectedTrustTemplateId: templateId,
    themeLoadSource: 'cache'
  }));
};

const hasTemplateMetaChanged = ({ cachedTemplateId, cachedTemplateUpdatedAt, latestMeta }) => {
  const latestTemplateId = normalizeTemplateMetaValue(latestMeta?.trustTemplateId);
  const latestTemplateUpdatedAt = latestMeta?.linkedTemplateUpdatedAt || null;

  return latestTemplateId !== normalizeTemplateMetaValue(cachedTemplateId)
    || latestTemplateUpdatedAt !== (cachedTemplateUpdatedAt || null);
};

const APP_TEMPLATE_SELECT = 'id, trust_id, name, template_key, theme_config, home_layout, animations, custom_css, updated_at';

const fetchTemplateByTrustId = async (targetTrustId) => {
  if (!targetTrustId) return { template: null, error: null };
  const result = await supabase
    .from('app_templates')
    .select(APP_TEMPLATE_SELECT)
    .eq('trust_id', String(targetTrustId))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    template: result?.data || null,
    error: result?.error || null
  };
};

const fetchTrustThemeLink = async (targetTrustId) => {
  if (!targetTrustId) {
    return {
      trust: null,
      template: null,
      overrides: {},
      linkSource: 'missing_trust'
    };
  }

  const trustResult = await supabase
    .from('Trust')
    .select('id, name, template_id')
    .eq('id', targetTrustId)
    .maybeSingle();

  if (trustResult?.error) {
    return {
      trust: null,
      template: null,
      overrides: {},
      linkSource: 'trust_query_error',
      error: trustResult.error
    };
  }

  const trust = trustResult?.data || null;
  if (!trust) {
    return {
      trust: null,
      template: null,
      overrides: {},
      linkSource: 'missing_trust'
    };
  }

  const linkedTemplateId = trust.template_id || null;
  if (!linkedTemplateId) {
    const fallbackTemplateResult = await fetchTemplateByTrustId(targetTrustId);
    if (fallbackTemplateResult.error) {
      return {
        trust,
        template: null,
        overrides: {},
        linkSource: 'trust_template_fallback_query_error',
        error: fallbackTemplateResult.error
      };
    }

    if (fallbackTemplateResult.template) {
      return {
        trust,
        template: fallbackTemplateResult.template,
        overrides: {},
        linkSource: 'linked_template_by_trust_id'
      };
    }

    if (import.meta.env.DEV) {
      console.log('[useTheme][TemplateLink][Fetch]', {
        trustId: targetTrustId,
        trustTemplateId: null,
        fetchedTemplateId: null,
        fetchedTemplateUpdatedAt: null,
        fetchedTemplateIsActive: null,
        linkSource: 'no_template_link'
      });
    }
    return {
      trust,
      template: null,
      overrides: {},
      linkSource: 'no_template_link'
    };
  }

  const templateResult = await supabase
    .from('app_templates')
    .select(APP_TEMPLATE_SELECT)
    .eq('id', linkedTemplateId)
    .maybeSingle();

  if (templateResult?.error) {
    return {
      trust,
      template: null,
      overrides: {},
      linkSource: 'linked_template_query_error',
      error: templateResult.error
    };
  }

  const template = templateResult?.data || null;
  const fallbackTemplateResult = template ? null : await fetchTemplateByTrustId(targetTrustId);
  const resolvedTemplate = template || fallbackTemplateResult?.template || null;
  const linkSource = template
    ? 'linked_template'
    : (resolvedTemplate ? 'linked_template_by_trust_id' : 'invalid_template_link');

  if (!template && fallbackTemplateResult?.error) {
    return {
      trust,
      template: null,
      overrides: {},
      linkSource: 'trust_template_fallback_query_error',
      error: fallbackTemplateResult.error
    };
  }

  if (import.meta.env.DEV) {
    console.log('[useTheme][TemplateLink][Fetch]', {
      trustId: targetTrustId,
      trustTemplateId: linkedTemplateId,
      fetchedTemplateId: resolvedTemplate?.id || null,
      fetchedTemplateUpdatedAt: resolvedTemplate?.updated_at || null,
      linkSource
    });
  }
  return {
    trust,
    template: resolvedTemplate,
    overrides: {},
    linkSource
  };
};

const fetchTrustTemplateMeta = async (targetTrustId) => {
  if (!targetTrustId) return null;

  const trustResult = await supabase
    .from('Trust')
    .select('id, name, template_id')
    .eq('id', targetTrustId)
    .maybeSingle();

  if (trustResult?.error) {
    return {
      trustId: targetTrustId,
      trustName: null,
      trustTemplateId: null,
      trustUpdatedAt: null,
      linkedTemplateId: null,
      linkedTemplateUpdatedAt: null,
      linkedTemplateName: null,
      templateExists: false,
      source: 'trust_meta_error'
    };
  }

  const trust = trustResult?.data || null;
  if (!trust) {
    return {
      trustId: targetTrustId,
      trustName: null,
      trustTemplateId: null,
      trustUpdatedAt: null,
      linkedTemplateId: null,
      linkedTemplateUpdatedAt: null,
      linkedTemplateName: null,
      templateExists: false
    };
  }

  const linkedTemplateId = trust.template_id || null;
  if (!linkedTemplateId) {
    return {
      trustId: trust.id,
      trustName: trust.name || null,
      trustTemplateId: null,
      trustUpdatedAt: null,
      linkedTemplateId: null,
      linkedTemplateUpdatedAt: null,
      linkedTemplateName: null,
      templateExists: false
    };
  }

  const templateResult = await supabase
    .from('app_templates')
    .select('id, name, updated_at')
    .eq('id', linkedTemplateId)
    .maybeSingle();

  const template = templateResult?.data || null;

  return {
    trustId: trust.id,
    trustName: trust.name || null,
    trustTemplateId: linkedTemplateId,
    trustUpdatedAt: null,
    linkedTemplateId,
    linkedTemplateUpdatedAt: template?.updated_at || null,
    linkedTemplateName: template?.name || null,
    templateExists: Boolean(template?.id)
  };
};

export const useTheme = (trustId) => {
  const [refreshTick, setRefreshTick] = useState(0);
  const isCacheValidationInFlightRef = useRef(false);
  const hasQueuedRefreshRef = useRef(false);
  const previousTrustIdRef = useRef(null);
  const prefetchedTrustIdsRef = useRef(new Set());
  const initialThemeStateRef = useRef(null);
  if (!initialThemeStateRef.current) {
    try {
      const resolvedTrustId = String(trustId || '').trim() || resolveStoredTrustId();
      const immediateTheme = readCachedThemeEntry(resolvedTrustId)?.theme || readLastThemeCache(resolvedTrustId) || null;
      initialThemeStateRef.current = {
        theme: immediateTheme || DEFAULT_THEME,
        hasImmediateTheme: Boolean(immediateTheme),
        resolvedTrustId
      };
    } catch {
      initialThemeStateRef.current = {
        theme: DEFAULT_THEME,
        hasImmediateTheme: false,
        resolvedTrustId: ''
      };
    }
  }
  const [theme, setTheme] = useState(() => initialThemeStateRef.current.theme);
  const [isThemeLoading, setIsThemeLoading] = useState(() => {
    const initialState = initialThemeStateRef.current;
    if (!initialState?.resolvedTrustId) return false;
    return !initialState.hasImmediateTheme;
  });

  useEffect(() => {
    const resolvedTrustId = String(trustId || '').trim() || resolveStoredTrustId();
    const previousTrustId = previousTrustIdRef.current;
    previousTrustIdRef.current = resolvedTrustId || null;
    if (!resolvedTrustId) {
      setIsThemeLoading(false);
      return undefined;
    }

    if (import.meta.env.DEV) {
      console.log('[useTheme][TemplateLink] Trust context resolved:', {
        previousTrustId: previousTrustId || null,
        selectedTrustId: resolvedTrustId
      });
    }

    const validateCacheInBackground = async (cachedTheme) => {
      if (isCacheValidationInFlightRef.current) return;
      isCacheValidationInFlightRef.current = true;
      try {
        const isBaseTrustSelected = resolvedTrustId === BASE_TRUST_ID;
        const [latestBaseMeta, latestSelectedMeta] = await Promise.all([
          fetchTrustTemplateMeta(BASE_TRUST_ID),
          isBaseTrustSelected ? Promise.resolve(null) : fetchTrustTemplateMeta(resolvedTrustId)
        ]);

        const cachedBaseTemplateId = String(cachedTheme?.baseTrustTemplateId || '').trim() || null;
        const cachedSelectedTemplateId = String(cachedTheme?.selectedTrustTemplateId || '').trim() || null;
        const cachedBaseTemplateUpdatedAt = cachedTheme?.baseTemplateUpdatedAt || null;
        const cachedSelectedTemplateUpdatedAt = cachedTheme?.selectedTemplateUpdatedAt || null;

        const shouldReloadBase = hasTemplateMetaChanged({
          cachedTemplateId: cachedBaseTemplateId,
          cachedTemplateUpdatedAt: cachedBaseTemplateUpdatedAt,
          latestMeta: latestBaseMeta
        });

        const shouldReloadSelected = isBaseTrustSelected
          ? false
          : hasTemplateMetaChanged({
            cachedTemplateId: cachedSelectedTemplateId,
            cachedTemplateUpdatedAt: cachedSelectedTemplateUpdatedAt,
            latestMeta: latestSelectedMeta
          });

        const cacheOutdated = shouldReloadBase || shouldReloadSelected;

        if (import.meta.env.DEV) {
          console.log('[useTheme][TemplateLink][CacheValidation]', {
            selectedTrustId: resolvedTrustId,
            selectedTrustTemplateId: latestSelectedMeta?.trustTemplateId || null,
            baseTrustTemplateId: latestBaseMeta?.trustTemplateId || null,
            linkedSelectedTemplateId: latestSelectedMeta?.linkedTemplateId || null,
            linkedSelectedTemplateName: latestSelectedMeta?.linkedTemplateName || null,
            linkedBaseTemplateId: latestBaseMeta?.linkedTemplateId || null,
            linkedBaseTemplateName: latestBaseMeta?.linkedTemplateName || null,
            cachedSelectedTemplateId,
            cachedBaseTemplateId,
            cacheOutdated
          });
        }

        if (cacheOutdated && !hasQueuedRefreshRef.current) {
          hasQueuedRefreshRef.current = true;
          clearThemeCacheForTrust(resolvedTrustId);
          setRefreshTick((prev) => prev + 1);
        }
      } catch (err) {
        console.warn('[useTheme][TemplateLink] Cache validation failed:', err);
      } finally {
        isCacheValidationInFlightRef.current = false;
      }
    };

    const cachedEntry = readCachedThemeEntry(resolvedTrustId);
    const hasCachedTheme = Boolean(cachedEntry?.theme);
    const shouldRefreshFromDb = !hasCachedTheme || isStale(cachedEntry?.ts);
    traceThemeBoot('startup-context', {
      trustId: resolvedTrustId,
      hasCachedTheme,
      cacheKey: cachedEntry?.cacheKey || null,
      cacheTs: cachedEntry?.ts || null,
      shouldRefreshFromDb
    });

    try {
      if (hasCachedTheme) {
        const cachedTheme = tagThemeSource(cachedEntry.theme, 'cache');
        setTheme(cachedTheme);
        setIsThemeLoading(false);
        traceThemeBoot('cache-hit', {
          trustId: resolvedTrustId,
          selectedTrustTemplateId: cachedTheme?.selectedTrustTemplateId || null,
          baseTrustTemplateId: cachedTheme?.baseTrustTemplateId || null,
          source: cachedTheme?.themeLoadSource || 'cache'
        });

        if (import.meta.env.DEV) {
          console.log('[useTheme][TemplateLink] Cache hit:', {
            selectedTrustId: resolvedTrustId,
            cacheKey: cachedEntry?.cacheKey || null,
            cachedAt: cachedEntry?.ts ? new Date(cachedEntry.ts).toISOString() : null,
            selectedTrustTemplateId: cachedTheme?.selectedTrustTemplateId || null,
            baseTrustTemplateId: cachedTheme?.baseTrustTemplateId || null,
            linkedTemplateId: cachedTheme?.templateId || null,
            linkedTemplateName: cachedTheme?.template?.name || null,
            navbarTextColor: getThemeToken(cachedTheme, 'navbar.text_color', null),
            source: 'cache'
          });
        }

        if (!shouldRefreshFromDb) {
          const verifyTemplateLink = async () => {
            try {
              const isBaseTrust = resolvedTrustId === BASE_TRUST_ID;

              // Fetch selected AND base trust meta in parallel so a base-template
              // change is detected immediately even when the user is on a non-base trust.
              const [latestSelectedMeta, latestBaseMeta] = await Promise.all([
                fetchTrustTemplateMeta(resolvedTrustId),
                isBaseTrust ? Promise.resolve(null) : fetchTrustTemplateMeta(BASE_TRUST_ID)
              ]);

              const cachedSelectedTemplateId = String(cachedTheme?.selectedTrustTemplateId || '').trim() || null;
              const latestSelectedTemplateId = String(latestSelectedMeta?.trustTemplateId || '').trim() || null;
              const selectedChanged = cachedSelectedTemplateId !== latestSelectedTemplateId;

              // For non-base trust users: also check if the BASE trust's template changed.
              const cachedBaseTemplateId = String(cachedTheme?.baseTrustTemplateId || '').trim() || null;
              const latestBaseTemplateId = isBaseTrust
                ? null
                : (String(latestBaseMeta?.trustTemplateId || '').trim() || null);
              const baseChanged = !isBaseTrust && cachedBaseTemplateId !== latestBaseTemplateId;
              const selectedTemplateUpdatedAtChanged = hasTemplateMetaChanged({
                cachedTemplateId: cachedSelectedTemplateId,
                cachedTemplateUpdatedAt: cachedTheme?.selectedTemplateUpdatedAt || null,
                latestMeta: latestSelectedMeta
              });
              const baseTemplateUpdatedAtChanged = !isBaseTrust && hasTemplateMetaChanged({
                cachedTemplateId: cachedBaseTemplateId,
                cachedTemplateUpdatedAt: cachedTheme?.baseTemplateUpdatedAt || null,
                latestMeta: latestBaseMeta
              });

              if (selectedChanged || baseChanged || selectedTemplateUpdatedAtChanged || baseTemplateUpdatedAtChanged) {
                if (import.meta.env.DEV) {
                  console.log('[useTheme][TemplateLink] Cache discarded due to template link change:', {
                    selectedTrustId: resolvedTrustId,
                    cachedSelectedTemplateId,
                    latestSelectedTemplateId,
                    selectedChanged,
                    selectedTemplateUpdatedAtChanged,
                    cachedBaseTemplateId,
                    latestBaseTemplateId,
                    baseChanged,
                    baseTemplateUpdatedAtChanged,
                    cacheSource: 'cache',
                    nextSource: 'db'
                  });
                }
                clearThemeCacheForTrust(resolvedTrustId);
                hasQueuedRefreshRef.current = true;
                setRefreshTick((prev) => prev + 1);
                return;
              }

              setIsThemeLoading(false);
              void validateCacheInBackground(cachedTheme);
            } catch (err) {
              console.warn('[useTheme][TemplateLink] Trust template verification failed:', err);
              hasQueuedRefreshRef.current = true;
              setRefreshTick((prev) => prev + 1);
            }
          };

          void verifyTemplateLink();
          return undefined;
        }
      } else if (import.meta.env.DEV) {
        console.log('[useTheme][TemplateLink] Cache miss:', {
          selectedTrustId: resolvedTrustId,
          cacheKey: null
        });
        traceThemeBoot('cache-miss', { trustId: resolvedTrustId });
      }
    } catch {
      // no-op
    }

    const buildThemeForTrust = async (targetTrustId) => {
      const normalizedTargetTrustId = String(targetTrustId || '').trim();
      if (!normalizedTargetTrustId) return null;

      const isBaseTrustSelected = normalizedTargetTrustId === BASE_TRUST_ID;
      const [baseLink, selectedLink] = await Promise.all([
        fetchTrustThemeLink(BASE_TRUST_ID),
        isBaseTrustSelected
          ? Promise.resolve(null)
          : fetchTrustThemeLink(normalizedTargetTrustId)
      ]);

      const effectiveBaseTemplate = baseLink?.template || null;
      const effectiveSelectedTemplate = isBaseTrustSelected
        ? null
        : (selectedLink?.template || null);

      const baseTheme = effectiveBaseTemplate
        ? buildThemeFromTemplate({
          templateRow: effectiveBaseTemplate,
          trustOverrides: baseLink.overrides,
          trustId: BASE_TRUST_ID
        })
        : { ...DEFAULT_THEME, trustId: BASE_TRUST_ID };

      const selectedTheme = isBaseTrustSelected
        ? null
        : (effectiveSelectedTemplate
          ? buildThemeFromTemplate({
            templateRow: effectiveSelectedTemplate,
            trustOverrides: selectedLink.overrides,
            trustId: normalizedTargetTrustId
          })
          : null);

      const hasSelectedTemplate = Boolean(effectiveSelectedTemplate);
      const isNonBaseWithSelectedTemplate = !isBaseTrustSelected && hasSelectedTemplate;

      // Important anti-mix rule:
      // For non-base trusts with an explicit linked template, do NOT blend base app theme.
      // Use selected trust theme as primary source so base colors/styles don't leak in.
      const resolved = isNonBaseWithSelectedTemplate
        ? mergeResolvedThemes(DEFAULT_THEME, selectedTheme)
        : mergeResolvedThemes(baseTheme, selectedTheme);
      resolved.customCss = sanitizeCustomCss(resolved.customCss);
      resolved.baseTemplateUpdatedAt = effectiveBaseTemplate?.updated_at || null;
      resolved.selectedTemplateUpdatedAt = effectiveSelectedTemplate?.updated_at || null;
      resolved.baseTrustTemplateId = baseLink?.trust?.template_id || null;
      resolved.selectedTrustTemplateId = isBaseTrustSelected
        ? (baseLink?.trust?.template_id || null)
        : (selectedLink?.trust?.template_id || null);
      resolved.currentTrustTemplateId = resolved.selectedTrustTemplateId;
      resolved.selectedTrustId = normalizedTargetTrustId;
      resolved.baseTrustUpdatedAt = null;
      resolved.selectedTrustUpdatedAt = null;

      const baseThemeConfigRaw = deepMergeObjects(
        parseJsonObject(effectiveBaseTemplate?.theme_config, {}),
        parseJsonObject(baseLink?.overrides, {})
      );
      const selectedThemeConfigRaw = deepMergeObjects(
        parseJsonObject(effectiveSelectedTemplate?.theme_config, {}),
        parseJsonObject(selectedLink?.overrides, {})
      );
      resolved.baseThemeConfigRaw = baseThemeConfigRaw;
      resolved.selectedThemeConfigRaw = selectedThemeConfigRaw;

      const selectedSource = isBaseTrustSelected
        ? (baseLink?.template ? (baseLink?.linkSource || 'linked_template') : 'fallback_default')
        : (selectedLink?.template ? (selectedLink?.linkSource || 'linked_template') : 'fallback_base');
      resolved.themeLoadSource = selectedSource.startsWith('linked_') ? 'db.linked_template' : `fallback.${selectedSource}`;

      return resolved;
    };

    const prefetchOtherTrustThemes = async (currentTrustId) => {
      try {
        const userRaw = localStorage.getItem('user');
        const user = userRaw ? safeParse(userRaw) : null;
        const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
        const trustIds = new Set([
          BASE_TRUST_ID,
          String(currentTrustId || '').trim(),
          ...memberships.map((m) => String(m?.trust_id || '').trim()).filter(Boolean)
        ]);

        for (const tid of trustIds) {
          const normalizedTid = String(tid || '').trim();
          if (!normalizedTid || normalizedTid === String(currentTrustId || '').trim()) continue;
          if (prefetchedTrustIdsRef.current.has(normalizedTid)) continue;

          const cachedEntry = readCachedThemeEntry(normalizedTid);
          if (cachedEntry?.theme && !isStale(cachedEntry?.ts)) {
            prefetchedTrustIdsRef.current.add(normalizedTid);
            continue;
          }

          const prefetchedTheme = await buildThemeForTrust(normalizedTid);
          if (prefetchedTheme) {
            writeThemeCache(normalizedTid, prefetchedTheme);
            traceThemeBoot('prefetch-success', {
              trustId: normalizedTid,
              selectedTrustTemplateId: prefetchedTheme?.selectedTrustTemplateId || null
            });
          } else {
            traceThemeBoot('prefetch-skipped', { trustId: normalizedTid });
          }
          prefetchedTrustIdsRef.current.add(normalizedTid);
        }
      } catch (err) {
        console.warn('[useTheme][TemplateLink] Background prefetch failed:', err);
        traceThemeBoot('prefetch-error', { message: err?.message || String(err) });
      }
    };

    const load = async ({ silent = false } = {}) => {
      if (!silent) setIsThemeLoading(true);
      hasQueuedRefreshRef.current = false;
      traceThemeBoot('db-refresh-start', { trustId: resolvedTrustId, silent });
      try {
        const resolved = await buildThemeForTrust(resolvedTrustId);
        if (!resolved) throw new Error('Unable to resolve theme for current trust');

        // If selected trust could not load its linked template yet, keep trust-scoped cached
        // theme instead of showing mixed/base fallback.
        const normalizedResolvedTrustId = String(resolvedTrustId || '').trim();
        const isFallbackForSelectedTrust = String(resolved?.themeLoadSource || '').startsWith('fallback.')
          && normalizedResolvedTrustId
          && normalizedResolvedTrustId !== BASE_TRUST_ID;
        if (isFallbackForSelectedTrust) {
          const cachedForSameTrust = readCachedThemeEntry(normalizedResolvedTrustId)?.theme || null;
          if (cachedForSameTrust && String(cachedForSameTrust?.selectedTrustId || cachedForSameTrust?.trustId || '').trim() === normalizedResolvedTrustId) {
            setTheme(tagThemeSource(cachedForSameTrust, 'cache'));
            traceThemeBoot('fallback-blocked-using-cache', {
              trustId: normalizedResolvedTrustId,
              reason: resolved?.themeLoadSource || 'fallback',
            });
            return;
          }
        }

        if (import.meta.env.DEV) {
          console.log('[useTheme][TemplateLink] Loaded theme:', {
            previousTrustId: previousTrustId || null,
            selectedTrustId: resolvedTrustId,
            selectedTrustTemplateIdFromTrust: resolved.selectedTrustTemplateId || null,
            selectedTrustTemplateId: resolved.selectedTrustTemplateId,
            selectedLinkedTemplateId: resolved.templateId || null,
            selectedLinkedTemplateName: resolved.template?.name || null,
            baseTrustTemplateId: resolved.baseTrustTemplateId,
            baseLinkedTemplateId: null,
            baseLinkedTemplateName: null,
            baseLinkSource: null,
            selectedLinkSource: null,
            source: resolved.themeLoadSource,
            cacheUsed: false,
            selectedTemplateUpdatedAt: resolved.selectedTemplateUpdatedAt,
            baseTemplateUpdatedAt: resolved.baseTemplateUpdatedAt,
            navbarTextColor: getThemeToken(resolved, 'navbar.text_color', null),
            homeLayout: resolved.homeLayout,
            animations: resolved.animations
          });
        }

        writeThemeCache(resolvedTrustId, resolved);
        setTheme(tagThemeSource(resolved, 'db'));
        traceThemeBoot('db-refresh-success', {
          trustId: resolvedTrustId,
          selectedTrustTemplateId: resolved?.selectedTrustTemplateId || null,
          baseTrustTemplateId: resolved?.baseTrustTemplateId || null
        });
        void prefetchOtherTrustThemes(resolvedTrustId);
      } catch (err) {
        console.warn('[useTheme][TemplateLink] Theme load failed:', err);
        traceThemeBoot('db-refresh-error', {
          trustId: resolvedTrustId,
          message: err?.message || String(err)
        });
        setTheme((prev) => prev || { ...DEFAULT_THEME, trustId: BASE_TRUST_ID });
      } finally {
        if (!silent) setIsThemeLoading(false);
      }
    };

    void load({ silent: hasCachedTheme });
    return undefined;
  }, [trustId, refreshTick]);

  useEffect(() => {
    const queueRefreshFromEvent = async () => {
      const targetTrustId = String(trustId || '').trim() || resolveStoredTrustId();
      if (!targetTrustId || hasQueuedRefreshRef.current) return;
      const cachedEntry = readCachedThemeEntry(targetTrustId);
      const shouldRefresh = !cachedEntry?.theme || isStale(cachedEntry?.ts);
      if (shouldRefresh) {
        hasQueuedRefreshRef.current = true;
        clearThemeCacheForTrust(targetTrustId);
        setRefreshTick((prev) => prev + 1);
        return;
      }

      try {
        const cachedTheme = cachedEntry.theme;
        const isBaseTrust = targetTrustId === BASE_TRUST_ID;
        const [latestSelectedMeta, latestBaseMeta] = await Promise.all([
          fetchTrustTemplateMeta(targetTrustId),
          isBaseTrust ? Promise.resolve(null) : fetchTrustTemplateMeta(BASE_TRUST_ID)
        ]);

        const selectedTemplateChanged = hasTemplateMetaChanged({
          cachedTemplateId: cachedTheme?.selectedTrustTemplateId || null,
          cachedTemplateUpdatedAt: cachedTheme?.selectedTemplateUpdatedAt || null,
          latestMeta: latestSelectedMeta
        });

        const baseTemplateChanged = !isBaseTrust && hasTemplateMetaChanged({
          cachedTemplateId: cachedTheme?.baseTrustTemplateId || null,
          cachedTemplateUpdatedAt: cachedTheme?.baseTemplateUpdatedAt || null,
          latestMeta: latestBaseMeta
        });

        if (!selectedTemplateChanged && !baseTemplateChanged) return;

        if (import.meta.env.DEV) {
          console.log('[useTheme][TemplateLink] Refresh queued from app lifecycle event:', {
            selectedTrustId: targetTrustId,
            selectedTemplateChanged,
            baseTemplateChanged,
            trigger: 'focus_or_visibility'
          });
        }
      } catch (err) {
        console.warn('[useTheme][TemplateLink] Lifecycle cache validation failed:', err);
      }

      hasQueuedRefreshRef.current = true;
      clearThemeCacheForTrust(targetTrustId);
      setRefreshTick((prev) => prev + 1);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        queueRefreshFromEvent();
      }
    };
    const onTemplateApplied = () => {
      const targetTrustId = String(trustId || '').trim() || resolveStoredTrustId();
      if (!targetTrustId || hasQueuedRefreshRef.current) return;
      hasQueuedRefreshRef.current = true;
      clearThemeCacheForTrust(targetTrustId);
      setRefreshTick((prev) => prev + 1);
    };

    window.addEventListener('focus', queueRefreshFromEvent);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(THEME_TEMPLATE_APPLIED_EVENT, onTemplateApplied);

    return () => {
      window.removeEventListener('focus', queueRefreshFromEvent);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(THEME_TEMPLATE_APPLIED_EVENT, onTemplateApplied);
    };
  }, [trustId]);

  const clearThemeCache = (tid) => {
    try {
      const targetTrustId = String(tid || trustId || '').trim() || resolveStoredTrustId();
      clearThemeCacheForTrust(targetTrustId);
    } catch {
      // no-op
    }
  };

  const refreshTheme = () => {
    const targetTrustId = String(trustId || '').trim() || resolveStoredTrustId();
    clearThemeCacheForTrust(targetTrustId);
    hasQueuedRefreshRef.current = false;
    setRefreshTick((prev) => prev + 1);
  };

  const applyTrustTemplate = async ({ trustId: explicitTrustId, templateId }) => {
    const targetTrustId = String(explicitTrustId || trustId || '').trim() || resolveStoredTrustId();
    const nextTemplateId = String(templateId || '').trim();

    if (!targetTrustId) {
      return { success: false, error: 'Missing trust id' };
    }

    if (!nextTemplateId) {
      return { success: false, error: 'Missing template id' };
    }

    try {
      const { data, error } = await supabase
        .from('Trust')
        .update({
          template_id: nextTemplateId
        })
        .eq('id', targetTrustId)
        .select('id, name, template_id')
        .maybeSingle();

      if (error) throw error;

      clearThemeCacheForTrust(targetTrustId);

      if (import.meta.env.DEV) {
        console.log('[useTheme][TemplateLink] Trust.template_id updated:', {
          selectedTrustId: targetTrustId,
          trustTemplateId: data?.template_id || null,
          templateIdChangedTo: nextTemplateId,
          trigger: 'applyTrustTemplate'
        });
      }

      dispatchThemeTemplateApplied({
        trustId: targetTrustId,
        templateId: nextTemplateId,
        source: 'applyTrustTemplate'
      });
      dispatchThemeRefresh({
        trustId: targetTrustId,
        reason: 'template-applied'
      });

      hasQueuedRefreshRef.current = false;
      setRefreshTick((prev) => prev + 1);

      return {
        success: true,
        trust: data || null
      };
    } catch (err) {
      console.warn('[useTheme][TemplateLink] Failed to apply template:', err);
      return {
        success: false,
        error: err?.message || 'Failed to apply template'
      };
    }
  };

  return {
    theme,
    isThemeLoading,
    clearThemeCache,
    refreshTheme,
    applyTrustTemplate,
    currentTrustTemplateId: theme?.currentTrustTemplateId || null
  };
};
