import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const NativeWindow = globalThis.window;
const NativeLocalStorage = globalThis.localStorage;
const TEST_MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const createStorage = (initialEntries = {}) => {
  const values = new Map(Object.entries(initialEntries));

  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      const normalizedKey = String(key);
      return values.has(normalizedKey) ? values.get(normalizedKey) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
};

const createEnvironment = (initialEntries = {}) => {
  const localStorage = createStorage(initialEntries);

  globalThis.window = {
    localStorage,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = localStorage;

  return { localStorage };
};

const createUser = () => ({
  members_id: TEST_MEMBER_ID,
  hospital_memberships: [
    {
      trust_id: 'trust-a',
      trust_name: 'Trust A',
      members_id: TEST_MEMBER_ID,
    },
    {
      trust_id: 'trust-b',
      trust_name: 'Trust B',
      members_id: TEST_MEMBER_ID,
    },
  ],
  primary_trust: {
    id: 'trust-primary',
    name: 'Primary Trust',
  },
});

let orderHistoryService;
let cartUtils;

before(async () => {
  createEnvironment();
  orderHistoryService = await import('../src/features/products/orderHistoryService.js');
  cartUtils = await import('../src/features/products/productCart.js');
});

afterEach(() => {
  orderHistoryService?.setOrderHistoryPurchaseRpcOverrideForTests?.(null);
  cartUtils?.setCartProductsApiOverrideForTests?.(null);
});

after(() => {
  globalThis.window = NativeWindow;
  globalThis.localStorage = NativeLocalStorage;
});

test('default trust mode loads purchases from every linked trust and filters history statuses', async () => {
  const user = createUser();
  createEnvironment({
    user: JSON.stringify(user),
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-a',
    selected_trust_name: 'Trust A',
  });

  const requests = [];
  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        success: true,
        purchases: [
          {
            id: `${request.p_trust_id}-done`,
            trust_id: request.p_trust_id,
            status: 'order_payment_done',
            total_amount: 100,
          },
          {
            id: `${request.p_trust_id}-pending`,
            trust_id: request.p_trust_id,
            status: 'order payment pending',
          },
          {
            id: `${request.p_trust_id}-cancelled`,
            trust_id: request.p_trust_id,
            status: 'cancelled',
          },
          {
            id: `${request.p_trust_id}-cart`,
            trust_id: request.p_trust_id,
            type: 'cart',
            status: 'add_to_cart',
          },
          {
            id: `${request.p_trust_id}-wishlist`,
            trust_id: request.p_trust_id,
            status: 'wishlist',
          },
        ],
      },
    };
  });

  const snapshot = await orderHistoryService.loadOrderHistorySnapshot();

  assert.deepEqual(
    requests.map((request) => request.p_trust_id),
    ['trust-a', 'trust-b', 'trust-primary']
  );
  assert.ok(requests.every((request) => request.p_member_id === TEST_MEMBER_ID));
  assert.ok(requests.every((request) => request.p_action === 'get'));
  assert.equal(snapshot.rows.length, 9);
  assert.deepEqual(
    [...new Set(snapshot.rows.map((row) => row.status))].sort(),
    ['cancelled', 'order payment pending', 'order_payment_done']
  );
});

test('selected non-default trust mode loads only the selected trust', async () => {
  createEnvironment({
    user: JSON.stringify(createUser()),
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-b',
    selected_trust_name: 'Trust B',
  });

  const requests = [];
  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        success: true,
        purchases: [
          {
            id: 'order-b',
            status: 'order_payment_done',
          },
        ],
      },
    };
  });

  const snapshot = await orderHistoryService.loadOrderHistorySnapshot();

  assert.deepEqual(requests.map((request) => request.p_trust_id), ['trust-b']);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].trust_id, 'trust-b');
  assert.equal(snapshot.rows[0].trust_name, 'Trust B');
});

test('snapshot dedupes by trust and order identity but keeps same order id across trusts', async () => {
  createEnvironment({
    user: JSON.stringify(createUser()),
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-a',
  });

  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async (request) => ({
    data: {
      success: true,
      purchases: [
        {
          id: 'shared-order',
          trust_id: request.p_trust_id,
          status: 'order_payment_done',
        },
        {
          id: 'shared-order',
          trust_id: request.p_trust_id,
          status: 'order_payment_done',
        },
      ],
    },
  }));

  const snapshot = await orderHistoryService.loadOrderHistorySnapshot();

  assert.equal(snapshot.remoteRows.length, 6);
  assert.equal(snapshot.rows.length, 3);
  assert.deepEqual(
    snapshot.rows.map((row) => `${row.trust_id}:${row.id}`).sort(),
    ['trust-a:shared-order', 'trust-b:shared-order', 'trust-primary:shared-order']
  );
});

test('partial trust failures are reported while successful trust rows stay visible', async () => {
  createEnvironment({
    user: JSON.stringify(createUser()),
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-a',
  });

  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async (request) => {
    if (request.p_trust_id === 'trust-b') {
      throw new Error('Trust B unavailable');
    }

    return {
      data: {
        success: true,
        purchases: [
          {
            id: `${request.p_trust_id}-order`,
            trust_id: request.p_trust_id,
            status: 'order_payment_done',
          },
        ],
      },
    };
  });

  const snapshot = await orderHistoryService.loadOrderHistorySnapshot();

  assert.deepEqual(
    snapshot.rows.map((row) => row.trust_id).sort(),
    ['trust-a', 'trust-primary']
  );
  assert.equal(snapshot.trustErrors.length, 1);
  assert.equal(snapshot.trustErrors[0].trustId, 'trust-b');
  assert.match(snapshot.trustErrors[0].message, /Trust B unavailable/);
});

test('missing member identity returns no rows and a clear trust error', async () => {
  createEnvironment({
    user: JSON.stringify({ hospital_memberships: [{ trust_id: 'trust-a' }] }),
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-a',
  });

  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => {
    throw new Error('RPC should not run without a member ID');
  });

  const snapshot = await orderHistoryService.loadOrderHistorySnapshot();

  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.memberId, '');
  assert.equal(snapshot.trustErrors.length, 1);
  assert.match(snapshot.trustErrors[0].message, /Missing member identifier/);
});

// ---------------------------------------------------------------------------
// resolveOrderHistoryTrustScope — reading which trust is "current"
// ---------------------------------------------------------------------------

test('resolveOrderHistoryTrustScope prefers selected_trust_id, then last_selected, then the cached default', () => {
  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
    last_selected_trust_id: 'trust-last',
  });
  assert.equal(orderHistoryService.resolveOrderHistoryTrustScope().selectedTrustId, 'trust-last');

  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
    last_selected_trust_id: 'trust-last',
    selected_trust_id: 'trust-explicit',
  });
  assert.equal(orderHistoryService.resolveOrderHistoryTrustScope().selectedTrustId, 'trust-explicit');

  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
  });
  assert.equal(orderHistoryService.resolveOrderHistoryTrustScope().selectedTrustId, 'trust-default');
});

test('resolveOrderHistoryTrustScope flags "all trusts" mode only when the selected trust equals the default trust', () => {
  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
    selected_trust_id: 'trust-default',
  });
  assert.equal(orderHistoryService.resolveOrderHistoryTrustScope().isDefaultTrustSelected, true);

  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
    selected_trust_id: 'trust-other',
  });
  assert.equal(orderHistoryService.resolveOrderHistoryTrustScope().isDefaultTrustSelected, false);
});

// ---------------------------------------------------------------------------
// resolveOrderHistoryTrustContexts — which trusts actually get queried
// ---------------------------------------------------------------------------

test('BUG: an explicitly selected trust with no matching membership is still queried', () => {
  // The member belongs only to trust-a and trust-b, but somehow has trust-x selected
  // (e.g. a stale localStorage value, or a trust they were removed from). Desired: this
  // should be rejected/ignored client-side rather than sent to the backend as-is.
  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-default', name: 'Default Trust' }),
    selected_trust_id: 'trust-x',
  });

  const user = createUser(); // memberships: trust-a, trust-b only
  const contexts = orderHistoryService.resolveOrderHistoryTrustContexts(user);

  // Actual (current) behavior: trust-x is still included, with no membership backing it.
  assert.deepEqual(contexts.map((c) => c.trustId), ['trust-x']);
});

test('resolveOrderHistoryTrustContexts in "all trusts" mode dedupes trusts referenced multiple times', () => {
  createEnvironment({
    default_trust_cache: JSON.stringify({ id: 'trust-a', name: 'Trust A' }),
    selected_trust_id: 'trust-a',
  });

  // primary_trust and the selected trust both point at trust-a, which is also a membership.
  const user = createUser();
  const contexts = orderHistoryService.resolveOrderHistoryTrustContexts(user);

  const ids = contexts.map((c) => c.trustId);
  assert.deepEqual(ids, ['trust-a', 'trust-b', 'trust-primary']);
  assert.equal(new Set(ids).size, ids.length, 'no trust id should appear twice');
});

// ---------------------------------------------------------------------------
// resolveOrderHistoryMemberId — BUG: not trust-scoped
// ---------------------------------------------------------------------------

const MEMBER_UUID_GLOBAL = '44444444-4444-4444-8444-444444444444';
const MEMBER_UUID_TRUST_A = '55555555-5555-4555-8555-555555555555';
const MEMBER_UUID_TRUST_B = '66666666-6666-4666-8666-666666666666';

test('BUG: resolveOrderHistoryMemberId returns the same member id regardless of which trust is being queried', () => {
  // A member can legitimately have a DIFFERENT member_id per trust (see
  // utils/storageUtils.js compactMembership, which stores member_id per membership).
  const user = {
    members_id: MEMBER_UUID_GLOBAL,
    hospital_memberships: [
      { trust_id: 'trust-a', member_id: MEMBER_UUID_TRUST_A },
      { trust_id: 'trust-b', member_id: MEMBER_UUID_TRUST_B },
    ],
  };

  const resolved = orderHistoryService.resolveOrderHistoryMemberId(user);

  // Desired: querying trust-a's orders should use MEMBER_UUID_TRUST_A and trust-b's should
  // use MEMBER_UUID_TRUST_B. Actual: the function takes no trustId argument at all, so it
  // always returns the SAME id (whichever candidate is found first) no matter which trust's
  // orders are being fetched — proven by the fact the function's signature can't vary by trust.
  assert.equal(resolved, MEMBER_UUID_GLOBAL);
});

test('resolveOrderHistoryMemberId prefers explicit member_uuid/members_id fields over membership-nested ids', () => {
  const user = {
    members_id: MEMBER_UUID_GLOBAL,
    hospital_memberships: [{ trust_id: 'trust-a', member_id: MEMBER_UUID_TRUST_A }],
  };
  assert.equal(orderHistoryService.resolveOrderHistoryMemberId(user), MEMBER_UUID_GLOBAL);
});

test('resolveOrderHistoryMemberId falls back to a membership-nested id when no top-level id exists', () => {
  const user = {
    hospital_memberships: [{ trust_id: 'trust-a', member_id: '22222222-2222-4222-8222-222222222222' }],
  };
  assert.equal(
    orderHistoryService.resolveOrderHistoryMemberId(user),
    '22222222-2222-4222-8222-222222222222'
  );
});

test('resolveOrderHistoryMemberId ignores non-UUID candidates', () => {
  const user = { members_id: 'not-a-uuid', id: '33333333-3333-4333-8333-333333333333' };
  assert.equal(
    orderHistoryService.resolveOrderHistoryMemberId(user),
    '33333333-3333-4333-8333-333333333333'
  );
});

// ---------------------------------------------------------------------------
// shouldIncludePurchaseRow — the status allowlist
// ---------------------------------------------------------------------------

test('shouldIncludePurchaseRow accepts the 3 allowed statuses regardless of underscores/case', () => {
  assert.equal(orderHistoryService.shouldIncludePurchaseRow({ status: 'order_payment_pending' }), true);
  assert.equal(orderHistoryService.shouldIncludePurchaseRow({ status: 'Order Payment Done' }), true);
  assert.equal(orderHistoryService.shouldIncludePurchaseRow({ status: 'CANCELLED' }), true);
});

test('BUG: shouldIncludePurchaseRow silently drops any real order status outside the 3-value allowlist', () => {
  const postPaymentStatuses = ['shipped', 'delivered', 'out_for_delivery', 'refunded', 'completed', 'failed'];
  postPaymentStatuses.forEach((status) => {
    assert.equal(
      orderHistoryService.shouldIncludePurchaseRow({ status }),
      false,
      `expected "${status}" to be dropped (current allowlist behavior)`
    );
  });
});

test('shouldIncludePurchaseRow rejects rows with no status at all', () => {
  assert.equal(orderHistoryService.shouldIncludePurchaseRow({}), false);
  assert.equal(orderHistoryService.shouldIncludePurchaseRow({ status: '' }), false);
});

test('GAP: shouldIncludePurchaseRow has no explicit type check, so a cart/wishlist row only survives by accident if its status never overlaps an order status', () => {
  // Today cart rows use add_to_cart/remove_from_cart and wishlist rows use
  // wishlist/remove_from_wishlist, none of which collide with the order allowlist — but
  // nothing in this function actually checks `type === 'order'`. If a cart/wishlist row
  // ever legitimately had status 'cancelled' (a real product_purchase_status value), it
  // would leak into order history unfiltered.
  const cartRowWithOverlappingStatus = { type: 'cart', product_price_id: 1, status: 'cancelled' };
  assert.equal(orderHistoryService.shouldIncludePurchaseRow(cartRowWithOverlappingStatus), true);
});

// ---------------------------------------------------------------------------
// fetchOrdersForTrust
// ---------------------------------------------------------------------------

test('fetchOrdersForTrust throws the server-provided message when the RPC reports success:false', async () => {
  createEnvironment({ user: JSON.stringify(createUser()) });
  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => ({
    data: { success: false, message: 'Trust lookup failed' },
  }));

  await assert.rejects(
    orderHistoryService.fetchOrdersForTrust({ memberId: TEST_MEMBER_ID, trustId: 'trust-a' }),
    /Trust lookup failed/
  );
});

test('fetchOrdersForTrust rethrows a raw Supabase error unchanged', async () => {
  createEnvironment({ user: JSON.stringify(createUser()) });
  const boom = new Error('network down');
  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => ({ data: null, error: boom }));

  await assert.rejects(
    orderHistoryService.fetchOrdersForTrust({ memberId: TEST_MEMBER_ID, trustId: 'trust-a' }),
    /network down/
  );
});

test('fetchOrdersForTrust returns [] without calling the RPC when memberId or trustId is missing', async () => {
  createEnvironment({ user: JSON.stringify(createUser()) });
  let called = false;
  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => {
    called = true;
    return { data: { success: true, purchases: [] } };
  });

  assert.deepEqual(await orderHistoryService.fetchOrdersForTrust({ memberId: '', trustId: 'trust-a' }), []);
  assert.deepEqual(await orderHistoryService.fetchOrdersForTrust({ memberId: TEST_MEMBER_ID, trustId: '' }), []);
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// fetchOrdersForTrust — catalog enrichment (product_name from product_price_id)
// ---------------------------------------------------------------------------

test('fetchOrdersForTrust enriches a row with the real product name looked up by product_price_id', async () => {
  createEnvironment({ user: JSON.stringify(createUser()) });

  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: true,
      purchases: [
        {
          id: 412,
          trust_id: 'trust-a',
          product_price_id: 61,
          status: 'order_payment_done',
          total_amount: 810,
          selected_attributes: { size: 'L' },
        },
      ],
    },
  }));

  cartUtils.setCartProductsApiOverrideForTests(async () => ({
    data: {
      success: true,
      categories: [
        {
          id: 'cat-coords',
          name: 'Co-Ords',
          products: [
            {
              id: 97,
              product_name: 'Coord Set',
              prices: [{ id: 61, mrp: 918, price_after_discount: 810 }],
            },
          ],
        },
      ],
    },
  }));

  const rows = await orderHistoryService.fetchOrdersForTrust({ memberId: TEST_MEMBER_ID, trustId: 'trust-a' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_name, 'Coord Set');
  // The field the RPC never provides on its own — confirms the enrichment step actually ran.
});

test('fetchOrdersForTrust leaves rows unchanged when no catalog match exists for the product_price_id', async () => {
  createEnvironment({ user: JSON.stringify(createUser()) });

  orderHistoryService.setOrderHistoryPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: true,
      purchases: [
        { id: 500, trust_id: 'trust-a', product_price_id: 999, status: 'cancelled', total_amount: 0 },
      ],
    },
  }));

  cartUtils.setCartProductsApiOverrideForTests(async () => ({
    data: { success: true, categories: [] },
  }));

  const rows = await orderHistoryService.fetchOrdersForTrust({ memberId: TEST_MEMBER_ID, trustId: 'trust-a' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_name, undefined);
});
