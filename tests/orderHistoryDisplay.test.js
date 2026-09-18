import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStatusMeta,
  normalizeOrderRecord,
  normalizeOrderLine,
  normalizeSelectedAttributes,
  formatCurrency,
  formatOrderDate,
  parseAmount,
  ORDER_HISTORY_UNKNOWN_TRUST_KEY,
  ORDER_HISTORY_UNKNOWN_TRUST_LABEL,
} from '../src/utils/orderHistoryDisplay.js';

// ---------------------------------------------------------------------------
// getStatusMeta — status -> {group, label, tone}
// ---------------------------------------------------------------------------

test('getStatusMeta maps the three known statuses to their dedicated groups', () => {
  assert.equal(getStatusMeta('order payment pending').group, 'pending');
  assert.equal(getStatusMeta('order payment done').group, 'active');
  assert.equal(getStatusMeta('cancelled').group, 'cancelled');
});

test('getStatusMeta normalizes underscores/case/extra spaces before matching', () => {
  assert.equal(getStatusMeta('Order_Payment_Pending').group, 'pending');
  assert.equal(getStatusMeta('  ORDER-PAYMENT-DONE ').group, 'active');
  assert.equal(getStatusMeta('CANCELLED').group, 'cancelled');
});

test('getStatusMeta falls back to "other" for any status outside the 3-value allowlist', () => {
  const shipped = getStatusMeta('shipped');
  const delivered = getStatusMeta('delivered');
  const refunded = getStatusMeta('refunded');

  assert.equal(shipped.group, 'other');
  assert.equal(delivered.group, 'other');
  assert.equal(refunded.group, 'other');
  // Desired: a real post-payment lifecycle status like "delivered" should be recognized.
  // Actual: it is NOT distinguished from any other unknown string.
});

test('BUG: no status value ever resolves to statusGroup "delivered"', () => {
  const candidates = [
    'delivered', 'Delivered', 'DELIVERED', 'order_delivered', 'delivery completed',
    'completed', 'fulfilled', 'shipped', 'out for delivery',
  ];

  const anyDelivered = candidates.some((status) => getStatusMeta(status).group === 'delivered');

  // This proves the OrderHistory summary's "Delivered" stat (orders.filter(o =>
  // o.statusGroup === 'delivered').length) is dead code: no input can ever satisfy it.
  assert.equal(anyDelivered, false);
});

test('getStatusMeta treats an empty/missing status as "pending", not "other"', () => {
  const meta = getStatusMeta('');
  assert.equal(meta.group, 'pending');
  assert.equal(meta.label, 'Payment pending');
});

test('getStatusMeta title-cases unknown statuses for display', () => {
  const meta = getStatusMeta('refunded');
  assert.equal(meta.label, 'Refunded');
});

// ---------------------------------------------------------------------------
// formatCurrency / formatOrderDate / parseAmount
// ---------------------------------------------------------------------------

test('parseAmount extracts a number from currency-formatted strings', () => {
  assert.equal(parseAmount('Rs. 1,480.60'), 1480.6);
  assert.equal(parseAmount(1234), 1234);
  assert.equal(parseAmount('not a number'), 0);
  assert.equal(parseAmount(null), 0);
});

test('parseAmount handles a "Rs." prefix without corrupting the decimal point', () => {
  // Previously buggy: the blanket char-strip kept the dot from "Rs." itself, producing
  // ".1480.60" (two decimal points) which Number() rejects, silently returning 0.
  assert.equal(parseAmount('Rs.1480.60'), 1480.6);
  assert.equal(parseAmount('₹ 2,000'), 2000);
  assert.equal(parseAmount('Rs. -50'), -50);
  assert.equal(parseAmount('  810  '), 810);
});

test('formatCurrency rounds to the nearest rupee and uses en-IN grouping', () => {
  assert.equal(formatCurrency(1480.6), 'Rs. 1,481');
  assert.equal(formatCurrency(0), 'Rs. 0');
  assert.equal(formatCurrency(undefined), 'Rs. 0');
});

test('formatOrderDate returns a readable label for a valid timestamp and a fallback otherwise', () => {
  const label = formatOrderDate('2026-07-30T12:00:00.000Z');
  assert.match(label, /2026/);
  assert.equal(formatOrderDate('not-a-date'), 'Date unavailable');
  assert.equal(formatOrderDate(undefined), 'Date unavailable');
});

// ---------------------------------------------------------------------------
// normalizeOrderLine
// ---------------------------------------------------------------------------

test('normalizeOrderLine accepts a plain string as a single-quantity line', () => {
  const line = normalizeOrderLine('Kurta Set', 0);
  assert.deepEqual(line, { key: 'line-0', name: 'Kurta Set', quantity: 1 });
});

test('normalizeOrderLine reads name/quantity from common field name variants', () => {
  const line = normalizeOrderLine({ product_name: 'Shirt1', quantity: 3, id: 'p-1' }, 0);
  assert.deepEqual(line, { key: 'p-1', name: 'Shirt1', quantity: 3 });
});

test('normalizeOrderLine drops a line with no resolvable name', () => {
  assert.equal(normalizeOrderLine({ quantity: 2 }, 0), null);
  assert.equal(normalizeOrderLine(42, 0), null);
});

test('normalizeOrderLine floors fractional/invalid quantities to a safe positive integer', () => {
  assert.equal(normalizeOrderLine({ name: 'X', quantity: 2.9 }, 0).quantity, 2);
  assert.equal(normalizeOrderLine({ name: 'X', quantity: -1 }, 0).quantity, 1);
  assert.equal(normalizeOrderLine({ name: 'X', quantity: 'not-a-number' }, 0).quantity, 1);
});

// ---------------------------------------------------------------------------
// normalizeOrderRecord — the shape actually produced from a real purchase row
// ---------------------------------------------------------------------------

test('normalizeOrderRecord maps a realistic single-line purchase row (current checkout shape)', () => {
  // This is what CreateOrder.jsx's buildPurchaseRequests actually persists per cart line —
  // no `items`/`order_items` array, no shared order id, status has underscores.
  const row = {
    id: 412,
    trust_id: 'trust-a',
    trust_name: 'Trust A',
    product_price_id: 64,
    quantity: 2,
    unit_price: 360,
    amount: 720,
    total_amount: 810,
    status: 'order_payment_pending',
    created_at: '2026-07-30T10:00:00.000Z',
  };

  const record = normalizeOrderRecord(row, 0);

  assert.equal(record.id, '412');
  assert.equal(record.trustId, 'trust-a');
  assert.equal(record.trustLabel, 'Trust A');
  assert.equal(record.statusGroup, 'pending');
  assert.equal(record.status, 'Payment pending');
  assert.equal(record.totalAmount, 810);

  // BUG (data-shape mismatch): the row has no items/order_items/products/line_items array,
  // so `items` is always empty and `itemCount` falls back to `items.length` (0) unless an
  // item_count-style field is present. A real single-product purchase therefore shows 0 items,
  // not 1, because none of order.item_count/items_count/quantity-at-order-level are set here
  // (the "quantity" field is nested under `quantity` but that's the SAME field used above —
  // fallbackItemCount reads order.quantity, which IS present, so itemCount actually = 2 here).
  assert.deepEqual(record.items, []);
  assert.equal(record.itemCount, 2);
});

test('normalizeOrderRecord falls back to items.length (0) when no item-count field exists at all', () => {
  const row = {
    id: 500,
    trust_id: 'trust-a',
    product_price_id: 64,
    unit_price: 360,
    total_amount: 360,
    status: 'order_payment_done',
    created_at: '2026-07-30T10:00:00.000Z',
    // no `quantity`, `item_count`, `items_count`, and no items/order_items/products/line_items
  };

  const record = normalizeOrderRecord(row, 0);

  // BUG: a genuine single-product order with no quantity-ish field anywhere renders "0 Items"
  // in the UI's meta grid, which reads confusingly next to a non-zero total amount.
  assert.equal(record.itemCount, 0);
});

test('normalizeOrderRecord DOES correctly group real multi-item orders when an items array is present', () => {
  // Desired shape once checkout is fixed to emit a grouped order with line items.
  const row = {
    order_id: 'ORD-9001',
    trust_id: 'trust-a',
    status: 'order payment done',
    total_amount: 1080,
    created_at: '2026-07-30T10:00:00.000Z',
    items: [
      { product_name: 'Shirt1', quantity: 1 },
      { product_name: 'Coord3', quantity: 1 },
    ],
  };

  const record = normalizeOrderRecord(row, 0);

  assert.equal(record.id, 'ORD-9001');
  assert.equal(record.itemCount, 2);
  assert.equal(record.items.length, 2);
  assert.deepEqual(record.items.map((item) => item.name), ['Shirt1', 'Coord3']);
});

test('normalizeOrderRecord falls back to an unknown-trust placeholder when trust fields are missing', () => {
  const record = normalizeOrderRecord({ id: 1, status: 'cancelled', total_amount: 0 }, 0);
  assert.equal(record.trustKey, ORDER_HISTORY_UNKNOWN_TRUST_KEY);
  assert.equal(record.trustLabel, ORDER_HISTORY_UNKNOWN_TRUST_LABEL);
});

test('normalizeOrderRecord assigns a synthetic ORD-### id only when no real id-like field exists', () => {
  const record = normalizeOrderRecord({ status: 'cancelled', total_amount: 0 }, 4);
  assert.equal(record.id, 'ORD-005');
});

test('normalizeOrderRecord returns null for a non-object row instead of throwing', () => {
  assert.equal(normalizeOrderRecord(null, 0), null);
  assert.equal(normalizeOrderRecord(undefined, 0), null);
  assert.equal(normalizeOrderRecord('not-a-row', 0), null);
});

test('normalizeOrderRecord treats an unrecognized status as "other" but still renders a readable label', () => {
  const record = normalizeOrderRecord({ id: 1, status: 'shipped', total_amount: 100 }, 0);
  assert.equal(record.statusGroup, 'other');
  assert.equal(record.status, 'Shipped');
});

// ---------------------------------------------------------------------------
// normalizeSelectedAttributes — surfaces size/colour that's already on the raw row
// ---------------------------------------------------------------------------

test('normalizeSelectedAttributes formats a variant object into a readable label', () => {
  assert.equal(normalizeSelectedAttributes({ size: 'L', colour: 'beige' }), 'Size: L · Colour: beige');
});

test('normalizeSelectedAttributes preserves size-code casing like "XL" instead of mangling it', () => {
  assert.equal(normalizeSelectedAttributes({ size: 'XL' }), 'Size: XL');
});

test('normalizeSelectedAttributes title-cases underscored attribute keys', () => {
  assert.equal(normalizeSelectedAttributes({ shoe_size: '9' }), 'Shoe Size: 9');
});

test('normalizeSelectedAttributes returns an empty string for empty/missing/non-object input', () => {
  assert.equal(normalizeSelectedAttributes({}), '');
  assert.equal(normalizeSelectedAttributes(null), '');
  assert.equal(normalizeSelectedAttributes(undefined), '');
  assert.equal(normalizeSelectedAttributes('L'), '');
  assert.equal(normalizeSelectedAttributes(['L']), '');
});

test('normalizeOrderRecord surfaces attributesLabel straight from the raw row (no extra API call needed)', () => {
  const record = normalizeOrderRecord({
    id: 1,
    status: 'order_payment_pending',
    total_amount: 100,
    selected_attributes: { size: 'L', colour: 'beige' },
  }, 0);

  assert.equal(record.attributesLabel, 'Size: L · Colour: beige');
});

// ---------------------------------------------------------------------------
// normalizeOrderRecord — synthesizing a single line item from a catalog-enriched row
// ---------------------------------------------------------------------------

test('normalizeOrderRecord synthesizes one item from product_name when no items array exists', () => {
  // This is the shape orderHistoryService.js's catalog enrichment produces: no items/
  // order_items array, but a real product_name attached to the row itself.
  const record = normalizeOrderRecord({
    id: 412,
    status: 'order_payment_done',
    total_amount: 720,
    quantity: 2,
    product_name: 'Kurta Set',
  }, 0);

  assert.equal(record.items.length, 1);
  assert.equal(record.items[0].name, 'Kurta Set');
  assert.equal(record.items[0].quantity, 2);
  assert.equal(record.itemCount, 2);
});

test('normalizeOrderRecord preserves UUID purchase and product price identifiers', () => {
  const purchaseId = '550e8400-e29b-41d4-a716-446655440000';
  const priceId = '750e8400-e29b-41d4-a716-446655440002';
  const record = normalizeOrderRecord({
    id: purchaseId,
    product_price_id: priceId,
    product_name: 'UUID Order Product',
    quantity: 1,
    total_amount: 499,
    status: 'order_payment_done',
    created_at: '2026-07-30T10:00:00.000Z',
  }, 0);

  assert.equal(record.id, purchaseId);
  assert.equal(record.items[0].key, priceId);
  assert.equal(record.items[0].key.includes('NaN'), false);
  assert.notEqual(record.items[0].key, '0');
});

test('normalizeOrderRecord shows no synthesized item when the catalog lookup found no product name', () => {
  const record = normalizeOrderRecord({
    id: 413,
    status: 'order_payment_done',
    total_amount: 100,
    product_price_id: 64,
    // no product_name — catalog enrichment either failed or found no match
  }, 0);

  assert.deepEqual(record.items, []);
});
