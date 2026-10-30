import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const source = await readFile(new URL('../src/services/paymentService.js', import.meta.url), 'utf8');

async function runCheckout({ status = 'paid', cancel = false, repeat = false, verifyFails = false } = {}) {
  const events = [];
  const order = {
    success: true, order_id: 'order_test', key_id: 'public_test',
    amount: 12345, total_amount: 123.45, currency: 'INR',
  };
  const api = {
    post: async (path) => {
      if (path.endsWith('create-order')) return { data: order };
      if (verifyFails) throw new Error('Temporary verification failure');
      return { data: { success: true, verified: true, status } };
    },
    get: async () => ({ data: { status } }),
  };
  globalThis.__paymentAnalyticsTest = { api, track: (name, params) => events.push({ name, params }) };
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => 'test-session' };
  globalThis.window = {
    Razorpay: class {
      constructor(options) { this.options = options; }
      open() {
        if (cancel) return this.options.modal.ondismiss();
        void (async () => {
          const response = { razorpay_payment_id: 'payment_test' };
          await this.options.handler(response);
          if (repeat) await this.options.handler(response);
        })();
      }
    },
  };
  try {
    const isolatedSource = source
      .replace("import { api } from './api';", 'const { api } = globalThis.__paymentAnalyticsTest;')
      .replace("import { track } from './analytics';", 'const { track } = globalThis.__paymentAnalyticsTest;')
      .replace('const STATUS_POLL_INTERVAL_MS = 2500;', 'const STATUS_POLL_INTERVAL_MS = 0;');
    const service = await import(`data:text/javascript;base64,${Buffer.from(isolatedSource).toString('base64')}#${Math.random()}`);
    const result = await service.openRazorpayCheckout({ trustId: 'trust_test', purchaseIds: ['purchase_test'] });
    // Allow a repeated gateway callback to finish before checking deduplication.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { result, events };
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    delete globalThis.__paymentAnalyticsTest;
  }
}

test('confirmed payment records one purchase with the server total in currency units', async () => {
  const { result, events } = await runCheckout({ repeat: true });
  assert.equal(result.status, 'paid');
  assert.deepEqual(events, [{ name: 'purchase', params: {
    transaction_id: 'order_test', currency: 'INR', value: 123.45,
  } }]);
});

for (const status of ['processing', 'paid_needs_attention']) {
  test(`${status} does not record a purchase`, async () => {
    const { result, events } = await runCheckout({ status });
    assert.equal(result.status, status);
    assert.deepEqual(events, []);
  });
}

test('server status recovery records a purchase after verification fails', async () => {
  const { result, events } = await runCheckout({ verifyFails: true });
  assert.equal(result.status, 'paid');
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'purchase');
});

test('dismissed checkout retains its cancellation behavior', async () => {
  await assert.rejects(runCheckout({ cancel: true }), { code: 'PAYMENT_CANCELLED' });
});
