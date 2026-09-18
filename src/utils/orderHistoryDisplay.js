export const ORDER_HISTORY_UNKNOWN_TRUST_KEY = '__unknown_trust__';
export const ORDER_HISTORY_UNKNOWN_TRUST_LABEL = 'Unknown trust';

export const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

export const toTitleCase = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

export const normalizeStatusKey = (value = '') =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const parseAmount = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const text = normalizeText(value);
  if (!text) return 0;

  // Match the numeric token itself rather than stripping non-digit characters — a blanket
  // strip keeps the "." from currency prefixes like "Rs." and corrupts the value (e.g.
  // "Rs. 1,480.60" -> ".1480.60", which Number() can't parse and silently becomes 0).
  const match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return 0;

  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatCurrency = (value) => `Rs. ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

export const formatOrderDate = (value) => {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return 'Date unavailable';

  const date = new Date(ts);
  const datePart = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  return `${datePart} at ${timePart}`;
};

// NOTE: only these three statuses have a dedicated group/label; anything else (including
// genuine post-payment lifecycle states like "shipped"/"delivered"/"refunded") falls through
// to the 'other' group below. No status ever resolves to group 'delivered' — the Order History
// summary's "Delivered" stat can never be non-zero as a result. See orderHistoryDisplay.test.js.
export const getStatusMeta = (rawStatus) => {
  const status = normalizeStatusKey(rawStatus);

  if (status === 'order payment pending') {
    return { group: 'pending', label: 'Payment pending', tone: 'var(--brand-red-dark)' };
  }

  if (status === 'order payment done') {
    return { group: 'active', label: 'Payment done', tone: 'var(--app-button-bg)' };
  }

  if (status === 'cancelled') {
    return { group: 'cancelled', label: 'Cancelled', tone: 'var(--brand-red-dark)' };
  }

  return {
    group: status ? 'other' : 'pending',
    label: status ? toTitleCase(status) : 'Payment pending',
    tone: 'var(--subheading-color)',
  };
};

export const normalizeOrderLine = (item, index) => {
  if (typeof item === 'string') {
    const name = normalizeText(item);
    return name ? { key: `line-${index}`, name, quantity: 1 } : null;
  }

  if (!item || typeof item !== 'object') return null;

  const name = normalizeText(
    item.product_name
    || item.name
    || item.title
    || item.product
    || item.item_name
    || item.label
  );
  if (!name) return null;

  const quantityValue = Number(item.quantity ?? item.qty ?? item.count ?? 1);
  const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? Math.floor(quantityValue) : 1;

  return {
    key: normalizeText(item.id || item.product_id || item.sku) || `line-${index}`,
    name,
    quantity,
  };
};

// The 'get' RPC action already returns `selected_attributes` (e.g. {size: 'L', colour:
// 'beige'}) on every purchase row — no extra API call needed to surface this, unlike the
// product name (see enrichOrderRowsWithCatalog in orderHistoryService.js).
export const normalizeSelectedAttributes = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  // The value is shown as stored (not title-cased): purchase-time attributes are commonly
  // size codes like "XL"/"XXL", and title-casing would mangle those into "Xl"/"Xxl".
  return Object.entries(value)
    .map(([key, attrValue]) => {
      const label = toTitleCase(normalizeText(key).replace(/[_-]+/g, ' '));
      const text = normalizeText(attrValue);
      return label && text ? `${label}: ${text}` : '';
    })
    .filter(Boolean)
    .join(' · ');
};

// NOTE: real checkout (CreateOrder.jsx) writes one product_purchases row per cart line with no
// shared order/invoice id, so `order.items`/`order_items`/`products`/`line_items` are never
// populated on real rows today — `items` normalizes to [] and `itemCount` falls back to 1 per
// row. Each product from a single checkout therefore renders as its own separate "order".
export const normalizeOrderRecord = (order, index) => {
  if (!order || typeof order !== 'object') {
    return null;
  }

  const id = normalizeText(
    order.order_id
    || order.orderId
    || order.invoice_no
    || order.invoice_number
    || order.reference
    || order.id
  ) || `ORD-${String(index + 1).padStart(3, '0')}`;

  const createdAtRaw = normalizeText(
    order.created_at
    || order.createdAt
    || order.placed_at
    || order.placedAt
    || order.ordered_at
    || order.date
    || order.timestamp
  );
  const createdAtTs = Date.parse(createdAtRaw);
  const statusMeta = getStatusMeta(order.status || order.order_status || order.state || order.payment_status);

  const rawItems = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.order_items)
      ? order.order_items
      : Array.isArray(order.products)
        ? order.products
        : Array.isArray(order.line_items)
          ? order.line_items
          : [];

  let items = rawItems
    .map((item, itemIndex) => normalizeOrderLine(item, itemIndex))
    .filter(Boolean);

  // Real rows today have no items/order_items/products/line_items array (see note above) —
  // but each row IS one product purchase, so synthesize a single line from the row itself
  // once orderHistoryService.js has enriched it with a catalog product_name.
  if (items.length === 0) {
    const singleProductName = normalizeText(order.product_name || order.productName);
    if (singleProductName) {
      items = [{
        key: normalizeText(order.product_price_id || order.productPriceId || order.id) || `line-${index}`,
        name: singleProductName,
        quantity: Number.isFinite(Number(order.quantity)) && Number(order.quantity) > 0 ? Math.floor(Number(order.quantity)) : 1,
      }];
    }
  }

  const itemCountFromLines = items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  const fallbackItemCount = Number(order.item_count ?? order.items_count ?? order.quantity);
  const itemCount = itemCountFromLines > 0
    ? itemCountFromLines
    : (Number.isFinite(fallbackItemCount) && fallbackItemCount > 0 ? Math.floor(fallbackItemCount) : items.length);

  const totalAmount = parseAmount(
    order.total_amount
    || order.grand_total
    || order.amount
    || order.net_amount
    || order.payable_amount
    || order.total
  );
  const trustId = normalizeText(order.trust_id || order.trustId || order.source_trust_id || order.sourceTrustId);
  const trustName = normalizeText(order.trust_name || order.trustName || order.source_trust_name || order.sourceTrustName);
  const trustKey = trustId || trustName || ORDER_HISTORY_UNKNOWN_TRUST_KEY;
  const trustLabel = trustName || trustId || ORDER_HISTORY_UNKNOWN_TRUST_LABEL;
  const source = normalizeText(order.source || order.sourceType || order.source_type) || 'local';

  return {
    id,
    createdAt: createdAtRaw,
    createdAtTs: Number.isNaN(createdAtTs) ? 0 : createdAtTs,
    createdAtLabel: formatOrderDate(createdAtRaw),
    status: statusMeta.label,
    statusGroup: statusMeta.group,
    statusTone: statusMeta.tone,
    paymentMethod: normalizeText(order.payment_method || order.paymentMethod || order.method || order.payment_type),
    deliveryEta: normalizeText(order.estimated_delivery || order.delivery_eta || order.eta || order.expected_delivery),
    trackingStage: normalizeText(order.current_stage || order.tracking_stage || order.fulfillment_stage),
    attributesLabel: normalizeSelectedAttributes(order.selected_attributes),
    trustId,
    trustName,
    trustKey,
    trustLabel,
    source,
    itemCount,
    totalAmount,
    items,
  };
};
