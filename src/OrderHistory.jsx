import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Package2,
  Search,
} from 'lucide-react';
import {
  clearOrderHistoryCache,
  loadOrderHistorySnapshot,
} from './services/orderHistoryService';
import {
  ORDER_HISTORY_UNKNOWN_TRUST_KEY,
  ORDER_HISTORY_UNKNOWN_TRUST_LABEL,
  normalizeText,
  formatCurrency,
  normalizeOrderRecord,
  getStatusPillStyle,
} from './utils/orderHistoryDisplay';
import { getAppHomePath } from './utils/tenantNavigation';
import { useOrderPayment } from './hooks/useOrderPayment';
import OrderPageHeader from './components/OrderPageHeader';
import OrderProductImage from './components/OrderProductImage';
import OrderDateFilter, { DATE_FILTER_ALL, resolveDateRange } from './components/OrderDateFilter';

const T = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  text: 'var(--body-text-color)',
  heading: 'var(--heading-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 64%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
};

const ORDER_HISTORY_PAGE_SIZE = 15;
const ORDER_HISTORY_SKELETON_COUNT = 4;
const JUMP_TOP_SCROLL_OFFSET = 480;

// Page numbers to render: always first/last/current +-1, with null marking a gap.
const getPageItems = (current, total) => {
  const pages = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const items = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) items.push(null);
    items.push(n);
  });
  return items;
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'paid', label: 'Paid' },
];

const matchesStatusFilter = (order, filterKey) => {
  if (filterKey === 'pending') return order.statusGroup === 'pending';
  if (filterKey === 'paid') return order.statusGroup === 'active';
  return true;
};

const OrderHistoryCardSkeleton = () => (
  <article className="oh-card oh-card--skeleton" aria-hidden="true">
    <div className="oh-skeleton oh-thumb" />
    <div className="oh-card-body">
      <div className="oh-skeleton" style={{ width: '52%', height: 15 }} />
      <div className="oh-skeleton" style={{ width: '70%', height: 12, marginTop: 8 }} />
      <div className="oh-skeleton" style={{ width: '40%', height: 12, marginTop: 8 }} />
    </div>
  </article>
);

export function OrderHistoryContent({ variant = 'page' } = {}) {
  const isPageVariant = variant === 'page';
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [trustErrors, setTrustErrors] = useState([]);
  const [selectedTrustKey, setSelectedTrustKey] = useState('');
  const [page, setPage] = useState(1);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [dateFilter, setDateFilter] = useState(DATE_FILTER_ALL);

  const { canPay, payOrder, payingOrderId, payMessage } = useOrderPayment(orders);

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

  const selectedTrustTab = useMemo(() => {
    if (trustTabs.length === 0) return null;
    if (!selectedTrustKey) return trustTabs[0];
    return trustTabs.find((tab) => tab.key === selectedTrustKey) || trustTabs[0];
  }, [selectedTrustKey, trustTabs]);

  const activeTrustKey = selectedTrustTab?.key || '';

  const trustOrders = useMemo(() => {
    if (!activeTrustKey) return orders;
    return orders.filter((order) => (order.trustKey || order.trustId || order.trustLabel || ORDER_HISTORY_UNKNOWN_TRUST_KEY) === activeTrustKey);
  }, [activeTrustKey, orders]);

  const statusCounts = useMemo(() => ({
    all: trustOrders.length,
    pending: trustOrders.filter((order) => matchesStatusFilter(order, 'pending')).length,
    paid: trustOrders.filter((order) => matchesStatusFilter(order, 'paid')).length,
  }), [trustOrders]);

  const hasDateFilter = dateFilter.preset !== 'all';

  const visibleOrdersSource = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    // Date inputs are local calendar days; the "to" day is inclusive.
    const { from: dateFrom, to: dateTo } = resolveDateRange(dateFilter);
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    const filtered = trustOrders.filter((order) => {
      if (!matchesStatusFilter(order, statusFilter)) return false;
      if (fromTs !== null && order.createdAtTs < fromTs) return false;
      if (toTs !== null && order.createdAtTs > toTs) return false;
      if (!query) return true;
      const haystack = [order.id, ...order.items.map((item) => item.name)].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    return sortOrder === 'oldest'
      ? [...filtered].sort((a, b) => (a.createdAtTs || 0) - (b.createdAtTs || 0))
      : filtered;
  }, [trustOrders, statusFilter, searchText, dateFilter, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(visibleOrdersSource.length / ORDER_HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleOrders = useMemo(
    () => visibleOrdersSource.slice((currentPage - 1) * ORDER_HISTORY_PAGE_SIZE, currentPage * ORDER_HISTORY_PAGE_SIZE),
    [currentPage, visibleOrdersSource]
  );
  const isFiltering = Boolean(searchText.trim()) || statusFilter !== 'all' || hasDateFilter;

  const headerSubtitle = trustTabs.length === 1
    ? trustTabs[0].label
    : 'All trusts linked to your account';

  const trustWarning = trustErrors.length > 0
    ? (trustErrors.length === 1
      ? `${trustErrors[0]?.trustName || trustErrors[0]?.trustId || 'One trust'} could not be loaded. Showing the rest from the backend.`
      : `${trustErrors.length} trusts could not be loaded. Showing the rest from the backend.`)
    : '';

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

  // A new search/filter/sort/trust starts from the first page.
  useEffect(() => {
    setPage(1);
  }, [activeTrustKey, statusFilter, searchText, dateFilter, sortOrder]);

  useEffect(() => {
    const handleScroll = () => setShowJumpTop(window.scrollY > JUMP_TOP_SCROLL_OFFSET);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const goToPage = (nextPage) => {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleJumpToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openOrder = (order) => {
    navigate(`/order-history/${encodeURIComponent(order.id)}`, { state: { order } });
  };

  return (
    <main className={isPageVariant ? 'oh-page' : undefined}>
      {isPageVariant && (
        <OrderPageHeader
          title="Order History"
          subtitle={headerSubtitle}
          onBack={() => navigate(getAppHomePath())}
        />
      )}

      <section className="oh-content">
        <label className="oh-search">
          <Search className="h-4 w-4" aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search by product or order ID"
            aria-label="Search orders"
          />
        </label>

        <div className="oh-filter-row">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`oh-chip${statusFilter === filter.key ? ' oh-chip--active' : ''}`}
              onClick={() => setStatusFilter(filter.key)}
              aria-pressed={statusFilter === filter.key}
            >
              {filter.label} {statusCounts[filter.key]}
            </button>
          ))}
          <OrderDateFilter value={dateFilter} onChange={setDateFilter} />
        </div>

        {trustTabs.length > 1 ? (
          <div className="oh-trust-tabs" role="tablist" aria-label="Filter orders by trust">
            {trustTabs.map((tab) => {
              const isActive = tab.key === activeTrustKey;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`oh-trust-tab${isActive ? ' oh-trust-tab--active' : ''}`}
                  onClick={() => setSelectedTrustKey(tab.key)}
                  aria-pressed={isActive}
                >
                  <span className="oh-trust-tab-label">{tab.label}</span>
                  <span className="oh-trust-tab-count">{tab.count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {trustWarning ? (
          <div className="oh-alert" role="status">
            <strong>Partial history loaded</strong>
            <p>{trustWarning}</p>
          </div>
        ) : null}

        <div className="oh-count-row">
          <span>{isInitialLoading ? 'Loading orders...' : `${visibleOrdersSource.length} order${visibleOrdersSource.length === 1 ? '' : 's'}`}</span>
          <label className="oh-sort">
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort orders">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </label>
        </div>

        {payMessage ? (
          <p className="oh-pay-message" role="status">{payMessage}</p>
        ) : null}

        {isInitialLoading ? (
          <div className="oh-list">
            {Array.from({ length: ORDER_HISTORY_SKELETON_COUNT }).map((_, index) => (
              <OrderHistoryCardSkeleton key={`order-skeleton-${index}`} />
            ))}
          </div>
        ) : visibleOrdersSource.length === 0 ? (
          <div className="oh-empty">
            <div className="oh-empty-icon">
              <Package2 className="h-7 w-7" />
            </div>
            <p className="oh-empty-title">
              {isLoading ? 'Loading order history' : isFiltering ? 'No matching orders' : 'No order history yet'}
            </p>
            <p className="oh-empty-copy">
              {isLoading
                ? 'Fetching orders from the trusts linked to your account.'
                : isFiltering
                  ? 'Try a different search, status or date range.'
                  : 'Orders placed on any linked trust will show up here once they are available.'}
            </p>
            {!isLoading && !isFiltering ? (
              <div className="oh-empty-actions">
                <button type="button" className="oh-pay-btn" onClick={() => navigate('/categories-products')}>
                  Browse products
                </button>
                <button type="button" className="oh-secondary-btn" onClick={() => navigate(getAppHomePath())}>
                  Go home
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="oh-list">
            {visibleOrders.map((order) => {
              const title = order.productName || `Order #${order.shortId}`;
              const itemsLabel = `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}`;
              const detailLabel = order.attributesLabel ? `${itemsLabel} · ${order.attributesLabel.replace(/^Size: /, 'Size ')}` : itemsLabel;
              const showPay = canPay(order);

              return (
                <article
                  key={order.id}
                  className="oh-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openOrder(order)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openOrder(order);
                    }
                  }}
                >
                  <div className="oh-thumb">
                    <OrderProductImage
                      src={order.imageUrl}
                      loading="lazy"
                      fallback={<ImageIcon className="h-6 w-6" aria-hidden="true" />}
                    />
                  </div>

                  <div className="oh-card-body">
                    <div className="oh-card-head">
                      <h3 className="oh-card-title">{title}</h3>
                      <ChevronRight className="h-4 w-4 oh-chevron" aria-hidden="true" />
                    </div>
                    <p className="oh-card-meta">
                      {order.createdAtShort}
                      {order.productName ? <> · <span className="oh-card-id">#{order.shortId}</span></> : null}
                    </p>
                    <p className="oh-card-meta">{detailLabel}</p>
                  </div>

                  <div className="oh-card-foot">
                    <span className="oh-status" style={getStatusPillStyle(order.statusTone)}>{order.status}</span>
                    <strong className="oh-price">{formatCurrency(order.totalAmount)}</strong>
                    <span className="oh-delivery">Delivery: {order.deliveryEta || order.trackingStage || 'In progress'}</span>
                    {showPay ? (
                      <button
                        type="button"
                        className="oh-pay-btn"
                        disabled={Boolean(payingOrderId)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void payOrder(order);
                        }}
                      >
                        {payingOrderId === order.id ? 'Opening...' : 'Pay now'}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!isInitialLoading && totalPages > 1 ? (
          <nav className="oh-pagination" aria-label="Order pages">
            <button
              type="button"
              className="oh-page-btn"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {getPageItems(currentPage, totalPages).map((item, index) => (
              item === null ? (
                <span key={`gap-${index}`} className="oh-page-gap" aria-hidden="true">...</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`oh-page-btn${item === currentPage ? ' oh-page-btn--active' : ''}`}
                  onClick={() => goToPage(item)}
                  aria-current={item === currentPage ? 'page' : undefined}
                  aria-label={`Page ${item}`}
                >
                  {item}
                </button>
              )
            ))}
            <button
              type="button"
              className="oh-page-btn"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        ) : null}
      </section>

      <button
        type="button"
        className={`oh-jump-top${showJumpTop ? ' oh-jump-top--visible' : ''}`}
        onClick={handleJumpToTop}
        aria-label="Jump to top"
        aria-hidden={!showJumpTop}
        tabIndex={showJumpTop ? 0 : -1}
      >
        <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>

      <style>{`
        .oh-page {
          min-height: 100vh;
          background: ${T.page};
          color: ${T.text};
        }
        .oh-content {
          padding: 16px 16px 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .oh-search {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 16px;
          border-radius: 999px;
          background: ${T.surface};
          border: 1px solid ${T.line};
          color: ${T.muted};
        }
        .oh-search input {
          flex: 1;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          font-size: 14px;
          color: ${T.heading};
        }
        .oh-search input::placeholder {
          color: ${T.muted};
        }
        .oh-filter-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .oh-chip {
          min-height: 38px;
          padding: 0 18px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent);
          background: ${T.surface};
          color: var(--brand-navy);
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          transition: background-color 0.18s ease, color 0.18s ease;
        }
        .oh-chip--active {
          background: var(--app-button-bg);
          border-color: var(--app-button-bg);
          color: var(--app-button-text);
        }
        .oh-trust-tabs {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow-x: auto;
          padding: 2px 1px 4px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .oh-trust-tabs::-webkit-scrollbar {
          display: none;
        }
        .oh-trust-tab {
          flex: 0 0 auto;
          min-height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: ${T.surface};
          color: ${T.muted};
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }
        .oh-trust-tab--active {
          color: var(--brand-navy);
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          border-color: color-mix(in srgb, var(--brand-navy) 22%, transparent);
        }
        .oh-trust-tab-label {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .oh-trust-tab-count {
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
        .oh-alert {
          padding: 12px 14px;
          border-radius: 14px;
          background: ${T.surface};
          border: 1px solid color-mix(in srgb, var(--brand-red) 20%, transparent);
        }
        .oh-alert strong {
          font-size: 12px;
          color: var(--brand-red);
        }
        .oh-alert p {
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: ${T.muted};
        }
        .oh-count-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
          color: ${T.muted};
        }
        .oh-sort {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--brand-navy);
        }
        .oh-sort select {
          appearance: none;
          -webkit-appearance: none;
          border: 0;
          background: transparent;
          padding-right: 18px;
          font-size: 12px;
          font-weight: 800;
          color: var(--brand-navy);
          cursor: pointer;
        }
        .oh-sort svg {
          position: absolute;
          right: 0;
          pointer-events: none;
        }
        .oh-pay-message {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: ${T.text};
        }
        .oh-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .oh-card {
          display: grid;
          grid-template-columns: 72px minmax(0, 1fr);
          column-gap: 12px;
          row-gap: 10px;
          padding: 14px;
          border-radius: 18px;
          background: ${T.surface};
          border: 1px solid ${T.line};
          box-shadow: 0 6px 18px color-mix(in srgb, var(--brand-navy) 8%, transparent);
          color: ${T.text};
          cursor: pointer;
        }
        .oh-card:active {
          transform: scale(0.99);
        }
        .oh-card--skeleton {
          cursor: default;
        }
        .oh-thumb {
          width: 72px;
          height: 72px;
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          color: var(--brand-navy);
        }
        .oh-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .oh-card-body {
          min-width: 0;
        }
        .oh-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .oh-card-title {
          margin: 0;
          font-size: 16px;
          font-weight: 800;
          line-height: 1.3;
          color: ${T.heading};
          overflow-wrap: anywhere;
        }
        .oh-chevron {
          flex: 0 0 auto;
          margin-top: 3px;
          color: ${T.muted};
        }
        .oh-card-meta {
          margin: 3px 0 0;
          font-size: 12px;
          line-height: 1.4;
          color: ${T.muted};
        }
        .oh-card-id {
          color: var(--brand-navy);
        }
        .oh-card-foot {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          row-gap: 8px;
          column-gap: 10px;
        }
        .oh-status {
          justify-self: start;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .oh-price {
          font-size: 19px;
          font-weight: 900;
          letter-spacing: -0.02em;
          color: ${T.heading};
        }
        .oh-delivery {
          font-size: 12px;
          color: ${T.muted};
        }
        .oh-pay-btn {
          min-height: 44px;
          padding: 0 24px;
          border-radius: 999px;
          border: 0;
          background: var(--app-button-bg);
          color: var(--app-button-text);
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .oh-pay-btn:disabled {
          opacity: 0.6;
        }
        .oh-secondary-btn {
          min-height: 44px;
          border-radius: 999px;
          border: 1px solid ${T.line};
          background: ${T.surface};
          color: ${T.heading};
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .oh-skeleton {
          position: relative;
          overflow: hidden;
          border-radius: 999px;
          background: color-mix(in srgb, var(--brand-navy) 8%, var(--surface-color));
        }
        .oh-skeleton.oh-thumb {
          border-radius: 14px;
        }
        .oh-skeleton::after {
          content: '';
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, #fff 40%, transparent) 50%, transparent 100%);
          animation: oh-shimmer 1.75s ease-in-out infinite;
        }
        @keyframes oh-shimmer {
          100% {
            transform: translateX(100%);
          }
        }
        .oh-empty {
          min-height: 40vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 8px;
          padding: 16px 8px;
        }
        .oh-empty-icon {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color));
          color: var(--brand-navy);
        }
        .oh-empty-title {
          margin: 8px 0 0;
          font-size: 16px;
          font-weight: 900;
          color: ${T.heading};
        }
        .oh-empty-copy {
          margin: 0;
          max-width: 280px;
          font-size: 13px;
          line-height: 1.6;
          color: ${T.muted};
        }
        .oh-empty-actions {
          width: 100%;
          max-width: 280px;
          display: grid;
          gap: 10px;
          margin-top: 10px;
        }
        .oh-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 4px;
        }
        .oh-page-btn {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent);
          background: ${T.surface};
          color: var(--brand-navy);
          font-size: 13px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .oh-page-btn--active {
          background: var(--app-button-bg);
          border-color: var(--app-button-bg);
          color: var(--app-button-text);
        }
        .oh-page-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .oh-page-gap {
          color: ${T.muted};
          font-weight: 800;
        }
        .oh-jump-top {
          position: fixed;
          /* The app is a centred 430px column on wide screens (App.jsx), so anchor to the
             column's right edge instead of the viewport's. */
          right: max(20px, calc((100vw - 430px) / 2 + 20px));
          bottom: 28px;
          z-index: 15;
          width: 42px;
          height: 42px;
          border: none;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--app-button-bg);
          color: var(--app-button-text);
          box-shadow: 0 15px 34px color-mix(in srgb, var(--brand-navy) 28%, transparent);
          cursor: pointer;
          opacity: 0;
          transform: translateY(12px) scale(0.9);
          pointer-events: none;
          transition: opacity 220ms ease, transform 220ms ease;
        }
        .oh-jump-top--visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
      `}</style>
    </main>
  );
}

function OrderHistory() {
  return <OrderHistoryContent variant="page" />;
}

export default OrderHistory;
