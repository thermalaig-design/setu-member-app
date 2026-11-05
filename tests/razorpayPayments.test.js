import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = (await import(pathToFileURL(require.resolve('express')))).default;
const jwt = (await import(pathToFileURL(require.resolve('jsonwebtoken')))).default;
const trustId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const ids = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
let tables, serial, orders, activationCount, failActivation, failInvoice, missingEventsTable;
let mails, pdfs, refundCalls, refundError, refundStatus;
const database = {
  from(table) {
    let action = 'select', values, single = false, filters = [], sort, limit;
    const builder = {
      select() { return this; },
      insert(value) { action = 'insert'; values = value; return this; },
      update(value) { action = 'update'; values = value; return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      neq(key, value) { filters.push((row) => row[key] !== value); return this; },
      in(key, list) { filters.push((row) => list.includes(row[key])); return this; },
      not(key, op, value) { filters.push((row) => row[key] !== value); return this; },
      or(expression) {
        filters.push((row) => expression.split(',').some((part) => {
          const [key, , value] = part.split('.'); return row[key] === value;
        })); return this;
      },
      order(key) { sort = key; return this; },
      limit(value) { limit = value; return this; },
      maybeSingle() { single = true; return this; },
      single() { single = true; return this; },
      then(resolve, reject) {
        try {
          if (table === 'razorpay_webhook_events' && missingEventsTable) {
            return resolve({ data: null, error: { code: 'PGRST205',
              message: "Could not find the table 'public.razorpay_webhook_events' in the schema cache" } });
          }
          const source = tables[table] ||= [];
          let selected = source.filter((row) => filters.every((filter) => filter(row)));
          if (sort) selected.sort((a, b) => String(b[sort]).localeCompare(String(a[sort])));
          if (limit) selected = selected.slice(0, limit);
          if (action === 'insert') {
            selected = [{ id: `row-${++serial}`, ...structuredClone(values) }];
            source.push(...selected);
          } else if (action === 'update') {
            if ((table === 'product_payments' && values.status === 'success' && failActivation)
                || (table === 'product_invoices' && values.status === 'paid' && failInvoice)) {
              return resolve({ data: null, error: { message: 'SUBSCRIPTION_CONFIG_NOT_FOUND' } });
            }
            for (const row of selected) {
              if (table === 'product_payments' && values.status === 'success' && row.status === 'pending') {
                activationCount++;
                const invoice = tables.product_invoices.find((item) => item.id === row.invoice_id);
                const purchase = tables.product_purchases.find((item) => item.id === invoice?.purchase_id);
                if (purchase) purchase.status = 'order_payment_done';
              }
              Object.assign(row, structuredClone(values));
            }
          }
          resolve({ data: structuredClone(single ? selected[0] || null : selected), error: null });
        } catch (error) { reject(error); }
      },
    };
    return builder;
  },
};
class Razorpay {
  orders = { create: async (payload) => {
    const order = { ...payload, id: `order_${orders.length + 1}` };
    if (payload.transfers) order.transfers = payload.transfers.map((t, i) => ({ ...t, id: `trf_mock${i}` }));
    orders.push(order); return order;
  } };
  payments = {
    fetch: async (id) => ({ id, order_id: orders.at(-1).id, amount: orders.at(-1).amount, status: 'authorized', method: 'upi' }),
    capture: async (id, amount) => ({ id, amount, order_id: orders.at(-1).id, status: 'captured', method: 'upi' }),
    refund: async (id, payload) => {
      refundCalls.push({ id, payload });
      if (refundError) throw refundError;
      return { id: `rfnd_${refundCalls.length}`, payment_id: id, amount: payload.amount, status: refundStatus, created_at: 1790000000 };
    },
  };
}
globalThis.__rzpTest = { database, Razorpay, express, jwt,
  mail: { sendAdminAlertEmail: async (mail) => { mails.push(mail); return { sent: true }; } },
  invoicePdf: {
    generateAndStoreInvoicePdf: async (id) => { pdfs.push(id); },
    getInvoiceSignedUrl: async (id) => `https://signed.test/${id}.pdf`,
  } };
const load = (source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let source = await readFile(new URL('../backend/services/razorpayRouteService.js', import.meta.url), 'utf8');
source = source.replace("import Razorpay from 'razorpay';", 'const { Razorpay } = globalThis.__rzpTest;')
  .replace("import { paymentSupabase } from '../config/supabase.js';", 'const paymentSupabase = globalThis.__rzpTest.database;')
  .replace("import { sendAdminAlertEmail } from './emailService.js';", 'const { sendAdminAlertEmail } = globalThis.__rzpTest.mail;')
  .replace("import { generateAndStoreInvoicePdf, getInvoiceSignedUrl } from './invoicePdfService.js';",
    'const { generateAndStoreInvoicePdf, getInvoiceSignedUrl } = globalThis.__rzpTest.invoicePdf;');
const service = await load(source);
globalThis.__rzpTest.service = service;
source = await readFile(new URL('../backend/middleware/memberAuth.js', import.meta.url), 'utf8');
source = source.replace("import jwt from 'jsonwebtoken';", 'const { jwt } = globalThis.__rzpTest;')
  .replace("import { supabase } from '../config/supabase.js';", 'const supabase = globalThis.__rzpTest.database;');
globalThis.__rzpTest.auth = await load(source);
source = await readFile(new URL('../backend/routes/paymentRoutes.js', import.meta.url), 'utf8');
source = source.replace("import express from 'express';", 'const { express } = globalThis.__rzpTest;')
  .replace("import { requireMemberSession, memberBelongsToSession } from '../middleware/memberAuth.js';", 'const { requireMemberSession, memberBelongsToSession } = globalThis.__rzpTest.auth;')
  .replace("import { supabase } from '../config/supabase.js';", 'const supabase = globalThis.__rzpTest.database;')
  .replace(/import \{([\s\S]*?)\} from '..\/services\/razorpayRouteService.js';/, 'const {$1} = globalThis.__rzpTest.service;');
const routes = await load(source);
let server, url;
const envKeys = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SETU_SESSION_SECRET'];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
before(async () => {
  Object.assign(process.env, { RAZORPAY_KEY_ID: 'rzp_test_mock', RAZORPAY_KEY_SECRET: 'test-key',
    RAZORPAY_WEBHOOK_SECRET: 'test-webhook', SETU_SESSION_SECRET: 'test-session' });
  const app = express();
  app.post('/api/payments/webhook', express.raw({ type: '*/*' }), routes.razorpayWebhookHandler);
  app.use(express.json()); app.use('/api/payments', routes.default);
  server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  url = `http://127.0.0.1:${server.address().port}/api/payments`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  delete globalThis.__rzpTest;
});
const reset = (route = true, count = 1) => {
  serial = 0; orders = []; activationCount = 0; failActivation = false; failInvoice = false;
  missingEventsTable = false; mails = []; pdfs = []; refundCalls = []; refundError = null; refundStatus = 'processed';
  tables = {
    Trust: [{ id: trustId, name: 'Setu AI', payment_gateway: true, razorpay_route: route }],
    trust_bank_details: [{ trust_id: trustId, razorpay_id: 'acc_test', vendor_share: 98, updated_at: '2026-10-24' }],
    product_purchases: ids.slice(0, count).map((id, i) => ({ id, member_id: memberId, trust_id: trustId,
      type: 'order', status: 'order_payment_pending', quantity: i ? 1 : 2,
      product_price: { mrp: 100, price_after_discount: 80, gst_pct: 5, gst_amount: 4,
        transport_fee: 1, total_payable: 85.01, product_catalog: { product_name: i ? 'Yearly Subscription' : 'Product' } },
    })), product_invoices: [], product_payments: [], Members: [],
  };
};
const token = () => jwt.sign({ purpose: 'setu_member_session', memberId, phone: '9999999999' }, process.env.SETU_SESSION_SECRET);
const post = async (path, body, auth = true) => {
  const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(auth ? { Authorization: `Bearer ${token()}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const checkout = () => post('/create-order', { trust_id: trustId, purchase_ids: tables.product_purchases.map((row) => row.id) });
const captured = (order) => ({ id: 'pay_test', order_id: order.order_id, amount: order.amount, method: 'upi', status: 'captured' });
const webhook = async (event, entity, eventId = 'event1', valid = true) => {
  const body = JSON.stringify({ event, payload: { [event.split('.')[0] === 'order' ? 'payment' : event.split('.')[0]]: { entity } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  return fetch(url + '/webhook', { method: 'POST', body, headers: { 'Content-Type': 'application/json',
    'x-razorpay-signature': valid ? signature : '00', 'x-razorpay-event-id': eventId } });
};

test('1: UPI capture records paid invoice and 98% Route transfer', async () => {
  reset(); const { body } = await checkout();
  assert.equal((await webhook('payment.captured', captured(body))).status, 200);
  const row = tables.product_payments[0];
  assert.equal(row.status, 'success'); assert.equal(row.payment_mode, 'upi');
  assert.equal(row.transaction_id, 'pay_test'); assert.equal(tables.product_invoices[0].status, 'paid');
  assert.match(tables.product_invoices[0].invoice_number, /^RZP-\d{6}-[a-f0-9]{8}$/);
  assert.equal(orders[0].transfers[0].amount, Math.floor(body.amount * .98));
  assert.equal((await webhook('transfer.processed', { id: 'trf_test', source: 'pay_test' }, 'transfer1')).status, 200);
  assert.equal(row.transfer_status, 'processed'); assert.equal(row.gateway_transfer_id, 'trf_test');
});
test('2: mixed cart uses one order and shared transaction across invoice rows', async () => {
  reset(true, 2); const { body } = await checkout();
  assert.equal(body.amount, 8501 * 3); assert.equal(orders.length, 1);
  await webhook('payment.captured', captured(body));
  assert.equal(tables.product_invoices.length, 2); assert.equal(activationCount, 2);
  assert.ok(tables.product_payments.every((row) => row.transaction_id === 'pay_test' && row.gateway_order_id === body.order_id));
});
test('3: client amount is ignored and unit paise are rounded before quantity', async () => {
  reset(); tables.product_purchases[0].product_price.total_payable = 85.005;
  const { body } = await post('/create-order', { trust_id: trustId, purchase_ids: [ids[0]], amount: 1, price: .01 });
  assert.equal(body.amount, Math.round(85.005 * 100) * 2);
});
test('4: checkout retry supersedes pending rows; same-order recording is retry safe', async () => {
  reset(); const first = await checkout(); const second = await checkout();
  assert.equal(tables.product_payments[0].status, 'failed');
  assert.equal(tables.product_payments[0].gateway_payload.superseded_by, second.body.order_id);
  const quote = await service.quoteCheckout({ trustId, purchaseIds: [ids[0]] });
  await service.recordPendingOrder({ quote, order: orders[1] });
  assert.equal(tables.product_payments.length, 2); assert.equal(tables.product_invoices.length, 1);
  assert.equal(tables.product_purchases.length, 1); assert.notEqual(first.body.order_id, second.body.order_id);
});
test('5: signed webhook settles without calling verify-payment', async () => {
  reset(); const { body } = await checkout();
  await webhook('order.paid', captured(body)); assert.equal(activationCount, 1);
  assert.equal(tables.product_payments[0].status, 'success');
});
test('6: duplicate capture and non-capture events are harmless', async () => {
  reset(); const { body } = await checkout();
  await webhook('payment.failed', { ...captured(body), error_code: 'BAD_REQUEST_ERROR' }, 'failure1');
  assert.equal(tables.product_payments[0].status, 'pending');
  const snapshot = structuredClone(tables.product_payments);
  await webhook('payment.failed', { ...captured(body), error_code: 'changed' }, 'failure1');
  assert.deepEqual(tables.product_payments, snapshot);
  await webhook('payment.captured', captured(body));
  assert.equal((await webhook('payment.captured', captured(body))).status, 200);
  assert.equal(activationCount, 1);
});
test('7: wrong webhook/checkout signatures return 400; valid verify fetches and captures', async () => {
  reset(); const { body } = await checkout();
  assert.equal((await webhook('payment.captured', captured(body), 'bad', false)).status, 400);
  const request = { razorpay_order_id: body.order_id, razorpay_payment_id: 'pay_test', razorpay_signature: '00' };
  assert.equal((await post('/verify-payment', request)).status, 400);
  request.razorpay_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${body.order_id}|pay_test`).digest('hex');
  assert.equal((await post('/verify-payment', request)).body.status, 'paid');
});
test('8: missing session returns 401; another member returns 403 before gateway call', async () => {
  reset(); const request = { trust_id: trustId, purchase_ids: [ids[0]] };
  assert.equal((await post('/create-order', request, false)).status, 401);
  tables.product_purchases[0].member_id = ids[1];
  assert.equal((await post('/create-order', request)).status, 403); assert.equal(orders.length, 0);
});
test('9: Route disabled creates no transfer and leaves transfer_status null', async () => {
  reset(false); const { body } = await checkout();
  assert.equal(orders[0].transfers, undefined); assert.equal(tables.product_payments[0].transfer_status, null);
  await webhook('payment.captured', captured(body)); assert.equal(tables.product_payments[0].transfer_status, null);
});
test('10: transfer.failed stores the full entity with reason and flags the payment', async () => {
  reset(); const { body } = await checkout();
  await webhook('payment.captured', captured(body));
  const failedTransfer = { id: 'trf_fail', source: 'pay_test', recipient: 'acc_test', amount: 8330,
    status: 'failed', failure_reason: 'Beneficiary account blocked', error: { code: 'BAD_REQUEST_ERROR' } };
  assert.equal((await webhook('transfer.failed', failedTransfer, 'transfer-fail')).status, 200);
  const row = tables.product_payments[0];
  assert.equal(row.transfer_status, 'failed'); assert.equal(row.gateway_transfer_id, 'trf_fail');
  assert.equal(row.gateway_payload.transfer.failure_reason, 'Beneficiary account blocked');
  assert.equal(row.gateway_payload.needs_attention, true);
  assert.equal(row.gateway_payload.transfer_failure.failure_reason, 'Beneficiary account blocked');
});
test('11: duplicate event id is skipped; transfer event before capture is parked then replayed', async () => {
  reset(); const { body } = await checkout();
  const failedTransfer = { id: 'trf_early', source: 'pay_test', status: 'failed', failure_reason: 'early' };
  assert.equal((await webhook('transfer.failed', failedTransfer, 'early1')).status, 200);
  assert.equal(tables.product_payments[0].transfer_status, 'pending');
  assert.equal(tables.razorpay_webhook_events[0].status, 'pending_match');
  await webhook('payment.captured', captured(body), 'cap1');
  assert.equal(tables.product_payments[0].transfer_status, 'failed');
  assert.equal(tables.razorpay_webhook_events.find((e) => e.event_id === 'early1').status, 'processed');
  const snapshot = structuredClone(tables.product_payments);
  assert.equal((await webhook('payment.captured', captured(body), 'cap1')).status, 200);
  assert.deepEqual(tables.product_payments, snapshot); assert.equal(activationCount, 1);
});
test('create-order stores the Route transfer id from the order', async () => {
  reset(); await checkout();
  const row = tables.product_payments[0];
  assert.equal(row.gateway_transfer_id, 'trf_mock0'); assert.equal(row.transfer_status, 'pending');
  reset(false); await checkout();
  assert.equal(tables.product_payments[0].gateway_transfer_id, null);
});
test('webhooks work when razorpay_webhook_events table is missing', async () => {
  reset(); missingEventsTable = true; const { body } = await checkout();
  assert.equal((await webhook('payment.captured', captured(body), 'cap-nolog')).status, 200);
  assert.equal((await webhook('transfer.processed', { id: 'trf_test', source: 'pay_test' }, 'trf-nolog')).status, 200);
  const row = tables.product_payments[0];
  assert.equal(row.status, 'success'); assert.equal(row.last_webhook_event_id, 'trf-nolog');
  assert.equal(row.gateway_transfer_id, 'trf_test'); assert.equal(row.transfer_status, 'processed');
  assert.equal(tables.razorpay_webhook_events, undefined);
});
test('permanent errors return 200, transient errors 500, activation errors stay pending', async () => {
  reset(); const { body } = await checkout();
  assert.equal((await webhook('payment.captured', { ...captured(body), order_id: 'order_unknown' })).status, 200);
  assert.equal((await webhook('payment.captured', { ...captured(body), amount: 1 })).status, 200);
  failActivation = true;
  await webhook('payment.captured', captured(body));
  assert.equal(tables.product_payments[0].status, 'pending');
  assert.equal(tables.product_payments[0].gateway_payload.activation_error, 'SUBSCRIPTION_CONFIG_NOT_FOUND');
  assert.equal(tables.product_payments[0].gateway_payload.captured_payment_id, 'pay_test');
  failActivation = false; failInvoice = true;
  assert.equal((await webhook('payment.captured', captured(body))).status, 500);
  failInvoice = false;
  assert.equal((await webhook('payment.captured', captured(body))).status, 200);
  assert.equal(tables.product_invoices[0].status, 'paid');
});
test('quote rejects disabled gateway, unavailable items, mixed members and invalid Route configuration', async () => {
  const quote = () => service.quoteCheckout({ trustId, purchaseIds: tables.product_purchases.map((row) => row.id) });
  reset(); tables.Trust[0].payment_gateway = false;
  await assert.rejects(quote, { code: 'PAYMENT_GATEWAY_DISABLED' });
  reset(); tables.product_purchases[0].status = 'order_payment_done';
  await assert.rejects(quote, { code: 'PURCHASES_NOT_PAYABLE' });
  reset(true, 2); tables.product_purchases[1].member_id = ids[1];
  await assert.rejects(quote, { code: 'PURCHASES_BELONG_TO_MULTIPLE_MEMBERS' });
  reset(); tables.trust_bank_details[0].vendor_share = 0;
  await assert.rejects(quote, { code: 'VENDOR_SHARE_NOT_CONFIGURED' });
  reset(); tables.trust_bank_details[0].razorpay_id = 'invalid';
  await assert.rejects(quote, { code: 'LINKED_ACCOUNT_INVALID' });
  reset(); tables.product_purchases[0].product_price.total_payable = .01;
  await assert.rejects(quote, { code: 'AMOUNT_TOO_SMALL' });
});

test('client checkout dismissal returns PAYMENT_CANCELLED and retains pending purchases', async () => {
  reset();
  const savedWindow = globalThis.window;
  const savedStorage = globalThis.localStorage;
  globalThis.__rzpTest.api = {
    post: async (path, body) => ({ data: (await post(path.replace('/payments', ''), body)).body }),
  };
  globalThis.localStorage = { getItem: () => token() };
  globalThis.window = { Razorpay: class {
    constructor(options) { this.options = options; }
    open() { this.options.modal.ondismiss(); }
  } };
  try {
    const clientSource = (await readFile(new URL('../src/services/paymentService.js', import.meta.url), 'utf8'))
      .replace("import { Capacitor, registerPlugin } from '@capacitor/core';", "const Capacitor = { getPlatform: () => 'web' }; const registerPlugin = () => ({});")
      .replace("import { track } from './analytics';", 'const track = () => {};')
      .replace("import { api } from './api';", 'const { api } = globalThis.__rzpTest;');
    const client = await load(clientSource);
    await assert.rejects(() => client.openRazorpayCheckout({ trustId, purchaseIds: [ids[0]] }), { code: 'PAYMENT_CANCELLED' });
    assert.equal(tables.product_purchases.length, 1);
    assert.equal(tables.product_purchases[0].status, 'order_payment_pending');
    assert.equal(tables.product_payments[0].status, 'pending');
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    if (savedStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = savedStorage;
    delete globalThis.__rzpTest.api;
  }
});

const paidCheckout = async () => {
  reset(); const { body } = await checkout();
  await webhook('payment.captured', captured(body), 'cap-paid');
  return body;
};
const failedTransfer = { id: 'trf_fail', source: 'pay_test', recipient: 'acc_test', amount: 8330,
  status: 'failed', failure_reason: 'Beneficiary account blocked' };
const refundEntity = (overrides = {}) => ({ id: 'rfnd_1', payment_id: 'pay_test', amount: 17002, status: 'processed', ...overrides });

test('transfer.failed on an activated purchase flags it, keeps the purchase and emails the admin once', async () => {
  const order = await paidCheckout();
  await webhook('transfer.failed', failedTransfer, 'tf1');
  const row = tables.product_payments[0];
  assert.equal(row.transfer_status, 'failed'); assert.equal(row.gateway_payload.needs_attention, true);
  assert.equal(row.gateway_payload.purchase_hold, undefined);
  assert.equal(tables.product_purchases[0].status, 'order_payment_done');
  assert.equal(mails.length, 1);
  for (const expected of ['pay_test', order.order_id, 'trf_fail', '83.30', 'Beneficiary account blocked']) {
    assert.ok(mails[0].text.includes(expected), `alert should mention ${expected}`);
  }
  await webhook('transfer.failed', failedTransfer, 'tf2'); // same failure redelivered under a new event id
  assert.equal(mails.length, 1);
});

test('transfer.failed before activation holds the purchase without changing its status', async () => {
  reset(); await checkout();
  tables.product_payments[0].transaction_id = 'pay_test'; // payment known, purchase not activated
  await webhook('transfer.failed', failedTransfer, 'tf-hold');
  const payload = tables.product_payments[0].gateway_payload;
  assert.equal(payload.purchase_hold, true); assert.equal(payload.needs_attention, undefined);
  assert.equal(tables.product_purchases[0].status, 'order_payment_pending');
  assert.equal(mails.length, 1);
});

test('transfer.processed after transfer.failed clears the flags and keeps other payload keys', async () => {
  await paidCheckout();
  await webhook('transfer.failed', failedTransfer, 'tf1');
  await webhook('transfer.processed', { id: 'trf_fail', source: 'pay_test', recipient: 'acc_test', amount: 8330, status: 'processed' }, 'tf-ok');
  const row = tables.product_payments[0];
  assert.equal(row.transfer_status, 'processed');
  for (const key of ['needs_attention', 'purchase_hold', 'transfer_failure']) assert.equal(row.gateway_payload[key], undefined);
  assert.ok(row.gateway_payload.order && row.gateway_payload.split && row.gateway_payload.payment);
});

test('full refund marks payment refunded and cancels purchase and invoice, with reverse_all', async () => {
  await paidCheckout();
  const result = await service.refundPayment({ paymentId: 'pay_test', requestedBy: 'admin@x.com' });
  assert.equal(refundCalls[0].payload.reverse_all, 1); assert.equal(refundCalls[0].payload.amount, 17002);
  assert.equal(result.fully_refunded, true);
  const row = tables.product_payments[0];
  assert.equal(row.status, 'refunded');
  assert.deepEqual(Object.keys(row.gateway_payload.refund).sort(), ['amount', 'created_at', 'id', 'status']);
  assert.equal(row.gateway_payload.refund.status, 'processed');
  assert.equal(tables.product_invoices[0].status, 'cancelled'); assert.equal(tables.product_purchases[0].status, 'cancelled');
  await assert.rejects(() => service.refundPayment({ paymentId: 'pay_test' }), { code: 'REFUND_ALREADY_REFUNDED' });
});

test('partial refund keeps the payment successful until the remainder is refunded', async () => {
  await paidCheckout();
  await assert.rejects(() => service.refundPayment({ paymentId: 'pay_test', amountRupees: 500 }), { code: 'REFUND_AMOUNT_INVALID' });
  const first = await service.refundPayment({ paymentId: 'pay_test', amountRupees: 50 });
  assert.equal(first.fully_refunded, false);
  const row = tables.product_payments[0];
  assert.equal(row.status, 'success'); assert.equal(row.gateway_payload.refund.amount, 5000);
  assert.equal(tables.product_invoices[0].status, 'paid'); assert.equal(tables.product_purchases[0].status, 'order_payment_done');
  assert.ok(row.gateway_payload.order, 'older payload keys survive');
  await assert.rejects(() => service.refundPayment({ paymentId: 'pay_test', amountRupees: 120.03 }), { code: 'REFUND_AMOUNT_INVALID' });
  const second = await service.refundPayment({ paymentId: 'pay_test' }); // remaining Rs. 120.02
  assert.equal(refundCalls[1].payload.amount, 12002); assert.equal(second.fully_refunded, true);
  assert.equal(row.status, 'refunded'); assert.equal(row.gateway_payload.refund_history.length, 2);
});

test('pending refund completes on refund.processed webhook; redelivery is harmless', async () => {
  await paidCheckout(); refundStatus = 'pending';
  await service.refundPayment({ paymentId: 'pay_test' });
  const row = tables.product_payments[0];
  assert.equal(row.status, 'success'); assert.equal(row.gateway_payload.refund.status, 'pending');
  assert.equal((await webhook('refund.processed', refundEntity(), 'rf-ok')).status, 200);
  assert.equal(row.status, 'refunded'); assert.equal(row.gateway_payload.refund.status, 'processed');
  assert.equal(tables.product_purchases[0].status, 'cancelled');
  const snapshot = structuredClone(tables.product_payments);
  assert.equal((await webhook('refund.processed', refundEntity(), 'rf-ok')).status, 200);
  assert.deepEqual(tables.product_payments, snapshot);
});

test('refund.failed keeps the payment successful, records the failure, alerts admin and allows a retry', async () => {
  await paidCheckout(); refundStatus = 'pending';
  await service.refundPayment({ paymentId: 'pay_test' });
  assert.equal((await webhook('refund.failed', refundEntity({ status: 'failed' }), 'rf-fail')).status, 200);
  const row = tables.product_payments[0];
  assert.equal(row.status, 'success'); assert.equal(row.gateway_payload.refund.status, 'failed');
  assert.equal(row.gateway_payload.refund_failure.id, 'rfnd_1');
  assert.equal(tables.product_invoices[0].status, 'paid'); assert.equal(tables.product_purchases[0].status, 'order_payment_done');
  assert.equal(mails.length, 1); assert.ok(mails[0].text.includes('rfnd_1'));
  refundStatus = 'processed';
  assert.equal((await service.refundPayment({ paymentId: 'pay_test' })).fully_refunded, true);
});

test('Razorpay rejecting a refund leaves the database untouched', async () => {
  await paidCheckout(); refundError = { error: { description: 'The payment has been fully refunded already' } };
  const before = structuredClone(tables);
  await assert.rejects(() => service.refundPayment({ paymentId: 'pay_test' }), (error) => error === refundError);
  assert.deepEqual(tables, before);
  await assert.rejects(() => service.refundPayment({ paymentId: 'pay_unknown' }), { code: 'REFUND_PAYMENT_NOT_FOUND' });
});

test('successful payment stores an invoice PDF; admin refund endpoint requires admin auth', async () => {
  await paidCheckout();
  assert.deepEqual(pdfs, [tables.product_invoices[0].id]);
  const adminSource = (await readFile(new URL('../backend/routes/adminPaymentRoutes.js', import.meta.url), 'utf8'))
    .replace("import express from 'express';", 'const { express } = globalThis.__rzpTest;')
    .replace("import { authenticateAdmin } from '../middleware/adminAuth.js';",
      "const authenticateAdmin = (req, res, next) => (req.headers['x-test-admin'] ? next() : res.status(401).json({ success: false }));")
    .replace(/import \{([\s\S]*?)\} from '..\/services\/razorpayRouteService.js';/, 'const {$1} = globalThis.__rzpTest.service;');
  const adminRoutes = await load(adminSource);
  const app = express(); app.use(express.json()); app.use('/admin', adminRoutes.default);
  const listener = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  try {
    const call = (body, admin = true) => fetch(`http://127.0.0.1:${listener.address().port}/admin/refund`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-test-admin': '1' } : {}) }, body: JSON.stringify(body) });
    assert.equal((await call({ payment_id: 'pay_test' }, false)).status, 401); assert.equal(refundCalls.length, 0);
    assert.equal((await call({ payment_id: 'bad' })).status, 400);
    assert.equal((await call({ payment_id: 'pay_test', amount: -5 })).status, 400);
    const ok = await call({ payment_id: 'pay_test', amount: 50 });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).fully_refunded, false);
  } finally { await new Promise((resolve) => listener.close(resolve)); }
});
