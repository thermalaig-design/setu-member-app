/* global process, Buffer */
import express from 'express';
import { requireMemberSession, memberBelongsToSession } from '../middleware/memberAuth.js';
import { supabase } from '../config/supabase.js';
import {
  PaymentError,
  applyCaptured,
  applyFailed,
  applyRefundEvent,
  applyTransferEvent,
  createInvoiceDownloadUrl,
  createRouteOrder,
  findPaidInvoiceForPurchase,
  getPublicKeyId,
  markWebhookEvent,
  quoteCheckout,
  recordPendingOrder,
  recordWebhookEvent,
  replayPendingTransferEvents,
  settleVerifiedPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/razorpayRouteService.js';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_ID_RE = /^order_[A-Za-z0-9]+$/;
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]+$/;
const MAX_PURCHASES = 50;

const sendError = (res, error, fallback) => {
  if (error instanceof PaymentError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(fallback, error);
  const gatewayMessage = error?.error?.description;
  return res.status(500).json({ success: false, message: gatewayMessage || fallback });
};

// Create a Razorpay order for pending purchases. The amount and the Route
// split are computed on the server from database prices.
router.post('/create-order', requireMemberSession, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const trustId = String(body.trust_id || '').trim();
    const purchaseIds = [...new Set(
      (Array.isArray(body.purchase_ids) ? body.purchase_ids : []).map((id) => String(id || '').trim())
    )];

    if (!UUID_RE.test(trustId)) {
      return res.status(400).json({ success: false, message: 'A valid trust_id is required.' });
    }
    if (purchaseIds.length === 0 || purchaseIds.length > MAX_PURCHASES || !purchaseIds.every((id) => UUID_RE.test(id))) {
      return res.status(400).json({ success: false, message: `purchase_ids must contain 1 to ${MAX_PURCHASES} valid ids.` });
    }

    const quote = await quoteCheckout({ trustId, purchaseIds });

    if (!(await memberBelongsToSession(quote.member_id, req.member))) {
      return res.status(403).json({ success: false, message: 'These items do not belong to your account.' });
    }

    const order = await createRouteOrder({ quote });
    await recordPendingOrder({ quote, order });

    return res.json({
      success: true,
      key_id: getPublicKeyId(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      trust_name: quote.trust_name,
      total_amount: quote.total_amount,
      lines: quote.lines,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create payment order.');
  }
});

// Verify the checkout signature, then confirm with Razorpay and record the payment.
router.post('/verify-payment', requireMemberSession, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const orderId = String(body.razorpay_order_id || '').trim();
    const paymentId = String(body.razorpay_payment_id || '').trim();
    const signature = String(body.razorpay_signature || '').trim();

    if (!ORDER_ID_RE.test(orderId) || !PAYMENT_ID_RE.test(paymentId) || !signature) {
      return res.status(400).json({
        success: false,
        message: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required.',
      });
    }

    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, verified: false, message: 'Payment signature verification failed.' });
    }

    const { status } = await settleVerifiedPayment({ orderId, paymentId });
    return res.json({ success: true, verified: true, status });
  } catch (error) {
    return sendError(res, error, 'Failed to verify payment.');
  }
});

// Poll the outcome of an order (used when verify returned "processing").
router.get('/order-status/:orderId', requireMemberSession, async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!ORDER_ID_RE.test(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const { data, error } = await supabase
      .from('product_payments')
      .select('id, status, product_invoices!inner(purchase_id, product_purchases!inner(member_id))')
      .eq('gateway_order_id', orderId);
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const memberIds = [...new Set(rows.map((row) => row.product_invoices?.product_purchases?.member_id).filter(Boolean))];
    for (const memberId of memberIds) {
      if (!(await memberBelongsToSession(memberId, req.member))) {
        return res.status(403).json({ success: false, message: 'This order does not belong to your account.' });
      }
    }

    let status = 'failed';
    if (rows.every((row) => row.status === 'success')) status = 'paid';
    else if (rows.some((row) => row.status === 'pending')) status = 'processing';

    return res.json({ success: true, order_id: orderId, status });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch order status.');
  }
});

// Signed, short-lived link to the invoice PDF of one of the member's own purchases.
router.get('/invoice/:purchaseId/download-url', requireMemberSession, async (req, res) => {
  try {
    const { purchaseId } = req.params;
    if (!UUID_RE.test(purchaseId)) {
      return res.status(400).json({ success: false, message: 'Invalid purchase id.' });
    }
    const invoice = await findPaidInvoiceForPurchase(purchaseId);
    if (!invoice || !(await memberBelongsToSession(invoice.member_id, req.member))) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }
    const downloadUrl = await createInvoiceDownloadUrl(invoice.id);
    if (!downloadUrl) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    return res.json({ success: true, url: downloadUrl });
  } catch (error) {
    return sendError(res, error, 'Failed to prepare invoice download.');
  }
});

const PERMANENT_ERROR_PREFIXES = ['GATEWAY_ORDER_NOT_FOUND', 'AMOUNT_MISMATCH'];

// Mounted in server.js with express.raw() BEFORE express.json(): the signature
// must be checked against the exact bytes Razorpay sent.
export const razorpayWebhookHandler = async (req, res) => {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ success: false, message: 'Webhook is not configured.' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  const signature = req.headers['x-razorpay-signature'];
  if (!verifyWebhookSignature({ rawBody, signature })) {
    // Never log the secret or the signature itself - only enough to diagnose a secret mismatch.
    console.warn('Razorpay webhook rejected: invalid signature', {
      event_id: req.headers['x-razorpay-event-id'] || null,
      has_signature: Boolean(signature), body_bytes: rawBody.length,
    });
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid payload.' });
  }

  const eventId = String(req.headers['x-razorpay-event-id'] || '').trim();
  const eventName = String(event?.event || '');
  if (!eventId) {
    return res.status(400).json({ success: false, message: 'Missing event id.' });
  }

  console.log('Razorpay webhook received', eventName, eventId);

  try {
    const { duplicate } = await recordWebhookEvent({ eventId, eventName, event });
    if (duplicate) return res.json({ success: true, duplicate: true });

    const payment = event?.payload?.payment?.entity;
    const transfer = event?.payload?.transfer?.entity;
    let finalStatus = 'processed';

    if (eventName === 'payment.captured' || eventName === 'order.paid') {
      if (payment?.id && payment?.order_id) {
        const result = await applyCaptured({ payment, eventId });
        // Activation errors are acknowledged but not "processed", so a redelivery re-runs them.
        if (result?.success === false) finalStatus = 'failed';
        await replayPendingTransferEvents([payment.id, payment.order_id]);
      }
    } else if (eventName === 'payment.failed') {
      if (payment?.order_id) await applyFailed({ payment, eventId });
    } else if (eventName === 'refund.processed' || eventName === 'refund.failed') {
      const refund = event?.payload?.refund?.entity;
      if (refund?.id) {
        await applyRefundEvent({ refund, status: eventName.slice('refund.'.length), eventId });
      }
    } else if (eventName.startsWith('transfer.')) {
      if (transfer) {
        const eventCreatedAt = event?.created_at ? new Date(event.created_at * 1000).toISOString() : null;
        const result = await applyTransferEvent({
          transfer, status: eventName.slice('transfer.'.length), eventId, eventCreatedAt,
        });
        if (!result.matched) {
          // Payment not recorded yet (out-of-order delivery): park it, replayed on capture.
          console.warn('Razorpay transfer event has no matching payment row yet', eventName, eventId, transfer.source);
          finalStatus = 'pending_match';
        }
      }
    }

    await markWebhookEvent(eventId, finalStatus);
    console.log('Razorpay webhook processed', eventName, eventId, finalStatus);
    return res.json({ success: true });
  } catch (error) {
    const message = String(error?.message || error);
    console.error('Razorpay webhook processing failed:', eventName, eventId, message);
    await markWebhookEvent(eventId, 'failed', message).catch(() => {});

    // mapDbError turns known codes into friendly PaymentErrors; match on the code too.
    const permanent = PERMANENT_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix) || error?.code === prefix);
    // Permanent errors would fail forever, so acknowledge them; others get retried.
    return permanent
      ? res.json({ success: true, ignored: true })
      : res.status(500).json({ success: false, message: 'Webhook processing failed.' });
  }
};

export default router;
