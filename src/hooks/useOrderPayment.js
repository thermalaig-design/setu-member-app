import { useEffect, useState } from 'react';
import { openRazorpayCheckout } from '../services/paymentService';
import { supabase } from '../services/supabaseClient';
import { useAppTheme } from '../context/ThemeContext';

// Razorpay's checkout locks page scroll while its modal is open and can leave the
// lock behind (esp. in WebViews) after dismiss/success, freezing the page.
export function releaseStuckScrollLock() {
  if (typeof document === 'undefined') return;
  [document.documentElement, document.body].forEach((el) => {
    if (el.style.overflow === 'hidden') el.style.overflow = '';
    if (el.style.overflowY === 'hidden') el.style.overflowY = '';
    if (el.style.position === 'fixed') {
      el.style.position = '';
      el.style.top = '';
      el.style.width = '';
    }
    if (el.style.touchAction === 'none') el.style.touchAction = '';
  });
}

// Only trusts with the payment gateway on get a "Pay now" button on pending orders.
export function useOrderPayment(orders) {
  const theme = useAppTheme();
  const [gatewayTrustIds, setGatewayTrustIds] = useState([]);
  const [payingOrderId, setPayingOrderId] = useState('');
  const [payMessage, setPayMessage] = useState('');

  const pendingTrustKey = [...new Set(
    orders.filter((order) => order.statusGroup === 'pending' && order.trustId).map((order) => order.trustId)
  )].sort().join(',');

  useEffect(() => {
    if (!pendingTrustKey) {
      setGatewayTrustIds([]);
      return undefined;
    }
    let active = true;
    supabase
      .from('Trust')
      .select('id, payment_gateway')
      .in('id', pendingTrustKey.split(','))
      .then(({ data }) => {
        if (active) setGatewayTrustIds((data || []).filter((row) => row.payment_gateway).map((row) => row.id));
      })
      .catch(() => {
        if (active) setGatewayTrustIds([]);
      });
    return () => {
      active = false;
    };
  }, [pendingTrustKey]);

  useEffect(() => {
    releaseStuckScrollLock();
  }, []);

  const canPay = (order) => (
    order.statusGroup === 'pending' && Boolean(order.purchaseId) && gatewayTrustIds.includes(order.trustId)
  );

  const payOrder = async (order) => {
    setPayingOrderId(order.id);
    setPayMessage('');
    try {
      const result = await openRazorpayCheckout({
        trustId: order.trustId,
        purchaseIds: [order.purchaseId],
        name: order.trustName || order.trustLabel,
        description: 'Order payment',
        themeColor: theme.primary,
      });
      setPayMessage(
        result.status === 'paid'
          ? 'Payment received. Your order is confirmed.'
          : 'Payment received, confirming your order. It will update here shortly.'
      );
      window.dispatchEvent(new Event('trust-changed'));
    } catch (error) {
      setPayMessage(
        error?.code === 'PAYMENT_CANCELLED'
          ? 'Payment was cancelled. Tap Pay now to try again.'
          : error?.message || 'Payment was not completed. Please try again.'
      );
    } finally {
      setPayingOrderId('');
      releaseStuckScrollLock();
    }
  };

  return { canPay, payOrder, payingOrderId, payMessage };
}
