import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, Image as ImageIcon, Package2 } from 'lucide-react';
import {
  clearOrderHistoryCache,
  loadOrderHistorySnapshot,
} from './services/orderHistoryService';
import {
  formatCurrency,
  getStatusPillStyle,
  normalizeOrderRecord,
} from './utils/orderHistoryDisplay';
import { useOrderPayment } from './hooks/useOrderPayment';
import OrderPageHeader from './components/OrderPageHeader';
import OrderProductImage from './components/OrderProductImage';

const T = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  text: 'var(--body-text-color)',
  heading: 'var(--heading-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
};

const SUCCESS_TONE = '#2e7d32';

// "29 Oct 2026, 1:12 pm"
const formatPlacedOn = (order) => order.createdAtLabel.replace(' at ', ', ');

const buildTimeline = (order) => {
  const deliveryLabel = order.deliveryEta || order.trackingStage || 'In progress';

  let payment;
  if (order.statusGroup === 'active') {
    payment = { state: 'done', tone: SUCCESS_TONE, label: 'Paid' };
  } else if (order.statusGroup === 'cancelled') {
    payment = { state: 'failed', tone: order.statusTone, label: 'Cancelled' };
  } else if (order.statusGroup === 'other') {
    payment = { state: 'done', tone: SUCCESS_TONE, label: order.status };
  } else {
    payment = { state: 'pending', tone: order.statusTone, label: 'Pending' };
  }

  return [
    { key: 'placed', title: 'Order placed', sub: formatPlacedOn(order), state: 'done', tone: SUCCESS_TONE },
    { key: 'payment', title: 'Payment', sub: payment.label, state: payment.state, tone: payment.tone },
    { key: 'delivery', title: 'Delivery', sub: deliveryLabel, state: 'upcoming', tone: 'var(--brand-navy)' },
  ];
};

function OrderDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams();
  const [order, setOrder] = useState(location.state?.order || null);
  const [isLoading, setIsLoading] = useState(!location.state?.order);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        clearOrderHistoryCache();
        const snapshot = await loadOrderHistorySnapshot();
        if (!active) return;
        const match = (Array.isArray(snapshot.rows) ? snapshot.rows : [])
          .map((row, index) => normalizeOrderRecord(row, index))
          .filter(Boolean)
          .find((candidate) => candidate.id === orderId);
        if (match) setOrder(match);
      } catch {
        // Keep whatever order we already have (passed through navigation state).
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    const refresh = () => { void load(); };
    window.addEventListener('trust-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('trust-changed', refresh);
    };
  }, [orderId]);

  const paymentOrders = useMemo(() => (order ? [order] : []), [order]);
  const { canPay, payOrder, payingOrderId, payMessage } = useOrderPayment(paymentOrders);

  const goBack = () => navigate('/order-history');

  if (!order) {
    return (
      <main className="od-page">
        <OrderPageHeader title="Order Details" onBack={goBack} />
        <div className="od-empty">
          <div className="od-empty-icon"><Package2 className="h-7 w-7" /></div>
          <p className="od-empty-title">{isLoading ? 'Loading order' : 'Order not found'}</p>
          {!isLoading ? (
            <button type="button" className="od-pay-btn" onClick={goBack}>Back to orders</button>
          ) : null}
        </div>
        <style>{styles}</style>
      </main>
    );
  }

  const timeline = buildTimeline(order);
  const showPay = canPay(order);
  const canOpenProduct = Boolean(order.catalogProductId && order.catalogCategoryId);
  const openProduct = () => {
    navigate(`/categories-products/list/${encodeURIComponent(order.catalogCategoryId)}/detail/${encodeURIComponent(order.catalogProductId)}`);
  };

  return (
    <main className="od-page">
      <OrderPageHeader title="Order Details" subtitle={order.trustLabel} onBack={goBack} />

      <section className="od-content">
        <div className="od-product-head">
          <div className="od-thumb">
            <OrderProductImage
              src={order.imageUrl}
              alt={order.productName || 'Product'}
              fallback={<ImageIcon className="h-6 w-6" aria-hidden="true" />}
            />
          </div>
          <div className="od-product-info">
          <div className="od-title-row">
            <h2 className="od-title">{order.productName || `Order #${order.shortId}`}</h2>
            {canOpenProduct ? (
              <button type="button" className="od-product-link" onClick={openProduct} aria-label="View product">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : null}
          </div>
          <div className="od-pills">
            <span className="od-pill" style={getStatusPillStyle(order.statusTone)}>{order.status}</span>
            <span className="od-pill" style={getStatusPillStyle('var(--brand-navy)')}>
              Delivery {(order.deliveryEta || order.trackingStage || 'in progress').toLowerCase()}
            </span>
          </div>
          </div>
        </div>

        {payMessage ? <p className="od-message" role="status">{payMessage}</p> : null}

        <article className="od-card">
          <h3 className="od-card-title">Order summary</h3>
          <dl className="od-rows">
            <div><dt>Items</dt><dd>{order.itemCount}</dd></div>
            {order.attributesLabel
              ? order.attributesLabel.split(' · ').map((attribute) => {
                const [label, ...rest] = attribute.split(': ');
                return <div key={attribute}><dt>{label}</dt><dd>{rest.join(': ')}</dd></div>;
              })
              : null}
          </dl>
          <div className="od-total">
            <span>Total</span>
            <strong>{formatCurrency(order.totalAmount)}</strong>
          </div>
        </article>

        <article className="od-card">
          <h3 className="od-card-title">Order status</h3>
          <ol className="od-timeline">
            {timeline.map((step) => (
              <li key={step.key}>
                <span
                  className={`od-dot od-dot--${step.state}`}
                  style={step.state === 'done'
                    ? { background: step.tone, borderColor: step.tone }
                    : { borderColor: step.tone }}
                >
                  {step.state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                </span>
                <div>
                  <p className="od-step-title">{step.title}</p>
                  <p className="od-step-sub">{step.sub}</p>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="od-card">
          <h3 className="od-card-title">Order info</h3>
          <dl className="od-info">
            <div><dt>Placed on</dt><dd>{formatPlacedOn(order)}</dd></div>
            <div><dt>Seller</dt><dd>{order.trustLabel || '—'}</dd></div>
            <div><dt>Delivery address</dt><dd>{order.deliveryAddress || 'Not available'}</dd></div>
          </dl>
        </article>
      </section>

      {showPay ? (
        <div className="od-bar">
          <div>
            <span className="od-bar-label">Amount due</span>
            <strong className="od-bar-amount">{formatCurrency(order.totalAmount)}</strong>
          </div>
          <button
            type="button"
            className="od-pay-btn"
            disabled={Boolean(payingOrderId)}
            onClick={() => void payOrder(order)}
          >
            {payingOrderId === order.id ? 'Opening payment...' : 'Pay now'}
          </button>
        </div>
      ) : null}

      <style>{styles}</style>
    </main>
  );
}

const styles = `
  .od-page {
    min-height: 100vh;
    background: ${T.page};
    color: ${T.text};
    display: flex;
    flex-direction: column;
  }
  .od-product-head {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }
  /* Same 3:4 ratio the product list cards use, so photos crop the same way. */
  .od-thumb {
    flex: 0 0 auto;
    width: 72px;
    aspect-ratio: 3 / 4;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
    color: var(--brand-navy);
  }
  .od-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .od-product-info {
    flex: 1;
    min-width: 0;
  }
  .od-content {
    flex: 1;
    padding: 16px 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .od-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .od-product-link {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent);
    background: ${T.surface};
    color: var(--brand-navy);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .od-title {
    margin: 0;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: ${T.heading};
    overflow-wrap: anywhere;
  }
  .od-pills {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .od-pill {
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
  }
  .od-message {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: ${T.text};
  }
  .od-card {
    padding: 16px;
    border-radius: 18px;
    background: ${T.surface};
    border: 1px solid ${T.line};
    box-shadow: 0 6px 18px color-mix(in srgb, var(--brand-navy) 8%, transparent);
  }
  .od-card-title {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 800;
    color: ${T.heading};
  }
  .od-rows,
  .od-info {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .od-rows > div {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .od-rows dt {
    color: ${T.muted};
  }
  .od-rows dd {
    margin: 0;
    font-weight: 800;
    color: ${T.heading};
  }
  .od-total {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid ${T.line};
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13px;
    font-weight: 800;
    color: ${T.heading};
  }
  .od-total strong {
    font-size: 20px;
    font-weight: 900;
  }
  .od-timeline {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .od-timeline li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .od-dot {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    margin-top: 1px;
  }
  .od-step-title {
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    color: ${T.heading};
  }
  .od-step-sub {
    margin: 2px 0 0;
    font-size: 12px;
    color: ${T.muted};
  }
  .od-info > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .od-info dt {
    font-size: 11px;
    color: ${T.muted};
  }
  .od-info dd {
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    color: ${T.heading};
    overflow-wrap: anywhere;
  }
  .od-bar {
    position: sticky;
    bottom: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: ${T.surface};
    border-top: 1px solid ${T.line};
    box-shadow: 0 -6px 18px color-mix(in srgb, var(--brand-navy) 8%, transparent);
  }
  .od-bar-label {
    display: block;
    font-size: 11px;
    color: ${T.muted};
  }
  .od-bar-amount {
    font-size: 20px;
    font-weight: 900;
    color: ${T.heading};
  }
  .od-pay-btn {
    min-height: 48px;
    padding: 0 36px;
    border-radius: 999px;
    border: 0;
    background: var(--app-button-bg);
    color: var(--app-button-text);
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
  }
  .od-pay-btn:disabled {
    opacity: 0.6;
  }
  .od-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
  }
  .od-empty-icon {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
    color: var(--brand-navy);
  }
  .od-empty-title {
    margin: 0;
    font-size: 16px;
    font-weight: 900;
    color: ${T.heading};
  }
`;

export default OrderDetails;
