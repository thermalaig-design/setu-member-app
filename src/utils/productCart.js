export const CART_CHANGED_EVENT = 'product-cart-changed';

const CART_STORAGE_KEY_PREFIX = 'product_cart_v2_';
const CART_LEGACY_STORAGE_KEY = 'product_cart_v1';
const TRUST_CHANGED_EVENT = 'trust-changed';
const TRUST_STORAGE_KEYS = new Set(['selected_trust_id', 'last_selected_trust_id']);
const TRUST_STORAGE_FALLBACK = 'global';

let cartLegacyMigrated = false;

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
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
    images: Array.isArray(item?.images) ? item.images : [],
    selected_image: normalizeText(item?.selected_image),
    selected_attributes: normalizeAttributes(item?.selected_attributes),
    attribute_values: normalizeAttributeRows(item?.attribute_values || item?.attributeValues),
    price: normalizePrice(item?.price),
    quantity,
    added_at: normalizeText(item?.added_at || item?.saved_at || item?.updated_at) || new Date().toISOString(),
    updated_at: normalizeText(item?.updated_at || item?.added_at || item?.saved_at) || new Date().toISOString(),
  };
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
    price: normalizePrice(context.price || product?.price || null),
    quantity,
    added_at: normalizeText(product?.added_at) || now,
    updated_at: now,
  };
};

export const findCartItem = (productId, trustId = undefined) => {
  const key = getCartKey(productId, trustId);
  if (!key) return null;
  return readCartItems(trustId).find((item) => item.key === key) || null;
};

export const getCartItemQuantity = (productId, trustId = undefined) => {
  const item = findCartItem(productId, trustId);
  return Number(item?.quantity || 0);
};

export const setCartProductQuantity = (product, context = {}) => {
  const item = toCartItem(product, context);
  const trustId = resolveTrustId(context.trustId);
  const nextQuantity = normalizeQuantity(context.quantity);
  const items = readCartItems(trustId);

  if (!item || nextQuantity <= 0) {
    return removeCartProduct(product?.id, trustId);
  }

  const nextItem = {
    ...item,
    quantity: nextQuantity,
    updated_at: new Date().toISOString(),
  };

  const existingIndex = items.findIndex((entry) => entry.key === nextItem.key);
  const nextItems = existingIndex >= 0
    ? items.map((entry, index) => (index === existingIndex ? { ...entry, ...nextItem } : entry))
    : [nextItem, ...items];

  const persisted = writeScopedCartItems(trustId, nextItems);
  try {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
  return persisted;
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

export const removeCartProduct = (productId, trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const key = getCartKey(productId, normalizedTrustId);
  if (!key) return readCartItems(normalizedTrustId);

  const nextItems = readCartItems(normalizedTrustId).filter((item) => item.key !== key);
  const persisted = writeScopedCartItems(normalizedTrustId, nextItems);
  try {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
  return persisted;
};

export const clearCartItems = (trustId = undefined) => {
  const normalizedTrustId = resolveTrustId(trustId);
  const persisted = writeScopedCartItems(normalizedTrustId, []);
  try {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: persisted }));
  } catch {
    // ignore event dispatch failures
  }
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
  const handleStorage = (event) => {
    const storageKey = event?.key;
    if (!storageKey) return;
    if (
      storageKey === CART_LEGACY_STORAGE_KEY
      || storageKey.startsWith(CART_STORAGE_KEY_PREFIX)
      || TRUST_STORAGE_KEYS.has(storageKey)
    ) {
      notify();
    }
  };

  window.addEventListener(CART_CHANGED_EVENT, notify);
  window.addEventListener(TRUST_CHANGED_EVENT, notify);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, notify);
    window.removeEventListener(TRUST_CHANGED_EVENT, notify);
    window.removeEventListener('storage', handleStorage);
  };
};
