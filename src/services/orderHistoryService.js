import { getUserHospitalMemberships } from '../utils/storageUtils.js';

const ORDER_HISTORY_STORAGE_KEYS = ['order_history_v1', 'order_history', 'orders_v1'];
const DEFAULT_TRUST_CACHE_KEY = 'default_trust_cache';
const SELECTED_TRUST_ID_KEY = 'selected_trust_id';
const SELECTED_TRUST_NAME_KEY = 'selected_trust_name';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const ALLOWED_PURCHASE_STATUSES = new Set([
  'order payment pending',
  'order payment done',
  'cancelled',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let orderHistoryPurchaseRpcOverride = null;

const getRuntimeEnv = () => (typeof import.meta !== 'undefined' ? import.meta.env : undefined);

const hasPurchaseApiConfig = () => {
  const env = getRuntimeEnv();
  return Boolean(env?.VITE_SUPABASE_URL && env?.VITE_SUPABASE_ANON_KEY);
};

export const setOrderHistoryPurchaseRpcOverrideForTests = (handler = null) => {
  orderHistoryPurchaseRpcOverride = handler;
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const normalizeStatusKey = (value = '') =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const clearOrderHistoryCache = () => {
  if (typeof window === 'undefined') return;

  ORDER_HISTORY_STORAGE_KEYS.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore storage failures
    }
  });
};

const readStoredTrustContext = (key, nameKey = null) => {
  if (typeof window === 'undefined') {
    return { id: '', name: '' };
  }

  const id = normalizeText(window.localStorage.getItem(key));
  const name = nameKey ? normalizeText(window.localStorage.getItem(nameKey)) : '';
  return { id, name };
};

const readDefaultTrustContext = () => {
  if (typeof window !== 'undefined') {
    const parsedDefault = safeParse(window.localStorage.getItem(DEFAULT_TRUST_CACHE_KEY) || '');
    const id = normalizeText(parsedDefault?.id);
    const name = normalizeText(parsedDefault?.name);
    if (id) {
      return { id, name: name || null };
    }
  }

  return {
    id: normalizeText(getRuntimeEnv()?.VITE_DEFAULT_TRUST_ID || ''),
    name: normalizeText(getRuntimeEnv()?.VITE_DEFAULT_TRUST_NAME || '') || null,
  };
};

export const resolveOrderHistoryTrustScope = () => {
  const defaultTrust = readDefaultTrustContext();
  const selectedTrust = readStoredTrustContext(SELECTED_TRUST_ID_KEY, SELECTED_TRUST_NAME_KEY);
  const persistedSelected = readStoredTrustContext(LAST_SELECTED_TRUST_ID_KEY);

  const selectedTrustId =
    selectedTrust.id
    || persistedSelected.id
    || defaultTrust.id
    || normalizeText(getRuntimeEnv()?.VITE_DEFAULT_TRUST_ID || '');

  const defaultTrustId = defaultTrust.id || normalizeText(getRuntimeEnv()?.VITE_DEFAULT_TRUST_ID || '');
  const isDefaultTrustSelected = Boolean(
    selectedTrustId
    && defaultTrustId
    && selectedTrustId.toLowerCase() === defaultTrustId.toLowerCase()
  );
  const selectedTrustName = selectedTrust.name || (isDefaultTrustSelected
    ? (defaultTrust.name || normalizeText(getRuntimeEnv()?.VITE_DEFAULT_TRUST_NAME || '') || null)
    : null);

  return {
    selectedTrustId,
    selectedTrustName,
    defaultTrustId,
    defaultTrustName: defaultTrust.name || null,
    isDefaultTrustSelected,
  };
};

const readStoredUser = () => {
  if (typeof window === 'undefined') return {};

  const parsed = safeParse(window.localStorage.getItem('user') || '');
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const extractOrderRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value.orders)) return value.orders;
  if (Array.isArray(value.history)) return value.history;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.purchases)) return value.purchases;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.result)) return value.result;

  return [];
};

const normalizeTrustContext = (trustId, trustName = null) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return null;

  return {
    trustId: normalizedTrustId,
    trustName: normalizeText(trustName) || null,
  };
};

export const resolveOrderHistoryTrustContexts = (user = null, trustScope = resolveOrderHistoryTrustScope()) => {
  const resolvedUser = user && typeof user === 'object' ? user : {};
  const trustContexts = [];
  const seenTrustIds = new Set();
  const resolvedScope = trustScope && typeof trustScope === 'object'
    ? trustScope
    : resolveOrderHistoryTrustScope();
  const selectedTrustId = normalizeText(resolvedScope.selectedTrustId);

  const addTrust = (trustId, trustName = null) => {
    const context = normalizeTrustContext(trustId, trustName);
    if (!context) return;
    const key = context.trustId.toLowerCase();
    if (seenTrustIds.has(key)) return;
    seenTrustIds.add(key);
    trustContexts.push(context);
  };

  const memberships = getUserHospitalMemberships(resolvedUser);
  if (resolvedScope.isDefaultTrustSelected) {
    memberships.forEach((membership) => {
      addTrust(membership?.trust_id || membership?.trust?.id, membership?.trust_name || membership?.trust?.name);
    });

    addTrust(resolvedUser?.primary_trust?.id, resolvedUser?.primary_trust?.name);
    addTrust(resolvedUser?.trust?.id, resolvedUser?.trust?.name);
    addTrust(resolvedScope.selectedTrustId, resolvedScope.selectedTrustName);
  } else if (selectedTrustId) {
    const matchingMembership = memberships.find((membership) => {
      const membershipTrustId = normalizeText(membership?.trust_id || membership?.trust?.id);
      return membershipTrustId && membershipTrustId.toLowerCase() === selectedTrustId.toLowerCase();
    });

    addTrust(
      selectedTrustId,
      matchingMembership?.trust_name
      || matchingMembership?.trust?.name
      || resolvedScope.selectedTrustName
    );
  }

  return trustContexts;
};

export const resolveOrderHistoryMemberId = (user = null) => {
  const resolvedUser = user && typeof user === 'object' ? user : {};
  const candidates = [];

  const pushCandidate = (value) => {
    const text = normalizeText(value);
    if (text) candidates.push(text);
  };

  pushCandidate(resolvedUser?.member_uuid);
  pushCandidate(resolvedUser?.members_uuid);
  pushCandidate(resolvedUser?.members_id);
  pushCandidate(resolvedUser?.member_id);

  if (Array.isArray(resolvedUser?.member_ids)) {
    resolvedUser.member_ids.forEach(pushCandidate);
  }

  const memberships = getUserHospitalMemberships(resolvedUser);
  memberships.forEach((membership) => {
    pushCandidate(membership?.member_uuid);
    pushCandidate(membership?.members_uuid);
    pushCandidate(membership?.members_id);
    pushCandidate(membership?.member_id);
  });

  pushCandidate(resolvedUser?.id);

  return candidates.find(isUuid) || '';
};

export const shouldIncludePurchaseRow = (row = {}) => {
  if (!row || typeof row !== 'object') return false;

  const statusKey = normalizeStatusKey(
    row.status
    || row.order_status
    || row.state
    || row.payment_status
    || row.type
  );

  if (!statusKey) return false;
  return ALLOWED_PURCHASE_STATUSES.has(statusKey);
};

const getOrderIdentityKey = (row = {}) => {
  const trustId = normalizeText(
    row?.trust_id
    || row?.trustId
    || row?.source_trust_id
    || row?.sourceTrustId
  );
  const orderId = normalizeText(
    row?.order_id
    || row?.orderId
    || row?.invoice_no
    || row?.invoice_number
    || row?.reference
    || row?.id
  );

  return `${trustId.toLowerCase() || 'global'}::${orderId.toLowerCase() || 'unknown'}`;
};

const dedupeOrderRows = (rows = []) => {
  const seen = new Set();
  const deduped = [];

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const key = getOrderIdentityKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });

  return deduped;
};

const extractRpcPayloadRows = (data) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  if (data.success === false) return extractOrderRows(data);

  return extractOrderRows(data);
};

const callOrderHistoryPurchaseRpc = async (request) => {
  if (orderHistoryPurchaseRpcOverride) {
    return orderHistoryPurchaseRpcOverride(request);
  }

  if (!hasPurchaseApiConfig()) {
    throw new Error('Order history sync is unavailable. Please check Supabase configuration and try again.');
  }

  const module = await import('./supabaseClient.js');
  const supabase = module?.supabase;
  if (!supabase?.rpc) {
    throw new Error('Order history sync is unavailable. Please try again.');
  }

  return supabase.rpc('manage_purchase_by_member', request);
};

// The 'get' RPC action only returns `product_price_id` on each purchase row — never the
// product's name — so it has to be looked up from the trust's product catalog, same as
// productCart.js/productWishlist.js already do for cart and wishlist rows. Dynamic import
// avoids a static circular dependency (productCart.js dynamically imports this module too,
// to resolve the member id).
// Same precedence the Cart uses: the selected image if it is still active, else the first
// active catalog image (ordered by sort_order), else a flat image_url on the product.
const resolveCatalogProductImage = (product) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  const activeImages = images
    .filter((image) => {
      const status = normalizeText(image?.status).toLowerCase();
      return normalizeText(image?.image_url)
        && !['inactive', 'disabled', 'deleted', 'archived'].includes(status)
        && image?.is_active !== false
        && image?.isActive !== false;
    })
    .sort((a, b) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0));

  const selectedImage = normalizeText(product?.selected_image);
  const knownUrls = images.map((image) => normalizeText(image?.image_url));
  if (selectedImage && (!knownUrls.includes(selectedImage) || activeImages.some((image) => normalizeText(image.image_url) === selectedImage))) {
    return selectedImage;
  }

  return normalizeText(activeImages[0]?.image_url)
    || normalizeText(product?.image_url || product?.imageUrl);
};

const enrichOrderRowsWithCatalog = async (rows, trustId) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  try {
    const { fetchTrustProductsCategories, buildProductCatalogLookups } = await import('../utils/productCart.js');
    const categories = await fetchTrustProductsCategories(trustId);
    const { byPriceId, byProductId } = buildProductCatalogLookups(categories);

    return rows.map((row) => {
      const productPriceId = normalizeText(row?.product_price_id || row?.productPriceId);
      const rowProductId = normalizeText(row?.product_id || row?.productId);
      const catalogMatch = (productPriceId ? byPriceId.get(productPriceId) : null)
        || (rowProductId ? byProductId.get(rowProductId) : null);
      if (!catalogMatch?.product) return row;

      return {
        ...row,
        product_name: normalizeText(catalogMatch.product?.product_name || catalogMatch.product?.alias_name) || row.product_name,
        catalog_product_id: normalizeText(catalogMatch.product?.id || catalogMatch.product?.product_id || catalogMatch.product?.productId),
        catalog_category_id: normalizeText(catalogMatch.product?.category_id),
        product_image: resolveCatalogProductImage(catalogMatch.product) || row.product_image,
      };
    });
  } catch {
    // Catalog lookup is a display enhancement, not critical — fall back to unenriched rows.
    return rows;
  }
};

export const fetchOrdersForTrust = async ({ memberId, trustId, trustName = null }) => {
  const normalizedMemberId = normalizeText(memberId);
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedMemberId || !normalizedTrustId) return [];

  const request = {
    p_member_id: normalizedMemberId,
    p_trust_id: normalizedTrustId,
    p_action: 'get',
    p_payload: {},
  };

  const { data, error } = await callOrderHistoryPurchaseRpc(request);
  if (error) {
    throw error;
  }

  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(normalizeText(data.message) || `Failed to load order history for trust ${normalizedTrustId}`);
  }

  const rows = extractRpcPayloadRows(data);
  const mappedRows = rows
    .filter(shouldIncludePurchaseRow)
    .map((row) => {
      const resolvedTrustId = normalizeText(row?.trust_id || row?.trustId) || normalizedTrustId;
      const resolvedTrustName = normalizeText(row?.trust_name || row?.trustName || trustName) || null;

      return {
        ...row,
        trust_id: resolvedTrustId,
        trust_name: resolvedTrustName,
        source: normalizeText(row?.source || row?.sourceType || row?.source_type) || 'backend',
        source_trust_id: normalizedTrustId,
        source_trust_name: resolvedTrustName,
      };
    });

  return enrichOrderRowsWithCatalog(mappedRows, normalizedTrustId);
};

export const subscribeOrderHistory = (onEvent = () => {}) => {
  if (typeof window === 'undefined') return () => {};

  const storedUser = readStoredUser();
  const memberId = resolveOrderHistoryMemberId(storedUser);
  const normalizedMemberId = normalizeText(memberId);
  if (!normalizedMemberId || !hasPurchaseApiConfig()) return () => {};
  let active = true;
  let resolvedSupabase = null;
  const channels = [];

  const createChannelForTable = (supabase, tableName) => supabase
    .channel(`order-history-${normalizedMemberId}-${tableName}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: tableName, filter: `member_id=eq.${normalizedMemberId}` },
      () => onEvent()
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: tableName, filter: `member_id=eq.${normalizedMemberId}` },
      () => onEvent()
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: tableName, filter: `member_id=eq.${normalizedMemberId}` },
      () => onEvent()
    )
    .subscribe();

  import('./supabaseClient.js')
    .then((module) => {
      if (!active || !module?.supabase?.channel) return;
      resolvedSupabase = module.supabase;
      channels.push(...['purchase', 'purchases'].map((tableName) => createChannelForTable(resolvedSupabase, tableName)));
    })
    .catch(() => {});

  return () => {
    active = false;
    channels.forEach((channel) => {
      if (channel && resolvedSupabase?.removeChannel) {
        resolvedSupabase.removeChannel(channel);
      }
    });
  };
};

export const loadOrderHistorySnapshot = async ({ user = null } = {}) => {
  clearOrderHistoryCache();
  const resolvedUser = user && typeof user === 'object' ? user : readStoredUser();
  const trustScope = resolveOrderHistoryTrustScope();
  const memberId = resolveOrderHistoryMemberId(resolvedUser);
  const trustContexts = resolveOrderHistoryTrustContexts(resolvedUser, trustScope);

  if (!memberId || trustContexts.length === 0) {
    return {
      rows: [],
      localRows: [],
      remoteRows: [],
      trustContexts,
      trustErrors: memberId ? [] : [{
        trustId: null,
        trustName: null,
        message: 'Missing member identifier for remote order history',
      }],
      memberId,
      hasRemoteOrders: false,
    };
  }

  const settledResults = await Promise.allSettled(
    trustContexts.map((trustContext) =>
      fetchOrdersForTrust({
        memberId,
        trustId: trustContext.trustId,
        trustName: trustContext.trustName,
      })
    )
  );

  const remoteRows = [];
  const trustErrors = [];

  settledResults.forEach((result, index) => {
    const trustContext = trustContexts[index] || {};
    if (result.status === 'fulfilled') {
      remoteRows.push(...result.value);
      return;
    }

    trustErrors.push({
      trustId: trustContext.trustId || null,
      trustName: trustContext.trustName || trustContext.trustId || null,
      message: normalizeText(result.reason?.message) || 'Failed to load order history for one trust',
    });
  });

  return {
    rows: dedupeOrderRows(remoteRows),
    localRows: [],
    remoteRows,
    trustContexts,
    trustErrors,
    memberId,
    hasRemoteOrders: remoteRows.length > 0,
  };
};
