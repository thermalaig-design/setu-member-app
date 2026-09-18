import { getUserHospitalMemberships } from '../utils/storageUtils.js';
import {
  buildProductCatalogLookups,
  fetchTrustProductsCategories,
} from './productCart.js';

export const WISHLIST_CHANGED_EVENT = 'product-wishlist-changed';

const WISHLIST_STORAGE_KEY_PREFIX = 'product_wishlist_v2_';
const WISHLIST_LEGACY_STORAGE_KEY = 'product_wishlist_v1';
const TRUST_CHANGED_EVENT = 'trust-changed';
const TRUST_STORAGE_KEYS = new Set(['selected_trust_id', 'last_selected_trust_id']);
const TRUST_STORAGE_FALLBACK = 'global';
const WISHLIST_STATUS = 'wishlist';
const REMOVE_FROM_WISHLIST_STATUS = 'remove_from_wishlist';
const PENDING_SYNC_STATE = 'pending';
const SYNCED_SYNC_STATE = 'synced';

let wishlistLegacyMigrated = false;
const wishlistCacheByTrust = new Map();
const wishlistRefreshPromiseByTrust = new Map();
let orderHistoryServicePromise = null;
let supabaseClientPromise = null;
let wishlistPurchaseRpcOverride = null;

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getRuntimeEnv = () => (typeof import.meta !== 'undefined' ? import.meta.env : undefined);

const hasPurchaseApiConfig = () => {
  const env = getRuntimeEnv();
  return Boolean(env?.VITE_SUPABASE_URL && env?.VITE_SUPABASE_ANON_KEY);
};

const hasWishlistPurchaseSource = () => hasPurchaseApiConfig() || Boolean(wishlistPurchaseRpcOverride);

export const setWishlistPurchaseRpcOverrideForTests = (handler = null) => {
  wishlistPurchaseRpcOverride = typeof handler === 'function' ? handler : null;
};

const loadOrderHistoryService = async () => {
  if (!hasPurchaseApiConfig()) return null;

  if (!orderHistoryServicePromise) {
    orderHistoryServicePromise = import('../services/orderHistoryService.js');
  }

  try {
    return await orderHistoryServicePromise;
  } catch {
    return null;
  }
};

const callWishlistPurchaseRpc = async (request) => {
  if (wishlistPurchaseRpcOverride) {
    return wishlistPurchaseRpcOverride(request);
  }

  const supabase = await loadSupabaseClient();
  if (!supabase?.rpc) return null;

  return supabase.rpc('manage_purchase_by_member', request);
};

const loadSupabaseClient = async () => {
  if (!hasPurchaseApiConfig()) return null;

  if (!supabaseClientPromise) {
    supabaseClientPromise = import('../services/supabaseClient.js');
  }

  try {
    const module = await supabaseClientPromise;
    return module?.supabase || null;
  } catch {
    return null;
  }
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

const isActiveProductImage = (image) => {
  const status = normalizeText(image?.status).toLowerCase();
  if (['inactive', 'disabled', 'deleted', 'archived'].includes(status)) return false;
  if (image?.is_active === false || image?.isActive === false) return false;
  return true;
};

const normalizeProductImages = (images) =>
  (Array.isArray(images) ? images : [])
    .filter((image) => normalizeText(image?.image_url) && isActiveProductImage(image));

const normalizeAmount = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const text = normalizeText(value);
  if (!text) return 0;

  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeQuantity = (value) => {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const normalizePrice = (value) => (value && typeof value === 'object' ? value : null);

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
    const normalizedKey = normalizeText(key).toLowerCase();
    const normalizedValue = normalizeAttributeValue(rawValue);
    if (normalizedKey && normalizedValue) {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
    }, {});
};

const redactId = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= 10) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
};

const getStoredUserDiagnostics = (user = {}) => ({
  hasUser: Boolean(user && Object.keys(user).length > 0),
  id: redactId(user?.id),
  member_uuid: redactId(user?.member_uuid),
  members_uuid: redactId(user?.members_uuid),
  members_id: redactId(user?.members_id),
  member_id: redactId(user?.member_id),
  member_ids_count: Array.isArray(user?.member_ids) ? user.member_ids.length : 0,
  memberships_count: getUserHospitalMemberships(user).length,
});

const getWishlistMutationDiagnostics = ({ trustId, product, context = {}, existingItem = null, request = null } = {}) => ({
  trustId: redactId(trustId),
  productId: redactId(product?.id || product?.product_id || product?.productId),
  productName: normalizeText(product?.product_name || product?.alias_name || product?.name),
  productStatus: normalizeText(product?.status),
  categoryId: redactId(context?.categoryId || product?.category_id || product?.categoryId),
  priceId: redactId(resolveWishlistProductPriceId(product, context)),
  priceStatus: normalizeText(context?.price?.status || product?.price?.status),
  priceProductId: redactId(context?.price?.product_id || product?.price?.product_id),
  unitPrice: resolveWishlistUnitPrice(product, context),
  existingPurchaseId: redactId(existingItem?.purchase_id || existingItem?.purchaseId),
  existingStatus: normalizeText(existingItem?.status),
  requestAction: request?.p_action,
  requestTrustId: redactId(request?.p_trust_id),
  requestMemberId: redactId(request?.p_member_id),
  requestPayload: {
    ...request?.p_payload,
    id: redactId(request?.p_payload?.id),
    product_price_id: redactId(request?.p_payload?.product_price_id),
  },
});

const logWishlistDiagnosticSnapshot = (label, value) => {
  try {
    console.error(`${label} snapshot`, JSON.stringify(value, null, 2));
  } catch {
    console.error(`${label} snapshot`, value);
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const readStoredUser = () => {
  if (typeof window === 'undefined') return {};

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

const resolveWishlistMutationMemberId = async () => {
  const service = await loadOrderHistoryService();
  return service?.resolveOrderHistoryMemberId
    ? service.resolveOrderHistoryMemberId(readStoredUser())
    : resolveMemberIdFromUser(readStoredUser());
};

const getRequiredWishlistMutationIdentity = async (trustId) => {
  const normalizedTrustId = resolveTrustId(trustId);
  if (!normalizedTrustId || normalizedTrustId === TRUST_STORAGE_FALLBACK) {
    console.warn('[Wishlist] mutation identity missing trust', {
      requestedTrustId: redactId(trustId),
      resolvedTrustId: normalizedTrustId,
      selectedTrustId: redactId(hasStorage() ? window.localStorage.getItem('selected_trust_id') : ''),
      lastSelectedTrustId: redactId(hasStorage() ? window.localStorage.getItem('last_selected_trust_id') : ''),
    });
    throw new Error('Selected trust is missing. Please select a trust and try again.');
  }

  const memberId = await resolveWishlistMutationMemberId();
  if (!memberId) {
    console.warn('[Wishlist] mutation identity missing member', {
      trustId: redactId(normalizedTrustId),
      user: getStoredUserDiagnostics(readStoredUser()),
    });
    throw new Error('Could not find your member profile ID. Please sign in again and retry.');
  }

  console.info('[Wishlist] mutation identity resolved', {
    trustId: redactId(normalizedTrustId),
    memberId: redactId(memberId),
  });

  return { memberId, trustId: normalizedTrustId };
};

const getActiveTrustId = () => {
  if (!hasStorage()) return TRUST_STORAGE_FALLBACK;

  return normalizeText(window.localStorage.getItem('selected_trust_id'))
    || normalizeText(window.localStorage.getItem('last_selected_trust_id'))
    || TRUST_STORAGE_FALLBACK;
};

const resolveTrustId = (value) => normalizeText(value) || getActiveTrustId();

const getWishlistStorageKey = (trustId = undefined) => `${WISHLIST_STORAGE_KEY_PREFIX}${resolveTrustId(trustId)}`;

const isWishlistStatusItem = (item = {}) => normalizeText(item?.status).toLowerCase() === WISHLIST_STATUS;

const filterWishlistStatusItems = (items = []) => (Array.isArray(items) ? items.filter(isWishlistStatusItem) : []);

const getWishlistSortTimestamp = (item = {}) => {
  const rawTimestamp = normalizeText(
    item?.saved_at
    || item?.updated_at
    || item?.created_at
    || item?.savedAt
    || item?.updatedAt
    || item?.createdAt
  );

  if (!rawTimestamp) return 0;

  const parsedTimestamp = Date.parse(rawTimestamp);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
};

const sortWishlistItemsNewestFirst = (items = []) => [...(Array.isArray(items) ? items : [])].sort((a, b) => {
  const timeDiff = getWishlistSortTimestamp(b) - getWishlistSortTimestamp(a);
  if (timeDiff !== 0) return timeDiff;

  const bIdentity = normalizeText(b?.purchase_id || b?.product_price_id || b?.id);
  const aIdentity = normalizeText(a?.purchase_id || a?.product_price_id || a?.id);
  return bIdentity.localeCompare(aIdentity);
});

export const getWishlistKey = (productId, trustId = '') => {
  const normalizedProductId = normalizeText(productId);
  if (!normalizedProductId) return '';
  return `${resolveTrustId(trustId)}:${normalizedProductId}`;
};

export const resolveWishlistProductPriceId = (product = {}, context = {}) => normalizeText(
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
);

const resolveWishlistUnitPrice = (product = {}, context = {}) => {
  const price = normalizePrice(context?.price || product?.price);
  const unitPrice = normalizeAmount(
    context?.unitPrice
    ?? context?.unit_price
    ?? price?.price_after_discount
    ?? price?.total_payable
    ?? price?.member_price
    ?? price?.mrp
    ?? product?.unit_price
    ?? product?.unitPrice
    ?? product?.price_after_discount
    ?? product?.total_payable
    ?? product?.member_price
    ?? product?.mrp
  );

  return Number.isFinite(unitPrice) ? unitPrice : 0;
};

const resolveWishlistQuantity = (context = {}, fallback = 1) => {
  const quantity = normalizeQuantity(context?.quantity ?? fallback);
  return quantity > 0 ? quantity : 1;
};

const resolveWishlistPriceObject = (product = {}, context = {}, productPriceId = '') => {
  const price = normalizePrice(context?.price || product?.price);
  if (price) return price;

  const unitPrice = resolveWishlistUnitPrice(product, context);
  if (unitPrice <= 0) return null;

  return {
    id: productPriceId || '',
    product_price_id: productPriceId || '',
    price_after_discount: unitPrice,
    total_payable: unitPrice,
    member_price: unitPrice,
    mrp: unitPrice,
    discount_pct: 0,
  };
};

const normalizeWishlistItem = (item, fallbackTrustId = undefined) => {
  if (!item || typeof item !== 'object') return null;

  const trustId = normalizeText(item?.trust_id || item?.trustId || fallbackTrustId);
  if (!trustId) return null;

  const source = normalizeText(item?.source || '').toLowerCase();
  const isRpcSource = ['rpc', 'remote', 'server', 'api'].includes(source);
  const hasProductReference = Boolean(
    item?.product_id
    || item?.productId
    || item?.product?.id
    || item?.product?.product_id
    || item?.product_price?.product_id
    || item?.product_price?.productId
    || item?.price?.product_id
    || item?.price?.productId
  );

  const purchaseId = normalizeText(item?.purchase_id || item?.purchaseId || (isRpcSource ? item?.id : ''));
  const productPriceId = normalizeText(
    item?.product_price_id
    || item?.productPriceId
    || item?.price_id
    || item?.priceId
    || item?.price?.id
    || item?.price?.product_price_id
    || item?.price?.price_id
  );
  const productId = normalizeText(
    item?.product_id
    || item?.productId
    || item?.product?.id
    || item?.product?.product_id
    || item?.product_price?.product_id
    || item?.product_price?.productId
    || item?.price?.product_id
    || item?.price?.productId
    || (!isRpcSource && !hasProductReference ? item?.id : '')
  );
  const identityId = productPriceId || productId || purchaseId || normalizeText(item?.id);
  const key = identityId ? getWishlistKey(identityId, trustId) : '';

  if (!key) return null;

  const quantity = normalizeQuantity(item?.quantity ?? item?.qty ?? item?.count ?? 1) || 1;
  const unitPrice = resolveWishlistUnitPrice(item, {});
  const price = normalizePrice(item?.price) || resolveWishlistPriceObject(item, {}, productPriceId);
  const status = normalizeText(item?.status || item?.purchase_status || item?.purchaseStatus || item?.state || WISHLIST_STATUS).toLowerCase() || WISHLIST_STATUS;
  const savedAt = normalizeText(item?.saved_at || item?.savedAt || item?.created_at || item?.createdAt || item?.updated_at || item?.updatedAt) || new Date().toISOString();
  const updatedAt = normalizeText(item?.updated_at || item?.updatedAt || item?.saved_at || item?.savedAt || item?.created_at || item?.createdAt) || savedAt;
  const syncState = normalizeText(item?.sync_state || item?.syncState || item?.sync_status || '').toLowerCase();

  return {
    key,
    purchase_id: purchaseId,
    id: normalizeText(productId || productPriceId || purchaseId || item?.id),
    product_id: productId || normalizeText(item?.product_id || item?.productId || ''),
    product_price_id: productPriceId,
    trust_id: trustId,
    category_id: normalizeText(item?.category_id || item?.categoryId),
    category_name: normalizeText(item?.category_name || item?.categoryName),
    product_name: normalizeText(item?.product_name || item?.alias_name || item?.name || item?.title) || `Product ${productId || productPriceId || purchaseId || key}`,
    product_code: normalizeText(item?.product_code),
    product_type: normalizeText(item?.product_type),
    alias_name: normalizeText(item?.alias_name),
    images: normalizeProductImages(item?.images),
    selected_image: normalizeText(item?.selected_image || item?.image_url || item?.imageUrl),
    selected_attributes: normalizeAttributes(item?.selected_attributes || {}),
    attribute_values: normalizeAttributeRows(item?.attribute_values || item?.attributeValues || []),
    price,
    unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
    quantity,
    status,
    saved_at: savedAt,
    updated_at: updatedAt,
    sync_state: syncState || (isRpcSource ? SYNCED_SYNC_STATE : ''),
    source: source || (isRpcSource ? 'rpc' : 'local'),
  };
};

const isGenericWishlistName = (value) => {
  const text = normalizeText(value);
  if (!text) return true;
  return /^Product\s+/i.test(text);
};

const hasWishlistSelectedAttributes = (item = {}) => (
  item?.selected_attributes
  && typeof item.selected_attributes === 'object'
  && !Array.isArray(item.selected_attributes)
  && Object.keys(item.selected_attributes).length > 0
);

const hasWishlistAttributeRows = (item = {}) => (
  Array.isArray(item?.attribute_values) && item.attribute_values.length > 0
);

const getWishlistCompletenessScore = (item = {}) => {
  let score = 0;
  if (normalizeText(item?.product_id)) score += 8;
  if (normalizeText(item?.product_price_id)) score += 8;
  if (normalizeText(item?.category_id)) score += 3;
  if (!isGenericWishlistName(item?.product_name)) score += 4;
  if (Array.isArray(item?.images) && item.images.length > 0) score += 3;
  if (normalizeText(item?.selected_image)) score += 2;
  if (hasWishlistSelectedAttributes(item)) score += 2;
  if (hasWishlistAttributeRows(item)) score += 2;
  if (item?.price && typeof item.price === 'object') score += 2;
  return score;
};

const getWishlistItemTimestamp = (item = {}) => (
  getWishlistSortTimestamp(item)
  || Date.parse(normalizeText(item?.updated_at || item?.saved_at || item?.created_at))
  || 0
);

const getWishlistIdentityAliases = (item = {}) => {
  const trustId = resolveTrustId(item?.trust_id || item?.trustId);
  const aliases = [];
  const pushAlias = (type, value) => {
    const text = normalizeText(value);
    if (trustId && text) aliases.push(`${type}:${trustId}:${text}`);
  };

  if (normalizeText(item?.key)) aliases.push(`key:${item.key}`);
  pushAlias('purchase', item?.purchase_id || item?.purchaseId);
  pushAlias('price', item?.product_price_id || item?.productPriceId);

  const productId = normalizeText(item?.product_id || item?.productId);
  if (productId) pushAlias('product', productId);

  return [...new Set(aliases)];
};

const pickWishlistDetailItem = (left = {}, right = {}) => {
  const leftScore = getWishlistCompletenessScore(left);
  const rightScore = getWishlistCompletenessScore(right);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;

  const rightTimestamp = getWishlistItemTimestamp(right);
  const leftTimestamp = getWishlistItemTimestamp(left);
  if (rightTimestamp !== leftTimestamp) return rightTimestamp > leftTimestamp ? right : left;

  return right;
};

const pickWishlistStatusItem = (left = {}, right = {}) => {
  const leftIsActive = isWishlistStatusItem(left);
  const rightIsActive = isWishlistStatusItem(right);
  if (leftIsActive !== rightIsActive) return rightIsActive ? right : left;

  const rightTimestamp = getWishlistItemTimestamp(right);
  const leftTimestamp = getWishlistItemTimestamp(left);
  if (rightTimestamp !== leftTimestamp) return rightTimestamp > leftTimestamp ? right : left;

  return right;
};

const normalizeWishlistIdentifierType = (type) => {
  const normalizedType = normalizeText(type).toLowerCase();
  if (['purchase', 'purchase_id', 'purchaseid'].includes(normalizedType)) return 'purchase_id';
  if (['price', 'product_price', 'product_price_id', 'productpriceid', 'price_id', 'priceid'].includes(normalizedType)) return 'product_price_id';
  if (['product', 'product_id', 'productid'].includes(normalizedType)) return 'product_id';
  if (normalizedType === 'key') return 'key';
  if (normalizedType === 'any') return 'any';
  return '';
};

const isDuplicateWishlistMutationError = (error = {}) => {
  const text = [
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
    || text.includes('duplicate key value')
    || text.includes('unique constraint');
};

const toWishlistIdentifier = (type, value) => {
  const normalizedType = normalizeWishlistIdentifierType(type);
  const normalizedValue = normalizeText(value);
  return normalizedType && normalizedValue ? { type: normalizedType, value: normalizedValue } : null;
};

const normalizeWishlistIdentifierInput = (identifier) => {
  if (identifier && typeof identifier === 'object') {
    const type = normalizeWishlistIdentifierType(identifier.type || identifier.kind || identifier.field);
    const value = normalizeText(identifier.value ?? identifier.id);
    return type && value ? { type, value } : null;
  }

  const value = normalizeText(identifier);
  return value ? { type: 'any', value } : null;
};

const compactWishlistIdentifiers = (identifiers = []) => {
  const seen = new Set();
  const compacted = [];

  for (const rawIdentifier of Array.isArray(identifiers) ? identifiers : [identifiers]) {
    const identifier = normalizeWishlistIdentifierInput(rawIdentifier);
    if (!identifier) continue;

    const key = `${identifier.type}:${identifier.value}`;
    if (seen.has(key)) continue;

    seen.add(key);
    compacted.push(identifier);
  }

  return compacted;
};

const getWishlistProductSearchIdentifiers = (product = {}, context = {}) => [
  toWishlistIdentifier('product_price_id', resolveWishlistProductPriceId(product, context)),
  toWishlistIdentifier('purchase_id', context?.purchaseId),
  toWishlistIdentifier('purchase_id', context?.purchase_id),
  toWishlistIdentifier('purchase_id', product?.purchase_id),
  toWishlistIdentifier('purchase_id', product?.purchaseId),
  toWishlistIdentifier('product_id', product?.product_id || product?.productId || product?.id),
].filter(Boolean);

const getWishlistRemovalIdentifier = (item = {}) => (
  toWishlistIdentifier('purchase_id', item?.purchase_id || item?.purchaseId)
  || toWishlistIdentifier('product_price_id', item?.product_price_id || item?.productPriceId)
  || toWishlistIdentifier('product_id', item?.product_id || item?.productId || item?.id)
  || toWishlistIdentifier('key', item?.key)
);

const pickWishlistText = (primary, fallback) => {
  const primaryText = normalizeText(primary);
  const fallbackText = normalizeText(fallback);
  if (primaryText && !isGenericWishlistName(primaryText)) return primaryText;
  if (fallbackText && !isGenericWishlistName(fallbackText)) return fallbackText;
  return primaryText || fallbackText;
};

const mergeDuplicateWishlistItems = (left, right) => {
  const statusSource = pickWishlistStatusItem(left, right);
  const detailSource = pickWishlistDetailItem(left, right);
  const fallbackSource = detailSource === right ? left : right;
  const status = normalizeText(statusSource?.status || detailSource?.status || WISHLIST_STATUS).toLowerCase() || WISHLIST_STATUS;

  return normalizeWishlistItem({
    ...fallbackSource,
    ...detailSource,
    purchase_id: normalizeText(detailSource?.purchase_id || detailSource?.purchaseId || fallbackSource?.purchase_id || fallbackSource?.purchaseId),
    product_id: normalizeText(detailSource?.product_id || detailSource?.productId || fallbackSource?.product_id || fallbackSource?.productId),
    product_price_id: normalizeText(detailSource?.product_price_id || detailSource?.productPriceId || fallbackSource?.product_price_id || fallbackSource?.productPriceId),
    id: normalizeText(
      detailSource?.product_id
      || detailSource?.productId
      || fallbackSource?.product_id
      || fallbackSource?.productId
      || detailSource?.id
      || fallbackSource?.id
    ),
    category_id: normalizeText(detailSource?.category_id || detailSource?.categoryId || fallbackSource?.category_id || fallbackSource?.categoryId),
    category_name: normalizeText(detailSource?.category_name || detailSource?.categoryName || fallbackSource?.category_name || fallbackSource?.categoryName),
    product_name: pickWishlistText(detailSource?.product_name, fallbackSource?.product_name),
    product_code: normalizeText(detailSource?.product_code || fallbackSource?.product_code),
    product_type: normalizeText(detailSource?.product_type || fallbackSource?.product_type),
    alias_name: normalizeText(detailSource?.alias_name || fallbackSource?.alias_name),
    images: Array.isArray(detailSource?.images) && detailSource.images.length > 0 ? detailSource.images : (fallbackSource?.images || []),
    selected_image: normalizeText(detailSource?.selected_image || fallbackSource?.selected_image),
    selected_attributes: hasWishlistSelectedAttributes(detailSource)
      ? detailSource.selected_attributes
      : fallbackSource?.selected_attributes || {},
    attribute_values: hasWishlistAttributeRows(detailSource)
      ? detailSource.attribute_values
      : fallbackSource?.attribute_values || [],
    price: detailSource?.price || fallbackSource?.price || null,
    unit_price: detailSource?.unit_price || fallbackSource?.unit_price || 0,
    quantity: statusSource?.quantity || detailSource?.quantity || fallbackSource?.quantity || 1,
    status,
    saved_at: normalizeText(detailSource?.saved_at || fallbackSource?.saved_at || statusSource?.saved_at),
    updated_at: normalizeText(statusSource?.updated_at || detailSource?.updated_at || fallbackSource?.updated_at) || new Date().toISOString(),
    sync_state: normalizeText(statusSource?.sync_state || detailSource?.sync_state || fallbackSource?.sync_state),
    source: normalizeText(statusSource?.source || detailSource?.source || fallbackSource?.source),
  }, detailSource?.trust_id || fallbackSource?.trust_id);
};

const dedupeWishlistItems = (items, fallbackTrustId = undefined) => {
  const deduped = [];
  const aliasToIndex = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeWishlistItem(item, item?.trust_id || item?.trustId || fallbackTrustId);
    if (!normalized) continue;

    const aliases = getWishlistIdentityAliases(normalized);
    const matchedIndex = aliases
      .map((alias) => aliasToIndex.get(alias))
      .find((index) => Number.isInteger(index));

    if (!Number.isInteger(matchedIndex)) {
      const index = deduped.length;
      deduped.push(normalized);
      aliases.forEach((alias) => aliasToIndex.set(alias, index));
      continue;
    }

    const existing = deduped[matchedIndex];
    const existingAliases = getWishlistIdentityAliases(existing);
    const merged = mergeDuplicateWishlistItems(existing, normalized);
    deduped[matchedIndex] = merged;

    [...existingAliases, ...aliases, ...getWishlistIdentityAliases(merged)]
      .forEach((alias) => aliasToIndex.set(alias, matchedIndex));
  }

  return deduped.filter(Boolean);
};

const readScopedWishlistItems = (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  if (wishlistCacheByTrust.has(normalizedTrustId)) {
    return wishlistCacheByTrust.get(normalizedTrustId) || [];
  }

  if (!hasStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getWishlistStorageKey(normalizedTrustId)) || '[]');
    const normalized = Array.isArray(parsed)
      ? dedupeWishlistItems(parsed, normalizedTrustId)
      : [];
    wishlistCacheByTrust.set(normalizedTrustId, normalized);
    return normalized;
  } catch {
    return [];
  }
};

const writeScopedWishlistItems = (trustId, items, { persist = true } = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const normalizedItems = dedupeWishlistItems(items, normalizedTrustId);
  wishlistCacheByTrust.set(normalizedTrustId, normalizedItems);

  if (persist && hasStorage()) {
    try {
      window.localStorage.setItem(getWishlistStorageKey(normalizedTrustId), JSON.stringify(normalizedItems));
    } catch {
      // Ignore storage failures so wishlist actions do not hard-fail.
    }
  }

  return normalizedItems;
};

const notifyWishlistChange = (items) => {
  if (typeof window === 'undefined') return;

  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: items }));
  } catch {
    // ignore event dispatch failures
  }
};

const extractPurchaseRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value.purchases)) return value.purchases;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.result)) return value.result;

  if (value.purchase && typeof value.purchase === 'object') return [value.purchase];
  if (value.item && typeof value.item === 'object') return [value.item];
  if (value.row && typeof value.row === 'object') return [value.row];
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
        if (!nestedRow || typeof nestedRow !== 'object') return;
        flattened.push({
          ...nestedRow,
          trust_id: row.trust_id || row.trustId || nestedRow.trust_id || nestedRow.trustId,
          trust_name: row.trust_name || row.trustName || nestedRow.trust_name || nestedRow.trustName || null,
          source: row.source || nestedRow.source || 'rpc',
        });
      });
      continue;
    }

    flattened.push(row);
  }

  return flattened;
};

const mergeWishlistItems = (remoteItems = [], localItems = []) => {
  const remoteNormalized = dedupeWishlistItems(remoteItems);
  const localNormalized = dedupeWishlistItems(localItems);
  const remoteKeys = new Set(remoteNormalized.map((item) => item.key));
  const localMap = new Map(localNormalized.map((item) => [item.key, item]));
  const localPurchaseMap = new Map();
  const localPriceMap = new Map();
  const localProductMap = new Map();

  localNormalized.forEach((item) => {
    const purchaseId = normalizeText(item?.purchase_id || item?.purchaseId);
    const productPriceId = normalizeText(item?.product_price_id || item?.productPriceId);
    const productId = normalizeText(item?.product_id || item?.productId || item?.id);
    if (purchaseId) {
      localPurchaseMap.set(purchaseId, item);
    }
    if (productPriceId) {
      localPriceMap.set(productPriceId, item);
    }
    if (productId) {
      localProductMap.set(productId, item);
    }
  });

  const matchedLocalKeys = new Set();

  const merged = remoteNormalized.map((remote) => {
    const remotePurchaseId = normalizeText(remote.purchase_id || remote.purchaseId);
    const remoteProductPriceId = normalizeText(remote.product_price_id || remote.productPriceId);
    const remoteProductId = normalizeText(remote.product_id || remote.productId || remote.id);
    const local = localMap.get(remote.key)
      || (remotePurchaseId ? localPurchaseMap.get(remotePurchaseId) : null)
      || (remoteProductPriceId ? localPriceMap.get(remoteProductPriceId) : null)
      || (remoteProductId ? localProductMap.get(remoteProductId) : null);
    if (!local) {
      return {
        ...remote,
        sync_state: remote.sync_state || SYNCED_SYNC_STATE,
      };
    }

    matchedLocalKeys.add(local.key);

    return {
      ...local,
      ...remote,
      purchase_id: normalizeText(remote.purchase_id || remote.purchaseId || local.purchase_id || local.purchaseId),
      product_id: normalizeText(remote.product_id || remote.productId || local.product_id || local.productId),
      product_price_id: normalizeText(remote.product_price_id || remote.productPriceId || local.product_price_id || local.productPriceId),
      id: normalizeText(
        remote.id
        || local.id
        || remote.purchase_id
        || remote.purchaseId
        || local.purchase_id
        || local.purchaseId
        || remote.product_price_id
        || remote.productPriceId
        || local.product_price_id
        || local.productPriceId
        || remote.product_id
        || remote.productId
        || local.product_id
        || local.productId
      ),
      category_id: normalizeText(remote.category_id || remote.categoryId || local.category_id || local.categoryId),
      category_name: normalizeText(remote.category_name || remote.categoryName || local.category_name || local.categoryName),
      product_name: pickWishlistText(remote.product_name, local.product_name),
      product_code: normalizeText(remote.product_code || local.product_code),
      product_type: normalizeText(remote.product_type || local.product_type),
      alias_name: normalizeText(remote.alias_name || local.alias_name),
      images: Array.isArray(remote.images) && remote.images.length > 0 ? remote.images : local.images || [],
      selected_image: normalizeText(remote.selected_image || local.selected_image),
      status: normalizeText(remote.status || local.status || WISHLIST_STATUS).toLowerCase() || WISHLIST_STATUS,
      selected_attributes: Object.keys(remote.selected_attributes || {}).length > 0
        ? remote.selected_attributes
        : local.selected_attributes || {},
      attribute_values: Array.isArray(remote.attribute_values) && remote.attribute_values.length > 0
        ? remote.attribute_values
        : local.attribute_values || [],
      price: remote.price || local.price || null,
      sync_state: remote.sync_state || SYNCED_SYNC_STATE,
      source: remote.source || local.source || 'rpc',
    };
  });

  localNormalized.forEach((item) => {
    if (!remoteKeys.has(item.key) && !matchedLocalKeys.has(item.key)) {
      merged.push({
        ...item,
        sync_state: normalizeText(item.sync_state).toLowerCase() || PENDING_SYNC_STATE,
      });
    }
  });

  return dedupeWishlistItems(merged);
};

const resolveWishlistCatalogPriceId = (row = {}, priceRow = null) => normalizeText(
  row?.product_price_id
  || row?.productPriceId
  || row?.price_id
  || row?.priceId
  || priceRow?.id
);

const resolveWishlistCatalogProductId = (row = {}, product = null, priceRow = null) => normalizeText(
  row?.product_id
  || row?.productId
  || row?.product?.id
  || row?.product_price?.product_id
  || row?.product_price?.productId
  || row?.price?.product_id
  || row?.price?.productId
  || product?.id
  || product?.product_id
  || product?.productId
  || priceRow?.product_id
  || priceRow?.productId
);

const buildRemoteWishlistPrice = (row = {}, priceRow = null, productPriceId = '') => {
  const unitPrice = normalizeAmount(
    row?.unit_price
    ?? row?.unitPrice
    ?? row?.amount
    ?? priceRow?.price_after_discount
    ?? priceRow?.member_price
    ?? priceRow?.total_payable
    ?? priceRow?.mrp
  );
  const totalPayable = normalizeAmount(row?.total_amount ?? row?.totalAmount);

  return {
    ...(priceRow && typeof priceRow === 'object' ? priceRow : {}),
    id: normalizeText(priceRow?.id) || productPriceId,
    product_price_id: productPriceId,
    price_after_discount: unitPrice || normalizeAmount(priceRow?.price_after_discount),
    member_price: unitPrice || normalizeAmount(priceRow?.member_price),
    total_payable: totalPayable || normalizeAmount(priceRow?.total_payable) || unitPrice,
    mrp: normalizeAmount(priceRow?.mrp) || unitPrice,
    discount_pct: normalizeAmount(priceRow?.discount_pct),
    discount_amount: normalizeAmount(priceRow?.discount_amount),
    gst_pct: normalizeAmount(priceRow?.gst_pct),
    gst_amount: normalizeAmount(priceRow?.gst_amount),
    transport_fee: normalizeAmount(priceRow?.transport_fee),
    billing_type: normalizeText(priceRow?.billing_type),
    status: normalizeText(priceRow?.status),
  };
};

const enrichWishlistRowsWithCatalog = async (rows = [], trustId = undefined) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const categories = await fetchTrustProductsCategories(trustId);
  const { byPriceId, byProductId } = buildProductCatalogLookups(categories);

  return rows.map((row) => {
    const productPriceId = resolveWishlistCatalogPriceId(row);
    const productId = resolveWishlistCatalogProductId(row);
    const catalogMatch = byPriceId.get(productPriceId) || byProductId.get(productId) || null;
    if (!catalogMatch?.product) return row;

    const product = catalogMatch.product;
    const priceRow = catalogMatch.priceRow || null;
    const matchedPriceId = productPriceId || resolveWishlistCatalogPriceId({}, priceRow);
    const matchedProductId = resolveWishlistCatalogProductId(row, product, priceRow);

    return {
      ...row,
      purchase_id: normalizeText(row?.purchase_id || row?.purchaseId || row?.id),
      product_id: matchedProductId,
      product_price_id: matchedPriceId,
      category_id: normalizeText(product?.category_id || product?.categoryId || catalogMatch?.category?.id),
      category_name: normalizeText(product?.category_name || product?.categoryName || catalogMatch?.category?.name),
      product_name: normalizeText(product?.product_name || product?.alias_name || row?.product_name || row?.name),
      product_code: normalizeText(product?.product_code || row?.product_code),
      product_type: normalizeText(product?.product_type || row?.product_type),
      alias_name: normalizeText(product?.alias_name || row?.alias_name),
      images: normalizeProductImages(Array.isArray(product?.images) ? product.images : row?.images),
      selected_image: normalizeText(row?.selected_image || row?.image_url || row?.imageUrl || product?.selected_image || product?.image_url || product?.imageUrl),
      attribute_values: Array.isArray(product?.attribute_values) ? product.attribute_values : (row?.attribute_values || row?.attributeValues || []),
      price: buildRemoteWishlistPrice(row, priceRow, matchedPriceId),
      unit_price: normalizeAmount(row?.unit_price ?? row?.unitPrice) || normalizeAmount(priceRow?.price_after_discount),
    };
  });
};

const loadRemoteWishlistItems = async (trustId = undefined) => {
  if (!hasWishlistPurchaseSource()) return null;

  const activeTrustId = resolveTrustId(trustId);
  const memberId = resolveMemberIdFromUser(readStoredUser());
  if (!memberId) return [];

  const request = {
    p_member_id: memberId,
    p_trust_id: activeTrustId,
    p_action: 'get',
    p_payload: {},
  };

  const response = await callWishlistPurchaseRpc(request);
  if (!response) return null;

  const { data, error } = response;
  if (error) throw error;
  if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
    throw new Error(normalizeText(data.message) || 'Unable to load wishlist right now.');
  }

  const wishlistRows = flattenPurchaseRows(extractPurchaseRows(data)).filter((row) => {
    const rowTrustId = normalizeText(row?.trust_id || row?.trustId || activeTrustId);
    if (rowTrustId !== activeTrustId) return false;

    return normalizeText(row?.status || row?.purchase_status || row?.purchaseStatus || row?.state || row?.payment_status).toLowerCase() === WISHLIST_STATUS;
  });

  const enrichedWishlistRows = await enrichWishlistRowsWithCatalog(wishlistRows, activeTrustId);

  return sortWishlistItemsNewestFirst(
    dedupeWishlistItems(
      enrichedWishlistRows
        .map((row) => normalizeWishlistItem({
          ...row,
          trust_id: row?.trust_id || row?.trustId || activeTrustId,
          sync_state: SYNCED_SYNC_STATE,
          source: 'rpc',
        }, activeTrustId))
        .filter(Boolean)
    )
  );
};

// loadRemoteWishlistItems (and therefore refreshWishlistCache) filters out any row whose
// status isn't 'wishlist', so it can never see a 'remove_from_wishlist' tombstone row. That
// tombstone is exactly what idx_unique_wishlist_item collides against, so recovering from a
// duplicate-key error needs the *unfiltered* row — this fetches it directly.
const fetchAuthoritativeWishlistPurchase = async (trustId, productPriceId) => {
  const normalizedProductPriceId = normalizeText(productPriceId);
  if (!hasWishlistPurchaseSource() || !normalizedProductPriceId) return null;

  const activeTrustId = resolveTrustId(trustId);
  const memberId = await resolveWishlistMutationMemberId();
  if (!memberId) return null;

  try {
    const response = await callWishlistPurchaseRpc({
      p_member_id: memberId,
      p_trust_id: activeTrustId,
      p_action: 'get',
      p_payload: {},
    });
    if (!response) return null;

    const { data, error } = response;
    if (error || (data && typeof data === 'object' && !Array.isArray(data) && data.success === false)) {
      return null;
    }

    const rows = flattenPurchaseRows(extractPurchaseRows(data));
    const match = rows.find((row) => {
      const rowTrustId = normalizeText(row?.trust_id || row?.trustId || activeTrustId);
      const rowType = normalizeText(row?.type || row?.purchase_type).toLowerCase();
      const rowProductPriceId = normalizeText(row?.product_price_id || row?.productPriceId);
      return rowTrustId === activeTrustId && rowType === 'wishlist' && rowProductPriceId === normalizedProductPriceId;
    });

    if (!match) return null;

    const id = normalizeText(match?.id || match?.purchase_id || match?.purchaseId);
    if (!id) return null;

    return {
      id,
      status: normalizeText(match?.status || match?.purchase_status).toLowerCase(),
      quantity: Number(match?.quantity) || 1,
    };
  } catch {
    return null;
  }
};

export const refreshWishlistCache = async (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);

  if (wishlistRefreshPromiseByTrust.has(normalizedTrustId)) {
    return wishlistRefreshPromiseByTrust.get(normalizedTrustId);
  }

  const refreshPromise = (async () => {
    if (!hasWishlistPurchaseSource()) {
      const localItems = sortWishlistItemsNewestFirst(readScopedWishlistItems(normalizedTrustId));
      const persisted = writeScopedWishlistItems(normalizedTrustId, localItems);
      notifyWishlistChange(persisted);
      return persisted;
    }

    try {
      const remoteItems = await loadRemoteWishlistItems(normalizedTrustId);
      if (Array.isArray(remoteItems)) {
        const currentItems = readScopedWishlistItems(normalizedTrustId);
        const persisted = writeScopedWishlistItems(
          normalizedTrustId,
          sortWishlistItemsNewestFirst(mergeWishlistItems(remoteItems, currentItems))
        );
        notifyWishlistChange(persisted);
        return persisted;
      }
    } catch {
      // ignore API refresh failures and keep the current cached view
    }

    return readScopedWishlistItems(normalizedTrustId);
  })().finally(() => {
    wishlistRefreshPromiseByTrust.delete(normalizedTrustId);
  });

  wishlistRefreshPromiseByTrust.set(normalizedTrustId, refreshPromise);
  return refreshPromise;
};

const getWishlistItemIdentifierValues = (item = {}) => {
  const purchaseId = normalizeText(item?.purchase_id || item?.purchaseId);
  const productPriceId = normalizeText(
    item?.product_price_id
    || item?.productPriceId
    || item?.price_id
    || item?.priceId
    || item?.price?.id
    || item?.price?.product_price_id
    || item?.price?.price_id
  );
  const productId = normalizeText(
    item?.product_id
    || item?.productId
    || item?.price?.product_id
    || item?.price?.productId
  );
  const id = normalizeText(item?.id);
  const values = {
    key: [normalizeText(item?.key)].filter(Boolean),
    purchase_id: [purchaseId].filter(Boolean),
    product_price_id: [productPriceId].filter(Boolean),
    product_id: [productId].filter(Boolean),
  };

  if (id) {
    if (productId && id === productId) values.product_id.push(id);
    if (productPriceId && id === productPriceId) values.product_price_id.push(id);
    if (purchaseId && id === purchaseId) values.purchase_id.push(id);
    if (!productId && !productPriceId && !purchaseId) values.product_id.push(id);
  }

  return Object.fromEntries(
    Object.entries(values).map(([type, typeValues]) => [type, [...new Set(typeValues)]])
  );
};

const itemMatchesWishlistIdentifier = (item, trustId, identifier) => {
  if (!item || !identifier) return false;

  const normalizedTrustId = resolveTrustId(trustId);
  const values = getWishlistItemIdentifierValues(item);
  if (identifier.type === 'key') {
    return values.key.includes(identifier.value)
      || values.key.includes(getWishlistKey(identifier.value, normalizedTrustId));
  }

  if (identifier.type === 'any') {
    return ['purchase_id', 'product_price_id', 'product_id'].some((type) => (
      values[type]?.includes(identifier.value)
    )) || values.key.includes(identifier.value)
      || values.key.includes(getWishlistKey(identifier.value, normalizedTrustId));
  }

  return values[identifier.type]?.includes(identifier.value) || false;
};

const findWishlistItemByIdentifiers = (items, trustId, identifiers = []) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const normalizedIdentifiers = compactWishlistIdentifiers(identifiers);

  if (normalizedIdentifiers.length === 0) return null;

  const matchesIdentifier = (item, identifiersToMatch) => (
    identifiersToMatch.some((identifier) => itemMatchesWishlistIdentifier(item, normalizedTrustId, identifier))
  );

  const itemsList = Array.isArray(items) ? items : [];
  const directMatches = itemsList.filter((item) => matchesIdentifier(item, normalizedIdentifiers));
  if (directMatches.length === 0) return null;

  const expandedIdentifiers = [...normalizedIdentifiers];
  directMatches.forEach((item) => {
    const values = getWishlistItemIdentifierValues(item);
    ['purchase_id', 'product_price_id', 'product_id'].forEach((type) => {
      (values[type] || []).forEach((value) => {
        const identifier = toWishlistIdentifier(type, value);
        if (identifier) expandedIdentifiers.push(identifier);
      });
    });
  });

  const linkedMatches = itemsList.filter((item) => matchesIdentifier(item, compactWishlistIdentifiers(expandedIdentifiers)));
  return linkedMatches.reduce((best, item) => {
    if (!best) return item;

    const bestIsActive = isWishlistStatusItem(best);
    const itemIsActive = isWishlistStatusItem(item);
    if (bestIsActive !== itemIsActive) return itemIsActive ? item : best;

    const bestScore = getWishlistCompletenessScore(best);
    const itemScore = getWishlistCompletenessScore(item);
    if (bestScore !== itemScore) return itemScore > bestScore ? item : best;

    return getWishlistItemTimestamp(item) > getWishlistItemTimestamp(best) ? item : best;
  }, null);
};

const buildWishlistRpcRequest = ({
  memberId,
  trustId,
  product,
  context = {},
  existingItem = null,
  status = WISHLIST_STATUS,
  quantity = 1,
}) => {
  const normalizedMemberId = normalizeText(memberId);
  const normalizedTrustId = resolveTrustId(trustId);
  if (!normalizedMemberId || !normalizedTrustId) return null;

  const resolvedQuantity = resolveWishlistQuantity(context, quantity);
  const normalizedStatus = normalizeText(status).toLowerCase() || WISHLIST_STATUS;
  const purchaseId = normalizeText(existingItem?.purchase_id || existingItem?.purchaseId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const unitPrice = resolveWishlistUnitPrice(product, context);

  if (purchaseId) {
    return {
      p_member_id: normalizedMemberId,
      p_trust_id: normalizedTrustId,
      p_action: 'upsert_purchase',
      p_payload: {
        id: purchaseId,
        status: normalizedStatus,
        quantity: resolvedQuantity,
      },
    };
  }

  if (!productPriceId) return null;

  return {
    p_member_id: normalizedMemberId,
    p_trust_id: normalizedTrustId,
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: productPriceId,
      type: WISHLIST_STATUS,
      quantity: resolvedQuantity,
      unit_price: unitPrice,
      status: normalizedStatus,
    },
  };
};

const buildRequiredWishlistRpcRequest = async ({
  trustId,
  product,
  context = {},
  existingItem = null,
  status = WISHLIST_STATUS,
  quantity = 1,
}) => {
  const { memberId, trustId: requestTrustId } = await getRequiredWishlistMutationIdentity(trustId);
  const request = buildWishlistRpcRequest({
    memberId,
    trustId: requestTrustId,
    product,
    context,
    existingItem,
    status,
    quantity,
  });

  if (!request) {
    const purchaseId = normalizeText(existingItem?.purchase_id || existingItem?.purchaseId);
    const productPriceId = resolveWishlistProductPriceId(product, context);
    if (!purchaseId && !productPriceId) {
      throw new Error('Product price ID is missing. Please refresh this product and try again.');
    }

    throw new Error('Unable to prepare wishlist sync. Please refresh and try again.');
  }

  return request;
};

const persistWishlistMutation = async ({
  trustId,
  request,
  previousItems = [],
  localItems = null,
  refreshAfterSuccess = false,
  throwOnError = false,
}) => {
  if (!request) {
    const error = new Error('Wishlist sync is unavailable. Please refresh and try again.');
    if (throwOnError) throw error;
    return { ok: false, items: previousItems, error };
  }

  try {
    console.info('[Wishlist] purchase mutation request', {
      trustId: redactId(trustId),
      action: request?.p_action,
      memberId: redactId(request?.p_member_id),
      payload: {
        ...request?.p_payload,
        id: redactId(request?.p_payload?.id),
        product_price_id: redactId(request?.p_payload?.product_price_id),
      },
    });
    const response = await callWishlistPurchaseRpc(request);
    if (!response) {
      throw new Error('Wishlist sync is unavailable. Please refresh and try again.');
    }

    const { data, error } = response;
    if (error) {
      console.error('[Wishlist] purchase RPC returned Supabase error', {
        trustId: redactId(trustId),
        action: request?.p_action,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      }, error);
      throw error;
    }

    if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
      const mutationError = new Error(normalizeText(data.message || data.error) || 'Unable to save wishlist right now.');
      mutationError.data = data;
      mutationError.details = data.details || data.error || '';
      mutationError.code = data.code;

      if (
        isDuplicateWishlistMutationError(mutationError)
        && normalizeText(request?.p_payload?.status).toLowerCase() === WISHLIST_STATUS
      ) {
        // The insert collided with idx_unique_wishlist_item, which means a row for this
        // product already exists — almost always a previously removed (tombstone) row,
        // since that index ignores status. refreshWishlistCache can't see it (it filters
        // to active rows only), so fetch it directly and re-activate that same row instead
        // of leaving a phantom "added" state that has no real purchase_id behind it.
        const productPriceId = normalizeText(request?.p_payload?.product_price_id);
        const authoritative = await fetchAuthoritativeWishlistPurchase(trustId, productPriceId);

        if (authoritative?.id) {
          const reactivateResponse = await callWishlistPurchaseRpc({
            p_member_id: request.p_member_id,
            p_trust_id: trustId,
            p_action: 'upsert_purchase',
            p_payload: {
              id: authoritative.id,
              status: WISHLIST_STATUS,
              quantity: request?.p_payload?.quantity || 1,
            },
          });
          const reactivated = reactivateResponse
            && !reactivateResponse.error
            && !(reactivateResponse.data && typeof reactivateResponse.data === 'object' && reactivateResponse.data.success === false);

          if (reactivated) {
            const refreshedItems = await refreshWishlistCache(trustId);
            console.info('[Wishlist] duplicate wishlist row reactivated', {
              trustId: redactId(trustId),
              productPriceId: redactId(productPriceId),
              purchaseId: redactId(authoritative.id),
            });
            return {
              ok: true,
              items: Array.isArray(refreshedItems) ? refreshedItems : (Array.isArray(localItems) ? localItems : previousItems),
              responseItems: [],
              duplicateResolved: true,
            };
          }
        }

        console.error('[Wishlist] duplicate wishlist row could not be reactivated', {
          trustId: redactId(trustId),
          productPriceId: redactId(productPriceId),
          authoritative,
        });
        throw mutationError;
      }

      const diagnostic = {
        trustId: redactId(trustId),
        action: request?.p_action,
        message: normalizeText(data.message),
        code: data.code,
        details: data.details,
        payload: {
          ...request?.p_payload,
          id: redactId(request?.p_payload?.id),
          product_price_id: redactId(request?.p_payload?.product_price_id),
        },
        data,
      };
      console.error('[Wishlist] purchase RPC returned success=false', diagnostic);
      logWishlistDiagnosticSnapshot('[Wishlist] purchase RPC returned success=false', diagnostic);
      throw mutationError;
    }

    const responseRows = flattenPurchaseRows(extractPurchaseRows(data));
    const normalizedResponseItems = dedupeWishlistItems(
      responseRows
        .map((row) => normalizeWishlistItem({
          ...row,
          trust_id: row?.trust_id || row?.trustId || trustId,
          sync_state: SYNCED_SYNC_STATE,
          source: 'rpc',
        }, trustId))
        .filter(Boolean)
    );

    const wishlistedResponseItems = normalizedResponseItems.filter(
      (item) => normalizeText(item.status).toLowerCase() === WISHLIST_STATUS
    );

    if (wishlistedResponseItems.length > 0) {
      const persisted = writeScopedWishlistItems(
        trustId,
        mergeWishlistItems(wishlistedResponseItems, Array.isArray(localItems) ? localItems : previousItems)
      );
      notifyWishlistChange(persisted);
      return {
        ok: true,
        items: persisted,
        responseItems: wishlistedResponseItems,
      };
    }

    if (refreshAfterSuccess) {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          void refreshWishlistCache(trustId);
        }, 250);
      } else {
        void refreshWishlistCache(trustId);
      }
    }

    return {
      ok: true,
      items: readScopedWishlistItems(trustId),
      responseItems: normalizedResponseItems,
    };
  } catch (error) {
    const diagnostic = {
      trustId: redactId(trustId),
      action: request?.p_action,
      memberId: redactId(request?.p_member_id),
      payload: {
        ...request?.p_payload,
        id: redactId(request?.p_payload?.id),
        product_price_id: redactId(request?.p_payload?.product_price_id),
      },
      message: error?.message || String(error),
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    };
    console.error('[Wishlist] purchase mutation failed', diagnostic, error);
    logWishlistDiagnosticSnapshot('[Wishlist] purchase mutation failed', diagnostic);
    const restored = writeScopedWishlistItems(trustId, previousItems);
    notifyWishlistChange(restored);
    if (throwOnError) throw error;
    return { ok: false, items: restored, error };
  }
};

const buildOptimisticWishlistItem = (product = {}, context = {}, trustId = undefined, overrides = {}) => normalizeWishlistItem({
  ...product,
  ...context,
  ...overrides,
  trust_id: resolveTrustId(trustId || context?.trustId || product?.trust_id),
  product_id: normalizeText(product?.product_id || product?.productId || product?.id || overrides?.product_id || overrides?.productId),
  product_price_id: resolveWishlistProductPriceId(product, context) || normalizeText(overrides?.product_price_id || overrides?.productPriceId),
  purchase_id: normalizeText(overrides?.purchase_id || overrides?.purchaseId || product?.purchase_id || product?.purchaseId),
  category_id: normalizeText(context?.categoryId || product?.category_id || product?.categoryId),
  category_name: normalizeText(context?.categoryName || product?.category_name || product?.categoryName),
  selected_image: normalizeText(context?.selectedImage || product?.selected_image || product?.image_url || product?.imageUrl),
  selected_attributes: context?.selectedAttributes || product?.selected_attributes || {},
  attribute_values: context?.attributeValues || product?.attribute_values || product?.attributeValues || [],
  price: context?.price || product?.price || resolveWishlistPriceObject(product, context, resolveWishlistProductPriceId(product, context)),
  unit_price: resolveWishlistUnitPrice(product, context),
  quantity: resolveWishlistQuantity(context, overrides?.quantity ?? product?.quantity ?? 1),
  status: normalizeText(overrides?.status || context?.status || product?.status || WISHLIST_STATUS).toLowerCase() || WISHLIST_STATUS,
  saved_at: overrides?.saved_at || product?.saved_at || new Date().toISOString(),
  updated_at: overrides?.updated_at || product?.updated_at || overrides?.saved_at || product?.saved_at || new Date().toISOString(),
  sync_state: normalizeText(overrides?.sync_state || product?.sync_state || context?.sync_state || PENDING_SYNC_STATE).toLowerCase() || PENDING_SYNC_STATE,
  source: overrides?.source || product?.source || 'optimistic',
}, trustId || context?.trustId || product?.trust_id);

const migrateLegacyWishlistItems = () => {
  if (!hasStorage() || wishlistLegacyMigrated) return;

  const legacyRaw = window.localStorage.getItem(WISHLIST_LEGACY_STORAGE_KEY);
  if (!legacyRaw) {
    wishlistLegacyMigrated = true;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch {
    wishlistLegacyMigrated = true;
    return;
  }

  if (!Array.isArray(parsed)) {
    wishlistLegacyMigrated = true;
    return;
  }

  const grouped = new Map();
  const currentTrustId = getActiveTrustId();

  for (const rawItem of parsed) {
    const normalized = normalizeWishlistItem({
      ...rawItem,
      sync_state: normalizeText(rawItem?.sync_state || '').toLowerCase(),
      trust_id: rawItem?.trust_id || currentTrustId || TRUST_STORAGE_FALLBACK,
    }, rawItem?.trust_id || currentTrustId || TRUST_STORAGE_FALLBACK);

    if (!normalized) continue;

    const bucketTrustId = normalized.trust_id || currentTrustId || TRUST_STORAGE_FALLBACK;
    const bucketKey = getWishlistStorageKey(bucketTrustId);

    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, []);
    }
    grouped.get(bucketKey).push(normalized);
  }

  grouped.forEach((items, bucketKey) => {
    const trustId = bucketKey.slice(WISHLIST_STORAGE_KEY_PREFIX.length);
    const existing = readScopedWishlistItems(trustId);
    const persisted = writeScopedWishlistItems(trustId, [...existing, ...items]);
    notifyWishlistChange(persisted);
  });

  try {
    window.localStorage.removeItem(WISHLIST_LEGACY_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }

  wishlistLegacyMigrated = true;
};

export const readWishlistItems = (trustId = undefined) => {
  migrateLegacyWishlistItems();
  return sortWishlistItemsNewestFirst(filterWishlistStatusItems(readScopedWishlistItems(trustId)));
};

export const findWishlistProductInItems = (items = [], productOrId = {}, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const isObjectProduct = productOrId && typeof productOrId === 'object';
  const product = isObjectProduct ? productOrId : {};
  const identity = normalizeText(productOrId);
  const identifiers = isObjectProduct
    ? getWishlistProductSearchIdentifiers(product, context)
    : [
      toWishlistIdentifier('product_price_id', identity),
      toWishlistIdentifier('product_id', identity),
    ].filter(Boolean);

  if (identifiers.length === 0) return null;

  const target = findWishlistItemByIdentifiers(items, trustId, identifiers);

  return target && isWishlistStatusItem(target) ? target : null;
};

export const isWishlistProductInItems = (items = [], productOrId = {}, context = {}) =>
  Boolean(findWishlistProductInItems(items, productOrId, context));

export const isWishlistProduct = (productOrId, trustId = '', context = {}) => {
  const resolvedContext = {
    ...context,
    trustId: context?.trustId || trustId,
  };
  return isWishlistProductInItems(readWishlistItems(resolvedContext.trustId), productOrId, resolvedContext);
};

export const toWishlistItem = (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const optimisticItem = buildOptimisticWishlistItem(product, context, trustId, {
    sync_state: SYNCED_SYNC_STATE,
    status: WISHLIST_STATUS,
  });

  if (optimisticItem) return optimisticItem;

  const fallbackPrice = resolveWishlistPriceObject(product, context, productPriceId);
  return normalizeWishlistItem({
    ...product,
    ...context,
    trust_id: trustId,
    product_price_id: productPriceId,
    price: fallbackPrice,
    status: WISHLIST_STATUS,
    sync_state: SYNCED_SYNC_STATE,
  }, trustId);
};

export const cacheWishlistProduct = (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId || product?.trust_id || product?.trustId);
  const previousItems = readScopedWishlistItems(trustId);
  const wishlistItem = toWishlistItem(product, {
    ...context,
    trustId,
  });

  if (!wishlistItem) return previousItems;

  const nextItems = dedupeWishlistItems([
    wishlistItem,
    ...previousItems.filter((entry) => entry.key !== wishlistItem.key),
  ]);
  const persisted = writeScopedWishlistItems(trustId, nextItems);
  notifyWishlistChange(persisted);
  return persisted;
};

export const addWishlistProduct = (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const previousItems = readScopedWishlistItems(trustId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const existingItem = findWishlistItemByIdentifiers(
    previousItems,
    trustId,
    getWishlistProductSearchIdentifiers(product, context)
  );
  const existingItemIsRemoved = normalizeText(existingItem?.status).toLowerCase() === REMOVE_FROM_WISHLIST_STATUS;
  const mutationExistingItem = existingItemIsRemoved ? null : existingItem;
  const optimisticItem = buildOptimisticWishlistItem(product, context, trustId, {
    purchase_id: mutationExistingItem?.purchase_id || mutationExistingItem?.purchaseId,
    status: WISHLIST_STATUS,
    sync_state: PENDING_SYNC_STATE,
  });

  if (!optimisticItem) {
    return previousItems;
  }

  const nextItems = dedupeWishlistItems([
    optimisticItem,
    ...previousItems.filter((entry) => entry.key !== optimisticItem.key),
  ]);

  const persisted = writeScopedWishlistItems(trustId, nextItems);
  notifyWishlistChange(persisted);

  if (hasWishlistPurchaseSource()) {
    void (async () => {
      const service = await loadOrderHistoryService();
      const memberId = service?.resolveOrderHistoryMemberId
        ? service.resolveOrderHistoryMemberId(readStoredUser())
        : resolveMemberIdFromUser(readStoredUser());
      const request = buildWishlistRpcRequest({
        memberId,
        trustId,
        product,
        context,
        existingItem: mutationExistingItem,
        status: WISHLIST_STATUS,
        quantity: optimisticItem.quantity,
      });

      if (!request) {
        console.warn('[Wishlist] wishlist API request skipped', {
          trustId,
          productId: product?.id || product?.product_id || product?.productId,
          productPriceId,
          hasMemberId: Boolean(memberId),
        });
        return;
      }

      await persistWishlistMutation({
        trustId,
        request,
        previousItems,
        localItems: nextItems,
        refreshAfterSuccess: true,
      });
    })();
  }

  return persisted;
};

export const addWishlistProductAsync = async (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const previousItems = readScopedWishlistItems(trustId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const existingItem = findWishlistItemByIdentifiers(
    previousItems,
    trustId,
    getWishlistProductSearchIdentifiers(product, context)
  );
  const existingItemIsRemoved = normalizeText(existingItem?.status).toLowerCase() === REMOVE_FROM_WISHLIST_STATUS;
  const mutationExistingItem = existingItemIsRemoved ? null : existingItem;
  const optimisticItem = buildOptimisticWishlistItem(product, context, trustId, {
    purchase_id: mutationExistingItem?.purchase_id || mutationExistingItem?.purchaseId,
    status: WISHLIST_STATUS,
    sync_state: hasWishlistPurchaseSource() ? PENDING_SYNC_STATE : SYNCED_SYNC_STATE,
  });

  if (!optimisticItem) {
    const error = new Error('Unable to identify this product for wishlist.');
    return { ok: false, items: previousItems, wished: false, error };
  }

	  let request = null;
	  if (hasWishlistPurchaseSource()) {
	    try {
	      console.info('[Wishlist] preparing add mutation', getWishlistMutationDiagnostics({
	        trustId,
	        product,
	        context,
	        existingItem: mutationExistingItem,
	      }));
	      request = await buildRequiredWishlistRpcRequest({
	        trustId,
	        product,
	        context,
	        existingItem: mutationExistingItem,
	        status: WISHLIST_STATUS,
	        quantity: optimisticItem.quantity,
	      });
	      console.info('[Wishlist] add mutation request prepared', getWishlistMutationDiagnostics({
	        trustId,
	        product,
	        context,
	        existingItem: mutationExistingItem,
	        request,
	      }));
	    } catch (error) {
	      console.error('[Wishlist] add mutation request failed before RPC', {
	        ...getWishlistMutationDiagnostics({
	          trustId,
	          product,
	          context,
	          existingItem: mutationExistingItem,
	        }),
	        message: error?.message || String(error),
	      }, error);
	      return { ok: false, items: previousItems, wished: false, error };
	    }
	  }

  const nextItems = dedupeWishlistItems([
    optimisticItem,
    ...previousItems.filter((entry) => entry.key !== optimisticItem.key),
  ]);

  const persisted = writeScopedWishlistItems(trustId, nextItems);
  notifyWishlistChange(persisted);

  if (!hasWishlistPurchaseSource()) {
    return { ok: true, items: persisted, wished: true };
  }

  try {
    const result = await persistWishlistMutation({
      trustId,
      request,
      previousItems,
      localItems: nextItems,
      refreshAfterSuccess: false,
      throwOnError: true,
    });

    const hasSyncedResponse = Array.isArray(result?.responseItems) && result.responseItems.length > 0;
    if (!hasSyncedResponse && !result?.duplicateResolved) {
      await refreshWishlistCache(trustId);
    }

	    return {
	      ok: true,
	      items: readWishlistItems(trustId),
	      wished: true,
	      duplicateResolved: Boolean(result?.duplicateResolved),
	    };
	  } catch (error) {
	    if (isDuplicateWishlistMutationError(error)) {
	      console.info('[Wishlist] duplicate wishlist row detected; refreshing cache', {
	        trustId: redactId(trustId),
	        productPriceId: redactId(productPriceId),
	      });
	      await refreshWishlistCache(trustId);
	      const refreshedItems = readWishlistItems(trustId);
	      const refreshedItem = findWishlistItemByIdentifiers(
	        refreshedItems,
	        trustId,
	        getWishlistProductSearchIdentifiers(product, context)
	      );
	      if (isWishlistStatusItem(refreshedItem)) {
	        console.info('[Wishlist] duplicate wishlist row resolved from backend cache', {
	          trustId: redactId(trustId),
	          productPriceId: redactId(productPriceId),
	          purchaseId: redactId(refreshedItem?.purchase_id || refreshedItem?.purchaseId),
	        });
	        notifyWishlistChange(refreshedItems);
	        return { ok: true, items: refreshedItems, wished: true, duplicateResolved: true };
	      }
	    }
	    return { ok: false, items: readWishlistItems(trustId), wished: false, error };
	  }
};

export const updateWishlistProduct = (productId, trustId = undefined, updates = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const previousItems = readScopedWishlistItems(normalizedTrustId);
  const target = findWishlistItemByIdentifiers(previousItems, normalizedTrustId, [productId]);

  if (!target) return previousItems;

  const nextItem = normalizeWishlistItem({
    ...target,
    ...updates,
    trust_id: normalizedTrustId,
    sync_state: target.sync_state || (hasPurchaseApiConfig() ? PENDING_SYNC_STATE : ''),
    saved_at: target.saved_at || updates.saved_at,
    updated_at: new Date().toISOString(),
  }, normalizedTrustId);

  const persisted = writeScopedWishlistItems(
    normalizedTrustId,
    previousItems.map((item) => (item.key === target.key ? nextItem : item))
  );
  notifyWishlistChange(persisted);

  const shouldSyncStatus = Object.prototype.hasOwnProperty.call(updates, 'status')
    || Object.prototype.hasOwnProperty.call(updates, 'quantity');

  if (hasWishlistPurchaseSource() && shouldSyncStatus && target.purchase_id) {
    void (async () => {
      const memberId = (await loadOrderHistoryService())?.resolveOrderHistoryMemberId
        ? (await loadOrderHistoryService()).resolveOrderHistoryMemberId(readStoredUser())
        : resolveMemberIdFromUser(readStoredUser());

      const request = {
        p_member_id: memberId,
        p_trust_id: normalizedTrustId,
        p_action: 'upsert_purchase',
        p_payload: {
          id: target.purchase_id,
          status: normalizeText(updates.status || target.status || WISHLIST_STATUS).toLowerCase(),
          quantity: resolveWishlistQuantity(updates, target.quantity || 1),
        },
      };

      try {
        const response = await callWishlistPurchaseRpc(request);
        if (!response) return;

        const { data, error } = response;
        if (error) throw error;
        if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
          throw new Error(normalizeText(data.message) || 'Unable to update wishlist item.');
        }
      } catch (error) {
        console.warn('[Wishlist] wishlist update failed:', error?.message || error);
        const restored = writeScopedWishlistItems(normalizedTrustId, previousItems);
        notifyWishlistChange(restored);
      }
    })();
  }

  return persisted;
};

export const removeWishlistProduct = (productId, trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const previousItems = readScopedWishlistItems(normalizedTrustId);
  const target = findWishlistItemByIdentifiers(previousItems, normalizedTrustId, [productId]);

  if (!target) return previousItems;

  const hiddenRemovalItem = normalizeWishlistItem({
    ...target,
    status: REMOVE_FROM_WISHLIST_STATUS,
    updated_at: new Date().toISOString(),
    sync_state: hasPurchaseApiConfig() ? PENDING_SYNC_STATE : target.sync_state,
  }, normalizedTrustId);

  const persisted = writeScopedWishlistItems(
    normalizedTrustId,
    previousItems.map((item) => (item.key === target.key ? hiddenRemovalItem : item))
  );
  notifyWishlistChange(persisted);

  if (hasWishlistPurchaseSource()) {
    void (async () => {
      let request;
      try {
        request = await buildRequiredWishlistRpcRequest({
          trustId: normalizedTrustId,
          product: target,
          context: { ...target, trustId: normalizedTrustId, price: target.price },
          existingItem: target,
          status: REMOVE_FROM_WISHLIST_STATUS,
          quantity: target.quantity || 1,
        });
      } catch (error) {
        console.warn('[Wishlist] wishlist remove could not build request:', error?.message || error);
        const restored = writeScopedWishlistItems(normalizedTrustId, previousItems);
        notifyWishlistChange(restored);
        return;
      }

      try {
        const response = await callWishlistPurchaseRpc(request);
        if (!response) {
          throw new Error('Wishlist sync is unavailable. Please refresh and try again.');
        }

        const { data, error } = response;
        if (error) throw error;
        if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
          const rpcError = new Error(normalizeText(data.error || data.message) || 'Unable to remove wishlist item.');
          rpcError.rpcData = data;
          throw rpcError;
        }
      } catch (error) {
        console.warn('[Wishlist] wishlist remove failed:', JSON.stringify({
          message: error?.message || String(error),
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
          rpcData: error?.rpcData,
          requestPayload: request?.p_payload,
        }, null, 2));

        if (isDuplicateWishlistMutationError(error)) {
          try {
            const productPriceId = resolveWishlistProductPriceId(target, {});
            const authoritative = await fetchAuthoritativeWishlistPurchase(normalizedTrustId, productPriceId);

            if (authoritative?.id && authoritative.status === REMOVE_FROM_WISHLIST_STATUS) {
              const finalItems = readScopedWishlistItems(normalizedTrustId).map((item) => (
                item.key === target.key
                  ? { ...hiddenRemovalItem, purchase_id: authoritative.id, sync_state: SYNCED_SYNC_STATE }
                  : item
              ));
              notifyWishlistChange(writeScopedWishlistItems(normalizedTrustId, finalItems));
              return;
            }

            if (authoritative?.id) {
              const retryResponse = await callWishlistPurchaseRpc({
                p_member_id: (await getRequiredWishlistMutationIdentity(normalizedTrustId)).memberId,
                p_trust_id: normalizedTrustId,
                p_action: 'upsert_purchase',
                p_payload: {
                  id: authoritative.id,
                  status: REMOVE_FROM_WISHLIST_STATUS,
                  quantity: authoritative.quantity || 1,
                },
              });
              const retrySucceeded = retryResponse
                && !retryResponse.error
                && !(retryResponse.data && typeof retryResponse.data === 'object' && retryResponse.data.success === false);

              if (retrySucceeded) return;
            }
          } catch (retryError) {
            console.warn('[Wishlist] wishlist remove retry after refresh failed:', retryError?.message || retryError);
          }
        }

        const restored = writeScopedWishlistItems(normalizedTrustId, previousItems);
        notifyWishlistChange(restored);
      }
    })();
  }

  return persisted;
};

export const removeWishlistProductAsync = async (productId, trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const previousItems = readScopedWishlistItems(normalizedTrustId);
  const target = findWishlistItemByIdentifiers(previousItems, normalizedTrustId, [productId]);

  if (!target) {
    return { ok: true, items: readWishlistItems(normalizedTrustId), wished: false };
  }

  let request = null;
  if (hasWishlistPurchaseSource()) {
    try {
      request = await buildRequiredWishlistRpcRequest({
        trustId: normalizedTrustId,
        product: target,
        context: {
          ...target,
          trustId: normalizedTrustId,
          price: target.price,
        },
        existingItem: target,
        status: REMOVE_FROM_WISHLIST_STATUS,
        quantity: target.quantity || 1,
      });
    } catch (error) {
      return { ok: false, items: readWishlistItems(normalizedTrustId), wished: true, error };
    }
  }

  const hiddenRemovalItem = normalizeWishlistItem({
    ...target,
    status: REMOVE_FROM_WISHLIST_STATUS,
    updated_at: new Date().toISOString(),
    sync_state: hasWishlistPurchaseSource() ? PENDING_SYNC_STATE : target.sync_state,
  }, normalizedTrustId);

  const persisted = writeScopedWishlistItems(
    normalizedTrustId,
    previousItems.map((item) => (item.key === target.key ? hiddenRemovalItem : item))
  );
  notifyWishlistChange(persisted);

  if (!hasWishlistPurchaseSource()) {
    return { ok: true, items: readWishlistItems(normalizedTrustId), wished: false };
  }

  try {
    const response = await callWishlistPurchaseRpc(request);
    if (!response) {
      throw new Error('Wishlist sync is unavailable. Please refresh and try again.');
    }

    const { data, error } = response;
    if (error) throw error;
    if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
      const rpcError = new Error(normalizeText(data.error || data.message) || 'Unable to remove wishlist item.');
      rpcError.rpcData = data;
      throw rpcError;
    }

    return { ok: true, items: readWishlistItems(normalizedTrustId), wished: false };
  } catch (error) {
    console.warn('[Wishlist] wishlist remove failed:', JSON.stringify({
      productId,
      trustId: normalizedTrustId,
      purchaseId: target.purchase_id,
      requestPayload: request?.p_payload,
      message: error?.message || String(error),
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      rpcData: error?.rpcData,
    }, null, 2));

    if (isDuplicateWishlistMutationError(error)) {
      // The local item had no known purchase_id, so the removal fell back to an insert
      // that collided with idx_unique_wishlist_item. That almost always means the server
      // already has this exact row in 'remove_from_wishlist' status (refreshWishlistCache
      // can't see it — it filters to active rows only), so local state was simply stale.
      // Fetch the real row directly: if it's already removed, just sync local state to
      // match; if it's genuinely still active, retry the removal against its real id.
      try {
        const productPriceId = resolveWishlistProductPriceId(target, {});
        const authoritative = await fetchAuthoritativeWishlistPurchase(normalizedTrustId, productPriceId);

        if (authoritative?.id && authoritative.status === REMOVE_FROM_WISHLIST_STATUS) {
          const finalItems = readScopedWishlistItems(normalizedTrustId).map((item) => (
            item.key === target.key
              ? { ...hiddenRemovalItem, purchase_id: authoritative.id, sync_state: SYNCED_SYNC_STATE }
              : item
          ));
          const finalPersisted = writeScopedWishlistItems(normalizedTrustId, finalItems);
          notifyWishlistChange(finalPersisted);
          console.info('[Wishlist] remove target was already removed server-side; local state synced', {
            trustId: normalizedTrustId,
            productPriceId,
            purchaseId: authoritative.id,
          });
          return { ok: true, items: readWishlistItems(normalizedTrustId), wished: false };
        }

        if (authoritative?.id) {
          const retryResponse = await callWishlistPurchaseRpc({
            p_member_id: (await getRequiredWishlistMutationIdentity(normalizedTrustId)).memberId,
            p_trust_id: normalizedTrustId,
            p_action: 'upsert_purchase',
            p_payload: {
              id: authoritative.id,
              status: REMOVE_FROM_WISHLIST_STATUS,
              quantity: authoritative.quantity || 1,
            },
          });
          const retrySucceeded = retryResponse
            && !retryResponse.error
            && !(retryResponse.data && typeof retryResponse.data === 'object' && retryResponse.data.success === false);

          if (retrySucceeded) {
            const finalItems = readScopedWishlistItems(normalizedTrustId).map((item) =>
              (item.key === target.key ? hiddenRemovalItem : item)
            );
            const finalPersisted = writeScopedWishlistItems(normalizedTrustId, finalItems);
            notifyWishlistChange(finalPersisted);
            return { ok: true, items: readWishlistItems(normalizedTrustId), wished: false };
          }
        }
      } catch (retryError) {
        console.warn('[Wishlist] wishlist remove retry after refresh failed:', retryError?.message || retryError);
      }
    }

    const restored = writeScopedWishlistItems(normalizedTrustId, previousItems);
    notifyWishlistChange(restored);
    return { ok: false, items: readWishlistItems(normalizedTrustId), wished: true, error };
  }
};

export const toggleWishlistProduct = (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const identity = productPriceId || normalizeText(product?.id) || normalizeText(product?.product_id) || normalizeText(product?.productId);
  const previousItems = readScopedWishlistItems(trustId);
  const target = findWishlistItemByIdentifiers(
    previousItems,
    trustId,
    getWishlistProductSearchIdentifiers(product, context)
  );

  if (!identity) {
    return {
      items: previousItems,
      wished: false,
      ok: false,
      error: new Error('Unable to identify this product for wishlist.'),
    };
  }

  if (target && normalizeText(target.status).toLowerCase() === WISHLIST_STATUS) {
    const items = removeWishlistProduct(
      getWishlistRemovalIdentifier(target) || toWishlistIdentifier('product_price_id', identity),
      trustId
    );
    return { items, wished: false, ok: true };
  }

  const items = addWishlistProduct(product, {
    ...context,
    trustId,
  });
  const wished = isWishlistProductInItems(items, product, { ...context, trustId });
  return {
    items,
    wished,
    ok: wished,
  };
};

export const toggleWishlistProductAsync = async (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const productPriceId = resolveWishlistProductPriceId(product, context);
  const identity = productPriceId || normalizeText(product?.id) || normalizeText(product?.product_id) || normalizeText(product?.productId);
  const previousItems = readScopedWishlistItems(trustId);
  const target = findWishlistItemByIdentifiers(
    previousItems,
    trustId,
    getWishlistProductSearchIdentifiers(product, context)
  );

  if (!identity) {
    return {
      items: previousItems,
      wished: false,
      ok: false,
      error: new Error('Unable to identify this product for wishlist.'),
    };
  }

  if (target && isWishlistStatusItem(target)) {
    return removeWishlistProductAsync(
      getWishlistRemovalIdentifier(target) || toWishlistIdentifier('product_price_id', identity),
      trustId
    );
  }

  return addWishlistProductAsync(product, {
    ...context,
    trustId,
  });
};

export const clearWishlistItems = (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const persisted = writeScopedWishlistItems(normalizedTrustId, []);
  notifyWishlistChange(persisted);
  return persisted;
};

export const subscribeWishlist = (callback, trustId = undefined) => {
  if (typeof window === 'undefined') return () => {};

  const notify = () => callback(readWishlistItems(trustId));
  const handleStorage = (event) => {
    const storageKey = event?.key;
    if (!storageKey) return;
    if (
      storageKey === WISHLIST_LEGACY_STORAGE_KEY
      || storageKey.startsWith(WISHLIST_STORAGE_KEY_PREFIX)
      || TRUST_STORAGE_KEYS.has(storageKey)
    ) {
      notify();
      if (hasWishlistPurchaseSource()) {
        void refreshWishlistCache(trustId);
      }
    }
  };
  const handleTrustChanged = () => {
    notify();
    if (hasWishlistPurchaseSource()) {
      void refreshWishlistCache(trustId);
    }
  };

  window.addEventListener(WISHLIST_CHANGED_EVENT, notify);
  window.addEventListener(TRUST_CHANGED_EVENT, handleTrustChanged);
  window.addEventListener('storage', handleStorage);

  notify();
  if (hasWishlistPurchaseSource()) {
    void refreshWishlistCache(trustId);
  }

  return () => {
    window.removeEventListener(WISHLIST_CHANGED_EVENT, notify);
    window.removeEventListener(TRUST_CHANGED_EVENT, handleTrustChanged);
    window.removeEventListener('storage', handleStorage);
  };
};
