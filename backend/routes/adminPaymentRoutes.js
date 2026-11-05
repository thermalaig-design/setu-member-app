import express from 'express';
import { authenticateAdmin } from '../middleware/adminAuth.js';
import {
  PaymentError,
  listFailedTransfers,
  listRefundablePayments,
  refundPayment,
} from '../services/razorpayRouteService.js';

const router = express.Router();
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]+$/;

router.use(authenticateAdmin);

const sendError = (res, error, fallback) => {
  if (error instanceof PaymentError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: error?.error?.description || fallback });
};

router.get('/', async (req, res) => {
  try {
    return res.json({ success: true, payments: await listRefundablePayments() });
  } catch (error) {
    return sendError(res, error, 'Failed to load payments.');
  }
});

router.get('/failed-transfers', async (req, res) => {
  try {
    return res.json({ success: true, transfers: await listFailedTransfers() });
  } catch (error) {
    return sendError(res, error, 'Failed to load failed transfers.');
  }
});

// amount is in rupees and optional (omitted = refund the full remaining amount).
router.post('/refund', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const paymentId = String(body.payment_id || '').trim();
    if (!PAYMENT_ID_RE.test(paymentId)) {
      return res.status(400).json({ success: false, message: 'A valid payment_id is required.' });
    }
    const hasAmount = body.amount !== undefined && body.amount !== null && body.amount !== '';
    const amount = hasAmount ? Number(body.amount) : null;
    if (hasAmount && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ success: false, message: 'amount must be a positive number of rupees.' });
    }
    const result = await refundPayment({ paymentId, amountRupees: amount, requestedBy: req.adminUser?.email });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, 'Failed to refund payment.');
  }
});

export default router;
