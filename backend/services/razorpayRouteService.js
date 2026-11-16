/* global process, Buffer */
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { paymentSupabase } from '../config/supabase.js';
import { sendAdminAlertEmail } from './emailService.js';
import { generateAndStoreInvoicePdf, getInvoiceSignedUrl } from './invoicePdfService.js';

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
        gateway_transfer_id: order.transfers?.[0]?.id || null,
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
      // Best effort: a missing PDF is rebuilt on the first download.
      try {
        await generateAndStoreInvoicePdf(row.invoice_id);
      } catch (error) {
        console.error('Invoice PDF generation failed', { invoice_id: row.invoice_id, error: error?.message || error });
      }
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

const rupees = (amountPaise) => (Number(amountPaise) / 100).toFixed(2);

const alertAdmin = (subject, lines) => sendAdminAlertEmail({ subject, text: lines.join('\n') })
  .catch((error) => console.error('Admin alert failed', error?.message || error));

// Purchase behind a payment row's invoice; null when the invoice has no purchase.
const purchaseForInvoice = async (invoiceId) => {
  const invoice = await query(db().from('product_invoices').select('id, purchase_id').eq('id', invoiceId).maybeSingle());
  if (!invoice?.purchase_id) return null;
  return query(db().from('product_purchases').select('id, status').eq('id', invoice.purchase_id).maybeSingle());
};

export const applyTransferEvent = async ({ transfer, status, eventId = null, eventCreatedAt = null }) => {
  if (!/^(pay|order)_[A-Za-z0-9]+$/.test(transfer.source || '')) reject('TRANSFER_SOURCE_REQUIRED');
  const rows = await query(db().from('product_payments')
    .select('id, invoice_id, amount, transaction_id, gateway_order_id, gateway_payload, last_webhook_event_id')
    .eq('payment_gateway', 'razorpay')
    .or(`transaction_id.eq.${transfer.source},gateway_order_id.eq.${transfer.source}`));
  const failed = status === 'failed';
  let matched = 0;
  const newFailures = [];
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
      const alreadyReported = row.gateway_payload?.transfer_failure?.transfer_id === transfer.id;
      payload.transfer_failure = {
        transfer_id: transfer.id, recipient: transfer.recipient, amount: transfer.amount,
        failure_reason: transfer.failure_reason || transfer.error?.description || transfer.error?.reason || null,
        error_code: transfer.error?.code || null,
        failed_at: row.gateway_payload?.transfer_failure?.failed_at || new Date().toISOString(),
      };
      // An already activated purchase cannot be held back, so flag it for a person.
      // One that is not activated yet is only marked held; its status enum is left alone.
      const purchase = await purchaseForInvoice(row.invoice_id);
      if (!purchase || purchase.status === 'order_payment_done') {
        payload.needs_attention = true;
      } else {
        payload.purchase_hold = true;
      }
      console.error('RAZORPAY TRANSFER FAILED - needs manual attention', {
        payment_row_id: row.id, ...payload.transfer_failure,
      });
      if (!alreadyReported) newFailures.push({ row, failure: payload.transfer_failure });
    } else if (status === 'processed') {
      delete payload.transfer_failure;
      delete payload.needs_attention;
      delete payload.purchase_hold;
    }
    await query(db().from('product_payments').update({
      gateway_transfer_id: transfer.id, transfer_status: status, gateway_payload: payload,
      last_webhook_event_id: eventId || row.last_webhook_event_id,
    }).eq('id', row.id).eq('payment_gateway', 'razorpay'));
  }
  if (newFailures.length) {
    const first = newFailures[0];
    await alertAdmin(`Razorpay transfer failed: ${transfer.id}`, [
      'A Razorpay Route transfer failed and needs manual attention.', '',
      `Payment id: ${first.row.transaction_id || transfer.source}`,
      `Order id: ${first.row.gateway_order_id}`,
      `Transfer id: ${transfer.id}`,
      `Transfer amount: Rs. ${rupees(transfer.amount)}`,
      `Reason: ${first.failure.failure_reason || first.failure.error_code || 'not provided'}`,
    ]);
  }
  return { success: true, matched };
};

const isoFromRazorpay = (value) => (typeof value === 'number' ? new Date(value * 1000).toISOString() : value || null);

const sumPaise = (entries) => entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

/**
 * Merge one Razorpay refund entity into every payment row of the same Razorpay
 * payment. Refund state lives in gateway_payload (refund = latest, refund_history
 * = all refunds). The row only becomes 'refunded' once processed refunds cover
 * the full amount; then the invoice and purchase are cancelled.
 */
export const applyRefundEntity = async ({ rows, refund, status = refund.status, eventId = null }) => {
  const entry = { id: refund.id, amount: refund.amount, status, created_at: isoFromRazorpay(refund.created_at) };
  const totalPaise = rows.reduce((sum, row) => sum + paise(row.amount), 0);
  let fullyRefunded = false;
  let failedNow = false;
  for (const row of rows) {
    const history = [...(row.gateway_payload?.refund_history || [])];
    const index = history.findIndex((item) => item.id === entry.id);
    const previous = index >= 0 ? history[index] : null;
    // Razorpay refunds are final once processed: ignore late pending/failed events.
    const next = previous?.status === 'processed' ? previous : entry;
    if (index >= 0) history[index] = next; else history.push(next);
    const processedPaise = sumPaise(history.filter((item) => item.status === 'processed'));
    const full = totalPaise > 0 && processedPaise >= totalPaise;
    fullyRefunded = fullyRefunded || full;
    const payload = { ...row.gateway_payload, refund: next, refund_history: history };
    if (next.status === 'failed') {
      payload.refund_failure = { ...next, failed_at: new Date().toISOString() };
      failedNow = failedNow || previous?.status !== 'failed';
    } else if (payload.refund_failure?.id === next.id) {
      delete payload.refund_failure;
    }
    const update = { gateway_payload: payload };
    if (eventId) update.last_webhook_event_id = eventId;
    if (full && row.status === 'success') update.status = 'refunded';
    await query(db().from('product_payments').update(update).eq('id', row.id));
  }
  if (fullyRefunded) {
    for (const row of rows) {
      const invoice = await query(db().from('product_invoices').update({ status: 'cancelled' })
        .eq('id', row.invoice_id).select('purchase_id').maybeSingle());
      if (invoice?.purchase_id) {
        await query(db().from('product_purchases').update({ status: 'cancelled' }).eq('id', invoice.purchase_id));
      }
    }
  }
  if (failedNow) {
    await alertAdmin(`Razorpay refund failed: ${entry.id}`, [
      'A Razorpay refund failed and needs manual attention.', '',
      `Payment id: ${refund.payment_id || rows[0]?.transaction_id}`,
      `Refund id: ${entry.id}`,
      `Refund amount: Rs. ${rupees(entry.amount)}`,
    ]);
  }
  return { refund: entry, fully_refunded: fullyRefunded };
};

const refundableRows = (paymentId) => query(db().from('product_payments')
  .select('id, invoice_id, status, amount, transaction_id, gateway_payload, last_webhook_event_id')
  .eq('payment_gateway', 'razorpay').eq('transaction_id', paymentId).in('status', ['success', 'refunded']));

/** Admin refund. `amountRupees` omitted = refund everything still refundable. */
export const refundPayment = async ({ paymentId, amountRupees = null, requestedBy = null }) => {
  const rows = await refundableRows(paymentId);
  if (!rows.length) throw new PaymentError('Payment not found or not refundable.', 404, 'REFUND_PAYMENT_NOT_FOUND');
  const totalPaise = rows.reduce((sum, row) => sum + paise(row.amount), 0);
  // Pending refunds count too, so two quick clicks cannot over-refund.
  const reserved = sumPaise((rows[0].gateway_payload?.refund_history || []).filter((item) => item.status !== 'failed'));
  const remaining = totalPaise - reserved;
  if (remaining <= 0) throw new PaymentError('This payment is already fully refunded.', 409, 'REFUND_ALREADY_REFUNDED');
  const amount = amountRupees === null || amountRupees === undefined ? remaining : paise(amountRupees);
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > remaining) {
    throw new PaymentError(`Refund amount must be between Rs. 1 and Rs. ${rupees(remaining)}.`, 400, 'REFUND_AMOUNT_INVALID');
  }
  const refund = await getRazorpay().payments.refund(paymentId, {
    amount, speed: 'normal', reverse_all: 1,
    notes: { source: 'setu-admin', requested_by: requestedBy || 'admin' },
  });
  const result = await applyRefundEntity({ rows, refund: { payment_id: paymentId, ...refund } });
  return { success: true, payment_id: paymentId, ...result };
};

export const applyRefundEvent = async ({ refund, status, eventId = null }) => {
  if (!/^pay_[A-Za-z0-9]+$/.test(refund?.payment_id || '')) return { success: true, matched: 0 };
  const rows = await refundableRows(refund.payment_id);
  if (!rows.length) return { success: true, matched: 0 };
  const fresh = eventId ? rows.filter((row) => row.last_webhook_event_id !== eventId) : rows;
  if (!fresh.length) return { success: true, matched: rows.length };
  await applyRefundEntity({ rows: fresh, refund, status, eventId });
  return { success: true, matched: rows.length };
};

const groupByTransaction = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = row.transaction_id || row.gateway_order_id;
    const group = groups.get(key) || { payment_id: row.transaction_id, order_id: row.gateway_order_id,
      amount: 0, status: row.status, payment_date: row.payment_date, refund: row.gateway_payload?.refund || null,
      refunded_amount: sumPaise((row.gateway_payload?.refund_history || []).filter((item) => item.status !== 'failed')) / 100 };
    group.amount += Number(row.amount);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const listRefundablePayments = async ({ limit = 50 } = {}) => {
  const rows = await query(db().from('product_payments')
    .select('id, amount, status, transaction_id, gateway_order_id, payment_date, gateway_payload')
    .eq('payment_gateway', 'razorpay').in('status', ['success', 'refunded']).not('transaction_id', 'is', null)
    .order('payment_date', { ascending: false }).limit(limit));
  return groupByTransaction(rows);
};

export const listFailedTransfers = async ({ limit = 50 } = {}) => {
  const rows = await query(db().from('product_payments')
    .select('id, amount, status, transaction_id, gateway_order_id, gateway_transfer_id, gateway_payload')
    .eq('payment_gateway', 'razorpay').eq('transfer_status', 'failed')
    .order('updated_at', { ascending: false }).limit(limit));
  return rows.map((row) => ({
    id: row.id, payment_id: row.transaction_id, order_id: row.gateway_order_id,
    transfer_id: row.gateway_transfer_id, amount: row.amount, status: row.status,
    reason: row.gateway_payload?.transfer_failure?.failure_reason || null,
    failed_at: row.gateway_payload?.transfer_failure?.failed_at || null,
    needs_attention: row.gateway_payload?.needs_attention === true,
    purchase_hold: row.gateway_payload?.purchase_hold === true,
  }));
};

/** Paid invoice of a purchase, with the member that owns it (null if none). */
export const findPaidInvoiceForPurchase = async (purchaseId) => {
  const invoice = await query(db().from('product_invoices').select('id, status, purchase_id')
    .eq('purchase_id', purchaseId).eq('status', 'paid').maybeSingle());
  if (!invoice) return null;
  const purchase = await query(db().from('product_purchases').select('member_id').eq('id', purchaseId).maybeSingle());
  return { id: invoice.id, member_id: purchase?.member_id || null };
};

export const createInvoiceDownloadUrl = (invoiceId) => getInvoiceSignedUrl(invoiceId);

// The event log table is optional: the payment rows are updated either way.
export const isMissingEventsTable = (error) => {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '');
  return /razorpay_webhook_events/.test(message) && /does not exist|schema cache|not found/i.test(message);
};

const warnEventsTableMissing = () => {
  console.warn('Razorpay webhook event log disabled until razorpay_webhook_events.sql is applied');
};

/**
 * Webhook event log. Returns { duplicate: true } when this event id was already
 * processed (Razorpay retries); otherwise the event is stored as 'received'.
 */
export const recordWebhookEvent = async ({ eventId, eventName, event }) => {
  try {
    const existing = await query(db().from('razorpay_webhook_events').select('event_id, status')
      .eq('event_id', eventId).maybeSingle());
    if (existing) return { duplicate: existing.status === 'processed' || existing.status === 'pending_match' };
    const entity = event?.payload?.transfer?.entity || event?.payload?.refund?.entity || event?.payload?.payment?.entity;
    const { error } = await db().from('razorpay_webhook_events').insert({
      event_id: eventId, event_name: eventName, payload: event, status: 'received',
      entity_id: entity?.source || entity?.id || null,
      event_created_at: event?.created_at ? new Date(event.created_at * 1000).toISOString() : null,
    });
    if (error && error.code !== '23505') throw mapDbError(error);
    return { duplicate: false };
  } catch (error) {
    if (!isMissingEventsTable(error)) throw error;
    warnEventsTableMissing();
    return { duplicate: false };
  }
};

export const markWebhookEvent = async (eventId, status, errorMessage = null) => {
  try {
    await query(db().from('razorpay_webhook_events').update({
      status, error: errorMessage, processed_at: new Date().toISOString(),
    }).eq('event_id', eventId));
  } catch (error) {
    if (!isMissingEventsTable(error)) throw error;
    warnEventsTableMissing();
  }
};

// Transfer events that arrived before the payment row knew its transaction_id.
export const replayPendingTransferEvents = async (sources) => {
  let pending;
  try {
    pending = await query(db().from('razorpay_webhook_events').select('event_id, event_name, payload, event_created_at')
      .eq('status', 'pending_match').in('entity_id', sources.filter(Boolean)));
  } catch (error) {
    if (!isMissingEventsTable(error)) throw error;
    warnEventsTableMissing();
    return;
  }
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
