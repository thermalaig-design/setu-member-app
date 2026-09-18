import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CircleDollarSign,
  Clock3,
  ChevronDown,
  ChevronUp,
  Package2,
  PackageCheck,
} from 'lucide-react';
import {
  clearOrderHistoryCache,
  loadOrderHistorySnapshot,
  resolveOrderHistoryTrustScope,
} from './services/orderHistoryService';
import {
  ORDER_HISTORY_UNKNOWN_TRUST_KEY,
  ORDER_HISTORY_UNKNOWN_TRUST_LABEL,
  normalizeText,
  formatCurrency,
  normalizeOrderRecord,
} from './utils/orderHistoryDisplay';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { getAppHomePath } from './utils/tenantNavigation';

const T = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  text: 'var(--body-text-color)',
  heading: 'var(--heading-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
};

const ORDER_HISTORY_PAGE_SIZE = 6;
const ORDER_HISTORY_SKELETON_COUNT = 4;
const ORDER_HISTORY_LOAD_MORE_DELAY_MS = 180;
const ORDER_HISTORY_LOAD_MORE_ROOT_MARGIN = '240px';

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

export function OrderHistoryContent({ variant = 'page' } = {}) {
  const isPageVariant = variant === 'page';
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [orders, setOrders] = useState([]);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [trustErrors, setTrustErrors] = useState([]);
  const [selectedTrustKey, setSelectedTrustKey] = useState('');
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
        clearOrderHistoryCache();
        const snapshot = await loadOrderHistorySnapshot();
        if (!active) return;

        const normalizedOrders = Array.isArray(snapshot.rows)
          ? snapshot.rows
            .map((order, index) => normalizeOrderRecord(order, index))
            .filter(Boolean)
            .sort((a, b) => (b.createdAtTs || 0) - (a.createdAtTs || 0))
          : [];

        setOrders(normalizedOrders);
        setTrustErrors(Array.isArray(snapshot.trustErrors) ? snapshot.trustErrors : []);
      } catch (error) {
        if (!active) return;
        setOrders([]);
        setTrustErrors([{
          trustId: null,
          trustName: null,
          message: error?.message || 'Failed to load order history',
        }]);
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
        || event.key === 'user'
        || event.key === 'selected_trust_id'
        || event.key === 'selected_trust_name'
        || event.key === 'last_selected_trust_id'
        || event.key === 'default_trust_cache'
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

  const summary = useMemo(() => {
    const totalOrders = orders.length;
    const pendingOrders = orders.filter((order) => order.statusGroup === 'pending').length;
    const doneOrders = orders.filter((order) => order.statusGroup === 'active').length;
    const totalSpent = orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const latestOrder = orders[0] || null;

    return {
      totalOrders,
      pendingOrders,
      doneOrders,
      totalSpent,
      latestOrder,
    };
  }, [orders]);

  const isInitialLoading = isLoading && orders.length === 0;
  const trustTabs = useMemo(() => {
    const tabs = [];
    const tabMap = new Map();

    orders.forEach((order) => {
      const key = normalizeText(order.trustKey || order.trustId || order.trustLabel) || ORDER_HISTORY_UNKNOWN_TRUST_KEY;
      const label = normalizeText(order.trustLabel || order.trustName || order.trustId) || ORDER_HISTORY_UNKNOWN_TRUST_LABEL;

      if (tabMap.has(key)) {
        tabMap.get(key).count += 1;
        return;
      }

      const tab = { key, label, count: 1 };
      tabMap.set(key, tab);
      tabs.push(tab);
    });

    return tabs;
  }, [orders]);
  const visibleTrustCount = trustTabs.length;

  const selectedTrustTab = useMemo(() => {
    if (trustTabs.length === 0) return null;
    if (!selectedTrustKey) return trustTabs[0];
    return trustTabs.find((tab) => tab.key === selectedTrustKey) || trustTabs[0];
  }, [selectedTrustKey, trustTabs]);

  const activeTrustKey = selectedTrustTab?.key || '';
  const visibleOrdersSource = useMemo(() => {
    if (!activeTrustKey) return orders;
    return orders.filter((order) => (order.trustKey || order.trustId || order.trustLabel || ORDER_HISTORY_UNKNOWN_TRUST_KEY) === activeTrustKey);
  }, [activeTrustKey, orders]);

  const visibleOrders = useMemo(() => visibleOrdersSource.slice(0, visibleCount), [visibleCount, visibleOrdersSource]);
  
  const hasMoreOrders = visibleCount < visibleOrdersSource.length;
  const orderHistoryTrustScope = resolveOrderHistoryTrustScope();
  const isAllTrustsMode = orderHistoryTrustScope.isDefaultTrustSelected;

  const headerSubtitle = trustTabs.length === 1
    ? `Orders from ${trustTabs[0].label}`
    : 'All trusts linked to your account';

  const trustOverviewLabel = isLoading && orders.length === 0
    ? (isAllTrustsMode ? 'Loading orders from all linked trusts...' : 'Loading orders from the selected trust...')
    : visibleTrustCount > 0
      ? `Showing orders across ${visibleTrustCount} trust${visibleTrustCount === 1 ? '' : 's'} with purchases`
      : 'Showing locally saved orders until trust data is available';

  const sectionCopy = isLoading && orders.length === 0
    ? (isAllTrustsMode
      ? 'Fetching the latest purchases from every linked trust.'
      : 'Fetching the latest purchases from the selected trust.')
    : trustTabs.length > 1
      ? 'Switch between trusts using the tabs below.'
      : 'Latest orders appear first.';

  const trustWarning = trustErrors.length > 0
    ? (trustErrors.length === 1
      ? `${trustErrors[0]?.trustName || trustErrors[0]?.trustId || 'One trust'} could not be loaded. Showing the rest from the backend.`
      : `${trustErrors.length} trusts could not be loaded. Showing the rest from the backend.`)
    : '';

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
      label: 'Payment Pending',
      value: summary.pendingOrders,
      helper: summary.pendingOrders > 0 ? 'Waiting on payment' : 'Nothing pending right now',
      tone: 'var(--app-button-bg)',
      icon: Clock3,
    },
    {
      label: 'Payment Done',
      value: summary.doneOrders,
      helper: summary.totalOrders > 0 ? `${Math.round((summary.doneOrders / summary.totalOrders) * 100) || 0}% of orders` : 'No paid orders yet',
      tone: 'var(--brand-red)',
      icon: PackageCheck,
    },
    {
      label: 'Total Spent',
      value: formatCurrency(summary.totalSpent),
      helper: summary.totalOrders > 0
        ? `${summary.totalOrders} order${summary.totalOrders === 1 ? '' : 's'}${visibleTrustCount > 0 ? ` across ${visibleTrustCount} trust${visibleTrustCount === 1 ? '' : 's'}` : ''}`
        : 'No spend recorded',
      tone: 'var(--heading-color)',
      icon: CircleDollarSign,
    },
  ]), [summary, trustOverviewLabel, visibleTrustCount]);

  useEffect(() => {
    if (trustTabs.length === 0) {
      setSelectedTrustKey('');
      return;
    }

    setSelectedTrustKey((current) => (
      current && trustTabs.some((tab) => tab.key === current)
        ? current
        : trustTabs[0].key
    ));
  }, [trustTabs]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof window === 'undefined' || isLoading || isInitialLoading || !hasMoreOrders) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount((current) => Math.max(current, visibleOrdersSource.length));
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
            setVisibleCount((current) => Math.min(current + ORDER_HISTORY_PAGE_SIZE, visibleOrdersSource.length));
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
  }, [activeTrustKey, hasMoreOrders, isLoading, isInitialLoading, visibleOrdersSource.length]);

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
  }, [orders, activeTrustKey]);

  const selectedTrustOrderCountLabel = selectedTrustTab
    ? `Showing ${visibleOrdersSource.length} order${visibleOrdersSource.length === 1 ? '' : 's'} for ${selectedTrustTab.label}`
    : '';

  return (
    <main className={isPageVariant ? 'order-history-page' : undefined}>
      {isPageVariant && (
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
                onClick={() => navigate(getAppHomePath())}
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
                  {headerSubtitle}
                </p>
              </div>
              <div className="w-10" aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

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
                        borderColor: `color-mix(in srgb, ${card.tone} 20%, color-mix(in srgb, var(--surface-color) 14%, transparent))`,
                        background: `color-mix(in srgb, ${card.tone} 6%, color-mix(in srgb, var(--surface-color) 10%, var(--app-accent-bg)))`,
                        boxShadow: `0 12px 28px color-mix(in srgb, var(--brand-navy) 10%, transparent)`,
                      }}
                    >
                      <div className="order-history-summary-icon" style={{ background: `color-mix(in srgb, ${card.tone} 14%, var(--surface-color))` }}>
                        <Icon className="h-4 w-4" style={{ color: card.tone }} />
                      </div>
                      <p className="order-history-summary-label">{card.label}</p>
                      <strong className="order-history-summary-value" style={{ color: 'var(--surface-color)' }}>{card.value}</strong>
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
              <h3 className="order-history-section-title" style={{ color: navbarTextColor }}>
                Recent Orders
              </h3>
              <p className="order-history-section-copy">
                {sectionCopy}
              </p>
            </div>
          </div>

          {trustTabs.length > 1 ? (
            <>
              <div className="order-history-trust-tabs" role="tablist" aria-label="Filter recent orders by trust">
                {trustTabs.map((tab) => {
                  const isActive = tab.key === activeTrustKey;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      className={`order-history-trust-tab${isActive ? ' order-history-trust-tab--active' : ''}`}
                      onClick={() => setSelectedTrustKey(tab.key)}
                      aria-pressed={isActive}
                    >
                      <span className="order-history-trust-tab-label">{tab.label}</span>
                      <span className="order-history-trust-tab-count">{tab.count}</span>
                    </button>
                  );
                })}
              </div>

              {selectedTrustOrderCountLabel ? (
                <p className="order-history-trust-tab-note">{selectedTrustOrderCountLabel}</p>
              ) : null}
            </>
          ) : null}

          {isInitialLoading ? (
            <div className="order-history-list">
              {Array.from({ length: ORDER_HISTORY_SKELETON_COUNT }).map((_, index) => (
                <OrderHistoryCardSkeleton key={`order-skeleton-${index}`} />
              ))}
            </div>
          ) : visibleOrdersSource.length === 0 ? (
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
                  onClick={() => navigate(getAppHomePath())}
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
                const productSummary = previewChips
                  .map((item) => `${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`)
                  .join(', ');
                const hasProductSummary = Boolean(productSummary);

                return (
                  <article key={order.id} className="order-history-card">

                    <div className="order-history-card-top">
                      <div className="min-w-0">
                        {hasProductSummary ? (
                          <p className="order-history-card-product" style={{ color: navbarTextColor }}>
                            {productSummary}
                            {remainingCount > 0 ? ` +${remainingCount} more` : ''}
                          </p>
                        ) : null}
                        <p
                          className={hasProductSummary ? 'order-history-card-id order-history-card-id--secondary' : 'order-history-card-id'}
                          style={hasProductSummary ? undefined : { color: navbarTextColor }}
                        >
                          {hasProductSummary ? `Order #${order.id}` : order.id}
                        </p>
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
                        <span className="order-history-meta-label">Attributes</span>
                        <strong className="order-history-meta-value">{order.attributesLabel || 'No variant'}</strong>
                      </div>
                      <div className="order-history-meta-item">
                        <span className="order-history-meta-label">Delivery</span>
                        <strong className="order-history-meta-value">{order.deliveryEta || order.trackingStage || 'In progress'}</strong>
                      </div>
                    </div>
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
          background: color-mix(in srgb, var(--surface-color) 10%, var(--app-accent-bg));
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
          color: color-mix(in srgb, var(--surface-color) 52%, ${navbarTextColor} 100%);
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
          color: color-mix(in srgb, var(--surface-color) 70%, transparent);
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
        .order-history-trust-tabs {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow-x: auto;
          padding: 2px 1px 4px;
          margin-top: 2px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .order-history-trust-tabs::-webkit-scrollbar {
          display: none;
        }
        .order-history-trust-tab {
          flex: 0 0 auto;
          min-height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg));
          color: ${T.muted};
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
        }
        .order-history-trust-tab:active {
          transform: scale(0.98);
        }
        .order-history-trust-tab--active {
          color: var(--brand-navy);
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          border-color: color-mix(in srgb, var(--brand-navy) 22%, transparent);
          box-shadow: 0 8px 18px color-mix(in srgb, var(--brand-navy) 7%, transparent);
        }
        .order-history-trust-tab-label {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .order-history-trust-tab-count {
          min-width: 20px;
          height: 20px;
          padding: 0 6px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          color: var(--brand-navy);
          font-size: 10px;
          font-weight: 900;
        }
        .order-history-trust-tab--active .order-history-trust-tab-count {
          background: color-mix(in srgb, var(--brand-navy) 16%, var(--surface-color));
        }
        .order-history-trust-tab-note {
          margin: 0;
          font-size: 11px;
          line-height: 1.4;
          font-weight: 700;
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
          background: linear-gradient(180deg,
            color-mix(in srgb, var(--surface-color) 10%, var(--app-accent-bg)) 99%,
            color-mix(in srgb, var(--surface-color) 10%, var(--app-accent-bg)) 100%
          );
          border: 1px solid color-mix(in srgb, var(--surface-color) 14%, transparent);
          box-shadow:
            0 16px 32px color-mix(in srgb, var(--brand-navy) 12%, transparent),
            inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent);
          color: var(--surface-color);
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
        .order-history-card-product {
          margin: 0;
          font-size: 15px;
          font-weight: 900;
          line-height: 1.3;
          color: inherit;
          overflow-wrap: break-word;
        }
        .order-history-card-id {
          margin: 0;
          font-size: 15px;
          font-weight: 900;
          color: inherit;
        }
        .order-history-card-id--secondary {
          margin-top: 3px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
          color: color-mix(in srgb, currentColor 62%, transparent);
        }
        .order-history-card-date {
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: color-mix(in srgb, currentColor 70%, transparent);
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
          border: 1px solid color-mix(in srgb, var(--surface-color) 16%, transparent);
          background: color-mix(in srgb, var(--surface-color) 8%, var(--page-bg, var(--app-page-bg)));
          color: color-mix(in srgb, var(--surface-color) 90%, var(--page-bg, var(--app-page-bg)));
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
          background: color-mix(in srgb, var(--surface-color) 7%, var(--page-bg, var(--app-page-bg)));
          border: 1px solid color-mix(in srgb, var(--surface-color) 12%, transparent);
        }
        .order-history-meta-label {
          display: block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--surface-color) 52%, ${navbarTextColor} 100%);
        }
        .order-history-meta-value {
          display: block;
          margin-top: 4px;
          font-size: 13px;
          font-weight: 900;
          color: color-mix(in srgb, var(--surface-color) 92%, var(--page-bg, var(--app-page-bg)));
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
          color: color-mix(in srgb, var(--surface-color) 82%, var(--page-bg, var(--app-page-bg)));
          background: color-mix(in srgb, var(--surface-color) 8%, var(--page-bg, var(--app-page-bg)));
          border: 1px solid color-mix(in srgb, var(--surface-color) 10%, transparent);
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
          .order-history-summary-grid,
          .order-history-meta-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function OrderHistory() {
  return <OrderHistoryContent variant="page" />;
}

export default OrderHistory;
