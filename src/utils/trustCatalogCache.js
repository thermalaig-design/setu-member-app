import { supabase } from '../services/supabaseClient';

const CATALOG_CACHE_PREFIX = 'trust_catalog_cache_v1';
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const PRICE_SELECT = [
  'id',
  'product_id',
  'mrp',
  'discount_pct',
  'discount_amount',
  'price_after_discount',
  'gst_pct',
  'gst_amount',
  'transport_fee',
  'total_payable',
  'member_price',
  'billing_type',
  'status',
].join(', ');

const memoryCache = new Map();

const hasStorage = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

export const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

export const pickText = (...values) => {
  for (const value of values) {
    if (normalizeText(value)) return normalizeText(value);
  }
  return '';
};

const getActiveTrustId = () => {
  if (!hasStorage()) return '';

  return normalizeText(window.localStorage.getItem('selected_trust_id'))
    || normalizeText(window.localStorage.getItem('last_selected_trust_id'))
    || '';
};

export const getTrustCandidates = () => {
  const candidates = [
    getActiveTrustId(),
    import.meta.env.VITE_DEFAULT_TRUST_ID,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return [...new Set(candidates)];
};

const getCatalogCacheKey = (trustId) => `${CATALOG_CACHE_PREFIX}:${normalizeText(trustId) || 'global'}`;

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readStorageEntry = (key) => {
  if (memoryCache.has(key)) return memoryCache.get(key);
  if (!hasStorage()) return null;

  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  const parsed = safeParse(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  memoryCache.set(key, parsed);
  return parsed;
};

const writeStorageEntry = (key, entry) => {
  memoryCache.set(key, entry);

  if (!hasStorage()) return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore cache write failures so product screens keep working.
  }
};

export const readTrustCatalogCache = (trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return null;

  const entry = readStorageEntry(getCatalogCacheKey(normalizedTrustId));
  if (!entry || typeof entry !== 'object') return null;

  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : null;
  if (!payload) return null;

  return {
    trustId: normalizeText(entry.trustId) || normalizedTrustId,
    payload,
    storedAt: Number(entry.storedAt) || 0,
    hasPrices: Boolean(entry.hasPrices),
  };
};

export const readTrustCatalogCacheForCandidates = (trustIds) => {
  for (const trustId of Array.isArray(trustIds) ? trustIds : []) {
    const cached = readTrustCatalogCache(trustId);
    if (cached) return cached;
  }

  return null;
};

export const isTrustCatalogCacheFresh = (entry, ttlMs = CATALOG_CACHE_TTL_MS) => {
  const storedAt = Number(entry?.storedAt) || 0;
  return Boolean(entry?.payload) && storedAt > 0 && (Date.now() - storedAt) <= ttlMs;
};

export const writeTrustCatalogCache = (trustId, payload, options = {}) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId || !payload || typeof payload !== 'object') return null;

  const entry = {
    trustId: normalizedTrustId,
    storedAt: Date.now(),
    payload,
    hasPrices: Boolean(options.hasPrices),
  };

  writeStorageEntry(getCatalogCacheKey(normalizedTrustId), entry);
  return entry;
};

export const clearTrustCatalogCache = (trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return;

  const key = getCatalogCacheKey(normalizedTrustId);
  memoryCache.delete(key);

  if (!hasStorage()) return;

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const collectProductIdsFromCategories = (categories) => {
  const ids = new Set();

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    (Array.isArray(category?.products) ? category.products : []).forEach((product) => {
      const productId = pickText(product?.id);
      if (productId) ids.add(productId);
    });
  });

  return [...ids];
};

export const fetchProductPricesById = async (productIds, signal) => {
  const ids = [...new Set((productIds || []).map((id) => pickText(id)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  let query = supabase
    .from('product_price')
    .select(PRICE_SELECT)
    .in('product_id', ids);

  if (typeof query.abortSignal === 'function') {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[trustCatalogCache] Failed to load product prices:', error.message || error);
    return new Map();
  }

  const pricesById = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const productId = pickText(row?.product_id);
    if (!productId) return;

    const status = pickText(row?.status).toLowerCase();
    const existing = pricesById.get(productId);
    const isActive = !status || status === 'active';
    const existingStatus = pickText(existing?.status).toLowerCase();
    const existingIsActive = !existingStatus || existingStatus === 'active';

    if (!existing || (isActive && !existingIsActive)) {
      pricesById.set(productId, row);
    }
  });

  return pricesById;
};

const attachPricesToPayload = (payload, pricesById) => ({
  ...payload,
  categories: (Array.isArray(payload?.categories) ? payload.categories : []).map((category) => ({
    ...category,
    products: (Array.isArray(category?.products) ? category.products : []).map((product) => {
      const price = pricesById.get(pickText(product?.id));
      return price ? { ...product, price } : product;
    }),
  })),
});

export const enrichPayloadWithPrices = async (payload, signal) => {
  if (!payload) return payload;
  const productIds = collectProductIdsFromCategories(payload.categories);
  const pricesById = await fetchProductPricesById(productIds, signal);
  if (signal?.aborted) return payload;
  return attachPricesToPayload(payload, pricesById);
};

export const fetchProductCategoryTree = async (signal) => {
  const trustCandidates = getTrustCandidates();
  let lastError = '';

  for (const trustId of trustCandidates) {
    let query = supabase.rpc('get_products_by_trust_id', {
      p_trust_id: trustId,
    });

    if (typeof query.abortSignal === 'function') {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query;
    if (signal?.aborted) return null;

    if (error) {
      lastError = error.message || String(error);
      continue;
    }

    const payload = data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : { categories: Array.isArray(data) ? data : [] };
    const categories = Array.isArray(payload.categories) ? payload.categories : [];

    if (payload.success === false) {
      lastError = payload.message || 'RPC returned success=false';
      continue;
    }

    if (categories.length > 0) {
      return {
        trustId: pickText(payload.trust_id, trustId),
        categories,
      };
    }

    lastError = `No categories returned for trust ${trustId}`;
  }

  throw new Error(lastError || 'No categories found for the selected trust');
};
