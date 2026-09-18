import { getUserHospitalMemberships } from './storageUtils.js';

export const CART_CHANGED_EVENT = 'product-cart-changed';

const CART_STORAGE_KEY_PREFIX = 'product_cart_v2_';
const CART_LEGACY_STORAGE_KEY = 'product_cart_v1';
const CART_PURCHASE_REF_KEY_PREFIX = 'product_cart_purchase_refs_v1_';
const TRUST_CHANGED_EVENT = 'trust-changed';
const TRUST_STORAGE_KEYS = new Set(['selected_trust_id', 'last_selected_trust_id']);
const TRUST_STORAGE_FALLBACK = 'global';
const CART_TYPE = 'cart';
const WISHLIST_TYPE = 'wishlist';
const WISHLIST_STATUS = 'wishlist';
const ADD_TO_CART_STATUS = 'add_to_cart';
const REMOVE_FROM_CART_STATUS = 'remove_from_cart';
const SYNCED_SYNC_STATE = 'synced';
const PRODUCTS_RPC_PATH = '/rest/v1/rpc/get_products_by_trust_id';

let cartLegacyMigrated = false;
let cartPurchaseRpcOverride = null;
let cartProductsApiOverride = null;
const cartRefreshPromiseByTrust = new Map();

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getRuntimeEnv = () => (typeof import.meta !== 'undefined' ? import.meta.env : undefined);

const hasPurchaseApiConfig = () => {
  const env = getRuntimeEnv();
  return Boolean(env?.VITE_SUPABASE_URL && env?.VITE_SUPABASE_ANON_KEY);
};

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const isActiveImage = (image) => {
  const status = normalizeText(image?.status).toLowerCase();
  return !status || status === 'active';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const readStoredUser = () => {
  if (!hasStorage()) return {};

  const parsed = safeParse(window.localStorage.getItem('user') || '');
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const resolveMemberIdFromUser = (user = {}) => {
  const candidates = [];

  const pushCandidate = (value) => {
    const text = normalizeText(value);
    if (text) candidates.push(text);
  };

  pushCandidate(user?.member_uuid);
  pushCandidate(user?.members_uuid);
  pushCandidate(user?.members_id);
  pushCandidate(user?.member_id);

  if (Array.isArray(user?.member_ids)) {
    user.member_ids.forEach(pushCandidate);
  }

  getUserHospitalMemberships(user).forEach((membership) => {
    pushCandidate(membership?.member_uuid);
    pushCandidate(membership?.members_uuid);
    pushCandidate(membership?.members_id);
    pushCandidate(membership?.member_id);
  });

  pushCandidate(user?.id);

  return candidates.find(isUuid) || '';
};

const normalizeQuantity = (value) => {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const getActiveTrustId = () => {
  if (!hasStorage()) return TRUST_STORAGE_FALLBACK;

  return normalizeText(window.localStorage.getItem('selected_trust_id'))
    || normalizeText(window.localStorage.getItem('last_selected_trust_id'))
    || TRUST_STORAGE_FALLBACK;
};

const resolveTrustId = (value) => normalizeText(value) || getActiveTrustId();

const getCartStorageKey = (trustId = undefined) => `${CART_STORAGE_KEY_PREFIX}${resolveTrustId(trustId)}`;

const getCartPurchaseRefStorageKey = (trustId = undefined) => `${CART_PURCHASE_REF_KEY_PREFIX}${resolveTrustId(trustId)}`;

const readCartPurchaseRefs = (trustId = undefined) => {
  if (!hasStorage()) return {};

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getCartPurchaseRefStorageKey(trustId)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeCartPurchaseRefs = (trustId, refs = {}) => {
  if (!hasStorage()) return refs;

  try {
    window.localStorage.setItem(getCartPurchaseRefStorageKey(trustId), JSON.stringify(refs || {}));
  } catch {
    // Ignore storage failures so a successful RPC is not undone by cache issues.
  }

  return refs;
};

const getCartPurchaseRef = (productId, trustId = undefined) => {
  const key = getCartKey(productId, trustId);
  if (!key) return null;
  const refs = readCartPurchaseRefs(trustId);
  const ref = refs[key];
  return ref && typeof ref === 'object' ? ref : null;
};

const rememberCartPurchaseRef = (item = {}) => {
  const key = item?.key || getCartKey(item?.id, item?.trust_id);
  const trustId = resolveTrustId(item?.trust_id);
  const purchaseId = normalizeText(item?.purchase_id || item?.purchaseId);
  if (!key || !trustId || !purchaseId) return;

  const refs = readCartPurchaseRefs(trustId);
  refs[key] = {
    purchase_id: purchaseId,
    product_price_id: normalizeText(item?.product_price_id || item?.productPriceId),
    id: normalizeText(item?.id),
    trust_id: trustId,
    updated_at: new Date().toISOString(),
  };
  writeCartPurchaseRefs(trustId, refs);
};

const notifyCartChange = (items) => {
  if (typeof window === 'undefined') return;

  try {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: items }));
  } catch {
    // ignore event dispatch failures
  }
};

const normalizeAttributeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    return normalizeText(value.label || value.name || value.value || '');
  }

  return normalizeText(value);
};

const normalizeAttributes = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeAttributeValue(rawValue);
    if (normalizedKey && normalizedValue) {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
  }, {});
};

const normalizeAttributeRows = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;

      const attribute_name = normalizeText(row.attribute_name || row.name || row.label || row.attribute);
      const attribute_value = normalizeAttributeValue(row.value ?? row.attribute_value ?? row.attributeValue);
      if (!attribute_name || !attribute_value) return null;

      return {
        attribute_name,
        value: attribute_value,
      };
    })
    .filter(Boolean);
};

const normalizePrice = (value) => (value && typeof value === 'object' ? value : null);

const normalizeAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const resolveUnitBaseAmount = (price) => {
  for (const candidate of [
    price?.price_after_discount,
    price?.member_price,
    price?.selling_price,
    price?.total_payable,
    price?.mrp,
  ]) {
    const amount = normalizeAmount(candidate);
    if (amount > 0) return amount;
  }

  return 0;
};

const resolveUnitTaxAmount = (price, unitBaseAmount) => {
  const explicitTax = normalizeAmount(price?.gst_amount);
  if (explicitTax > 0) return explicitTax;

  const gstPct = normalizeAmount(price?.gst_pct ?? price?.gst_percent);
  if (gstPct > 0 && unitBaseAmount > 0) {
    return (unitBaseAmount * gstPct) / 100;
  }

  const totalPayable = normalizeAmount(price?.total_payable);
  const transportFee = normalizeAmount(price?.transport_fee);
  if (totalPayable > 0 && unitBaseAmount > 0) {
    const inferredTax = totalPayable - unitBaseAmount - Math.max(transportFee, 0);
    if (inferredTax > 0) return inferredTax;
  }

  return 0;
};

const normalizeRpcValue = (value) => {
  return normalizeText(value);
};

const resolveCartProductPriceId = (product = {}, context = {}) => normalizeText(
  context?.price?.id
  || context?.price?.product_price_id
  || context?.price?.price_id
  || product?.price?.id
  || product?.price?.product_price_id
  || product?.price?.price_id
  || context?.productPriceId
  || context?.product_price_id
  || context?.priceId
  || context?.price_id
  || product?.product_price_id
  || product?.productPriceId
  || product?.price_id
  || product?.priceId
);

const resolveCartUnitPrice = (product = {}, context = {}) => {
  const price = normalizePrice(context?.price || product?.price);
  const unitPrice = normalizeAmount(
    context?.unitPrice
    ?? context?.unit_price
    ?? product?.unit_price
    ?? product?.unitPrice
    ?? price?.price_after_discount
    ?? price?.member_price
    ?? price?.selling_price
    ?? price?.total_payable
    ?? price?.mrp
  );

  return Number.isFinite(unitPrice) ? unitPrice : 0;
};

export const getCartItemPricing = (item = {}) => {
  const quantity = normalizeQuantity(item?.quantity);
  const price = item?.price && typeof item.price === 'object' ? item.price : null;
  const unitBaseAmount = price ? resolveUnitBaseAmount(price) : 0;
  const unitTaxAmount = price ? resolveUnitTaxAmount(price, unitBaseAmount) : 0;
  const unitTransportAmount = price ? Math.max(0, normalizeAmount(price.transport_fee)) : 0;
  const unitTotalAmount = price
    ? (normalizeAmount(price.total_payable) > 0
      ? normalizeAmount(price.total_payable)
      : unitBaseAmount + unitTaxAmount + unitTransportAmount)
    : 0;

  return {
    quantity,
    unitBaseAmount,
    unitTaxAmount,
    unitTransportAmount,
    unitTotalAmount,
    subtotal: unitBaseAmount * quantity,
    taxAmount: unitTaxAmount * quantity,
    transportAmount: unitTransportAmount * quantity,
    totalAmount: unitTotalAmount * quantity,
  };
};

export const getCartKey = (productId, trustId = '') => {
  const normalizedProductId = normalizeText(productId);
  if (!normalizedProductId) return '';
  return `${resolveTrustId(trustId)}:${normalizedProductId}`;
};

const normalizeCartItem = (item) => {
  const id = normalizeText(item?.id);
  const trustId = normalizeText(item?.trust_id);
  const key = getCartKey(id, trustId);
  const quantity = normalizeQuantity(item?.quantity);

  if (!id || !key || quantity <= 0) return null;

  return {
    key,
    id,
    trust_id: trustId,
    category_id: normalizeText(item?.category_id),
    category_name: normalizeText(item?.category_name),
    product_name: normalizeText(item?.product_name) || `Product ${id}`,
    product_code: normalizeText(item?.product_code),
    product_type: normalizeText(item?.product_type),
    alias_name: normalizeText(item?.alias_name),
    purchase_id: normalizeText(item?.purchase_id || item?.purchaseId),
    product_price_id: normalizeText(item?.product_price_id || item?.productPriceId || item?.price_id || item?.priceId || item?.price?.id),
    images: normalizeProductImages(item?.images),
    selected_image: normalizeText(item?.selected_image),
    selected_attributes: normalizeAttributes(item?.selected_attributes),
    attribute_values: normalizeAttributeRows(item?.attribute_values || item?.attributeValues),
    price: normalizePrice(item?.price),
    unit_price: normalizeAmount(item?.unit_price ?? item?.unitPrice),
    quantity,
    status: normalizeText(item?.status || ADD_TO_CART_STATUS).toLowerCase() || ADD_TO_CART_STATUS,
    sync_state: normalizeText(item?.sync_state || item?.syncState),
    added_at: normalizeText(item?.added_at || item?.saved_at || item?.updated_at) || new Date().toISOString(),
    updated_at: normalizeText(item?.updated_at || item?.added_at || item?.saved_at) || new Date().toISOString(),
  };
};

const hasCartAttributeRows = (item = {}) => (
  Array.isArray(item?.attribute_values) && item.attribute_values.length > 0
);

const hasSelectedAttributes = (item = {}) => (
  item?.selected_attributes
  && typeof item.selected_attributes === 'object'
  && !Array.isArray(item.selected_attributes)
  && Object.keys(item.selected_attributes).length > 0
);

const getCartItemPriceId = (item = {}) => resolveCartProductPriceId(item);

const findLocalCartFallback = (remoteItem, localItems = [], row = {}) => {
  if (!remoteItem || !Array.isArray(localItems) || localItems.length === 0) return null;

  const remoteKey = normalizeText(remoteItem?.key);
  const remoteTrustId = resolveTrustId(remoteItem?.trust_id || row?.trust_id || row?.trustId);
  const remotePurchaseId = normalizeText(
    remoteItem?.purchase_id
    || remoteItem?.purchaseId
    || row?.id
    || row?.purchase_id
    || row?.purchaseId
  );
  const remoteProductPriceId = getCartItemPriceId(remoteItem) || normalizeText(
    row?.product_price_id
    || row?.productPriceId
    || row?.price_id
    || row?.priceId
  );
  const remoteProductId = normalizeText(
    remoteItem?.id
    || row?.product_id
    || row?.productId
    || row?.product?.id
    || row?.product_price?.product_id
    || row?.product_price?.productId
  );

  return localItems.find((candidate) => {
    if (!candidate) return false;

    const candidateTrustId = resolveTrustId(candidate?.trust_id);
    if (remoteTrustId && candidateTrustId && candidateTrustId !== remoteTrustId) return false;

    if (remoteKey && normalizeText(candidate?.key) === remoteKey) return true;
    if (remotePurchaseId && normalizeText(candidate?.purchase_id || candidate?.purchaseId) === remotePurchaseId) return true;
    if (remoteProductPriceId && getCartItemPriceId(candidate) === remoteProductPriceId) return true;
    if (remoteProductId && normalizeText(candidate?.id || candidate?.product_id || candidate?.productId) === remoteProductId) return true;

    return false;
  }) || null;
};

const mergeRemoteCartItemWithLocalFallback = (remoteItem, localMatch = null) => {
  if (!remoteItem || !localMatch) return remoteItem;

  const remoteProductPriceId = getCartItemPriceId(remoteItem);
  const localProductId = normalizeText(localMatch?.id);
  const remoteProductId = normalizeText(remoteItem?.id);
  const remoteImages = normalizeProductImages(remoteItem?.images);
  const localImages = normalizeProductImages(localMatch?.images);
  const shouldUseLocalProductId = (
    localProductId
    && remoteProductPriceId
    && remoteProductId === remoteProductPriceId
  );

  return normalizeCartItem({
    ...remoteItem,
    id: shouldUseLocalProductId ? localProductId : remoteItem.id,
    category_id: normalizeText(remoteItem.category_id) || localMatch.category_id,
    category_name: normalizeText(remoteItem.category_name) || localMatch.category_name,
    product_name: normalizeText(remoteItem.product_name).startsWith('Product ')
      ? localMatch.product_name || remoteItem.product_name
      : remoteItem.product_name,
    product_code: normalizeText(remoteItem.product_code) || localMatch.product_code,
    product_type: normalizeText(remoteItem.product_type) || localMatch.product_type,
    alias_name: normalizeText(remoteItem.alias_name) || localMatch.alias_name,
    images: remoteImages.length > 0 ? remoteImages : localImages,
    selected_image: normalizeText(remoteItem.selected_image) || localMatch.selected_image,
    selected_attributes: hasSelectedAttributes(remoteItem)
      ? remoteItem.selected_attributes
      : localMatch.selected_attributes || {},
    attribute_values: hasCartAttributeRows(remoteItem)
      ? remoteItem.attribute_values
      : localMatch.attribute_values || [],
    price: remoteItem.price || localMatch.price,
  });
};

const dedupeCartItems = (items) => {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeCartItem(item);
    if (!normalized) continue;
    byKey.set(normalized.key, normalized);
  }

  return [...byKey.values()];
};

const readScopedCartItems = (trustId = undefined) => {
  if (!hasStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getCartStorageKey(trustId)) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeCartItem).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const writeScopedCartItems = (trustId, items) => {
  if (!hasStorage()) return [];

  const normalizedItems = dedupeCartItems(items);

  try {
    window.localStorage.setItem(getCartStorageKey(trustId), JSON.stringify(normalizedItems));
  } catch {
    // Ignore storage failures so cart interactions do not hard-fail.
  }

  return normalizedItems;
};

const migrateLegacyCartItems = () => {
  if (!hasStorage() || cartLegacyMigrated) return;

  const legacyRaw = window.localStorage.getItem(CART_LEGACY_STORAGE_KEY);
  if (!legacyRaw) {
    cartLegacyMigrated = true;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch {
    cartLegacyMigrated = true;
    return;
  }

  if (!Array.isArray(parsed)) {
    cartLegacyMigrated = true;
    return;
  }

  const grouped = new Map();
  const currentTrustId = getActiveTrustId();

  for (const rawItem of parsed) {
    const normalized = normalizeCartItem(rawItem);
    if (!normalized) continue;

    const bucketTrustId = normalized.trust_id || currentTrustId || TRUST_STORAGE_FALLBACK;
    const bucketKey = getCartStorageKey(bucketTrustId);
    const migratedItem = {
      ...normalized,
      trust_id: bucketTrustId,
      key: getCartKey(normalized.id, bucketTrustId),
    };

    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, []);
    }
    grouped.get(bucketKey).push(migratedItem);
  }

  grouped.forEach((items, bucketKey) => {
    const trustId = bucketKey.slice(CART_STORAGE_KEY_PREFIX.length);
    const existing = readScopedCartItems(trustId);
    writeScopedCartItems(trustId, [...existing, ...items]);
  });

  try {
    window.localStorage.removeItem(CART_LEGACY_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }

  cartLegacyMigrated = true;
};

export const readCartItems = (trustId = undefined) => {
  migrateLegacyCartItems();
  return readScopedCartItems(trustId);
};

export const toCartItem = (product, context = {}) => {
  const id = normalizeText(product?.id);
  const trustId = resolveTrustId(context.trustId);
  const key = getCartKey(id, trustId);
  if (!id || !key) return null;

  const quantity = normalizeQuantity(context.quantity ?? product?.quantity ?? 1) || 1;
  const now = new Date().toISOString();
  const productPriceId = resolveCartProductPriceId(product, context);
  const unitPrice = resolveCartUnitPrice(product, context);

  return {
    key,
    id,
    trust_id: trustId,
    category_id: normalizeText(context.categoryId || product?.category_id),
    category_name: normalizeText(context.categoryName || product?.category_name),
    product_name: normalizeText(product?.product_name || product?.alias_name) || `Product ${id}`,
    product_code: normalizeText(product?.product_code),
    product_type: normalizeText(product?.product_type),
    alias_name: normalizeText(product?.alias_name),
    purchase_id: normalizeText(context.cartPurchaseId || context.cart_purchase_id),
    product_price_id: productPriceId,
    images: Array.isArray(product?.images) ? product.images.filter(isActiveImage) : [],
    selected_image: normalizeText(context.selectedImage || product?.selected_image),
    selected_attributes: normalizeAttributes(context.selectedAttributes || product?.selected_attributes || {}),
    attribute_values: normalizeAttributeRows(context.attributeValues || product?.attribute_values || []),
    price: normalizePrice(context.price || product?.price || null),
    unit_price: unitPrice,
    quantity,
    status: normalizeText(context.status || ADD_TO_CART_STATUS).toLowerCase() || ADD_TO_CART_STATUS,
    sync_state: normalizeText(context.syncState || context.sync_state),
    added_at: normalizeText(product?.added_at) || now,
    updated_at: now,
  };
};

export const findCartItem = (productId, trustId = undefined) => {
  const identifiers = getCartItemSearchIdentifiers(productId, trustId);
  return findCartItemByIdentifiers(readCartItems(trustId), identifiers, trustId);
};

export const getCartItemQuantity = (productId, trustId = undefined) => {
  const item = findCartItem(productId, trustId);
  return Number(item?.quantity || 0);
};

export const setCartPurchaseRpcOverrideForTests = (handler = null) => {
  cartPurchaseRpcOverride = typeof handler === 'function' ? handler : null;
};

export const setCartProductsApiOverrideForTests = (handler = null) => {
  cartProductsApiOverride = typeof handler === 'function' ? handler : null;
};

const callCartPurchaseRpc = async (request) => {
  if (cartPurchaseRpcOverride) {
    return cartPurchaseRpcOverride(request);
  }

  if (!hasPurchaseApiConfig()) {
    throw new Error('Cart sync is unavailable. Please check Supabase configuration and try again.');
  }

  const module = await import('../services/supabaseClient.js');
  const supabase = module?.supabase;
  if (!supabase?.rpc) {
    throw new Error('Cart sync is unavailable. Please try again.');
  }

  return supabase.rpc('manage_purchase_by_member', request);
};

const extractPurchaseRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of ['purchases', 'items', 'rows', 'data', 'result']) {
    if (Array.isArray(value[key])) return value[key];
  }

  for (const key of ['purchase', 'item', 'row']) {
    if (value[key] && typeof value[key] === 'object') return [value[key]];
  }

  if (value.id || value.purchase_id || value.purchaseId) return [value];
  return [];
};

const flattenPurchaseRows = (rows = []) => {
  const flattened = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;

    const nestedRows = Array.isArray(row.purchases)
      ? row.purchases
      : Array.isArray(row.items)
        ? row.items
        : Array.isArray(row.order_items)
          ? row.order_items
          : Array.isArray(row.line_items)
            ? row.line_items
            : null;

    if (nestedRows && nestedRows.length > 0) {
      nestedRows.forEach((nestedRow) => {
        if (nestedRow && typeof nestedRow === 'object') {
          flattened.push(nestedRow);
        }
      });
      continue;
    }

    flattened.push(row);
  }

  return flattened;
};

const getPurchaseRowId = (row = {}) => normalizeText(row?.purchase_id || row?.purchaseId || row?.id);

const resolveResponsePurchaseId = (data, { productId = '', productPriceId = '', fallbackPurchaseId = '' } = {}) => {
  const rows = flattenPurchaseRows(extractPurchaseRows(data));
  const normalizedProductId = normalizeText(productId);
  const normalizedProductPriceId = normalizeText(productPriceId);

  const matchingRow = rows.find((row) => {
    const rowPriceId = normalizeText(row?.product_price_id || row?.productPriceId || row?.price_id || row?.priceId);
    const rowProductId = normalizeText(row?.product_id || row?.productId || row?.product?.id || row?.product_price?.product_id);
    if (normalizedProductPriceId && rowPriceId === normalizedProductPriceId) return true;
    if (normalizedProductId && rowProductId === normalizedProductId) return true;
    return false;
  }) || rows[0] || null;

  return getPurchaseRowId(matchingRow) || normalizeText(data?.purchase_id || data?.purchaseId) || normalizeText(fallbackPurchaseId);
};

const getPurchaseRowTimestamp = (row = {}) => {
  const timestamp = normalizeText(row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt);
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
};

const comparePurchaseRowsNewest = (left = {}, right = {}) => {
  const timeDiff = getPurchaseRowTimestamp(right) - getPurchaseRowTimestamp(left);
  if (timeDiff !== 0) return timeDiff;
  const rightId = normalizeText(right?.id || right?.purchase_id);
  const leftId = normalizeText(left?.id || left?.purchase_id);
  return rightId.localeCompare(leftId);
};

const pickLatestCartRowsByPrice = (rows = []) => {
  const latestByKey = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(
      row?.product_price_id
      || row?.productPriceId
      || row?.price_id
      || row?.priceId
      || row?.id
    );
    if (!key) continue;

    const existing = latestByKey.get(key);
    if (!existing || comparePurchaseRowsNewest(row, existing) < 0) {
      latestByKey.set(key, row);
    }
  }

  return [...latestByKey.values()];
};

const normalizeProductsApiResponse = (response) => {
  if (response && typeof response === 'object' && ('data' in response || 'error' in response)) {
    return response;
  }

  return { data: response, error: null };
};

const callCartProductsApi = async (request, signal = undefined) => {
  if (cartProductsApiOverride) {
    return normalizeProductsApiResponse(await cartProductsApiOverride(request));
  }

  const env = getRuntimeEnv();
  if (!env?.VITE_SUPABASE_URL || !env?.VITE_SUPABASE_ANON_KEY || typeof fetch !== 'function') {
    return { data: null, error: null };
  }

  const url = `${String(env.VITE_SUPABASE_URL).replace(/\/+$/, '')}${PRODUCTS_RPC_PATH}`;
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(request),
  });

  const contentType = normalizeText(response.headers?.get?.('content-type')).toLowerCase();
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = normalizeText(data?.message || data?.error || data) || 'Unable to load product catalog.';
    return { data: null, error: new Error(message) };
  }

  return { data, error: null };
};

const normalizeProductCategoryList = (value) => {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];

  const hasCategoryRows = value.some((entry) => entry && typeof entry === 'object' && Array.isArray(entry.products));
  if (hasCategoryRows) return value;

  return [{ id: '', name: '', products: value }];
};

const isCatalogProductCandidate = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (
    value.product_name !== undefined
    || value.productName !== undefined
    || value.product_code !== undefined
    || value.productCode !== undefined
    || value.product_type !== undefined
    || value.productType !== undefined
    || Array.isArray(value.prices)
    || Array.isArray(value.product_prices)
    || Array.isArray(value.productPrices)
  )
);

const extractFallbackProductList = (payload) => {
  const products = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (isCatalogProductCandidate(value)) {
      const productId = normalizeText(value.id || value.product_id || value.productId);
      const productKey = productId || normalizeText(value.product_name || value.productName || value.product_code || value.productCode);
      if (productKey && !seen.has(productKey)) {
        seen.add(productKey);
        products.push(value);
      }
      return;
    }

    Object.values(value).forEach(visit);
  };

  visit(payload);
  return products;
};

const extractProductCategories = (payload) => {
  if (!payload) return [];

  const candidates = [
    payload?.categories,
    payload?.data?.categories,
    payload?.result?.categories,
    payload?.payload?.categories,
    payload?.products,
    payload?.data?.products,
    payload?.result?.products,
    payload?.payload?.products,
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload?.result) ? payload.result : null,
    Array.isArray(payload) ? payload : null,
  ];

  for (const candidate of candidates) {
    const categories = normalizeProductCategoryList(candidate);
    if (categories && categories.length > 0) return categories;
  }

  const fallbackProducts = extractFallbackProductList(payload);
  return fallbackProducts.length > 0 ? [{ id: '', name: '', products: fallbackProducts }] : [];
};

export const fetchTrustProductsCategories = async (trustId, signal = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  if (!normalizedTrustId || normalizedTrustId === TRUST_STORAGE_FALLBACK) return [];

  try {
    const { data, error } = await callCartProductsApi({
      p_trust_id: normalizedTrustId,
    }, signal);

    if (error) throw error;
    if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) return [];

    return extractProductCategories(data);
  } catch {
    return [];
  }
};

const getCatalogProductId = (product = {}) => normalizeText(
  product?.id
  || product?.product_id
  || product?.productId
);

const hasPriceLikeFields = (value = {}) => Boolean(
  value
  && typeof value === 'object'
  && (
    value.product_price_id !== undefined
    || value.productPriceId !== undefined
    || value.price_id !== undefined
    || value.priceId !== undefined
    || value.price_after_discount !== undefined
    || value.member_price !== undefined
    || value.total_payable !== undefined
    || value.mrp !== undefined
  )
);

const collectCatalogPriceRows = (product = {}) => {
  const rows = [];
  const pushRow = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      rows.push(value);
    }
  };

  [
    product?.price,
    product?.product_price,
    product?.productPrice,
    product?.pricing,
    product?.selected_price,
    product?.selectedPrice,
    product?.default_price,
    product?.defaultPrice,
  ].forEach(pushRow);

  [
    product?.prices,
    product?.product_prices,
    product?.productPrices,
    product?.pricing_options,
    product?.pricingOptions,
    product?.price_options,
    product?.priceOptions,
  ].forEach((list) => {
    if (Array.isArray(list)) list.forEach(pushRow);
  });

  if (hasPriceLikeFields(product)) {
    pushRow(product);
  }

  return rows;
};

const resolveCatalogPriceId = (priceRow = {}, product = {}) => normalizeText(
  priceRow?.product_price_id
  || priceRow?.productPriceId
  || priceRow?.price_id
  || priceRow?.priceId
  || (priceRow !== product ? priceRow?.id : '')
  || product?.product_price_id
  || product?.productPriceId
  || product?.price_id
  || product?.priceId
);

const resolveCatalogPriceProductId = (priceRow = {}, product = {}) => normalizeText(
  priceRow?.product_id
  || priceRow?.productId
  || product?.id
  || product?.product_id
  || product?.productId
);

const CATEGORY_CHILD_KEYS = [
  'categories',
  'children',
  'subcategories',
  'sub_categories',
  'subCategories',
  'child_categories',
  'childCategories',
];

const PRODUCT_LIST_KEYS = [
  'products',
  'items',
];

const getCategoryContext = (category = {}, parentContext = {}) => ({
  id: normalizeText(
    category?.id
    || category?.category_id
    || category?.categoryId
    || parentContext?.id
  ),
  name: normalizeText(
    category?.name
    || category?.category_name
    || category?.categoryName
    || parentContext?.name
  ),
  raw: category || parentContext?.raw || null,
});

export const buildProductCatalogLookups = (categories = []) => {
  const byPriceId = new Map();
  const byProductId = new Map();

  const addProduct = (product, categoryContext = {}) => {
    if (!product || typeof product !== 'object') return;

    const productId = getCatalogProductId(product);
    const category = categoryContext?.raw || null;
    const productWithCategory = {
      ...product,
      category_id: normalizeText(product?.category_id || product?.categoryId || categoryContext?.id),
      category_name: normalizeText(product?.category_name || product?.categoryName || categoryContext?.name),
    };
    const match = {
      product: productWithCategory,
      category,
      priceRow: null,
    };

    if (productId && !byProductId.has(productId)) {
      byProductId.set(productId, match);
    }

    collectCatalogPriceRows(product).forEach((priceRow) => {
      const priceId = resolveCatalogPriceId(priceRow, product);
      if (!priceId) return;

      byPriceId.set(priceId, {
        product: productWithCategory,
        category,
        priceRow,
      });

      const priceProductId = resolveCatalogPriceProductId(priceRow, product);
      if (priceProductId && !byProductId.has(priceProductId)) {
        byProductId.set(priceProductId, {
          product: productWithCategory,
          category,
          priceRow,
        });
      }
    });
  };

  const visitCategoryNode = (node, parentContext = {}) => {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((entry) => visitCategoryNode(entry, parentContext));
      return;
    }

    if (isCatalogProductCandidate(node)) {
      addProduct(node, parentContext);
      return;
    }

    const currentContext = getCategoryContext(node, parentContext);

    PRODUCT_LIST_KEYS.forEach((key) => {
      const products = node?.[key];
      if (Array.isArray(products)) {
        products.forEach((product) => visitCategoryNode(product, currentContext));
      }
    });

    CATEGORY_CHILD_KEYS.forEach((key) => {
      const children = node?.[key];
      if (Array.isArray(children)) {
        children.forEach((child) => visitCategoryNode(child, currentContext));
      }
    });
  };

  visitCategoryNode(categories, {});

  return { byPriceId, byProductId };
};

const resolveRemoteLineUnitAmount = (row, key, quantity) => {
  const amount = normalizeAmount(row?.[key]);
  if (amount <= 0) return 0;
  return quantity > 0 ? amount / quantity : amount;
};

const buildRemoteCartPrice = (row = {}, priceRow = null, quantity = 1) => {
  const productPriceId = normalizeText(row?.product_price_id || row?.productPriceId || row?.price_id || row?.priceId || priceRow?.id);
  const unitPrice = normalizeAmount(row?.unit_price) || resolveRemoteLineUnitAmount(row, 'amount', quantity);
  const unitTax = resolveRemoteLineUnitAmount(row, 'tax_amount', quantity);
  const unitDelivery = resolveRemoteLineUnitAmount(row, 'delivery_fee', quantity);
  const unitTotal = resolveRemoteLineUnitAmount(row, 'total_amount', quantity);

  return {
    ...(priceRow && typeof priceRow === 'object' ? priceRow : {}),
    id: normalizeText(priceRow?.id) || productPriceId,
    product_price_id: productPriceId,
    price_after_discount: unitPrice || normalizeAmount(priceRow?.price_after_discount),
    member_price: unitPrice || normalizeAmount(priceRow?.member_price),
    mrp: normalizeAmount(priceRow?.mrp) || unitPrice,
    discount_pct: normalizeAmount(priceRow?.discount_pct),
    gst_pct: normalizeAmount(priceRow?.gst_pct),
    gst_amount: unitTax || normalizeAmount(priceRow?.gst_amount),
    transport_fee: unitDelivery || normalizeAmount(priceRow?.transport_fee),
    total_payable: unitTotal || normalizeAmount(priceRow?.total_payable) || unitPrice,
    billing_type: normalizeText(priceRow?.billing_type),
    status: normalizeText(priceRow?.status),
  };
};

const normalizeCatalogImages = (product = {}, row = {}) => {
  if (Array.isArray(product?.images)) return product.images.filter(isActiveImage);
  if (Array.isArray(row?.images)) return row.images.filter(isActiveImage);

  const imageUrl = normalizeText(
    product?.image_url
    || product?.imageUrl
    || product?.thumbnail_url
    || product?.thumbnailUrl
    || product?.photo_url
    || product?.photoUrl
    || row?.image_url
    || row?.imageUrl
  );

  return imageUrl ? [{ image_url: imageUrl }] : [];
};

const normalizeRemoteCartItem = (row = {}, { trustId, priceRow = null, product = null, category = null } = {}) => {
  const productPriceId = normalizeText(row?.product_price_id || row?.productPriceId || row?.price_id || row?.priceId || priceRow?.id);
  const productId = normalizeText(
    row?.product_id
    || row?.productId
    || row?.product?.id
    || row?.product_price?.product_id
    || row?.product_price?.productId
    || priceRow?.product_id
    || priceRow?.productId
    || product?.id
    || product?.product_id
    || productPriceId
  );
  const quantity = normalizeQuantity(row?.quantity) || 1;
  const normalizedTrustId = resolveTrustId(row?.trust_id || row?.trustId || trustId);

  return normalizeCartItem({
    ...product,
    id: productId,
    trust_id: normalizedTrustId,
    purchase_id: normalizeText(row?.id || row?.purchase_id || row?.purchaseId),
    product_price_id: productPriceId,
    category_id: normalizeText(product?.category_id || category?.id || row?.category_id || row?.categoryId),
    category_name: normalizeText(product?.category_name || category?.name || row?.category_name || row?.categoryName),
    product_name: normalizeText(product?.product_name || product?.alias_name || row?.product_name || row?.name) || `Product ${productId || productPriceId}`,
    product_code: normalizeText(product?.product_code || row?.product_code),
    product_type: normalizeText(product?.product_type || row?.product_type),
    alias_name: normalizeText(product?.alias_name || row?.alias_name),
    images: normalizeCatalogImages(product, row),
    selected_image: normalizeText(row?.selected_image || row?.image_url || row?.imageUrl || product?.selected_image || product?.image_url || product?.imageUrl),
    selected_attributes: row?.selected_attributes || row?.selectedAttributes || {},
    attribute_values: Array.isArray(product?.attribute_values) ? product.attribute_values : (row?.attribute_values || row?.attributeValues || []),
    price: buildRemoteCartPrice(row, priceRow, quantity),
    unit_price: normalizeAmount(row?.unit_price),
    quantity,
    status: ADD_TO_CART_STATUS,
    sync_state: SYNCED_SYNC_STATE,
    added_at: row?.created_at || row?.createdAt || row?.updated_at || row?.updatedAt,
    updated_at: row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt,
  });
};

const enrichRemoteCartRows = async (rows = [], trustId = undefined, localItems = []) => {
  const categories = await fetchTrustProductsCategories(trustId);
  const { byPriceId, byProductId } = buildProductCatalogLookups(categories);

  return rows
    .map((row) => {
      const productPriceId = normalizeText(row?.product_price_id || row?.productPriceId || row?.price_id || row?.priceId);
      const productId = normalizeText(
        row?.product_id
        || row?.productId
        || row?.product?.id
        || row?.product_price?.product_id
        || row?.product_price?.productId
      );
      const catalogMatch = byPriceId.get(productPriceId) || byProductId.get(productId) || null;

      const remoteItem = normalizeRemoteCartItem(row, {
        trustId,
        priceRow: catalogMatch?.priceRow || null,
        product: catalogMatch?.product || null,
        category: catalogMatch?.category || null,
      });

      return mergeRemoteCartItemWithLocalFallback(
        remoteItem,
        findLocalCartFallback(remoteItem, localItems, row)
      );
    })
    .filter(Boolean);
};

const resolveExistingPurchaseRef = (item, trustId, existingItem = null, context = {}) => {
  const shouldIgnoreStoredRef = Boolean(context.ignoreStoredPurchaseRef);
  const storedRef = shouldIgnoreStoredRef ? null : getCartPurchaseRef(item?.id || existingItem?.id, trustId);
  const purchaseId = normalizeText(
    item?.purchase_id
    || item?.purchaseId
    || existingItem?.purchase_id
    || existingItem?.purchaseId
    || storedRef?.purchase_id
    || storedRef?.purchaseId
  );
  const productPriceId = normalizeText(
    item?.product_price_id
    || item?.productPriceId
    || existingItem?.product_price_id
    || existingItem?.productPriceId
    || storedRef?.product_price_id
    || storedRef?.productPriceId
  );

  return { purchaseId, productPriceId };
};

const getRequiredCartMutationIdentity = (trustId) => {
  const normalizedTrustId = resolveTrustId(trustId);
  if (!normalizedTrustId || normalizedTrustId === TRUST_STORAGE_FALLBACK) {
    throw new Error('Selected trust is missing. Please select a trust and try again.');
  }

  const memberId = resolveMemberIdFromUser(readStoredUser());
  if (!memberId) {
    throw new Error('Could not find your member profile ID. Please sign in again and retry.');
  }

  return { memberId, trustId: normalizedTrustId };
};

const getCartRpcErrorMessage = (value = {}) => normalizeText(
  value?.message
  || value?.error
  || value?.details
  || value?.hint
);

const ensureCartRpcSuccess = (data, error) => {
  if (error) throw error;
  if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
    const rpcError = new Error(getCartRpcErrorMessage(data) || 'Unable to update your cart right now.');
    rpcError.rpcData = data;
    throw rpcError;
  }
};

const toCartIdentifier = (type, value) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;
  return { type, value: normalizedValue };
};

const getCartItemSearchIdentifiers = (itemOrId = {}, trustId = undefined) => {
  if (itemOrId && typeof itemOrId === 'object') {
    return [
      toCartIdentifier('key', itemOrId.key),
      toCartIdentifier('purchase_id', itemOrId.purchase_id || itemOrId.purchaseId),
      toCartIdentifier('product_price_id', itemOrId.product_price_id || itemOrId.productPriceId || itemOrId.price_id || itemOrId.priceId || itemOrId.price?.id),
      toCartIdentifier('product_id', itemOrId.product_id || itemOrId.productId || itemOrId.id),
    ].filter(Boolean);
  }

  const identity = normalizeText(itemOrId);
  return [
    toCartIdentifier('key', identity && trustId ? getCartKey(identity, trustId) : ''),
    toCartIdentifier('product_id', identity),
    toCartIdentifier('product_price_id', identity),
    toCartIdentifier('purchase_id', identity),
  ].filter(Boolean);
};

const cartItemMatchesIdentifier = (item = {}, identifier = {}, trustId = undefined) => {
  const resolvedTrustId = resolveTrustId(trustId || item?.trust_id);
  const type = normalizeText(identifier.type);
  const value = normalizeText(identifier.value);
  if (!value) return false;

  if (type === 'key') return normalizeText(item.key) === value;
  if (type === 'purchase_id') return normalizeText(item.purchase_id || item.purchaseId) === value;
  if (type === 'product_price_id') {
    return normalizeText(item.product_price_id || item.productPriceId || item.price_id || item.priceId || item.price?.id) === value;
  }
  if (type === 'product_id') {
    return normalizeText(item.product_id || item.productId || item.id) === value
      || normalizeText(item.key) === getCartKey(value, resolvedTrustId);
  }

  return false;
};

const findCartItemByIdentifiers = (items = [], identifiers = [], trustId = undefined) => {
  const compacted = (Array.isArray(identifiers) ? identifiers : [identifiers]).filter(Boolean);
  if (compacted.length === 0) return null;

  return (Array.isArray(items) ? items : []).find((item) => (
    compacted.some((identifier) => cartItemMatchesIdentifier(item, identifier, trustId))
  )) || null;
};

const getPurchaseRowStatus = (row = {}) => normalizeText(
  row?.status
  || row?.purchase_status
  || row?.purchaseStatus
  || row?.state
).toLowerCase();

const getPurchaseRowType = (row = {}) => normalizeText(
  row?.type
  || row?.purchase_type
  || row?.purchaseType
).toLowerCase();

const getPurchaseRowProductPriceId = (row = {}) => normalizeText(
  row?.product_price_id
  || row?.productPriceId
  || row?.price_id
  || row?.priceId
);

const findPurchaseRowByPriceAndType = (rows = [], {
  trustId,
  productPriceId,
  type,
  preferredStatuses = [],
} = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const normalizedProductPriceId = normalizeText(productPriceId);
  const normalizedType = normalizeText(type).toLowerCase();
  if (!normalizedTrustId || !normalizedProductPriceId || !normalizedType) return null;

  const matches = flattenPurchaseRows(rows).filter((row) => (
    resolveTrustId(row?.trust_id || row?.trustId || normalizedTrustId) === normalizedTrustId
    && getPurchaseRowType(row) === normalizedType
    && getPurchaseRowProductPriceId(row) === normalizedProductPriceId
  ));

  if (matches.length === 0) return null;

  const preferred = preferredStatuses
    .map((status) => normalizeText(status).toLowerCase())
    .filter(Boolean);

  return matches.find((row) => preferred.includes(getPurchaseRowStatus(row)))
    || matches.sort(comparePurchaseRowsNewest)[0]
    || null;
};

const fetchAuthoritativePurchaseRow = async ({
  memberId,
  trustId,
  productPriceId,
  type,
  preferredStatuses = [],
}) => {
  const requestTrustId = resolveTrustId(trustId);
  const { data, error } = await callCartPurchaseRpc({
    p_member_id: memberId,
    p_trust_id: requestTrustId,
    p_action: 'get',
    p_payload: {},
  });
  ensureCartRpcSuccess(data, error);

  return findPurchaseRowByPriceAndType(extractPurchaseRows(data), {
    trustId: requestTrustId,
    productPriceId,
    type,
    preferredStatuses,
  });
};

const isDuplicateWishlistMutationError = (error = {}) => {
  const text = [
    error?.rpcData?.error,
    error?.rpcData?.message,
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
    error?.data?.error,
    error?.data?.message,
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');

  return text.includes('idx_unique_wishlist_item')
    || text.includes('idx_unique_active_wishlist_item')
    || text.includes('duplicate key value')
    || text.includes('unique constraint');
};

const upsertPurchaseOrThrow = async (request) => {
  const { data, error } = await callCartPurchaseRpc(request);
  ensureCartRpcSuccess(data, error);
  return data;
};

const persistCartPurchaseMutation = async ({
  item,
  context = {},
  existingItem = null,
  nextQuantity = 0,
}) => {
  const trustId = resolveTrustId(context.trustId || item?.trust_id);
  const { memberId, trustId: requestTrustId } = getRequiredCartMutationIdentity(trustId);
  const existingRef = resolveExistingPurchaseRef(item, requestTrustId, existingItem, context);
  const normalizedNextQuantity = normalizeQuantity(nextQuantity);
  const isRemoval = normalizedNextQuantity <= 0;
  const productPriceId = resolveCartProductPriceId(item, context) || existingRef.productPriceId;
  const unitPrice = resolveCartUnitPrice(item, context);
  let payload;

  if (isRemoval) {
    if (!existingRef.purchaseId) {
      throw new Error('Could not find the cart purchase ID. Please refresh and try again.');
    }

    payload = {
      id: existingRef.purchaseId,
      status: REMOVE_FROM_CART_STATUS,
      quantity: normalizeQuantity(context.removedQuantity ?? existingItem?.quantity ?? item?.quantity ?? 1) || 1,
    };
  } else if (existingRef.purchaseId) {
    payload = {
      id: existingRef.purchaseId,
      status: ADD_TO_CART_STATUS,
      quantity: normalizedNextQuantity,
      selected_attributes: item.selected_attributes || {},
    };
  } else {
    if (!productPriceId) {
      throw new Error('Product price ID is missing. Please refresh this product and try again.');
    }

    payload = {
      product_price_id: normalizeRpcValue(productPriceId),
      type: CART_TYPE,
      quantity: normalizedNextQuantity,
      unit_price: unitPrice,
      status: ADD_TO_CART_STATUS,
      selected_attributes: item.selected_attributes || {},
    };
  }

  const request = {
    p_member_id: memberId,
    p_trust_id: requestTrustId,
    p_action: 'upsert_purchase',
    p_payload: payload,
  };

  const { data, error } = await callCartPurchaseRpc(request);
  ensureCartRpcSuccess(data, error);

  const purchaseId = resolveResponsePurchaseId(data, {
    productId: item?.id,
    productPriceId,
    fallbackPurchaseId: existingRef.purchaseId,
  });

  if (!isRemoval && !purchaseId) {
    throw new Error('Cart update succeeded, but the purchase ID was not returned.');
  }

  return {
    purchaseId,
    productPriceId,
    unitPrice,
    status: isRemoval ? REMOVE_FROM_CART_STATUS : ADD_TO_CART_STATUS,
  };
};

export const setCartProductQuantity = async (product, context = {}) => {
  const item = toCartItem(product, context);
  const trustId = resolveTrustId(context.trustId);
  const nextQuantity = normalizeQuantity(context.quantity);
  const items = readCartItems(trustId);

  if (!item || nextQuantity <= 0) {
    return removeCartProduct(product?.id, trustId, {
      ...context,
      removedQuantity: items.find((entry) => entry.key === getCartKey(product?.id, trustId))?.quantity,
    });
  }

  const existingItem = items.find((entry) => entry.key === item.key) || null;
  const syncedPurchase = await persistCartPurchaseMutation({
    item,
    context,
    existingItem,
    nextQuantity,
  });

  const nextItem = {
    ...item,
    purchase_id: syncedPurchase.purchaseId,
    product_price_id: syncedPurchase.productPriceId || item.product_price_id,
    unit_price: syncedPurchase.unitPrice || item.unit_price,
    quantity: nextQuantity,
    status: ADD_TO_CART_STATUS,
    sync_state: SYNCED_SYNC_STATE,
    updated_at: new Date().toISOString(),
  };

  rememberCartPurchaseRef(nextItem);

  const existingIndex = items.findIndex((entry) => entry.key === nextItem.key);
  const nextItems = existingIndex >= 0
    ? items.map((entry, index) => (index === existingIndex ? { ...entry, ...nextItem } : entry))
    : [nextItem, ...items];

  const persisted = writeScopedCartItems(trustId, nextItems);
  notifyCartChange(persisted);
  return persisted;
};

const loadRemoteCartItems = async (trustId = undefined, localItems = []) => {
  const { memberId, trustId: requestTrustId } = getRequiredCartMutationIdentity(trustId);

  const request = {
    p_member_id: memberId,
    p_trust_id: requestTrustId,
    p_action: 'get',
    p_payload: {},
  };

  const { data, error } = await callCartPurchaseRpc(request);
  ensureCartRpcSuccess(data, error);

  const cartRows = flattenPurchaseRows(extractPurchaseRows(data)).filter((row) => {
    const rowTrustId = resolveTrustId(row?.trust_id || row?.trustId || requestTrustId);
    const rowType = normalizeText(row?.type || row?.purchase_type || row?.purchaseType).toLowerCase();
    return rowTrustId === requestTrustId && rowType === CART_TYPE;
  });

  const activeRows = pickLatestCartRowsByPrice(cartRows)
    .filter((row) => normalizeText(row?.status || row?.purchase_status || row?.purchaseStatus || row?.state).toLowerCase() === ADD_TO_CART_STATUS)
    .sort(comparePurchaseRowsNewest);

  return enrichRemoteCartRows(activeRows, requestTrustId, localItems);
};

export const refreshCartCache = async (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);

  if (cartRefreshPromiseByTrust.has(normalizedTrustId)) {
    return cartRefreshPromiseByTrust.get(normalizedTrustId);
  }

  const refreshPromise = (async () => {
    const localItems = readCartItems(normalizedTrustId);
    const remoteItems = await loadRemoteCartItems(normalizedTrustId, localItems);
    const persisted = writeScopedCartItems(normalizedTrustId, remoteItems);
    persisted.forEach(rememberCartPurchaseRef);
    notifyCartChange(persisted);
    return persisted;
  })().finally(() => {
    cartRefreshPromiseByTrust.delete(normalizedTrustId);
  });

  cartRefreshPromiseByTrust.set(normalizedTrustId, refreshPromise);
  return refreshPromise;
};

export const incrementCartProduct = (product, context = {}, step = 1) => {
  const currentQuantity = getCartItemQuantity(product?.id, context.trustId);
  return setCartProductQuantity(product, {
    ...context,
    quantity: currentQuantity + Math.max(1, Math.floor(Number(step)) || 1),
  });
};

export const decrementCartProduct = (product, context = {}, step = 1) => {
  const currentQuantity = getCartItemQuantity(product?.id, context.trustId);
  const nextQuantity = Math.max(0, currentQuantity - Math.max(1, Math.floor(Number(step)) || 1));
  return setCartProductQuantity(product, {
    ...context,
    quantity: nextQuantity,
  });
};

export const removeCartProduct = async (productId, trustId = undefined, context = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const items = readCartItems(normalizedTrustId);
  const target = findCartItemByIdentifiers(
    items,
    getCartItemSearchIdentifiers(context.item || productId, normalizedTrustId),
    normalizedTrustId
  );
  if (!target) return items;

  const syncedPurchase = await persistCartPurchaseMutation({
    item: target,
    context: {
      ...context,
      trustId: normalizedTrustId,
      removedQuantity: context.removedQuantity ?? target.quantity,
    },
    existingItem: target,
    nextQuantity: 0,
  });

  rememberCartPurchaseRef({
    ...target,
    purchase_id: syncedPurchase.purchaseId || target.purchase_id,
    product_price_id: syncedPurchase.productPriceId || target.product_price_id,
  });

  const nextItems = items.filter((item) => item.key !== target.key);
  const persisted = writeScopedCartItems(normalizedTrustId, nextItems);
  notifyCartChange(persisted);
  return persisted;
};

export const moveCartProductToWishlist = async (productId, trustId = undefined, context = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const items = readCartItems(normalizedTrustId);
  const target = findCartItemByIdentifiers(
    items,
    getCartItemSearchIdentifiers(context.item || productId, normalizedTrustId),
    normalizedTrustId
  );
  if (!target) {
    return {
      cartItems: items,
      wishlistItem: null,
    };
  }

  const { memberId, trustId: requestTrustId } = getRequiredCartMutationIdentity(normalizedTrustId);
  const existingRef = resolveExistingPurchaseRef(target, requestTrustId, target, context);
  const purchaseId = normalizeText(existingRef.purchaseId || target.purchase_id || target.purchaseId);
  const productPriceId = normalizeText(existingRef.productPriceId || target.product_price_id || target.productPriceId);
  const quantity = normalizeQuantity(context.quantity ?? target.quantity) || 1;

  if (!purchaseId) {
    throw new Error('Could not find the cart purchase ID. Please refresh and try again.');
  }

  if (!productPriceId) {
    throw new Error('Product price ID is missing. Please refresh this product and try again.');
  }

  const wishlistRequest = {
    p_member_id: memberId,
    p_trust_id: requestTrustId,
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: normalizeRpcValue(productPriceId),
      type: WISHLIST_TYPE,
      quantity,
      unit_price: resolveCartUnitPrice(target, context),
      status: WISHLIST_STATUS,
      selected_attributes: target.selected_attributes || {},
    },
  };
  const removalRequest = {
    p_member_id: memberId,
    p_trust_id: requestTrustId,
    p_action: 'upsert_purchase',
    p_payload: {
      id: purchaseId,
      status: REMOVE_FROM_CART_STATUS,
      quantity,
    },
  };

  try {
    let wishlistData;
    let alreadyInWishlist = false;

    try {
      wishlistData = await upsertPurchaseOrThrow(wishlistRequest);
    } catch (wishlistError) {
      if (!isDuplicateWishlistMutationError(wishlistError)) {
        throw wishlistError;
      }

      const existingWishlistRow = await fetchAuthoritativePurchaseRow({
        memberId,
        trustId: requestTrustId,
        productPriceId,
        type: WISHLIST_TYPE,
        preferredStatuses: [WISHLIST_STATUS],
      });
      const existingWishlistRowId = normalizeText(existingWishlistRow?.id || existingWishlistRow?.purchase_id);
      if (!existingWishlistRowId) {
        throw wishlistError;
      }

      if (getPurchaseRowStatus(existingWishlistRow) !== WISHLIST_STATUS) {
        await upsertPurchaseOrThrow({
          p_member_id: memberId,
          p_trust_id: requestTrustId,
          p_action: 'upsert_purchase',
          p_payload: {
            id: existingWishlistRowId,
            status: WISHLIST_STATUS,
            quantity,
          },
        });
      }

      alreadyInWishlist = true;
      wishlistData = {
        success: true,
        purchases: [{
          ...existingWishlistRow,
          id: existingWishlistRowId,
          status: WISHLIST_STATUS,
          type: WISHLIST_TYPE,
          product_price_id: productPriceId,
          quantity,
        }],
      };
    }

    await upsertPurchaseOrThrow(removalRequest);

    const resolvedPurchaseId = resolveResponsePurchaseId(wishlistData, {
      productId: target.id,
      productPriceId,
    });
    const now = new Date().toISOString();
    const wishlistItem = {
      ...target,
      purchase_id: resolvedPurchaseId,
      product_price_id: productPriceId,
      quantity,
      type: WISHLIST_TYPE,
      status: WISHLIST_STATUS,
      sync_state: SYNCED_SYNC_STATE,
      updated_at: now,
      saved_at: now,
    };

    const nextItems = items.filter((item) => item.key !== target.key);
    const persisted = writeScopedCartItems(normalizedTrustId, nextItems);
    notifyCartChange(persisted);

    return {
      cartItems: persisted,
      wishlistItem,
      alreadyInWishlist,
    };
  } catch (error) {
    console.error('[Cart] move to wishlist API failed', JSON.stringify({
      productId: target.id,
      productPriceId,
      purchaseId,
      trustId: requestTrustId,
      memberId,
      wishlistPayload: wishlistRequest.p_payload,
      removalPayload: removalRequest.p_payload,
      message: error?.message || String(error),
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      rpcData: error?.rpcData,
    }, null, 2));
    throw error;
  }
};
export const clearCartItems = async (trustId = undefined, { sync = true } = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const items = readCartItems(normalizedTrustId);

  if (sync) {
    for (const item of items) {
      const syncedPurchase = await persistCartPurchaseMutation({
        item,
        context: {
          trustId: normalizedTrustId,
          removedQuantity: item.quantity,
        },
        existingItem: item,
        nextQuantity: 0,
      });

      rememberCartPurchaseRef({
        ...item,
        purchase_id: syncedPurchase.purchaseId || item.purchase_id,
        product_price_id: syncedPurchase.productPriceId || item.product_price_id,
      });
    }
  }

  const persisted = writeScopedCartItems(normalizedTrustId, []);
  notifyCartChange(persisted);
  return persisted;
};

export const getCartSummary = (items = readCartItems()) => {
  const normalizedItems = Array.isArray(items) ? items : [];

  const summary = normalizedItems.reduce((acc, item) => {
    const pricing = getCartItemPricing(item);
    acc.totalQuantity += pricing.quantity;
    acc.distinctItems += 1;
    acc.subtotal += pricing.subtotal;
    acc.taxAmount += pricing.taxAmount;
    acc.transportAmount += pricing.transportAmount;
    acc.totalAmount += pricing.totalAmount;
    return acc;
  }, {
    totalQuantity: 0,
    distinctItems: 0,
    subtotal: 0,
    taxAmount: 0,
    transportAmount: 0,
    totalAmount: 0,
  });

  return summary;
};

export const subscribeCart = (callback, trustId = undefined) => {
  if (typeof window === 'undefined') return () => {};

  const notify = () => callback(readCartItems(trustId));
  const refresh = () => {
    void refreshCartCache(trustId).catch(() => {
      // Keep subscribers stable; pages that need user-visible errors call refreshCartCache directly.
    });
  };
  const handleStorage = (event) => {
    const storageKey = event?.key;
    if (!storageKey) return;
    if (
      storageKey === CART_LEGACY_STORAGE_KEY
      || storageKey.startsWith(CART_STORAGE_KEY_PREFIX)
      || TRUST_STORAGE_KEYS.has(storageKey)
    ) {
      notify();
      if (TRUST_STORAGE_KEYS.has(storageKey)) {
        refresh();
      }
    }
  };
  const handleTrustChanged = () => {
    notify();
    refresh();
  };

  window.addEventListener(CART_CHANGED_EVENT, notify);
  window.addEventListener(TRUST_CHANGED_EVENT, handleTrustChanged);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, notify);
    window.removeEventListener(TRUST_CHANGED_EVENT, handleTrustChanged);
    window.removeEventListener('storage', handleStorage);
  };
};
