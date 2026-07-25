import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  ChevronDown,
  ChevronUp,
  Package2,
  PackageCheck,
  ShoppingBag,
} from 'lucide-react';
import { loadOrderHistorySnapshot } from './services/orderHistoryService';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';

const T = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  text: 'var(--body-text-color)',
  heading: 'var(--heading-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
};

const ORDER_HISTORY_STORAGE_KEYS = ['order_history_v1', 'order_history', 'orders_v1'];
const ORDER_HISTORY_PAGE_SIZE = 6;
const ORDER_HISTORY_SKELETON_COUNT = 4;
const ORDER_HISTORY_LOAD_MORE_DELAY_MS = 180;
const ORDER_HISTORY_LOAD_MORE_ROOT_MARGIN = '240px';

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const toTitleCase = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

const parseAmount = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const text = normalizeText(value);
  if (!text) return 0;

  const parsed = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value) => `Rs. ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

const formatOrderDate = (value) => {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return 'Date unavailable';

  const date = new Date(ts);
  const datePart = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  return `${datePart} at ${timePart}`;
};

const getStatusMeta = (rawStatus) => {
  const status = normalizeText(rawStatus).toLowerCase();

  if (['delivered', 'completed', 'fulfilled', 'success'].includes(status)) {
    return { group: 'delivered', label: 'Delivered', tone: 'var(--brand-navy)' };
  }

  if (['shipped', 'in transit', 'out for delivery'].includes(status)) {
    return { group: 'active', label: 'In transit', tone: 'var(--app-button-bg)' };
  }

  if (['processing', 'packed', 'confirmed', 'placed'].includes(status)) {
    return { group: 'active', label: 'Processing', tone: 'var(--brand-red)' };
  }

  if (['pending', 'created'].includes(status)) {
    return { group: 'pending', label: 'Pending', tone: 'var(--brand-red-dark)' };
  }

  if (['cancelled', 'canceled', 'returned', 'refunded'].includes(status)) {
    return { group: 'cancelled', label: 'Cancelled', tone: 'var(--brand-red-dark)' };
  }

  return {
    group: status ? 'other' : 'pending',
    label: status ? toTitleCase(status) : 'Pending',
    tone: 'var(--subheading-color)',
  };
};

const normalizeOrderLine = (item, index) => {
  if (typeof item === 'string') {
    const name = normalizeText(item);
    return name ? { key: `${index}`, name, quantity: 1 } : null;
  }

  if (!item || typeof item !== 'object') return null;

  const name = normalizeText(
    item.product_name
    || item.name
    || item.title
    || item.product
    || item.item_name
    || item.label
  );
  if (!name) return null;

  const quantityValue = Number(item.quantity ?? item.qty ?? item.count ?? 1);
  const quantity = Number.isFinite(quantityValue) && quantityValue > 0 ? Math.floor(quantityValue) : 1;

  return {
    key: normalizeText(item.id || item.product_id || item.sku || `${index}`) || `${index}`,
    name,
    quantity,
  };
};

const extractOrderList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.orders)) return value.orders;
  if (Array.isArray(value.history)) return value.history;
  if (Array.isArray(value.items)) return value.items;
  return [];
};

const normalizeOrderRecord = (order, index) => {
  if (!order || typeof order !== 'object') {
    return null;
  }

  const id = normalizeText(
    order.order_id
    || order.orderId
    || order.invoice_no
    || order.invoice_number
    || order.reference
    || order.id
  ) || `ORD-${String(index + 1).padStart(3, '0')}`;

  const createdAtRaw = normalizeText(
    order.created_at
    || order.createdAt
    || order.placed_at
    || order.placedAt
    || order.ordered_at
    || order.date
    || order.timestamp
  );
  const createdAtTs = Date.parse(createdAtRaw);
  const statusMeta = getStatusMeta(order.status || order.order_status || order.state || order.payment_status);

  const rawItems = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.order_items)
      ? order.order_items
      : Array.isArray(order.products)
        ? order.products
        : Array.isArray(order.line_items)
          ? order.line_items
          : [];

  const items = rawItems
    .map((item, itemIndex) => normalizeOrderLine(item, itemIndex))
    .filter(Boolean);

  const itemCountFromLines = items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  const fallbackItemCount = Number(order.item_count ?? order.items_count ?? order.quantity);
  const itemCount = itemCountFromLines > 0
    ? itemCountFromLines
    : (Number.isFinite(fallbackItemCount) && fallbackItemCount > 0 ? Math.floor(fallbackItemCount) : items.length);

  const totalAmount = parseAmount(
    order.total_amount
    || order.grand_total
    || order.amount
    || order.net_amount
    || order.payable_amount
    || order.total
  );
  const trustId = normalizeText(order.trust_id || order.trustId || order.source_trust_id || order.sourceTrustId);
  const trustName = normalizeText(order.trust_name || order.trustName || order.source_trust_name || order.sourceTrustName);
  const source = normalizeText(order.source || order.sourceType || order.source_type) || 'local';

  return {
    id,
    createdAt: createdAtRaw,
    createdAtTs: Number.isNaN(createdAtTs) ? 0 : createdAtTs,
    createdAtLabel: formatOrderDate(createdAtRaw),
    status: statusMeta.label,
    statusGroup: statusMeta.group,
    statusTone: statusMeta.tone,
    paymentMethod: normalizeText(order.payment_method || order.paymentMethod || order.method || order.payment_type),
    deliveryEta: normalizeText(order.estimated_delivery || order.delivery_eta || order.eta || order.expected_delivery),
    trackingStage: normalizeText(order.current_stage || order.tracking_stage || order.fulfillment_stage),
    trustId,
    trustName,
    trustLabel: trustName || trustId || '',
    source,
    itemCount,
    totalAmount,
    items,
  };
};

const readOrderHistory = () => {
  if (typeof window === 'undefined') return [];

  for (const key of ORDER_HISTORY_STORAGE_KEYS) {
    const parsed = safeParse(window.localStorage.getItem(key) || '');
    const list = extractOrderList(parsed);
    if (!Array.isArray(list) || list.length === 0) continue;
    return list
      .map((order, index) => normalizeOrderRecord(order, index))
      .filter(Boolean)
      .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0));
  }

  return [];
};

const getStatusChipStyles = (order) => ({
  color: order.statusTone,
  background: `color-mix(in srgb, ${order.statusTone} 12%, var(--surface-color))`,
  border: `1px solid color-mix(in srgb, ${order.statusTone} 22%, transparent)`,
});

const OrderHistorySummarySkeletonCard = () => (
  <article className="order-history-summary-card order-history-summary-card--skeleton" aria-hidden="true">
    <div className="order-history-skeleton order-history-skeleton-icon" />
    <div className="order-history-skeleton order-history-skeleton-line" style={{ width: '48%', height: 11 }} />
    <div className="order-history-skeleton order-history-skeleton-line" style={{ width: '68%', height: 18 }} />
    <div className="order-history-skeleton order-history-skeleton-line" style={{ width: '84%', height: 12 }} />
  </article>
);

const OrderHistoryCardSkeleton = () => (
  <article className="order-history-card order-history-card--skeleton" aria-hidden="true">
    <div className="order-history-card-top">
      <div className="min-w-0 flex-1">
        <div className="order-history-skeleton order-history-skeleton-line" style={{ width: '46%', height: 15 }} />
        <div className="order-history-skeleton order-history-skeleton-line" style={{ width: '34%', height: 12, marginTop: 8 }} />
        <div className="order-history-skeleton order-history-skeleton-pill" style={{ width: 104, height: 24, marginTop: 10 }} />
      </div>
      <div className="order-history-skeleton order-history-skeleton-pill" style={{ width: 74, height: 30 }} />
    </div>

    <div className="order-history-meta-grid">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="order-history-skeleton order-history-skeleton-meta" />
      ))}
    </div>

    <div className="order-history-item-chips">
      <div className="order-history-skeleton order-history-skeleton-chip" style={{ width: 92 }} />
      <div className="order-history-skeleton order-history-skeleton-chip" style={{ width: 76 }} />
      <div className="order-history-skeleton order-history-skeleton-chip" style={{ width: 58 }} />
    </div>
  </article>
);

function OrderHistory() {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [orders, setOrders] = useState(() => readOrderHistory());
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [trustCount, setTrustCount] = useState(0);
  const [trustErrors, setTrustErrors] = useState([]);
  const [historySource, setHistorySource] = useState('local');
  const [visibleCount, setVisibleCount] = useState(ORDER_HISTORY_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef(null);
  const loadMoreFrameRef = useRef(null);
  const loadMoreTimeoutRef = useRef(null);

  useEffect(() => {
    let active = true;

    const applySnapshot = async () => {
      if (active) {
        setIsLoading(true);
      }

      try {
        const snapshot = await loadOrderHistorySnapshot();
        if (!active) return;

        const normalizedOrders = Array.isArray(snapshot.rows)
          ? snapshot.rows
            .map((order, index) => normalizeOrderRecord(order, index))
            .filter(Boolean)
            .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0))
          : [];

        setOrders(normalizedOrders);
        setTrustCount(Array.isArray(snapshot.trustContexts) ? snapshot.trustContexts.length : 0);
        setTrustErrors(Array.isArray(snapshot.trustErrors) ? snapshot.trustErrors : []);

        const hasRemoteRows = Array.isArray(snapshot.remoteRows) && snapshot.remoteRows.length > 0;
        const hasLocalRows = Array.isArray(snapshot.localRows) && snapshot.localRows.length > 0;
        setHistorySource(hasRemoteRows && hasLocalRows ? 'mixed' : hasRemoteRows ? 'rpc' : 'local');
      } catch (error) {
        if (!active) return;
        setOrders(readOrderHistory());
        setTrustCount(0);
        setTrustErrors([{
          trustId: null,
          trustName: null,
          message: error?.message || 'Failed to load order history',
        }]);
        setHistorySource('local');
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    const refresh = () => {
      void applySnapshot();
    };

    const handleStorage = (event) => {
      if (
        !event?.key
        || ORDER_HISTORY_STORAGE_KEYS.includes(event.key)
        || event.key === 'user'
        || event.key === 'selected_trust_id'
        || event.key === 'selected_trust_name'
        || event.key === 'last_selected_trust_id'
      ) {
        refresh();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    refresh();

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', refresh);
    window.addEventListener('trust-changed', refresh);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('trust-changed', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (loadMoreTimeoutRef.current) {
      window.clearTimeout(loadMoreTimeoutRef.current);
      loadMoreTimeoutRef.current = null;
    }
    if (loadMoreFrameRef.current) {
      window.cancelAnimationFrame(loadMoreFrameRef.current);
      loadMoreFrameRef.current = null;
    }

    setLoadingMore(false);
    setVisibleCount(ORDER_HISTORY_PAGE_SIZE);
  }, [orders]);

  const summary = useMemo(() => {
    const totalOrders = orders.length;
    const deliveredOrders = orders.filter((order) => order.statusGroup === 'delivered').length;
    const activeOrders = orders.filter((order) => order.statusGroup === 'active' || order.statusGroup === 'pending').length;
    const totalSpent = orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const latestOrder = orders[0] || null;

    return {
      totalOrders,
      deliveredOrders,
      activeOrders,
      totalSpent,
      latestOrder,
    };
  }, [orders]);

  const isInitialLoading = isLoading && orders.length === 0;
  const visibleOrders = useMemo(() => orders.slice(0, visibleCount), [orders, visibleCount]);
  const hasMoreOrders = visibleCount < orders.length;

  const historySourceLabel = historySource === 'mixed'
    ? 'RPC + local cache'
    : historySource === 'rpc'
      ? 'Live RPC sync'
      : isLoading
        ? 'Syncing linked trusts'
        : 'Local cache fallback';

  const trustOverviewLabel = isLoading && orders.length === 0
    ? 'Loading orders from your linked trusts...'
    : trustCount > 0
      ? `Showing orders across ${trustCount} linked trust${trustCount === 1 ? '' : 's'}`
      : 'Showing locally saved orders until trust data is available';

  const sectionCopy = isLoading && orders.length === 0
    ? 'Fetching the latest purchases from every trust tied to this member.'
    : 'Latest orders appear first and stay within the current theme tokens.';

  const trustWarning = trustErrors.length > 0
    ? (trustErrors.length === 1
      ? `${trustErrors[0]?.trustName || trustErrors[0]?.trustId || 'One trust'} could not be loaded. Showing the rest from the API and local cache.`
      : `${trustErrors.length} trusts could not be loaded. Showing the rest from the API and local cache.`)
    : '';

  const latestOrderMetaLabel = summary.latestOrder
    ? summary.latestOrder.createdAtLabel
    : isInitialLoading
      ? 'Loading latest order...'
      : 'No recent order yet';
  const totalOrdersMetaLabel = isInitialLoading
    ? 'Loading orders...'
    : `${summary.totalOrders} order${summary.totalOrders === 1 ? '' : 's'}`;

  const summaryCards = useMemo(() => ([
    {
      label: 'Total Orders',
      value: summary.totalOrders,
      helper: summary.latestOrder
        ? `Latest: ${summary.latestOrder.id}${summary.latestOrder.trustLabel ? ` | ${summary.latestOrder.trustLabel}` : ''}`
        : trustOverviewLabel,
      tone: 'var(--brand-navy)',
      icon: Package2,
    },
    {
      label: 'Active',
      value: summary.activeOrders,
      helper: summary.activeOrders > 0 ? 'Processing or in transit' : 'Nothing active right now',
      tone: 'var(--app-button-bg)',
      icon: Clock3,
    },
    {
      label: 'Delivered',
      value: summary.deliveredOrders,
      helper: summary.totalOrders > 0 ? `${Math.round((summary.deliveredOrders / summary.totalOrders) * 100) || 0}% complete` : 'Awaiting first delivery',
      tone: 'var(--brand-red)',
      icon: PackageCheck,
    },
    {
      label: 'Total Spent',
      value: formatCurrency(summary.totalSpent),
      helper: summary.totalOrders > 0
        ? `${summary.totalOrders} order${summary.totalOrders === 1 ? '' : 's'}${trustCount > 0 ? ` across ${trustCount} trust${trustCount === 1 ? '' : 's'}` : ''}`
        : 'No spend recorded',
      tone: 'var(--heading-color)',
      icon: CircleDollarSign,
    },
  ]), [summary, trustCount, trustOverviewLabel]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof window === 'undefined' || isLoading || isInitialLoading || !hasMoreOrders) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount((current) => Math.max(current, orders.length));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadMoreTimeoutRef.current || loadMoreFrameRef.current) {
          return;
        }

        setLoadingMore(true);
        loadMoreFrameRef.current = window.requestAnimationFrame(() => {
          loadMoreFrameRef.current = null;
          loadMoreTimeoutRef.current = window.setTimeout(() => {
            loadMoreTimeoutRef.current = null;
            setVisibleCount((current) => Math.min(current + ORDER_HISTORY_PAGE_SIZE, orders.length));
            setLoadingMore(false);
          }, ORDER_HISTORY_LOAD_MORE_DELAY_MS);
        });
      },
      {
        root: null,
        rootMargin: ORDER_HISTORY_LOAD_MORE_ROOT_MARGIN,
        threshold: 0.01,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreOrders, isLoading, isInitialLoading, orders.length]);

  return (
    <main className="order-history-page">
      <div
        className="theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: '0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)',
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="px-4 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="p-2 rounded-xl transition-colors"
              style={{
                color: navbarTextColor,
                background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
              }}
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <h1 className="truncate text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>
                Order History
              </h1>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 66%, var(--surface-color))' }}>
                All trusts linked to your account
              </p>
            </div>
            <div className="w-10" aria-hidden="true" />
          </div>
        </div>
      </div>

      <section className="order-history-content">
        <div className="order-history-summary-toggle-row">
          <button
            type="button"
            className="order-history-summary-toggle"
            onClick={() => setIsSummaryOpen((prev) => !prev)}
            aria-expanded={isSummaryOpen}
            aria-controls="order-history-summary-panel"
          >
            <span>Orders Summary</span>
            {isSummaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {isSummaryOpen ? (
          <div id="order-history-summary-panel" className="order-history-summary-panel">
            <div className="order-history-hero">
              <div className="order-history-hero-copy">
                <span className="order-history-pill">{historySourceLabel}</span>
                <h2 className="order-history-hero-title">Your orders, across every linked trust</h2>
                <p className="order-history-hero-text">
                  Review the purchase trail for every trust tied to this member, powered by the purchase RPC.
                </p>
                <div className="order-history-hero-meta">
                  <span className="order-history-hero-meta-item">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>{latestOrderMetaLabel}</span>
                  </span>
                  <span className="order-history-hero-meta-item">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>{totalOrdersMetaLabel}</span>
                  </span>
                </div>
                <p className="order-history-hero-trust-note">{trustOverviewLabel}</p>
              </div>

              <div className="order-history-hero-badge">
                <Package2 className="h-5 w-5" />
                <span>{isInitialLoading ? '...' : summary.totalOrders || 0}</span>
              </div>
            </div>

            {trustWarning ? (
              <div className="order-history-alert" role="status">
                <strong>Partial history loaded</strong>
                <p>{trustWarning}</p>
              </div>
            ) : null}

            <div className="order-history-summary-grid">
              {isInitialLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                  <OrderHistorySummarySkeletonCard key={`summary-skeleton-${index}`} />
                ))
                : summaryCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <article
                      key={card.label}
                      className="order-history-summary-card"
                      style={{
                        borderColor: `color-mix(in srgb, ${card.tone} 18%, transparent)`,
                        background: `linear-gradient(180deg, color-mix(in srgb, ${card.tone} 9%, var(--surface-color)) 0%, color-mix(in srgb, var(--surface-color) 94%, var(--app-accent-bg)) 100%)`,
                        boxShadow: `0 12px 28px color-mix(in srgb, ${card.tone} 8%, transparent)`,
                      }}
                    >
                      <div className="order-history-summary-icon" style={{ background: `color-mix(in srgb, ${card.tone} 12%, var(--surface-color))` }}>
                        <Icon className="h-4 w-4" style={{ color: card.tone }} />
                      </div>
                      <p className="order-history-summary-label">{card.label}</p>
                      <strong className="order-history-summary-value" style={{ color: T.heading }}>{card.value}</strong>
                      <p className="order-history-summary-helper">{card.helper}</p>
                    </article>
                  );
                })}
            </div>
          </div>
        ) : null}

        <section className="order-history-section">
          <div className="order-history-section-head">
            <div>
              <h3 className="order-history-section-title" style={{ color: T.heading }}>
                Recent Orders
              </h3>
              <p className="order-history-section-copy">
                {sectionCopy}
              </p>
            </div>
          </div>

          {isInitialLoading ? (
            <div className="order-history-list">
              {Array.from({ length: ORDER_HISTORY_SKELETON_COUNT }).map((_, index) => (
                <OrderHistoryCardSkeleton key={`order-skeleton-${index}`} />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="order-history-empty">
              <div
                className="order-history-empty-icon"
                style={{
                  background: 'color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color))',
                  color: 'var(--brand-navy)',
                }}
              >
                <Package2 className="h-7 w-7" />
              </div>
              <p className="order-history-empty-title">{isLoading ? 'Loading order history' : 'No order history yet'}</p>
              <p className="order-history-empty-copy">
                {isLoading
                  ? 'Fetching orders from the trusts linked to your account.'
                  : 'Orders placed on any linked trust will show up here once they are available.'}
              </p>
              <div className="order-history-empty-actions">
                <button
                  type="button"
                  className="order-history-primary-btn"
                  onClick={() => navigate('/categories-products')}
                >
                  Browse products
                </button>
                <button
                  type="button"
                  className="order-history-secondary-btn"
                  onClick={() => navigate('/')}
                >
                  Go home
                </button>
              </div>
            </div>
          ) : (
            <div className="order-history-list">
              {visibleOrders.map((order) => {
                const previewChips = order.items.slice(0, 3);
                const remainingCount = Math.max(0, order.items.length - previewChips.length);

                return (
                  <article key={order.id} className="order-history-card">
                    <div className="order-history-card-top">
                      <div className="min-w-0">
                        <p className="order-history-card-id">{order.id}</p>
                        <p className="order-history-card-date">{order.createdAtLabel}</p>
                        {order.trustLabel ? (
                          <p className="order-history-trust-row">
                            <span className="order-history-trust-chip">Trust: {order.trustLabel}</span>
                          </p>
                        ) : null}
                      </div>
                      <span className="order-history-status" style={getStatusChipStyles(order)}>
                        {order.status}
                      </span>
                    </div>

                    <div className="order-history-meta-grid">
                      <div className="order-history-meta-item">
                        <span className="order-history-meta-label">Items</span>
                        <strong className="order-history-meta-value">{order.itemCount}</strong>
                      </div>
                      <div className="order-history-meta-item">
                        <span className="order-history-meta-label">Total</span>
                        <strong className="order-history-meta-value">{formatCurrency(order.totalAmount)}</strong>
                      </div>
                      <div className="order-history-meta-item">
                        <span className="order-history-meta-label">Payment</span>
                        <strong className="order-history-meta-value">{order.paymentMethod || 'Not set'}</strong>
                      </div>
                      <div className="order-history-meta-item">
                        <span className="order-history-meta-label">Delivery</span>
                        <strong className="order-history-meta-value">{order.deliveryEta || order.trackingStage || 'In progress'}</strong>
                      </div>
                    </div>

                    {previewChips.length > 0 ? (
                      <div className="order-history-item-chips">
                        {previewChips.map((item) => (
                          <span key={item.key} className="order-history-item-chip">
                            {item.name}
                            {item.quantity > 1 ? ` x${item.quantity}` : ''}
                          </span>
                        ))}
                        {remainingCount > 0 ? (
                          <span className="order-history-item-chip">
                            +{remainingCount} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {loadingMore ? (
                <>
                  {Array.from({ length: 2 }).map((_, index) => (
                    <OrderHistoryCardSkeleton key={`order-more-skeleton-${index}`} />
                  ))}
                </>
              ) : null}
              {hasMoreOrders ? (
                <div ref={sentinelRef} className="order-history-sentinel" aria-hidden="true" />
              ) : null}
              {loadingMore ? (
                <p className="order-history-loading-more-copy">Loading more orders...</p>
              ) : null}
            </div>
          )}
        </section>
      </section>

      <style>{`
        .order-history-page {
          min-height: 100vh;
          background: ${T.page};
          color: ${T.text};
        }
        .order-history-content {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .order-history-summary-toggle-row {
          display: flex;
          justify-content: flex-start;
        }
        .order-history-summary-toggle {
          min-height: 42px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--brand-navy);
          background: color-mix(in srgb, var(--surface-color) 88%, var(--app-accent-bg));
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 0 10px 22px color-mix(in srgb, var(--brand-navy) 6%, transparent);
          transition: transform 0.18s ease, background-color 0.18s ease;
        }
        .order-history-summary-toggle:active {
          transform: scale(0.98);
        }
        .order-history-summary-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .order-history-hero {
          border-radius: 24px;
          padding: 18px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--brand-navy) 8%, var(--surface-color)) 0%, color-mix(in srgb, var(--surface-color) 96%, var(--app-accent-bg)) 100%);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent);
          box-shadow: 0 16px 34px color-mix(in srgb, var(--brand-navy) 8%, transparent);
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          align-items: start;
        }
        .order-history-hero-copy {
          min-width: 0;
        }
        .order-history-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--brand-navy);
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          border: 1px solid color-mix(in srgb, var(--brand-navy) 20%, transparent);
        }
        .order-history-hero-title {
          margin: 12px 0 0;
          font-size: 22px;
          line-height: 1.15;
          font-weight: 900;
          color: ${T.heading};
          letter-spacing: -0.03em;
        }
        .order-history-hero-text {
          margin: 10px 0 0;
          font-size: 13px;
          line-height: 1.6;
          color: ${T.muted};
        }
        .order-history-hero-trust-note {
          margin: 10px 0 0;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--brand-navy) 82%, var(--surface-color));
        }
        .order-history-hero-meta {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .order-history-hero-meta-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          color: ${T.heading};
          background: color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg));
          border: 1px solid ${T.line};
        }
        .order-history-hero-badge {
          min-width: 60px;
          height: 60px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 4px;
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          color: var(--brand-navy);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          font-weight: 900;
          box-shadow: 0 10px 20px color-mix(in srgb, var(--brand-navy) 6%, transparent);
        }
        .order-history-alert {
          border-radius: 20px;
          padding: 14px 16px;
          border: 1px solid color-mix(in srgb, var(--brand-red) 20%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, var(--brand-red) 8%, var(--surface-color)) 0%, color-mix(in srgb, var(--surface-color) 96%, var(--app-accent-bg)) 100%);
          box-shadow: 0 10px 24px color-mix(in srgb, var(--brand-red) 8%, transparent);
        }
        .order-history-alert strong {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--brand-red);
        }
        .order-history-alert p {
          margin: 0;
          font-size: 13px;
          line-height: 1.6;
          color: ${T.muted};
        }
        .order-history-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .order-history-summary-card {
          border-radius: 20px;
          padding: 14px;
          border: 1px solid;
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-height: 134px;
        }
        .order-history-summary-card--skeleton {
          background: linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 92%, var(--app-accent-bg)) 0%, color-mix(in srgb, var(--surface-color) 97%, var(--page-bg)) 100%);
        }
        .order-history-summary-icon {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .order-history-summary-label {
          margin: 2px 0 0;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: ${T.muted};
        }
        .order-history-summary-value {
          font-size: 18px;
          line-height: 1.2;
          letter-spacing: -0.03em;
        }
        .order-history-summary-helper {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: ${T.muted};
        }
        .order-history-skeleton {
          position: relative;
          overflow: hidden;
          border-radius: 14px;
          background: color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg));
        }
        .order-history-skeleton::after {
          content: '';
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, #fff 22%, transparent) 50%, transparent 100%);
          animation: order-history-shimmer 1.75s ease-in-out infinite;
        }
        @keyframes order-history-shimmer {
          100% {
            transform: translateX(100%);
          }
        }
        .order-history-skeleton-icon {
          width: 34px;
          height: 34px;
          border-radius: 12px;
        }
        .order-history-skeleton-line {
          border-radius: 999px;
        }
        .order-history-skeleton-pill {
          border-radius: 999px;
        }
        .order-history-skeleton-meta {
          min-height: 58px;
          border-radius: 16px;
        }
        .order-history-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .order-history-section-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
        }
        .order-history-section-title {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }
        .order-history-section-copy {
          margin: 6px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: ${T.muted};
        }
        .order-history-empty {
          min-height: 44vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 8px;
          padding: 16px 8px;
        }
        .order-history-empty-icon {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent);
        }
        .order-history-empty-title {
          margin: 8px 0 0;
          font-size: 16px;
          font-weight: 900;
          color: ${T.heading};
        }
        .order-history-empty-copy {
          margin: 0;
          max-width: 280px;
          font-size: 13px;
          line-height: 1.6;
          color: ${T.muted};
        }
        .order-history-empty-actions {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-top: 10px;
          max-width: 280px;
        }
        .order-history-primary-btn,
        .order-history-secondary-btn {
          min-height: 46px;
          border-radius: 14px;
          border: 0;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease;
        }
        .order-history-primary-btn {
          color: var(--app-button-text);
          background: var(--app-button-bg);
        }
        .order-history-secondary-btn {
          color: ${T.heading};
          background: color-mix(in srgb, var(--surface-color) 78%, var(--app-accent-bg));
          border: 1px solid ${T.line};
        }
        .order-history-primary-btn:active,
        .order-history-secondary-btn:active {
          transform: scale(0.98);
        }
        .order-history-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .order-history-card {
          border-radius: 20px;
          padding: 16px;
          background: var(--surface-color);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent);
          box-shadow: 0 14px 28px color-mix(in srgb, var(--brand-navy) 8%, transparent);
        }
        .order-history-card--skeleton {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .order-history-card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .order-history-card-id {
          margin: 0;
          font-size: 15px;
          font-weight: 900;
          color: ${T.heading};
        }
        .order-history-card-date {
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: ${T.muted};
        }
        .order-history-trust-row {
          margin: 8px 0 0;
        }
        .order-history-trust-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          background: color-mix(in srgb, var(--brand-navy) 8%, var(--surface-color));
          color: var(--brand-navy);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .order-history-status {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .order-history-meta-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .order-history-meta-item {
          border-radius: 16px;
          padding: 10px 12px;
          background: color-mix(in srgb, var(--surface-color) 88%, var(--app-accent-bg));
          border: 1px solid ${T.line};
        }
        .order-history-meta-label {
          display: block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: ${T.muted};
        }
        .order-history-meta-value {
          display: block;
          margin-top: 4px;
          font-size: 13px;
          font-weight: 900;
          color: ${T.heading};
          word-break: break-word;
        }
        .order-history-item-chips {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .order-history-item-chip {
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 700;
          color: ${T.muted};
          background: color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg));
          border: 1px solid ${T.line};
        }
        .order-history-sentinel {
          width: 100%;
          height: 1px;
        }
        .order-history-loading-more-copy {
          margin: 0;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: ${T.muted};
        }
        @media (max-width: 380px) {
          .order-history-hero {
            grid-template-columns: 1fr;
          }
          .order-history-hero-badge {
            width: 56px;
            height: 56px;
          }
          .order-history-summary-grid,
          .order-history-meta-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

export default OrderHistory;
