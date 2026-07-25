export const WISHLIST_CHANGED_EVENT = 'product-wishlist-changed';

const WISHLIST_STORAGE_KEY_PREFIX = 'product_wishlist_v2_';
const WISHLIST_LEGACY_STORAGE_KEY = 'product_wishlist_v1';
const TRUST_CHANGED_EVENT = 'trust-changed';
const TRUST_STORAGE_KEYS = new Set(['selected_trust_id', 'last_selected_trust_id']);
const TRUST_STORAGE_FALLBACK = 'global';

let wishlistLegacyMigrated = false;

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
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
    const normalizedKey = normalizeText(key).toLowerCase();
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

const getActiveTrustId = () => {
  if (!hasStorage()) return TRUST_STORAGE_FALLBACK;

  return normalizeText(window.localStorage.getItem('selected_trust_id'))
    || normalizeText(window.localStorage.getItem('last_selected_trust_id'))
    || TRUST_STORAGE_FALLBACK;
};

const resolveTrustId = (value) => normalizeText(value) || getActiveTrustId();

const getWishlistStorageKey = (trustId = undefined) => `${WISHLIST_STORAGE_KEY_PREFIX}${resolveTrustId(trustId)}`;

export const getWishlistKey = (productId, trustId = '') => {
  const normalizedProductId = normalizeText(productId);
  if (!normalizedProductId) return '';
  return `${resolveTrustId(trustId)}:${normalizedProductId}`;
};

const normalizeWishlistItem = (item) => {
  const id = normalizeText(item?.id);
  const trustId = normalizeText(item?.trust_id);
  const key = getWishlistKey(id, trustId);

  if (!id || !key) return null;

  return {
    key,
    id,
    trust_id: trustId,
    category_id: normalizeText(item?.category_id),
    category_name: normalizeText(item?.category_name),
    product_name: normalizeText(item?.product_name || item?.alias_name) || `Product ${id}`,
    product_code: normalizeText(item?.product_code),
    product_type: normalizeText(item?.product_type),
    alias_name: normalizeText(item?.alias_name),
    images: Array.isArray(item?.images) ? item.images : [],
    selected_image: normalizeText(item?.selected_image),
    selected_attributes: normalizeAttributes(item?.selected_attributes),
    attribute_values: normalizeAttributeRows(item?.attribute_values),
    price: item?.price || null,
    saved_at: normalizeText(item?.saved_at) || new Date().toISOString(),
  };
};

const dedupeWishlistItems = (items) => {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeWishlistItem(item);
    if (!normalized) continue;
    byKey.set(normalized.key, normalized);
  }

  return [...byKey.values()];
};

const readScopedWishlistItems = (trustId = undefined) => {
  if (!hasStorage()) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getWishlistStorageKey(trustId)) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeWishlistItem).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const writeScopedWishlistItems = (trustId, items) => {
  if (!hasStorage()) return [];

  const normalizedItems = dedupeWishlistItems(items);

  try {
    window.localStorage.setItem(getWishlistStorageKey(trustId), JSON.stringify(normalizedItems));
  } catch {
    // ignore storage failures
  }

  return normalizedItems;
};

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
    const normalized = normalizeWishlistItem(rawItem);
    if (!normalized) continue;

    const bucketTrustId = normalized.trust_id || currentTrustId || TRUST_STORAGE_FALLBACK;
    const bucketKey = getWishlistStorageKey(bucketTrustId);
    const migratedItem = {
      ...normalized,
      trust_id: bucketTrustId,
      key: getWishlistKey(normalized.id, bucketTrustId),
    };

    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, []);
    }
    grouped.get(bucketKey).push(migratedItem);
  }

  grouped.forEach((items, bucketKey) => {
    const trustId = bucketKey.slice(WISHLIST_STORAGE_KEY_PREFIX.length);
    const existing = readScopedWishlistItems(trustId);
    writeScopedWishlistItems(trustId, [...existing, ...items]);
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
  return readScopedWishlistItems(trustId);
};

export const isWishlistProduct = (productId, trustId = '') => {
  const key = getWishlistKey(productId, trustId);
  if (!key) return false;
  return readWishlistItems(trustId).some((item) => item.key === key);
};

export const toWishlistItem = (product, context = {}) => {
  const id = normalizeText(product?.id);
  const trustId = resolveTrustId(context.trustId);
  const key = getWishlistKey(id, trustId);

  if (!id || !key) return null;

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
    images: Array.isArray(product?.images) ? product.images : [],
    selected_image: normalizeText(context.selectedImage || product?.selected_image),
    selected_attributes: normalizeAttributes(context.selectedAttributes || product?.selected_attributes || {}),
    attribute_values: normalizeAttributeRows(context.attributeValues || product?.attribute_values || []),
    price: context.price || product?.price || null,
    saved_at: new Date().toISOString(),
  };
};

export const addWishlistProduct = (product, context = {}) => {
  const item = toWishlistItem(product, context);
  const trustId = resolveTrustId(context.trustId);
  if (!item) return readWishlistItems(trustId);

  const existing = readWishlistItems(trustId).filter((entry) => entry.key !== item.key);
  const persisted = writeScopedWishlistItems(trustId, [item, ...existing]);
  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
  return persisted;
};

export const updateWishlistProduct = (productId, trustId = undefined, updates = {}) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const key = getWishlistKey(productId, normalizedTrustId);
  if (!key) return readWishlistItems(normalizedTrustId);

  const persisted = writeScopedWishlistItems(
    normalizedTrustId,
    readWishlistItems(normalizedTrustId).map((item) => (
      item.key === key
        ? normalizeWishlistItem({
          ...item,
          ...updates,
          trust_id: normalizedTrustId,
          saved_at: item.saved_at || updates.saved_at,
        })
        : item
    ))
  );

  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }

  return persisted;
};

export const removeWishlistProduct = (productId, trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const key = getWishlistKey(productId, normalizedTrustId);
  if (!key) return readWishlistItems(normalizedTrustId);

  const persisted = writeScopedWishlistItems(
    normalizedTrustId,
    readWishlistItems(normalizedTrustId).filter((item) => item.key !== key)
  );
  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
  return persisted;
};

export const toggleWishlistProduct = (product, context = {}) => {
  const trustId = resolveTrustId(context.trustId);
  const key = getWishlistKey(product?.id, trustId);
  if (!key) return { items: readWishlistItems(trustId), wished: false };

  const wished = readWishlistItems(trustId).some((item) => item.key === key);
  const items = wished
    ? removeWishlistProduct(product.id, trustId)
    : addWishlistProduct(product, context);

  return { items, wished: !wished };
};

export const clearWishlistItems = (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const persisted = writeScopedWishlistItems(normalizedTrustId, []);
  try {
    window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
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
    }
  };

  window.addEventListener(WISHLIST_CHANGED_EVENT, notify);
  window.addEventListener(TRUST_CHANGED_EVENT, notify);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(WISHLIST_CHANGED_EVENT, notify);
    window.removeEventListener(TRUST_CHANGED_EVENT, notify);
    window.removeEventListener('storage', handleStorage);
  };
};
