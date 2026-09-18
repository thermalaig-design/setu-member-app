import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const NativeWindow = globalThis.window;
const NativeLocalStorage = globalThis.localStorage;
const NativeCustomEvent = globalThis.CustomEvent;
const TEST_MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const createUserEntry = () => JSON.stringify({
  members_id: TEST_MEMBER_ID
});

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
    dump() {
      return Object.fromEntries(values.entries());
    }
  };
};

const createEnvironment = (initialEntries = {}) => {
  const localStorage = createStorage(initialEntries);
  const listeners = new Map();

  const windowStub = {
    localStorage,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      const handlers = [...(listeners.get(event?.type) || [])];
      handlers.forEach((handler) => handler.call(windowStub, event));
      return true;
    }
  };

  globalThis.window = windowStub;
  globalThis.localStorage = localStorage;
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }

  const setTrust = (trustId) => {
    localStorage.setItem('selected_trust_id', trustId);
    localStorage.setItem('last_selected_trust_id', trustId);
    windowStub.dispatchEvent(new CustomEvent('trust-changed', { detail: { trustId } }));
  };

  return { localStorage, windowStub, setTrust };
};

createEnvironment();

let cartUtils;
let wishlistUtils;

before(async () => {
  cartUtils = await import('../src/utils/productCart.js');
  wishlistUtils = await import('../src/utils/productWishlist.js');
});

afterEach(() => {
  cartUtils?.setCartPurchaseRpcOverrideForTests?.(null);
  cartUtils?.setCartProductsApiOverrideForTests?.(null);
  wishlistUtils?.setWishlistPurchaseRpcOverrideForTests?.(null);
});

after(() => {
  globalThis.window = NativeWindow;
  globalThis.localStorage = NativeLocalStorage;
  if (NativeCustomEvent) globalThis.CustomEvent = NativeCustomEvent;
  else delete globalThis.CustomEvent;
});

test('cart and wishlist stay isolated per trust and restore on trust switch', async () => {
  const cartEnv = createEnvironment({
    selected_trust_id: 'trust-1',
    last_selected_trust_id: 'trust-1',
    user: createUserEntry(),
    product_cart_v1: JSON.stringify([
      {
        id: 'cart-trust-1',
        trust_id: 'trust-1',
        product_name: 'Trust 1 Cart',
        quantity: 1,
        price: { mrp: 100 }
      },
      {
        id: 'cart-trust-2',
        trust_id: 'trust-2',
        product_name: 'Trust 2 Cart',
        quantity: 2,
        price: { mrp: 200 }
      }
    ])
  });

  const cartSeen = [];
  const unsubscribeCart = cartUtils.subscribeCart((items) => {
    cartSeen.push(items.map((item) => item.id).sort());
  });

  assert.deepEqual(cartUtils.readCartItems().map((item) => item.id).sort(), ['cart-trust-1']);
  assert.equal(cartEnv.localStorage.getItem('product_cart_v1'), null);
  assert.ok(cartEnv.localStorage.getItem('product_cart_v2_trust-1'));
  assert.ok(cartEnv.localStorage.getItem('product_cart_v2_trust-2'));

  cartEnv.setTrust('trust-2');
  assert.deepEqual(cartUtils.readCartItems().map((item) => item.id).sort(), ['cart-trust-2']);
  assert.deepEqual(cartSeen.at(-1), ['cart-trust-2']);

  const cartRequests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    cartRequests.push(request);
    return {
      data: {
        id: 'purchase-trust-2-new',
        product_price_id: request.p_payload.product_price_id
      }
    };
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-trust-2-new',
      product_name: 'Trust 2 Added',
      price: { id: 'price-trust-2-new', mrp: 300, member_price: 240 }
    },
    {
      trustId: 'trust-2',
      quantity: 3,
      price: { id: 'price-trust-2-new', mrp: 300, member_price: 240 }
    }
  );

  assert.deepEqual(cartRequests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-2',
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: 'price-trust-2-new',
      type: 'cart',
      quantity: 3,
      unit_price: 240,
      status: 'add_to_cart',
      selected_attributes: {}
    }
  });
  assert.deepEqual(
    cartUtils.readCartItems('trust-2').map((item) => item.id).sort(),
    ['cart-trust-2', 'cart-trust-2-new']
  );
  assert.equal(cartUtils.getCartItemQuantity('cart-trust-2-new', 'trust-2'), 3);
  assert.deepEqual(cartSeen.at(-1), ['cart-trust-2', 'cart-trust-2-new']);

  cartEnv.setTrust('trust-1');
  assert.deepEqual(cartUtils.readCartItems().map((item) => item.id).sort(), ['cart-trust-1']);
  assert.equal(cartUtils.getCartItemQuantity('cart-trust-2-new', 'trust-1'), 0);
  assert.deepEqual(cartSeen.at(-1), ['cart-trust-1']);

  unsubscribeCart();

  const wishlistEnv = createEnvironment({
    selected_trust_id: 'trust-1',
    last_selected_trust_id: 'trust-1',
    product_wishlist_v1: JSON.stringify([
      {
        id: 'wish-trust-1',
        trust_id: 'trust-1',
        product_name: 'Trust 1 Wishlist'
      },
      {
        id: 'wish-trust-2',
        trust_id: 'trust-2',
        product_name: 'Trust 2 Wishlist'
      }
    ])
  });

  const wishlistSeen = [];
  const unsubscribeWishlist = wishlistUtils.subscribeWishlist((items) => {
    wishlistSeen.push(items.map((item) => item.id).sort());
  });

  assert.deepEqual(wishlistUtils.readWishlistItems().map((item) => item.id).sort(), ['wish-trust-1']);
  assert.equal(wishlistEnv.localStorage.getItem('product_wishlist_v1'), null);
  assert.ok(wishlistEnv.localStorage.getItem('product_wishlist_v2_trust-1'));
  assert.ok(wishlistEnv.localStorage.getItem('product_wishlist_v2_trust-2'));

  wishlistEnv.setTrust('trust-2');
  assert.deepEqual(wishlistUtils.readWishlistItems().map((item) => item.id).sort(), ['wish-trust-2']);
  assert.deepEqual(wishlistSeen.at(-1), ['wish-trust-2']);

  wishlistUtils.addWishlistProduct(
    {
      id: 'wish-trust-2-new',
      product_name: 'Trust 2 Added'
    },
    {
      trustId: 'trust-2'
    }
  );

  assert.deepEqual(
    wishlistUtils.readWishlistItems('trust-2').map((item) => item.id).sort(),
    ['wish-trust-2', 'wish-trust-2-new']
  );
  assert.equal(wishlistUtils.isWishlistProduct('wish-trust-2-new', 'trust-2'), true);
  assert.deepEqual(wishlistSeen.at(-1), ['wish-trust-2', 'wish-trust-2-new']);

  wishlistEnv.setTrust('trust-1');
  assert.deepEqual(wishlistUtils.readWishlistItems().map((item) => item.id).sort(), ['wish-trust-1']);
  assert.equal(wishlistUtils.isWishlistProduct('wish-trust-2-new', 'trust-1'), false);
  assert.deepEqual(wishlistSeen.at(-1), ['wish-trust-1']);

  unsubscribeWishlist();
});

test('cart mutations send selected attributes to purchase API', async () => {
  createEnvironment({
    selected_trust_id: 'trust-attributes',
    last_selected_trust_id: 'trust-attributes',
    user: createUserEntry()
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: request.p_payload.id || 'purchase-attributes',
        product_price_id: request.p_payload.product_price_id || 'price-attributes'
      }
    };
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-attributes',
      product_name: 'Cart Attributes',
      price: { id: 'price-attributes', member_price: 180 }
    },
    {
      trustId: 'trust-attributes',
      quantity: 1,
      price: { id: 'price-attributes', member_price: 180 },
      selectedAttributes: {
        size: 'M',
        color: 'Red',
        number: ['2', '3']
      }
    }
  );

  assert.deepEqual(requests[0].p_payload.selected_attributes, {
    size: 'M',
    color: 'Red',
    number: '2, 3'
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-attributes',
      product_name: 'Cart Attributes',
      price: { id: 'price-attributes', member_price: 180 }
    },
    {
      trustId: 'trust-attributes',
      quantity: 2,
      price: { id: 'price-attributes', member_price: 180 },
      selectedAttributes: {
        size: 'L',
        pattern: 'Printed'
      }
    }
  );

  assert.deepEqual(requests[1].p_payload, {
    id: 'purchase-attributes',
    status: 'add_to_cart',
    quantity: 2,
    selected_attributes: {
      size: 'L',
      pattern: 'Printed'
    }
  });
  assert.deepEqual(cartUtils.readCartItems('trust-attributes')[0]?.selected_attributes, {
    size: 'L',
    pattern: 'Printed'
  });
});

test('cart move to wishlist creates wishlist row and removes cart row', async () => {
  createEnvironment({
    selected_trust_id: 'trust-cart-move-wishlist',
    last_selected_trust_id: 'trust-cart-move-wishlist',
    user: createUserEntry(),
    'product_cart_v2_trust-cart-move-wishlist': JSON.stringify([
      {
        key: 'trust-cart-move-wishlist:tunic2',
        id: 'tunic2',
        trust_id: 'trust-cart-move-wishlist',
        product_name: 'Tunic2',
        purchase_id: '64',
        product_price_id: '86',
        quantity: 1,
        selected_attributes: {
          size: 'L'
        },
        attribute_values: [
          {
            attribute_name: 'size',
            value: 'S,M,L'
          }
        ],
        price: {
          id: '86',
          member_price: 360,
          price_after_discount: 360
        }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        success: true,
        purchases: [
          {
            id: request.p_payload.id || 'wishlist-purchase-64',
            type: request.p_payload.type,
            status: request.p_payload.status,
            quantity: request.p_payload.quantity,
            trust_id: request.p_trust_id,
            product_price_id: request.p_payload.product_price_id || 86,
            selected_attributes: request.p_payload.selected_attributes
          }
        ]
      }
    };
  });

  const result = await cartUtils.moveCartProductToWishlist('tunic2', 'trust-cart-move-wishlist');
  wishlistUtils.cacheWishlistProduct(result.wishlistItem, {
    trustId: 'trust-cart-move-wishlist',
    selectedAttributes: result.wishlistItem.selected_attributes,
    attributeValues: result.wishlistItem.attribute_values,
    price: result.wishlistItem.price
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-cart-move-wishlist',
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: '86',
      type: 'wishlist',
      quantity: 1,
      unit_price: 0,
      status: 'wishlist',
      selected_attributes: {
        size: 'L'
      }
    }
  });
  assert.deepEqual(requests[1], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-cart-move-wishlist',
    p_action: 'upsert_purchase',
    p_payload: {
      id: '64',
      status: 'remove_from_cart',
      quantity: 1,
    }
  });
  assert.deepEqual(cartUtils.readCartItems('trust-cart-move-wishlist'), []);
  assert.equal(result.wishlistItem.purchase_id, 'wishlist-purchase-64');
  assert.equal(result.wishlistItem.status, 'wishlist');

  const wishlistItems = wishlistUtils.readWishlistItems('trust-cart-move-wishlist');
  assert.equal(wishlistItems.length, 1);
  assert.equal(wishlistItems[0].purchase_id, 'wishlist-purchase-64');
  assert.equal(wishlistItems[0].status, 'wishlist');
  assert.equal(wishlistItems[0].sync_state, 'synced');
});

test('cart move to wishlist keeps cart item and logs when API fails', async () => {
  createEnvironment({
    selected_trust_id: 'trust-cart-move-fail',
    last_selected_trust_id: 'trust-cart-move-fail',
    user: createUserEntry(),
    'product_cart_v2_trust-cart-move-fail': JSON.stringify([
      {
        key: 'trust-cart-move-fail:tunic2',
        id: 'tunic2',
        trust_id: 'trust-cart-move-fail',
        product_name: 'Tunic2',
        purchase_id: '65',
        product_price_id: '87',
        quantity: 1,
        price: {
          id: '87',
          member_price: 360
        }
      }
    ])
  });

  cartUtils.setCartPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: false,
      message: 'wishlist update failed'
    }
  }));

  const nativeConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => {
    errorLogs.push(args);
  };

  try {
    await assert.rejects(
      cartUtils.moveCartProductToWishlist('tunic2', 'trust-cart-move-fail'),
      /wishlist update failed/
    );
  } finally {
    console.error = nativeConsoleError;
  }

  assert.equal(errorLogs[0]?.[0], '[Cart] move to wishlist API failed');
  assert.equal(cartUtils.readCartItems('trust-cart-move-fail').length, 1);
  assert.deepEqual(wishlistUtils.readWishlistItems('trust-cart-move-fail'), []);
});

test('cart move to wishlist removes the cart row when product is already wishlisted elsewhere', async () => {
  createEnvironment({
    selected_trust_id: 'trust-cart-move-dup',
    last_selected_trust_id: 'trust-cart-move-dup',
    user: createUserEntry(),
    'product_cart_v2_trust-cart-move-dup': JSON.stringify([
      {
        key: 'trust-cart-move-dup:tunic2',
        id: 'tunic2',
        trust_id: 'trust-cart-move-dup',
        product_name: 'Tunic2',
        purchase_id: '307',
        product_price_id: '173',
        quantity: 1,
        price: {
          id: '173',
          member_price: 360
        }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    if (request.p_payload.type === 'wishlist') {
      return {
        data: {
          success: false,
          error: 'duplicate key value violates unique constraint "idx_unique_active_wishlist_item_uuid"'
        }
      };
    }

    if (request.p_action === 'get') {
      return {
        data: {
          success: true,
          purchases: [
            {
              id: 'wishlist-row-99',
              trust_id: 'trust-cart-move-dup',
              type: 'wishlist',
              product_price_id: '173',
              status: 'wishlist',
              quantity: 1
            }
          ]
        }
      };
    }

    return {
      data: {
        success: true,
        purchases: [
          {
            id: request.p_payload.id,
            status: request.p_payload.status,
            quantity: request.p_payload.quantity
          }
        ]
      }
    };
  });

  const result = await cartUtils.moveCartProductToWishlist('tunic2', 'trust-cart-move-dup');

  assert.equal(requests.length, 3);
  assert.equal(requests[1].p_action, 'get');
  assert.equal(requests[2].p_payload.status, 'remove_from_cart');
  assert.equal(result.alreadyInWishlist, true);
  assert.equal(result.wishlistItem.purchase_id, 'wishlist-row-99');
  assert.deepEqual(cartUtils.readCartItems('trust-cart-move-dup'), []);
});

test('cart move to wishlist reactivates a removed wishlist row instead of just dropping the cart item', async () => {
  createEnvironment({
    selected_trust_id: 'trust-cart-move-tombstone',
    last_selected_trust_id: 'trust-cart-move-tombstone',
    user: createUserEntry(),
    'product_cart_v2_trust-cart-move-tombstone': JSON.stringify([
      {
        key: 'trust-cart-move-tombstone:tunic2',
        id: 'tunic2',
        trust_id: 'trust-cart-move-tombstone',
        product_name: 'Tunic2',
        purchase_id: '307',
        product_price_id: '173',
        quantity: 1,
        price: {
          id: '173',
          member_price: 360
        }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    if (request.p_payload.type === 'wishlist') {
      return {
        data: {
          success: false,
          error: 'duplicate key value violates unique constraint "idx_unique_wishlist_item"'
        }
      };
    }

    if (request.p_action === 'get') {
      return {
        data: {
          success: true,
          purchases: [
            {
              id: 'wishlist-row-tombstone',
              trust_id: 'trust-cart-move-tombstone',
              type: 'wishlist',
              product_price_id: '173',
              status: 'remove_from_wishlist',
              quantity: 1
            }
          ]
        }
      };
    }

    return {
      data: {
        success: true,
        purchases: [
          {
            id: request.p_payload.id,
            status: request.p_payload.status,
            quantity: request.p_payload.quantity
          }
        ]
      }
    };
  });

  const result = await cartUtils.moveCartProductToWishlist('tunic2', 'trust-cart-move-tombstone');

  const reactivateRequest = requests.find((request) => (
    request.p_payload?.id === 'wishlist-row-tombstone' && request.p_payload?.status === 'wishlist'
  ));
  assert.ok(reactivateRequest, 'expected the tombstone wishlist row to be reactivated');

  const removeCartRequest = requests.find((request) => request.p_payload?.status === 'remove_from_cart');
  assert.ok(removeCartRequest, 'expected the cart row to still be removed after reactivation');

  assert.equal(result.alreadyInWishlist, true);
  assert.equal(result.wishlistItem.purchase_id, 'wishlist-row-tombstone');
  assert.deepEqual(cartUtils.readCartItems('trust-cart-move-tombstone'), []);
});

test('wishlist reads keep only wishlist rows and order them newest first', () => {
  createEnvironment({
    selected_trust_id: 'trust-wishlist-sort',
    last_selected_trust_id: 'trust-wishlist-sort',
    [`product_wishlist_v2_trust-wishlist-sort`]: JSON.stringify([
      {
        id: 'wish-old',
        trust_id: 'trust-wishlist-sort',
        status: 'wishlist',
        created_at: '2026-07-27T10:00:00.000Z',
        updated_at: '2026-07-27T10:00:00.000Z'
      },
      {
        id: 'wish-cancelled',
        trust_id: 'trust-wishlist-sort',
        status: 'cancelled',
        created_at: '2026-07-28T12:00:00.000Z',
        updated_at: '2026-07-28T12:00:00.000Z'
      },
      {
        id: 'wish-new',
        trust_id: 'trust-wishlist-sort',
        status: 'wishlist',
        created_at: '2026-07-28T13:00:00.000Z',
        updated_at: '2026-07-28T13:00:00.000Z'
      }
    ])
  });

  const items = wishlistUtils.readWishlistItems('trust-wishlist-sort');

  assert.deepEqual(items.map((item) => item.id), ['wish-new', 'wish-old']);
  assert.ok(items.every((item) => item.status === 'wishlist'));
});

test('wishlist refresh enriches product display from product catalog by price id', async () => {
  createEnvironment({
    selected_trust_id: 'trust-wishlist-products',
    last_selected_trust_id: 'trust-wishlist-products',
    user: createUserEntry()
  });

  const wishlistRequests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    wishlistRequests.push(request);
    return {
      data: {
        success: true,
        trust_id: 'trust-wishlist-products',
        member_id: TEST_MEMBER_ID,
        purchases: [
          {
            id: 91,
            type: 'wishlist',
            status: 'wishlist',
            quantity: 1,
            trust_id: 'trust-wishlist-products',
            product_price_id: 61,
            unit_price: 826.2,
            updated_at: '2026-07-28T18:30:00.000+05:30'
          },
          {
            id: 92,
            type: 'cart',
            status: 'add_to_cart',
            quantity: 1,
            trust_id: 'trust-wishlist-products',
            product_price_id: 62,
            unit_price: 100,
            updated_at: '2026-07-28T18:31:00.000+05:30'
          }
        ]
      }
    };
  });

  const productRequests = [];
  cartUtils.setCartProductsApiOverrideForTests(async (request) => {
    productRequests.push(request);
    return {
      data: {
        success: true,
        trust_id: 'trust-wishlist-products',
        categories: [
          {
            id: 'cat-coords',
            name: 'Coord Set',
            products: [
              {
                id: 97,
                product_name: 'coord2',
                product_code: 'co-2',
                product_type: 'Product',
                images: [{
                  id: 108,
                  status: 'active',
                  image_url: 'https://example.com/coord2.jpg',
                  sort_order: 0
                }],
                attribute_values: [
                  {
                    id: 180,
                    value: 'S,M,L',
                    status: 'active',
                    attribute_id: 60,
                    attribute_name: 'size',
                    attribute_type: 'display'
                  },
                  {
                    id: 181,
                    value: 'white',
                    status: 'active',
                    attribute_id: 62,
                    attribute_name: 'color',
                    attribute_type: 'select'
                  }
                ],
                prices: [
                  {
                    id: 61,
                    mrp: 918,
                    status: 'active',
                    gst_pct: 18,
                    gst_amount: 153.4,
                    billing_type: 'one_time',
                    discount_pct: 10,
                    member_price: 920,
                    total_payable: 1005.6,
                    transport_fee: 26,
                    discount_amount: 91.8,
                    price_after_discount: 826.2
                  }
                ]
              }
            ]
          }
        ]
      }
    };
  });

  const items = await wishlistUtils.refreshWishlistCache('trust-wishlist-products');

  assert.deepEqual(wishlistRequests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-wishlist-products',
    p_action: 'get',
    p_payload: {}
  });
  assert.deepEqual(productRequests[0], {
    p_trust_id: 'trust-wishlist-products'
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '97');
  assert.equal(items[0].product_id, '97');
  assert.equal(items[0].purchase_id, '91');
  assert.equal(items[0].product_price_id, '61');
  assert.equal(items[0].product_name, 'coord2');
  assert.equal(items[0].product_code, 'co-2');
  assert.equal(items[0].category_id, 'cat-coords');
  assert.equal(items[0].category_name, 'Coord Set');
  assert.equal(items[0].images[0]?.image_url, 'https://example.com/coord2.jpg');
  assert.equal(items[0].attribute_values.length, 2);
  assert.equal(items[0].price.mrp, 918);
  assert.equal(items[0].price.discount_pct, 10);
  assert.equal(items[0].price.price_after_discount, 826.2);
  assert.deepEqual(wishlistUtils.readWishlistItems('trust-wishlist-products').map((item) => item.product_name), ['coord2']);
});

test('wishlist reads hide removed tombstone rows after local removal', () => {
  createEnvironment({
    selected_trust_id: 'trust-wishlist-remove',
    last_selected_trust_id: 'trust-wishlist-remove',
    'product_wishlist_v2_trust-wishlist-remove': JSON.stringify([
      {
        id: 'wish-remove',
        trust_id: 'trust-wishlist-remove',
        status: 'wishlist',
        product_name: 'Removed Wish'
      },
      {
        id: 'wish-keep',
        trust_id: 'trust-wishlist-remove',
        status: 'wishlist',
        product_name: 'Kept Wish'
      }
    ])
  });

  wishlistUtils.removeWishlistProduct('wish-remove', 'trust-wishlist-remove');

  assert.deepEqual(
    wishlistUtils.readWishlistItems('trust-wishlist-remove').map((item) => item.id).sort(),
    ['wish-keep']
  );

  const storedRows = JSON.parse(globalThis.localStorage.getItem('product_wishlist_v2_trust-wishlist-remove'));
  assert.equal(
    storedRows.find((item) => item.id === 'wish-remove')?.status,
    'remove_from_wishlist'
  );
});

test('wishlist reads repair active purchase row linked to removed price tombstone', () => {
  const trustId = 'trust-wishlist-key-repair';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:purchase-jeans`,
        id: 'purchase-jeans',
        purchase_id: 'purchase-jeans',
        trust_id: trustId,
        status: 'wishlist',
        product_name: 'Product purchase-jeans',
        source: 'rpc'
      },
      {
        key: `${trustId}:price-jeans`,
        id: 'jeans3',
        product_id: 'jeans3',
        product_price_id: 'price-jeans',
        purchase_id: 'purchase-jeans',
        trust_id: trustId,
        status: 'remove_from_wishlist',
        product_name: 'Jeans3',
        price: { id: 'price-jeans', member_price: 540 }
      }
    ])
  });

  const items = wishlistUtils.readWishlistItems(trustId);

  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'wishlist');
  assert.equal(items[0].key, wishlistUtils.getWishlistKey('price-jeans', trustId));
  assert.equal(items[0].id, 'jeans3');
  assert.equal(items[0].product_id, 'jeans3');
  assert.equal(items[0].product_price_id, 'price-jeans');
  assert.equal(items[0].purchase_id, 'purchase-jeans');
  assert.equal(items[0].product_name, 'Jeans3');
  assert.equal(wishlistUtils.isWishlistProduct('price-jeans', trustId), true);
});

test('wishlist re-add uses product price id instead of stale removed purchase id', async () => {
  const trustId = 'trust-wishlist-readd';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry(),
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:price-jeans`,
        id: 'jeans3',
        product_id: 'jeans3',
        product_price_id: 'price-jeans',
        purchase_id: 'purchase-jeans',
        trust_id: trustId,
        status: 'remove_from_wishlist',
        product_name: 'Jeans3',
        price: { id: 'price-jeans', member_price: 540 }
      }
    ])
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        purchases: [
          {
            id: request.p_payload.id || 'purchase-jeans-new',
            type: 'wishlist',
            status: request.p_payload.status,
            trust_id: trustId,
            product_id: 'jeans3',
            product_price_id: request.p_payload.product_price_id || 'price-jeans',
            quantity: request.p_payload.quantity || 1
          }
        ]
      }
    };
  });

  const product = {
    id: 'jeans3',
    product_name: 'Jeans3',
    price: { id: 'price-jeans', member_price: 540 }
  };

  const addResult = wishlistUtils.toggleWishlistProduct(product, {
    trustId,
    price: product.price
  });

  assert.equal(addResult.wished, true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const itemsAfterReadd = wishlistUtils.readWishlistItems(trustId);
  assert.equal(itemsAfterReadd.length, 1);
  assert.equal(itemsAfterReadd[0].key, wishlistUtils.getWishlistKey('price-jeans', trustId));
  assert.equal(itemsAfterReadd[0].product_id, 'jeans3');
  assert.equal(itemsAfterReadd[0].product_price_id, 'price-jeans');
  assert.equal(itemsAfterReadd[0].purchase_id, 'purchase-jeans-new');
  assert.equal(wishlistUtils.isWishlistProduct('price-jeans', trustId), true);

  const removeResult = wishlistUtils.toggleWishlistProduct(product, {
    trustId,
    price: product.price
  });

  assert.equal(removeResult.wished, false);
  assert.deepEqual(wishlistUtils.readWishlistItems(trustId), []);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(requests[0].p_payload.id, undefined);
  assert.equal(requests[0].p_payload.product_price_id, 'price-jeans');
  assert.equal(requests[0].p_payload.status, 'wishlist');
  assert.equal(requests[1].p_payload.id, 'purchase-jeans-new');
  assert.equal(requests[1].p_payload.status, 'remove_from_wishlist');
});

test('wishlist async re-add uses product price id instead of stale removed purchase id', async () => {
  const trustId = 'trust-wishlist-async-readd';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry(),
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:price-async-readd`,
        id: 'kurta-async',
        product_id: 'kurta-async',
        product_price_id: 'price-async-readd',
        purchase_id: 'old-removed-purchase',
        trust_id: trustId,
        status: 'remove_from_wishlist',
        product_name: 'Kurta Async',
        price: { id: 'price-async-readd', member_price: 640 }
      }
    ])
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: 'new-async-purchase',
        type: 'wishlist',
        status: 'wishlist',
        trust_id: trustId,
        product_id: 'kurta-async',
        product_price_id: request.p_payload.product_price_id,
        quantity: request.p_payload.quantity
      }
    };
  });

  const product = {
    id: 'kurta-async',
    product_name: 'Kurta Async',
    price: { id: 'price-async-readd', member_price: 640 }
  };

  const result = await wishlistUtils.toggleWishlistProductAsync(product, {
    trustId,
    price: product.price
  });

  assert.equal(result.ok, true);
  assert.equal(result.wished, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].p_payload.id, undefined);
  assert.equal(requests[0].p_payload.product_price_id, 'price-async-readd');
  assert.equal(requests[0].p_payload.status, 'wishlist');

  const items = wishlistUtils.readWishlistItems(trustId);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'wishlist');
  assert.equal(items[0].purchase_id, 'new-async-purchase');
  assert.equal(items[0].product_price_id, 'price-async-readd');
});

test('wishlist async add uses snake case product price id from context', async () => {
  const trustId = 'trust-wishlist-context-price';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry()
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: 'purchase-kurta-context',
        type: 'wishlist',
        status: 'wishlist',
        trust_id: trustId,
        product_id: 'kurta1',
        product_price_id: request.p_payload.product_price_id,
        quantity: request.p_payload.quantity
      }
    };
  });

  const product = {
    id: 'kurta1',
    product_name: 'Kurta1'
  };

  const result = await wishlistUtils.toggleWishlistProductAsync(product, {
    trustId,
    product_price_id: 'price-kurta-context'
  });

  assert.equal(result.ok, true);
  assert.equal(result.wished, true);
  assert.equal(requests[0].p_payload.product_price_id, 'price-kurta-context');
  assert.equal(requests[0].p_payload.status, 'wishlist');

  const items = wishlistUtils.readWishlistItems(trustId);
  assert.equal(items[0].product_price_id, 'price-kurta-context');
  assert.equal(
    wishlistUtils.isWishlistProductInItems(items, product, { trustId, product_price_id: 'price-kurta-context' }),
    true
  );
});

test('wishlist async add reactivates the existing removed row instead of faking success', async () => {
  const trustId = 'trust-wishlist-duplicate';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry()
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);

    if (request.p_action === 'get') {
      return {
        data: {
          success: true,
          purchases: [
            {
              id: 'purchase-duplicate-real-id',
              trust_id: trustId,
              type: 'wishlist',
              product_price_id: 'price-duplicate',
              status: 'remove_from_wishlist',
              quantity: 1
            }
          ]
        }
      };
    }

    if (request.p_payload?.id === 'purchase-duplicate-real-id' && request.p_payload?.status === 'wishlist') {
      return { data: { success: true, id: 'purchase-duplicate-real-id', purchases: [] } };
    }

    return {
      data: {
        success: false,
        error: 'duplicate key value violates unique constraint "idx_unique_wishlist_item"'
      }
    };
  });

  const result = await wishlistUtils.toggleWishlistProductAsync(
    {
      id: 'kurta-duplicate',
      product_name: 'Kurta Duplicate'
    },
    {
      trustId,
      product_price_id: 'price-duplicate',
      price: { id: 'price-duplicate', member_price: 100 }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.wished, true);
  assert.equal(result.duplicateResolved, true);

  const reactivateRequest = requests.find((request) => request.p_payload?.id === 'purchase-duplicate-real-id');
  assert.ok(reactivateRequest, 'expected a reactivation request against the real existing purchase id');
  assert.equal(reactivateRequest.p_payload.status, 'wishlist');
  assert.equal(wishlistUtils.isWishlistProduct('price-duplicate', trustId), true);
});

test('wishlist async add surfaces the real error when the existing row cannot be reactivated', async () => {
  const trustId = 'trust-wishlist-duplicate-unrecoverable';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry()
  });

  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: false,
      error: 'duplicate key value violates unique constraint "idx_unique_wishlist_item"'
    }
  }));

  const result = await wishlistUtils.toggleWishlistProductAsync(
    {
      id: 'kurta-duplicate-unrecoverable',
      product_name: 'Kurta Duplicate Unrecoverable'
    },
    {
      trustId,
      product_price_id: 'price-duplicate-unrecoverable',
      price: { id: 'price-duplicate-unrecoverable', member_price: 100 }
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.error.message, /duplicate key value/);
  assert.equal(wishlistUtils.isWishlistProduct('price-duplicate-unrecoverable', trustId), false);
});

test('wishlist async add requires member identity and does not fake local success', async () => {
  const trustId = 'trust-wishlist-no-member';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    throw new Error('RPC should not be called without a member ID');
  });

  const result = await wishlistUtils.toggleWishlistProductAsync(
    {
      id: 'kurta-no-member',
      product_name: 'Kurta No Member',
      price: { id: 'price-no-member', member_price: 100 }
    },
    {
      trustId,
      price: { id: 'price-no-member', member_price: 100 }
    }
  );

  assert.equal(result.ok, false);
  assert.match(result.error.message, /member profile ID/);
  assert.deepEqual(requests, []);
  assert.deepEqual(wishlistUtils.readWishlistItems(trustId), []);
});

test('wishlist async remove can sync remove status by product price id without purchase id', async () => {
  const trustId = 'trust-wishlist-remove-price';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry(),
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:price-remove-only`,
        id: 'kurta-remove-only',
        product_id: 'kurta-remove-only',
        product_price_id: 'price-remove-only',
        trust_id: trustId,
        status: 'wishlist',
        product_name: 'Kurta Remove Only',
        price: { id: 'price-remove-only', member_price: 120 }
      }
    ])
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        success: true
      }
    };
  });

  const result = await wishlistUtils.toggleWishlistProductAsync(
    {
      id: 'kurta-remove-only',
      product_name: 'Kurta Remove Only',
      price: { id: 'price-remove-only', member_price: 120 }
    },
    {
      trustId,
      price: { id: 'price-remove-only', member_price: 120 }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.wished, false);
  assert.deepEqual(requests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: trustId,
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: 'price-remove-only',
      type: 'wishlist',
      quantity: 1,
      unit_price: 120,
      status: 'remove_from_wishlist'
    }
  });
  assert.deepEqual(wishlistUtils.readWishlistItems(trustId), []);
});

test('wishlist async remove syncs to already-removed server state instead of surfacing duplicate-key error', async () => {
  const trustId = 'trust-wishlist-remove-duplicate';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry(),
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:kurta-stale-active`,
        id: 'kurta-stale-active',
        product_id: 'kurta-stale-active',
        product_price_id: 'price-stale-active',
        trust_id: trustId,
        status: 'wishlist',
        product_name: 'Kurta Stale Active',
        price: { id: 'price-stale-active', member_price: 200 }
      }
    ])
  });

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);

    if (request.p_action === 'get') {
      return {
        data: {
          success: true,
          purchases: [
            {
              id: 'purchase-stale-real-id',
              trust_id: trustId,
              type: 'wishlist',
              product_price_id: 'price-stale-active',
              status: 'remove_from_wishlist',
              quantity: 1
            }
          ]
        }
      };
    }

    return {
      data: {
        success: false,
        error: 'duplicate key value violates unique constraint "idx_unique_wishlist_item"'
      }
    };
  });

  const result = await wishlistUtils.toggleWishlistProductAsync(
    {
      id: 'kurta-stale-active',
      product_name: 'Kurta Stale Active',
      price: { id: 'price-stale-active', member_price: 200 }
    },
    {
      trustId,
      price: { id: 'price-stale-active', member_price: 200 }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.wished, false);
  assert.deepEqual(wishlistUtils.readWishlistItems(trustId), []);
});

test('wishlist product matching does not confuse purchase id with product price id', async () => {
  const trustId = 'trust-wishlist-id-collision';
  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry(),
    [`product_wishlist_v2_${trustId}`]: JSON.stringify([
      {
        key: `${trustId}:83`,
        id: '120',
        purchase_id: '77',
        product_id: '120',
        product_price_id: '83',
        trust_id: trustId,
        status: 'wishlist',
        product_name: 'Mini skirts',
        price: { id: '83', price_after_discount: 315 }
      }
    ])
  });

  const jeans6 = {
    id: '114',
    product_name: 'jeans6',
    price: {
      id: '77',
      member_price: 499,
      price_after_discount: 540
    }
  };

  const initialItems = wishlistUtils.readWishlistItems(trustId);
  assert.equal(
    wishlistUtils.isWishlistProductInItems(initialItems, jeans6, { trustId, price: jeans6.price }),
    false
  );
  assert.equal(wishlistUtils.isWishlistProduct('77', trustId), false);

  const requests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: 'purchase-jeans6',
        type: 'wishlist',
        status: 'wishlist',
        trust_id: trustId,
        product_id: '114',
        product_price_id: request.p_payload.product_price_id,
        quantity: request.p_payload.quantity
      }
    };
  });

  const result = await wishlistUtils.toggleWishlistProductAsync(jeans6, {
    trustId,
    price: jeans6.price
  });

  assert.equal(result.ok, true);
  assert.equal(result.wished, true);
  assert.equal(requests[0].p_payload.id, undefined);
  assert.equal(requests[0].p_payload.product_price_id, '77');
  assert.equal(requests[0].p_payload.status, 'wishlist');

  const items = wishlistUtils.readWishlistItems(trustId);
  assert.deepEqual(
    items.map((item) => item.product_price_id).sort(),
    ['77', '83']
  );
  assert.equal(
    wishlistUtils.isWishlistProductInItems(items, jeans6, { trustId, price: jeans6.price }),
    true
  );
});

test('cart quantity updates preserve item order', async () => {
  createEnvironment({
    selected_trust_id: 'trust-order',
    last_selected_trust_id: 'trust-order',
    user: createUserEntry()
  });

  const requests = [];
  let purchaseCounter = 0;
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    const purchaseId = request.p_payload.id || `purchase-order-${purchaseCounter += 1}`;
    return {
      data: {
        id: purchaseId,
        product_price_id: request.p_payload.product_price_id
      }
    };
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-1',
      product_name: 'Cart Order 1',
      price: { id: 'price-order-1', member_price: 100 }
    },
    {
      trustId: 'trust-order',
      quantity: 1,
      price: { id: 'price-order-1', member_price: 100 }
    }
  );

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-2',
      product_name: 'Cart Order 2',
      price: { id: 'price-order-2', member_price: 200 }
    },
    {
      trustId: 'trust-order',
      quantity: 2,
      price: { id: 'price-order-2', member_price: 200 }
    }
  );

  const initialOrder = cartUtils.readCartItems('trust-order').map((item) => item.id);

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-1',
      product_name: 'Cart Order 1',
      price: { id: 'price-order-1', member_price: 100 }
    },
    {
      trustId: 'trust-order',
      quantity: 4,
      price: { id: 'price-order-1', member_price: 100 }
    }
  );

  const items = cartUtils.readCartItems('trust-order');
  assert.deepEqual(items.map((item) => item.id), initialOrder);
  assert.equal(items.find((item) => item.id === 'cart-order-1')?.quantity, 4);
  assert.deepEqual(requests[2], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-order',
    p_action: 'upsert_purchase',
    p_payload: {
      id: 'purchase-order-1',
      status: 'add_to_cart',
      quantity: 4,
      selected_attributes: {}
    }
  });
});

test('cart add ignores a wishlist purchase id on the product object', async () => {
  createEnvironment({
    selected_trust_id: 'trust-cart-from-wishlist',
    last_selected_trust_id: 'trust-cart-from-wishlist',
    user: createUserEntry(),
    'product_cart_purchase_refs_v1_trust-cart-from-wishlist': JSON.stringify({
      'trust-cart-from-wishlist:product-from-wishlist': {
        purchase_id: 'stale-wishlist-purchase-ref',
        product_price_id: 'price-from-wishlist',
        id: 'product-from-wishlist',
        trust_id: 'trust-cart-from-wishlist'
      }
    })
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: 'cart-purchase-from-wishlist',
        product_price_id: request.p_payload.product_price_id
      }
    };
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'product-from-wishlist',
      product_id: 'product-from-wishlist',
      purchase_id: 'wishlist-purchase-should-not-be-used',
      status: 'wishlist',
      product_price_id: 'price-from-wishlist',
      product_name: 'Wishlist Product',
      price: { id: 'price-from-wishlist', member_price: 360 }
    },
    {
      trustId: 'trust-cart-from-wishlist',
      quantity: 1,
      price: { id: 'price-from-wishlist', member_price: 360 },
      ignoreStoredPurchaseRef: true
    }
  );

  assert.deepEqual(requests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-cart-from-wishlist',
    p_action: 'upsert_purchase',
    p_payload: {
      product_price_id: 'price-from-wishlist',
      type: 'cart',
      quantity: 1,
      unit_price: 360,
      status: 'add_to_cart',
      selected_attributes: {}
    }
  });

  const [item] = cartUtils.readCartItems('trust-cart-from-wishlist');
  assert.equal(item.purchase_id, 'cart-purchase-from-wishlist');
  assert.equal(item.status, 'add_to_cart');
});

test('cart mutations require API sync and do not write local-only items', async () => {
  createEnvironment({
    selected_trust_id: 'trust-blocked',
    last_selected_trust_id: 'trust-blocked',
    user: createUserEntry()
  });

  await assert.rejects(
    () => cartUtils.setCartProductQuantity(
      {
        id: 'cart-blocked',
        product_name: 'Cart Blocked',
        price: { id: 'price-blocked', member_price: 10 }
      },
      {
        trustId: 'trust-blocked',
        quantity: 1,
        price: { id: 'price-blocked', member_price: 10 }
      }
    ),
    /Cart sync is unavailable/
  );

  assert.deepEqual(cartUtils.readCartItems('trust-blocked'), []);
});

test('cart mutations require member identity and do not write local-only items', async () => {
  createEnvironment({
    selected_trust_id: 'trust-no-member',
    last_selected_trust_id: 'trust-no-member'
  });

  cartUtils.setCartPurchaseRpcOverrideForTests(async () => {
    throw new Error('RPC should not be called without a member ID');
  });

  await assert.rejects(
    () => cartUtils.setCartProductQuantity(
      {
        id: 'cart-no-member',
        product_name: 'Cart No Member',
        price: { id: 'price-no-member', member_price: 10 }
      },
      {
        trustId: 'trust-no-member',
        quantity: 1,
        price: { id: 'price-no-member', member_price: 10 }
      }
    ),
    /member profile ID/
  );

  assert.deepEqual(cartUtils.readCartItems('trust-no-member'), []);
});

test('cart remove and re-add reuse the previous purchase id', async () => {
  createEnvironment({
    selected_trust_id: 'trust-readd',
    last_selected_trust_id: 'trust-readd',
    user: createUserEntry(),
    'product_cart_v2_trust-readd': JSON.stringify([
      {
        id: 'cart-readd',
        trust_id: 'trust-readd',
        purchase_id: 'purchase-readd',
        product_price_id: 'price-readd',
        product_name: 'Cart Readd',
        quantity: 2,
        price: { id: 'price-readd', member_price: 150 }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: request.p_payload.id || 'purchase-readd',
        product_price_id: request.p_payload.product_price_id || 'price-readd'
      }
    };
  });

  await cartUtils.removeCartProduct('cart-readd', 'trust-readd');
  assert.deepEqual(cartUtils.readCartItems('trust-readd'), []);
  assert.deepEqual(requests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-readd',
    p_action: 'upsert_purchase',
    p_payload: {
      id: 'purchase-readd',
      status: 'remove_from_cart',
      quantity: 2
    }
  });

  await cartUtils.setCartProductQuantity(
    {
      id: 'cart-readd',
      product_name: 'Cart Readd',
      price: { id: 'price-readd', member_price: 150 }
    },
    {
      trustId: 'trust-readd',
      quantity: 1,
      price: { id: 'price-readd', member_price: 150 }
    }
  );

  assert.deepEqual(requests[1], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-readd',
    p_action: 'upsert_purchase',
    p_payload: {
      id: 'purchase-readd',
      status: 'add_to_cart',
      quantity: 1,
      selected_attributes: {}
    }
  });
  assert.equal(cartUtils.readCartItems('trust-readd')[0]?.purchase_id, 'purchase-readd');
});

test('cart remove can target the exact item object when product identity changed after refresh', async () => {
  createEnvironment({
    selected_trust_id: 'trust-remove-identity',
    last_selected_trust_id: 'trust-remove-identity',
    user: createUserEntry(),
    'product_cart_v2_trust-remove-identity': JSON.stringify([
      {
        key: 'trust-remove-identity:price-identity',
        id: 'price-identity',
        trust_id: 'trust-remove-identity',
        purchase_id: 'purchase-identity',
        product_price_id: 'price-identity',
        product_name: 'Identity Item',
        quantity: 1,
        price: { id: 'price-identity', member_price: 100 }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        id: request.p_payload.id,
        product_price_id: 'price-identity',
        status: request.p_payload.status
      }
    };
  });

  const target = cartUtils.readCartItems('trust-remove-identity')[0];
  const updated = await cartUtils.removeCartProduct('old-product-id', 'trust-remove-identity', { item: target });

  assert.deepEqual(updated, []);
  assert.equal(requests[0].p_payload.id, 'purchase-identity');
  assert.equal(requests[0].p_payload.status, 'remove_from_cart');
});

test('cart remove surfaces RPC error text from error field', async () => {
  createEnvironment({
    selected_trust_id: 'trust-remove-error',
    last_selected_trust_id: 'trust-remove-error',
    user: createUserEntry(),
    'product_cart_v2_trust-remove-error': JSON.stringify([
      {
        id: 'cart-remove-error',
        trust_id: 'trust-remove-error',
        purchase_id: 'purchase-remove-error',
        product_price_id: 'price-remove-error',
        product_name: 'Remove Error',
        quantity: 1,
        price: { id: 'price-remove-error', member_price: 100 }
      }
    ])
  });

  cartUtils.setCartPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: false,
      error: 'server refused removal'
    }
  }));

  await assert.rejects(
    cartUtils.removeCartProduct('cart-remove-error', 'trust-remove-error'),
    /server refused removal/
  );
  assert.equal(cartUtils.readCartItems('trust-remove-error').length, 1);
});

test('cart refresh loads active add_to_cart rows from purchase API', async () => {
  createEnvironment({
    selected_trust_id: 'trust-remote',
    last_selected_trust_id: 'trust-remote',
    user: createUserEntry(),
    'product_cart_v2_trust-remote': JSON.stringify([
      {
        id: 'stale-local',
        trust_id: 'trust-remote',
        product_name: 'Stale Local',
        quantity: 1,
        price: { id: 'stale-price', member_price: 1 }
      }
    ])
  });

  const requests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    requests.push(request);
    return {
      data: {
        success: true,
        trust_id: 'trust-remote',
        member_id: TEST_MEMBER_ID,
        purchases: [
          {
            id: 51,
            type: 'cart',
            status: 'add_to_cart',
            quantity: 2,
            trust_id: 'trust-remote',
            product_price_id: 95,
            product_id: 'remote-product',
            product_name: 'Remote Product',
            unit_price: 1080,
            tax_amount: 388.8,
            delivery_fee: 200,
            total_amount: 2748.8,
            updated_at: '2026-07-28T17:12:37.958657+05:30',
            created_at: '2026-07-28T17:12:37.958657+05:30'
          },
          {
            id: 50,
            type: 'order',
            status: 'order_payment_pending',
            quantity: 1,
            trust_id: 'trust-remote',
            product_price_id: 95,
            updated_at: '2026-07-28T17:09:39.84436+05:30'
          },
          {
            id: 47,
            type: 'cart',
            status: 'remove_from_cart',
            quantity: 1,
            trust_id: 'trust-remote',
            product_price_id: 42,
            updated_at: '2026-07-28T17:06:47.931625+05:30'
          },
          {
            id: 43,
            type: 'cart',
            status: 'add_to_cart',
            quantity: 1,
            trust_id: 'trust-remote',
            product_price_id: 95,
            updated_at: '2026-07-28T15:59:22.376437+05:30'
          }
        ]
      }
    };
  });

  const items = await cartUtils.refreshCartCache('trust-remote');

  assert.deepEqual(requests[0], {
    p_member_id: TEST_MEMBER_ID,
    p_trust_id: 'trust-remote',
    p_action: 'get',
    p_payload: {}
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'remote-product');
  assert.equal(items[0].purchase_id, '51');
  assert.equal(items[0].product_price_id, '95');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].price.price_after_discount, 1080);
  assert.equal(items[0].price.gst_amount, 194.4);
  assert.equal(items[0].price.transport_fee, 100);
  assert.equal(items[0].price.total_payable, 1374.4);
  assert.deepEqual(cartUtils.readCartItems('trust-remote').map((item) => item.id), ['remote-product']);
});

test('cart refresh enriches product display from products function by product price id', async () => {
  createEnvironment({
    selected_trust_id: 'trust-products-api',
    last_selected_trust_id: 'trust-products-api',
    user: createUserEntry()
  });

  cartUtils.setCartPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: true,
      trust_id: 'trust-products-api',
      member_id: TEST_MEMBER_ID,
      purchases: [
        {
          id: 71,
          type: 'cart',
          status: 'add_to_cart',
          quantity: 1,
          trust_id: 'trust-products-api',
          product_price_id: 61,
          unit_price: 826.2,
          tax_amount: 148.72,
          delivery_fee: 26,
          total_amount: 1000.92,
          selected_attributes: {
            size: 'M',
            color: 'white'
          },
          updated_at: '2026-07-28T18:30:00.000+05:30'
        }
      ]
    }
  }));

  const productRequests = [];
  cartUtils.setCartProductsApiOverrideForTests(async (request) => {
    productRequests.push(request);
    return {
      data: {
        success: true,
        trust_id: 'trust-products-api',
        categories: [
          {
            id: 'cat-parent',
            name: 'Clothing',
            subcategories: [
              {
                id: 'cat-coords',
                name: 'Co-Ords',
                products: [
                  {
                    id: 97,
                    product_name: 'coord2',
                    product_code: 'co-2',
                    product_type: 'Product',
                    images: [{
                      id: 108,
                      size: 41,
                      status: 'active',
                      image_url: 'https://example.com/coord2.jpg',
                      sort_order: 0
                    }],
                    attributes: {},
                    attribute_values: [
                      {
                        id: 180,
                        value: 'S,M,L',
                        status: 'active',
                        attribute_id: 60,
                        attribute_name: 'size',
                        attribute_type: 'display'
                      },
                      {
                        id: 181,
                        value: 'white',
                        status: 'active',
                        attribute_id: 62,
                        attribute_name: 'color',
                        attribute_type: 'select'
                      }
                    ],
                    prices: [
                      {
                        id: 61,
                        mrp: 918,
                        status: 'active',
                        gst_pct: 18,
                        gst_amount: 153.4,
                        billing_type: 'one_time',
                        discount_pct: 10,
                        member_price: 920,
                        total_payable: 1005.6,
                        transport_fee: 26,
                        discount_amount: 91.8,
                        price_after_discount: 826.2
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    };
  });

  const items = await cartUtils.refreshCartCache('trust-products-api');

  assert.deepEqual(productRequests[0], {
    p_trust_id: 'trust-products-api'
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '97');
  assert.equal(items[0].product_name, 'coord2');
  assert.equal(items[0].product_code, 'co-2');
  assert.equal(items[0].category_id, 'cat-coords');
  assert.equal(items[0].category_name, 'Co-Ords');
  assert.equal(items[0].images[0]?.image_url, 'https://example.com/coord2.jpg');
  assert.equal(items[0].attribute_values.length, 2);
  assert.equal(items[0].attribute_values[0]?.attribute_name, 'size');
  assert.equal(items[0].attribute_values[1]?.attribute_name, 'color');
  assert.deepEqual(items[0].selected_attributes, {
    size: 'M',
    color: 'white'
  });
  assert.equal(items[0].product_price_id, '61');
  assert.equal(items[0].purchase_id, '71');
  assert.equal(items[0].price.mrp, 918);
  assert.equal(items[0].price.discount_pct, 10);
  assert.equal(items[0].price.price_after_discount, 826.2);
  assert.equal(items[0].price.gst_amount, 148.72);
  assert.equal(items[0].price.transport_fee, 26);
  assert.equal(items[0].price.total_payable, 1000.92);
});

test('cart refresh preserves local attribute options when remote enrichment has no catalog match', async () => {
  createEnvironment({
    selected_trust_id: 'trust-local-attrs',
    last_selected_trust_id: 'trust-local-attrs',
    user: createUserEntry(),
    'product_cart_v2_trust-local-attrs': JSON.stringify([
      {
        key: 'trust-local-attrs:122',
        id: '122',
        trust_id: 'trust-local-attrs',
        product_name: 'tunic1',
        product_code: 't1',
        purchase_id: 'purchase-local-attrs',
        product_price_id: '152',
        quantity: 1,
        selected_attributes: {
          size: 'L'
        },
        attribute_values: [
          {
            attribute_name: 'size',
            value: 'S'
          },
          {
            attribute_name: 'size',
            value: 'M'
          },
          {
            attribute_name: 'size',
            value: 'L'
          }
        ],
        price: {
          id: '152',
          mrp: 400,
          discount_pct: 10,
          price_after_discount: 360,
          gst_amount: 64.8,
          total_payable: 424.8
        }
      }
    ])
  });

  cartUtils.setCartPurchaseRpcOverrideForTests(async () => ({
    data: {
      success: true,
      trust_id: 'trust-local-attrs',
      member_id: TEST_MEMBER_ID,
      purchases: [
        {
          id: 'purchase-local-attrs',
          type: 'cart',
          status: 'add_to_cart',
          quantity: 1,
          trust_id: 'trust-local-attrs',
          product_price_id: 152,
          product_name: 'tunic1',
          selected_attributes: {
            size: 'L'
          },
          unit_price: 360,
          updated_at: '2026-07-28T18:30:00.000+05:30'
        }
      ]
    }
  }));

  cartUtils.setCartProductsApiOverrideForTests(async () => ({
    data: {
      success: true,
      trust_id: 'trust-local-attrs',
      categories: []
    }
  }));

  const items = await cartUtils.refreshCartCache('trust-local-attrs');

  assert.equal(items.length, 1);
  assert.equal(items[0].id, '122');
  assert.equal(items[0].product_price_id, '152');
  assert.equal(items[0].purchase_id, 'purchase-local-attrs');
  assert.deepEqual(items[0].selected_attributes, {
    size: 'L'
  });
  assert.deepEqual(items[0].attribute_values.map((row) => row.value), ['S', 'M', 'L']);
  assert.deepEqual(cartUtils.readCartItems('trust-local-attrs')[0].attribute_values.map((row) => row.value), ['S', 'M', 'L']);
});

test('cart and wishlist preserve UUID product category and price identifiers as strings', async () => {
  const trustId = 'trust-uuid-flow';
  const productId = '550e8400-e29b-41d4-a716-446655440000';
  const categoryId = '650e8400-e29b-41d4-a716-446655440001';
  const priceId = '750e8400-e29b-41d4-a716-446655440002';
  const cartPurchaseId = '850e8400-e29b-41d4-a716-446655440003';
  const wishlistPurchaseId = '950e8400-e29b-41d4-a716-446655440004';

  createEnvironment({
    selected_trust_id: trustId,
    last_selected_trust_id: trustId,
    user: createUserEntry()
  });

  const product = {
    id: productId,
    category_id: categoryId,
    product_name: 'UUID Product',
    price: {
      id: priceId,
      member_price: 499,
      price_after_discount: 499,
      total_payable: 499
    }
  };

  const cartRequests = [];
  cartUtils.setCartPurchaseRpcOverrideForTests(async (request) => {
    cartRequests.push(request);
    return {
      data: {
        success: true,
        purchases: [{
          id: cartPurchaseId,
          type: 'cart',
          status: 'add_to_cart',
          trust_id: trustId,
          product_id: productId,
          product_price_id: request.p_payload.product_price_id,
          quantity: request.p_payload.quantity
        }]
      }
    };
  });

  await cartUtils.setCartProductQuantity(product, {
    trustId,
    categoryId,
    quantity: 2,
    price: product.price
  });

  assert.equal(cartRequests[0].p_payload.product_price_id, priceId);
  assert.equal(typeof cartRequests[0].p_payload.product_price_id, 'string');
  assert.equal(cartUtils.getCartKey(productId, trustId), `${trustId}:${productId}`);
  const [cartItem] = cartUtils.readCartItems(trustId);
  assert.equal(cartItem.id, productId);
  assert.equal(cartItem.category_id, categoryId);
  assert.equal(cartItem.product_price_id, priceId);
  assert.equal(cartItem.purchase_id, cartPurchaseId);
  assert.equal(cartItem.quantity, 2);
  assert.equal(cartUtils.getCartItemQuantity(productId, trustId), 2);

  const wishlistRequests = [];
  wishlistUtils.setWishlistPurchaseRpcOverrideForTests(async (request) => {
    wishlistRequests.push(request);
    return {
      data: {
        success: true,
        purchases: [{
          id: wishlistPurchaseId,
          type: 'wishlist',
          status: 'wishlist',
          trust_id: trustId,
          product_id: productId,
          product_price_id: request.p_payload.product_price_id,
          quantity: request.p_payload.quantity
        }]
      }
    };
  });

  const result = await wishlistUtils.addWishlistProductAsync(product, {
    trustId,
    categoryId,
    price: product.price
  });

  assert.equal(result.ok, true);
  assert.equal(wishlistRequests[0].p_payload.product_price_id, priceId);
  assert.equal(typeof wishlistRequests[0].p_payload.product_price_id, 'string');
  const [wishlistItem] = wishlistUtils.readWishlistItems(trustId);
  assert.equal(wishlistItem.id, productId);
  assert.equal(wishlistItem.category_id, categoryId);
  assert.equal(wishlistItem.product_price_id, priceId);
  assert.equal(wishlistItem.purchase_id, wishlistPurchaseId);
  assert.notEqual(wishlistItem.id, 'NaN');
  assert.notEqual(wishlistItem.product_price_id, '0');
});
