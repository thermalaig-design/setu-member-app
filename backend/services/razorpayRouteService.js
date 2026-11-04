/* global process, Buffer */
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { paymentSupabase } from '../config/supabase.js';

const db = () => {
  if (!paymentSupabase) {
    throw new PaymentError('Payment database is not configured.', 503, 'PAYMENT_DATABASE_NOT_CONFIGURED');
  }
  return paymentSupabase;
};

export class PaymentError extends Error {
  constructor(message, status = 400, code = 'PAYMENT_ERROR') {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
    this.code = code;
  }
}

const DB_ERROR_MESSAGES = {
  PAYMENT_GATEWAY_DISABLED: 'Online payment is not enabled for this trust.',
  LINKED_ACCOUNT_NOT_CONFIGURED: 'Online payment is not set up for this trust yet. Please contact the trust.',
  LINKED_ACCOUNT_INVALID: 'Online payment is not set up correctly for this trust. Please contact the trust.',
  VENDOR_SHARE_NOT_CONFIGURED: 'Online payment is not set up correctly for this trust. Please contact the trust.',
  PURCHASES_NOT_PAYABLE: 'Some items in your order are no longer payable. Please refresh your cart and try again.',
  PURCHASES_BELONG_TO_MULTIPLE_MEMBERS: 'These items belong to different members and cannot be paid together.',
  PURCHASE_ALREADY_PAID: 'One or more items in this order are already paid.',
  AMOUNT_TOO_SMALL: 'Order amount must be at least Rs. 1.',
  AMOUNT_MISMATCH: 'The order amount changed. Please refresh and try again.',
  TRUST_NOT_FOUND: 'Trust not found.',
};

/** Convert known database exceptions into a PaymentError. */
export const mapDbError = (error) => {
  const raw = String(error?.message || '');
  const code = Object.keys(DB_ERROR_MESSAGES).find((key) => raw.startsWith(key));
  if (code) return new PaymentError(DB_ERROR_MESSAGES[code], 409, code);
  return error;
};

let razorpayClient = null;
export const getRazorpay = () => {
  if (razorpayClient) return razorpayClient;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new PaymentError('Payment gateway is not configured on the server.', 503, 'GATEWAY_NOT_CONFIGURED');
  }
  razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return razorpayClient;
};

export const getPublicKeyId = () => {
  getRazorpay();
  return process.env.RAZORPAY_KEY_ID;
};

const query = async (request) => {
  const { data, error } = await request;
  if (error) throw mapDbError(error);
  return data;
};

const reject = (code) => { throw new PaymentError(DB_ERROR_MESSAGES[code] || code, 409, code); };
const paise = (value) => Math.round(Number(value) * 100);

export const quoteCheckout = async ({ trustId, purchaseIds }) => {
  const trust = await query(db().from('Trust')
    .select('id, name, payment_gateway, razorpay_route').eq('id', trustId).maybeSingle());
  if (!trust) reject('TRUST_NOT_FOUND');
  if (trust.payment_gateway !== true) reject('PAYMENT_GATEWAY_DISABLED');
  const purchases = await query(db().from('product_purchases')
    .select('id, member_id, trust_id, type, status, quantity, product_price:product_price_id(mrp, price_after_discount, member_price, gst_pct, gst_amount, transport_fee, total_payable, product_catalog:product_id(product_name))')
    .in('id', purchaseIds).eq('trust_id', trustId).eq('type', 'order').eq('status', 'order_payment_pending'));
  if (!purchaseIds.length || purchases.length !== purchaseIds.length) reject('PURCHASES_NOT_PAYABLE');
  if (!purchases[0].member_id || new Set(purchases.map((row) => row.member_id)).size !== 1) {
    reject('PURCHASES_BELONG_TO_MULTIPLE_MEMBERS');
  }
  const lines = purchases.map((row) => {
    const price = row.product_price;
    const quantity = Number(row.quantity);
    if (!price || !Number.isSafeInteger(quantity) || quantity < 1 || price.total_payable == null) {
      reject('PURCHASES_NOT_PAYABLE');
    }
    const unitPaise = paise(price.total_payable);
    const linePaise = unitPaise * quantity;
    if (!Number.isSafeInteger(linePaise) || linePaise < 0) reject('PURCHASES_NOT_PAYABLE');
    const base = Number(price.price_after_discount) || Number(price.member_price) || Number(price.mrp) || 0;
    const tax = Number(price.gst_amount) || base * (Number(price.gst_pct) || 0) / 100;
    const transport = Number(price.transport_fee) || 0;
    if (![base, tax, transport].every((value) => Number.isFinite(value) && value >= 0)) reject('PURCHASES_NOT_PAYABLE');
    return {
      purchase_id: row.id, product_name: price.product_catalog?.product_name,
      quantity, unit_price: base, subtotal: paise(base) * quantity / 100,
      tax_amount: paise(tax) * quantity / 100, transport_fee: paise(transport) * quantity / 100,
      total_amount: linePaise / 100, amount_paise: linePaise,
    };
  });
  const totalPaise = lines.reduce((sum, line) => sum + line.amount_paise, 0);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 100) reject('AMOUNT_TOO_SMALL');
  let linkedAccountId = null;
  let vendorShare = 0;
  if (trust.razorpay_route === true) {
    const bank = await query(db().from('trust_bank_details').select('razorpay_id, vendor_share')
      .eq('trust_id', trustId).not('razorpay_id', 'is', null)
      .order('updated_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle());
    if (!bank) reject('LINKED_ACCOUNT_NOT_CONFIGURED');
    if (!/^acc_/.test(bank.razorpay_id)) reject('LINKED_ACCOUNT_INVALID');
    vendorShare = Number(bank.vendor_share);
    if (!Number.isFinite(vendorShare) || vendorShare < 1 || vendorShare > 100) reject('VENDOR_SHARE_NOT_CONFIGURED');
    linkedAccountId = bank.razorpay_id;
  }
  const transferPaise = Math.floor(totalPaise * vendorShare / 100);
  return {
    trust_id: trustId, trust_name: trust.name, member_id: purchases[0].member_id,
    lines, amount_paise: totalPaise, total_amount: totalPaise / 100,
    route_enabled: trust.razorpay_route === true, linked_account_id: linkedAccountId,
    vendor_share: vendorShare, platform_share: 100 - vendorShare,
    transfer_paise: transferPaise, platform_paise: totalPaise - transferPaise,
  };
};

export const createRouteOrder = async ({ quote }) => {
  const razorpay = getRazorpay();
  // Razorpay allows at most 40 characters.
  const receipt = `rcpt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

  const payload = {
    amount: quote.amount_paise,
    currency: 'INR',
    receipt,
    partial_payment: false,
    notes: {
      trust_id: quote.trust_id,
      member_id: quote.member_id,
      purchase_count: String(quote.lines?.length || 0),
      source: 'setu-member-app',
    },
  };

  if (quote.route_enabled) {
    if (!quote.linked_account_id || Number(quote.transfer_paise) < 100) {
      throw new PaymentError(
        'Online payment split is not configured correctly for this order. Please contact the trust.',
        409,
        'ROUTE_SPLIT_INVALID'
      );
    }
    payload.transfers = [{
      account: quote.linked_account_id,
      amount: Number(quote.transfer_paise),
      currency: 'INR',
      notes: { trust_id: quote.trust_id, receipt },
      linked_account_notes: ['receipt'],
      on_hold: false,
    }];
  }

  return razorpay.orders.create(payload);
};

export const recordPendingOrder = async ({ quote, order }) => {
  if (Number(order.amount) !== quote.amount_paise) reject('AMOUNT_MISMATCH');
  const payments = [];
  for (const line of quote.lines) {
    let invoice = await query(db().from('product_invoices').select('id, status')
      .eq('purchase_id', line.purchase_id).maybeSingle());
    const totals = {
      subtotal: line.subtotal, discount_amount: 0, tax_amount: line.tax_amount,
      transport_fee: line.transport_fee, total_amount: line.total_amount, status: 'unpaid',
    };
    if (!invoice) {
      const now = new Date();
      const { data, error } = await db().from('product_invoices').insert({
        ...totals, purchase_id: line.purchase_id,
        invoice_number: `RZP-${now.toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex')}`,
        invoice_date: now.toISOString().slice(0, 10),
      }).select('id, status').single();
      if (error && error.code !== '23505') throw error;
      invoice = data || await query(db().from('product_invoices').select('id, status')
        .eq('purchase_id', line.purchase_id).single());
    }
    if (invoice.status === 'paid') reject('PURCHASE_ALREADY_PAID');
    // Do not reset an invoice that was paid by a concurrent capture.
    const updatedInvoice = await query(db().from('product_invoices').update(totals)
      .eq('id', invoice.id).neq('status', 'paid').select('id').maybeSingle());
    if (!updatedInvoice) reject('PURCHASE_ALREADY_PAID');
    const previous = await query(db().from('product_payments').select('id, gateway_payload')
      .eq('invoice_id', invoice.id).eq('payment_gateway', 'razorpay').eq('status', 'pending')
      .neq('gateway_order_id', order.id));
    for (const row of previous) {
      await query(db().from('product_payments').update({ status: 'failed',
        gateway_payload: { ...row.gateway_payload, superseded_by: order.id },
      }).eq('id', row.id).eq('status', 'pending').neq('gateway_order_id', order.id));
    }
    let paymentRow = await query(db().from('product_payments').select('id')
      .eq('invoice_id', invoice.id).eq('gateway_order_id', order.id).maybeSingle());
    if (!paymentRow) {
      const { data, error } = await db().from('product_payments').insert({
        invoice_id: invoice.id, payment_mode: 'razorpay', amount: line.total_amount,
        status: 'pending', payment_gateway: 'razorpay', gateway_order_id: order.id,
        transfer_status: quote.route_enabled ? 'pending' : null,
        gateway_payload: {
          order: { id: order.id, receipt: order.receipt, amount: order.amount,
            created_at: order.created_at, transfers: order.transfers || null },
          split: { linked_account_id: quote.linked_account_id, vendor_share: quote.vendor_share,
            transfer_paise: quote.transfer_paise, platform_paise: quote.platform_paise },
        },
      }).select('id').single();
      if (error && error.code !== '23505') throw error;
      paymentRow = data || await query(db().from('product_payments').select('id')
        .eq('invoice_id', invoice.id).eq('gateway_order_id', order.id).single());
    }
    await query(db().from('product_purchases').update({ product_payment_id: paymentRow.id, unit_price: line.unit_price })
      .eq('id', line.purchase_id));
    payments.push({ purchase_id: line.purchase_id, invoice_id: invoice.id, payment_id: paymentRow.id });
  }
  return { success: true, gateway_order_id: order.id, payments };
};

const compactPayment = (payment = {}) => ({
  id: payment.id,
  order_id: payment.order_id,
  amount: payment.amount,
  status: payment.status,
  method: payment.method,
  vpa: payment.vpa || null,
  bank: payment.bank || null,
  wallet: payment.wallet || null,
  card_network: payment.card?.network || null,
  card_last4: payment.card?.last4 || null,
  fee: payment.fee ?? null,
  tax: payment.tax ?? null,
  captured_at: payment.captured_at || null,
});

export const applyCaptured = async ({ payment, eventId = null }) => {
  const rows = await query(db().from('product_payments')
    .select('id, invoice_id, status, amount, gateway_payload, last_webhook_event_id')
    .eq('gateway_order_id', payment.order_id).eq('payment_gateway', 'razorpay').in('status', ['pending', 'success']));
  if (!rows.length) reject('GATEWAY_ORDER_NOT_FOUND');
  const expected = paise(rows.reduce((sum, row) => sum + Number(row.amount), 0));
  if (expected !== Number(payment.amount)) {
    console.error('RAZORPAY AMOUNT_MISMATCH', { order_id: payment.order_id, expected, captured: payment.amount });
    reject('AMOUNT_MISMATCH');
  }
  const method = payment.method === 'cardless_emi' ? 'emi' : payment.method;
  const mode = ['upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater'].includes(method) ? method : 'razorpay';
  const errors = [];
  let updated = 0;
  for (const row of rows) {
    if (row.status === 'success') {
      // Repair an interrupted invoice write without rerunning activation.
      // The client verify-payment path usually wins the race, so record the
      // webhook's event id and payment details here too.
      await query(db().from('product_payments').update({
        gateway_payload: { ...row.gateway_payload, payment: compactPayment(payment) },
        last_webhook_event_id: eventId || row.last_webhook_event_id,
      }).eq('id', row.id).eq('status', 'success'));
      await query(db().from('product_invoices').update({ status: 'paid' }).eq('id', row.invoice_id));
      continue;
    }
    const payload = { ...row.gateway_payload, payment: compactPayment(payment) };
    delete payload.activation_error;
    delete payload.activation_error_at;
    const { data, error } = await db().from('product_payments').update({
      status: 'success', transaction_id: payment.id, payment_mode: mode,
      payment_date: new Date().toISOString(), gateway_payload: payload,
      last_webhook_event_id: eventId || row.last_webhook_event_id,
    }).eq('id', row.id).eq('status', 'pending').select('id');
    if (error) {
      console.error('PAYMENT CAPTURED BUT ACTIVATION FAILED', { payment_row_id: row.id, payment_id: payment.id, error });
      await query(db().from('product_payments').update({ gateway_payload: {
        ...row.gateway_payload, payment: compactPayment(payment), activation_error: error.message,
        activation_error_at: new Date().toISOString(), captured_payment_id: payment.id,
      } }).eq('id', row.id).eq('status', 'pending'));
      errors.push({ payment_row_id: row.id, error: error.message });
      continue;
    }
    if (data?.length) {
      await query(db().from('product_invoices').update({ status: 'paid' }).eq('id', row.invoice_id));
      updated += 1;
    }
  }
  return { success: errors.length === 0, updated, errors };
};

export const applyFailed = async ({ payment, eventId = null }) => {
  const rows = await query(db().from('product_payments').select('id, gateway_payload, last_webhook_event_id')
    .eq('gateway_order_id', payment.order_id).eq('payment_gateway', 'razorpay').eq('status', 'pending'));
  for (const row of rows) {
    if (eventId && row.last_webhook_event_id === eventId) continue;
    await query(db().from('product_payments').update({
      gateway_payload: { ...row.gateway_payload, last_failure: {
        id: payment.id, method: payment.method, error_code: payment.error_code || null,
        error_description: payment.error_description || null, error_reason: payment.error_reason || null,
        created_at: payment.created_at || null,
      } }, last_webhook_event_id: eventId || row.last_webhook_event_id,
    }).eq('id', row.id).eq('status', 'pending'));
  }
  return { success: true };
};

export const applyTransferEvent = async ({ transfer, status, eventId = null, eventCreatedAt = null }) => {
  if (!/^(pay|order)_[A-Za-z0-9]+$/.test(transfer.source || '')) reject('TRANSFER_SOURCE_REQUIRED');
  const rows = await query(db().from('product_payments').select('id, gateway_payload, last_webhook_event_id')
    .eq('payment_gateway', 'razorpay')
    .or(`transaction_id.eq.${transfer.source},gateway_order_id.eq.${transfer.source}`));
  const failed = status === 'failed';
  let matched = 0;
  for (const row of rows) {
    matched += 1;
    if (eventId && row.last_webhook_event_id === eventId) continue;
    // Razorpay does not guarantee ordering: drop events older than the one already applied.
    const appliedAt = row.gateway_payload?.transfer_event_at;
    if (eventCreatedAt && appliedAt && eventCreatedAt < appliedAt) continue;
    const payload = {
      ...row.gateway_payload,
      transfer: failed ? transfer : {
        id: transfer.id, source: transfer.source, recipient: transfer.recipient,
        amount: transfer.amount, status: transfer.status,
        settlement_status: transfer.settlement_status || null, processed_at: transfer.processed_at || null,
      },
      transfer_event_at: eventCreatedAt || appliedAt || null,
    };
    if (failed) {
      payload.needs_attention = true;
      payload.transfer_failure = {
        transfer_id: transfer.id, recipient: transfer.recipient, amount: transfer.amount,
        failure_reason: transfer.failure_reason || transfer.error?.description || transfer.error?.reason || null,
        error_code: transfer.error?.code || null, failed_at: new Date().toISOString(),
      };
      console.error('RAZORPAY TRANSFER FAILED - needs manual attention', {
        payment_row_id: row.id, ...payload.transfer_failure,
      });
    } else {
      delete payload.transfer_failure;
      delete payload.needs_attention;
    }
    await query(db().from('product_payments').update({
      gateway_transfer_id: transfer.id, transfer_status: status, gateway_payload: payload,
      last_webhook_event_id: eventId || row.last_webhook_event_id,
    }).eq('id', row.id).eq('payment_gateway', 'razorpay'));
  }
  return { success: true, matched };
};

/**
 * Webhook event log. Returns { duplicate: true } when this event id was already
 * processed (Razorpay retries); otherwise the event is stored as 'received'.
 */
export const recordWebhookEvent = async ({ eventId, eventName, event }) => {
  const existing = await query(db().from('razorpay_webhook_events').select('event_id, status')
    .eq('event_id', eventId).maybeSingle());
  if (existing) return { duplicate: existing.status === 'processed' || existing.status === 'pending_match' };
  const entity = event?.payload?.transfer?.entity || event?.payload?.payment?.entity;
  const { error } = await db().from('razorpay_webhook_events').insert({
    event_id: eventId, event_name: eventName, payload: event, status: 'received',
    entity_id: entity?.source || entity?.id || null,
    event_created_at: event?.created_at ? new Date(event.created_at * 1000).toISOString() : null,
  });
  if (error && error.code !== '23505') throw mapDbError(error);
  return { duplicate: false };
};

export const markWebhookEvent = async (eventId, status, errorMessage = null) => {
  await query(db().from('razorpay_webhook_events').update({
    status, error: errorMessage, processed_at: new Date().toISOString(),
  }).eq('event_id', eventId));
};

// Transfer events that arrived before the payment row knew its transaction_id.
export const replayPendingTransferEvents = async (sources) => {
  const pending = await query(db().from('razorpay_webhook_events').select('event_id, event_name, payload, event_created_at')
    .eq('status', 'pending_match').in('entity_id', sources.filter(Boolean)));
  pending.sort((a, b) => String(a.event_created_at).localeCompare(String(b.event_created_at)));
  for (const item of pending) {
    const transfer = item.payload?.payload?.transfer?.entity;
    if (!transfer) continue;
    const result = await applyTransferEvent({
      transfer, status: item.event_name.slice('transfer.'.length),
      eventId: item.event_id, eventCreatedAt: item.event_created_at,
    });
    if (result.matched) await markWebhookEvent(item.event_id, 'processed');
  }
};

/**
 * Called after the client reports success. Never trusts the client: fetches
 * the payment from Razorpay, captures it if needed, then updates the DB.
 */
export const settleVerifiedPayment = async ({ orderId, paymentId }) => {
  const razorpay = getRazorpay();
  let payment = await razorpay.payments.fetch(paymentId);

  if (payment.order_id !== orderId) {
    throw new PaymentError('Payment does not belong to this order.', 400, 'ORDER_PAYMENT_MISMATCH');
  }

  if (payment.status === 'authorized') {
    payment = await razorpay.payments.capture(payment.id, payment.amount, 'INR');
  }
  if (payment.status !== 'captured') {
    return { status: 'processing' };
  }

  try {
    const result = await applyCaptured({ payment });
    return { status: result?.success === false ? 'paid_needs_attention' : 'paid' };
  } catch (error) {
    console.error('Failed to record captured payment; webhook will retry:', error?.message || error);
    return { status: 'processing' };
  }
};

const safeEqualHex = (expectedHex, actualHex) => {
  try {
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(String(actualHex || ''), 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

export const verifyCheckoutSignature = ({ orderId, paymentId, signature }) => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
};

export const verifyWebhookSignature = ({ rawBody, signature }) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
};
