import { Capacitor, registerPlugin } from '@capacitor/core';
import { track } from './analytics';
import { api } from './api';

// Native Android Checkout (android/.../RazorpayPlugin.java); the web uses checkout.js.
const RazorpayNative = registerPlugin('Razorpay');

const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const SESSION_TOKEN_KEY = 'setu_session_token';
const STATUS_POLL_ATTEMPTS = 6;
const STATUS_POLL_INTERVAL_MS = 2500;

let razorpayScriptPromise = null;

export const loadRazorpayScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay checkout can only be loaded in the browser.'));
  }
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const fail = () => {
      razorpayScriptPromise = null;
      reject(new Error('Failed to load Razorpay checkout script.'));
    };

    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', fail);
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = fail;
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
};

const authConfig = () => {
  let token = '';
  try {
    token = localStorage.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    token = '';
  }
  if (!token) {
    throw new Error('Your session has expired. Please sign in again to pay.');
  }
  return { headers: { Authorization: `Bearer ${token}` } };
};

const toUserError = (error, fallback) => {
  const message = error?.response?.data?.message;
  if (message) return new Error(message);
  return error instanceof Error && error.message && !error.response ? error : new Error(fallback);
};

export const createPaymentOrder = async ({ trustId, purchaseIds }) => {
  try {
    const response = await api.post(
      '/payments/create-order',
      { trust_id: trustId, purchase_ids: purchaseIds },
      authConfig()
    );
    if (!response?.data?.success) {
      throw new Error(response?.data?.message || 'Failed to create payment order.');
    }
    return response.data;
  } catch (error) {
    throw toUserError(error, 'Failed to create payment order.');
  }
};

export const verifyRazorpayPayment = async ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  try {
    const response = await api.post(
      '/payments/verify-payment',
      { razorpay_order_id, razorpay_payment_id, razorpay_signature },
      authConfig()
    );
    if (!response?.data?.success || !response?.data?.verified) {
      throw new Error(response?.data?.message || 'Payment verification failed.');
    }
    return response.data;
  } catch (error) {
    throw toUserError(error, 'Payment verification failed.');
  }
};

export const getPaymentOrderStatus = async (orderId) => {
  try {
    const response = await api.get(`/payments/order-status/${encodeURIComponent(orderId)}`, authConfig());
    return response.data;
  } catch (error) {
    throw toUserError(error, 'Unable to check payment status.');
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls until the order leaves "processing" (or attempts run out).
const pollOrderStatus = async (orderId, attempts) => {
  let status = 'processing';
  for (let i = 0; i < attempts; i += 1) {
    await sleep(STATUS_POLL_INTERVAL_MS);
    try {
      const result = await getPaymentOrderStatus(orderId);
      status = result?.status || status;
      if (status !== 'processing') break;
    } catch {
      // Keep polling; the webhook may still settle the order.
    }
  }
  return status;
};

const paymentCancelledError = () => {
  const cancelled = new Error('Payment cancelled.');
  cancelled.code = 'PAYMENT_CANCELLED';
  return cancelled;
};

/**
 * Creates a server-priced order for the given pending purchases and opens
 * Razorpay Checkout (native SDK in the Android app, checkout.js elsewhere).
 * Resolves { status, orderId, paymentId } where status is
 * 'paid' | 'processing' | 'paid_needs_attention'. Rejects with code
 * 'PAYMENT_CANCELLED' if the user closes the modal.
 */
export const openRazorpayCheckout = async ({
  trustId,
  purchaseIds,
  name,
  description,
  prefill = {},
  themeColor = '#0f766e',
}) => {
  const useNativeCheckout = Capacitor.getPlatform() === 'android';
  if (!useNativeCheckout) await loadRazorpayScript();
  const order = await createPaymentOrder({ trustId, purchaseIds });

  const checkoutOptions = {
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    order_id: order.order_id,
    name,
    description,
    prefill,
    theme: { color: themeColor },
    retry: { enabled: true, max_count: 3 },
  };

  let paymentReported = false;
  const completePayment = (status, paymentId) => {
    // Only server-confirmed paid orders count as purchases, including retry payments.
    if (status === 'paid' && !paymentReported) {
      paymentReported = true;
      track('purchase', {
        transaction_id: order.order_id,
        currency: order.currency,
        value: Number(order.total_amount),
      });
    }
    return { status, orderId: order.order_id, paymentId };
  };

  const confirmPayment = async (response) => {
    const paymentId = response?.razorpay_payment_id;
    try {
      const verification = await verifyRazorpayPayment(response);
      let status = verification.status;
      if (status === 'processing') {
        status = await pollOrderStatus(order.order_id, STATUS_POLL_ATTEMPTS);
      }
      return completePayment(status, paymentId);
    } catch (verifyError) {
      // Money may have moved even though verify failed; ask the server before giving up.
      const status = await pollOrderStatus(order.order_id, 3);
      if (status === 'paid' || status === 'processing') {
        return completePayment(status, paymentId);
      }
      throw verifyError;
    }
  };

  if (useNativeCheckout) {
    let response;
    try {
      response = await RazorpayNative.open({ options: checkoutOptions });
    } catch (error) {
      if (error?.code === 'PAYMENT_CANCELLED') throw paymentCancelledError();
      throw new Error(error?.message || 'Payment failed. Please try again.');
    }
    return confirmPayment(response);
  }

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      ...checkoutOptions,
      handler: (response) => confirmPayment(response).then(resolve, reject),
      modal: {
        ondismiss: () => reject(paymentCancelledError()),
      },
    });

    // No reject on 'payment.failed': with retry enabled the user can try again in the same modal.
    checkout.open();
  });
};
