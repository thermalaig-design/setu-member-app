import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

const NativeWindow = globalThis.window;
const NativeLocalStorage = globalThis.localStorage;
const NativeCustomEvent = globalThis.CustomEvent;

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

after(() => {
  globalThis.window = NativeWindow;
  globalThis.localStorage = NativeLocalStorage;
  if (NativeCustomEvent) globalThis.CustomEvent = NativeCustomEvent;
  else delete globalThis.CustomEvent;
});

test('cart and wishlist stay isolated per trust and restore on trust switch', () => {
  const cartEnv = createEnvironment({
    selected_trust_id: 'trust-1',
    last_selected_trust_id: 'trust-1',
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

  cartUtils.setCartProductQuantity(
    {
      id: 'cart-trust-2-new',
      product_name: 'Trust 2 Added',
      price: { mrp: 300, member_price: 240 }
    },
    {
      trustId: 'trust-2',
      quantity: 3,
      price: { mrp: 300, member_price: 240 }
    }
  );

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

test('cart quantity updates preserve item order', () => {
  createEnvironment({
    selected_trust_id: 'trust-order',
    last_selected_trust_id: 'trust-order'
  });

  cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-1',
      product_name: 'Cart Order 1'
    },
    {
      trustId: 'trust-order',
      quantity: 1
    }
  );

  cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-2',
      product_name: 'Cart Order 2'
    },
    {
      trustId: 'trust-order',
      quantity: 2
    }
  );

  const initialOrder = cartUtils.readCartItems('trust-order').map((item) => item.id);

  cartUtils.setCartProductQuantity(
    {
      id: 'cart-order-1',
      product_name: 'Cart Order 1'
    },
    {
      trustId: 'trust-order',
      quantity: 4
    }
  );

  const items = cartUtils.readCartItems('trust-order');
  assert.deepEqual(items.map((item) => item.id), initialOrder);
  assert.equal(items.find((item) => item.id === 'cart-order-1')?.quantity, 4);
});
