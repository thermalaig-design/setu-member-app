import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ChevronLeft,
  ShoppingCart,
  Shirt,
  Sparkles,
  Heart,
  Briefcase,
  Dumbbell,
  Baby,
  Footprints,
  Home as HomeIcon,
  Lamp,
  Droplet,
  Palette,
  Gem,
} from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { buildCategoryView, getCardRowPattern, splitIntoRows } from './utils/categoryDisplay';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { readWishlistItems, subscribeWishlist } from './utils/productWishlist';
import { readCartItems, subscribeCart } from './utils/productCart';
import { getAppHomePath } from './utils/tenantNavigation';
import {
  enrichPayloadWithPrices,
  fetchProductCategoryTree,
  readTrustCatalogCacheForCandidates,
  writeTrustCatalogCache,
} from './utils/trustCatalogCache';

const THEME = {
  page: 'var(--page-bg, var(--app-page-bg))',
  text: 'var(--body-text-color)',
  navy: 'var(--brand-navy)',
  buttonBg: 'var(--app-button-bg)',
  buttonText: 'var(--app-button-text)',
};

const SKELETON_BG = 'color-mix(in srgb, var(--brand-navy) 8%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const SHADOW = '0 18px 36px color-mix(in srgb, var(--brand-navy) 10%, transparent)';

const ICONS = {
  Shirt,
  Sparkles,
  Heart,
  Briefcase,
  Dumbbell,
  Baby,
  Footprints,
  Home: HomeIcon,
  Lamp,
  Droplet,
  Palette,
  Gem,
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  if (['null', 'undefined', 'nan'].includes(lowered)) return '';
  return text;
};

const normalizeTrustId = (value) => normalizeText(value);

const getTrustCandidates = (preferredTrustId = '') => {
  const selectedTrustId = normalizeTrustId(
    preferredTrustId || localStorage.getItem('selected_trust_id')
  );

  return [...new Set([selectedTrustId].filter(Boolean))];
};

function CategoryArt({
  variant = 'card',
  label,
  imageUrl,
  iconName = 'Shirt',
  colors,
  tall = false,
}) {
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = ICONS[iconName] || Shirt;
  const frameClasses = variant === 'circle'
    ? 'h-[92px] w-[92px] rounded-full'
    : 'w-full';
  const frameRadius = variant === 'circle'
    ? '999px'
    : '0.15rem';
  const frameAspectRatio = variant === 'circle'
    ? undefined
    : tall
      ? '1 / 1'
      : '0.95 / 1.18';

  const imageClasses = 'absolute inset-0 h-full w-full object-cover';

  const iconBoxClasses = variant === 'circle'
    ? 'h-12 w-12'
    : 'h-14 w-14';

  const iconClasses = variant === 'circle'
    ? 'h-4 w-4'
    : 'h-6 w-6';

  const [start, end] = colors;
  const shouldShowImage = Boolean(imageUrl) && !imageFailed;
  const shouldShowImageSkeleton = shouldShowImage && !imageLoaded;

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);

    const checkCachedImage = () => {
      const image = imageRef.current;
      if (image?.complete && image.naturalWidth > 0) {
        setImageLoaded(true);
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(checkCachedImage);
    } else {
      checkCachedImage();
    }
  }, [imageUrl]);

  return (
    <div
      className={`relative overflow-hidden ${frameClasses}`}
        style={{
          aspectRatio: frameAspectRatio,
          background: `linear-gradient(145deg, ${start} 0%, ${end} 100%)`,
          borderRadius: frameRadius,
          boxShadow: SHADOW,
          margin: frameAspectRatio === '1 / 1' ? '0 auto' : undefined,
        }}
      >
      {shouldShowImageSkeleton ? (
        <div className="ws-skeleton ws-image-skeleton" aria-hidden="true" />
      ) : null}

      {shouldShowImage ? (
        <img
          ref={imageRef}
          src={imageUrl}
          alt={label}
          className={imageClasses}
          loading="lazy"
          decoding="async"
          style={{
            zIndex: 2,
            opacity: imageLoaded ? 1 : 0,
            transition: 'opacity 180ms ease',
          }}
          onLoad={() => {
            setImageLoaded(true);
          }}
          onError={(event) => {
            setImageFailed(true);
            setImageLoaded(false);
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}

      <div
        className="absolute inset-0"
        style={{
          zIndex: shouldShowImage ? 3 : 0,
          background: shouldShowImage
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 14%, transparent) 0%, color-mix(in srgb, var(--brand-navy) 10%, transparent) 100%)'
            : `linear-gradient(145deg, ${start} 0%, ${end} 100%)`,
          pointerEvents: 'none',
        }}
      />

      {!shouldShowImage ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 4 }}>
          <div
            className={`flex items-center justify-center rounded-full shadow-lg backdrop-blur-sm ${iconBoxClasses}`}
            style={{
              background: 'color-mix(in srgb, var(--surface-color) 86%, transparent)',
              border: '1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)',
            }}
          >
            <Icon className={iconClasses} style={{ color: THEME.navy }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="ws-skeleton h-[92px] w-[92px] rounded-full" />
      <div className="ws-skeleton h-4 w-16 rounded-full" />
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="flex flex-col">
      <div className="ws-skeleton aspect-[0.95/1.18] rounded-[1.45rem]" />
      <div className="ws-skeleton mt-2 h-4 w-3/4 rounded-full" />
    </div>
  );
}

function EmptyState({ title, description, onRetry }) {
  return (
    <div
      className="rounded-[1.75rem] border px-4 py-5 text-center"
      style={{
        background: 'color-mix(in srgb, var(--advertisement-card-bg) 94%, transparent)',
        borderColor: SKELETON_BORDER,
        boxShadow: SHADOW,
      }}
    >
      <p className="text-[15px] font-bold" style={{ color: THEME.text }}>
        {title}
      </p>
      <p
        className="mt-1 text-sm leading-6"
        style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}
      >
        {description}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-transform active:scale-[0.98]"
          style={{
            background: THEME.buttonBg,
            color: THEME.buttonText,
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function CircleSlider({ entries, onOpen }) {
  return (
    <div className="ws-circle-row no-scrollbar">
      {entries.map((entry) => (
        <button
          key={entry.id}
          className="ws-circle-item"
          type="button"
          onClick={() => onOpen(entry.id)}
        >
          <CategoryArt
            variant="circle"
            label={entry.label}
            imageUrl={entry.imageUrl}
            iconName={entry.icon}
            colors={entry.colors}
          />
          <span className="ws-circle-label">{entry.label}</span>
        </button>
      ))}
    </div>
  );
}

function CardGrid({ section, onOpen }) {
  const rows = splitIntoRows(section.items || [], section.rowPattern || getCardRowPattern(section.items?.length || 0));
  const openSection = () => onOpen(section.id);

  return (
    <section className="ws-section">
      <div
        className="ws-section-title"
        role="button"
        tabIndex={0}
        onClick={openSection}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openSection();
          }
        }}
      >
        {section.label}
      </div>
      <div className="ws-card-rows">
        {rows.map((row, rowIndex) => {
          const cols = row.length || 1;
          const tall = cols === 1;

          return (
            <div
              key={`${section.id}-${rowIndex}`}
              className="ws-grid"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {row.map((item) => (
                <button
                  key={item.id}
                  className="ws-tile"
                  type="button"
                  onClick={() => onOpen(item)}
                >
                  <CategoryArt
                    variant="card"
                    label={item.label}
                    imageUrl={item.imageUrl}
                    iconName={item.icon}
                    colors={item.colors}
                    tall={tall}
                  />
                  <span className="ws-tile-label">{item.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CategoriesProductsContent({
  variant = 'page',
  selectedTrustId: selectedTrustIdProp = '',
} = {}) {
  const isPageVariant = variant === 'page';
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  const [rpcResult, setRpcResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [wishlistItems, setWishlistItems] = useState(() => readWishlistItems());
  const [cartItems, setCartItems] = useState(() => readCartItems());
  const [showJumpTop, setShowJumpTop] = useState(false);
  const [jumpTopStyle, setJumpTopStyle] = useState(null);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async () => {
      const trustCandidates = getTrustCandidates(selectedTrustIdProp);
      const cached = readTrustCatalogCacheForCandidates(trustCandidates);
      const hasCachedPayload = Boolean(cached?.payload);

      if (hasCachedPayload) {
        setRpcResult(cached.payload);
        setError('');
        setLoading(false);
      } else {
        setLoading(true);
        setError('');
      }

      // Revalidate the live RPC so a recently published category cannot stay hidden behind cache.
      try {
        const payload = await fetchProductCategoryTree(controller.signal);
        if (!active || controller.signal.aborted || !payload) return;

        const pricedPayload = await enrichPayloadWithPrices(payload, controller.signal);
        if (!active || controller.signal.aborted || !pricedPayload) return;

        setRpcResult(pricedPayload);
        const cacheTrustId = pricedPayload?.trustId || payload?.trustId || trustCandidates[0];
        if (cacheTrustId) {
          writeTrustCatalogCache(cacheTrustId, pricedPayload, { hasPrices: true });
        }
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        if (!hasCachedPayload) {
          if (loadError?.name !== 'AbortError') {
            setError(loadError?.message || 'Failed to load categories');
          }
          setRpcResult(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken, selectedTrustIdProp]);

  useEffect(() => subscribeWishlist(setWishlistItems), []);
  useEffect(() => subscribeCart(setCartItems), []);

  const cartCount = useMemo(
    () => cartItems.reduce((total, item) => total + Number(item?.quantity || 0), 0),
    [cartItems]
  );

  const categories = useMemo(
    () => (Array.isArray(rpcResult?.categories) ? rpcResult.categories : []),
    [rpcResult]
  );

  const { sliderEntries, cardSections } = useMemo(
    () => buildCategoryView(categories),
    [categories]
  );
  const hasVisibleContent = sliderEntries.length > 0 || cardSections.length > 0;
  const showLoading = loading && !hasVisibleContent;
  const showEmpty = !loading && !error && !hasVisibleContent;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateJumpTopPlacement = () => {
      const root = rootRef.current;
      if (!root) {
        setJumpTopStyle(null);
        return;
      }

      const rect = root.getBoundingClientRect();
      const right = Math.max(window.innerWidth - rect.right + 18, 18);
      setJumpTopStyle({
        right: `${right}px`,
        bottom: 'max(22px, env(safe-area-inset-bottom))',
      });
    };

    const handleScroll = () => {
      updateJumpTopPlacement();

      if (isPageVariant) {
        const pageScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        const contentScrollTop = scrollRef.current?.scrollTop || 0;
        setShowJumpTop(Math.max(pageScrollTop, contentScrollTop) > 320);
        return;
      }

      const root = rootRef.current;
      if (!root) {
        setShowJumpTop(false);
        return;
      }

      const rect = root.getBoundingClientRect();
      setShowJumpTop(rect.top < -240 && rect.bottom > window.innerHeight * 0.45);
    };

    const target = isPageVariant ? scrollRef.current : window;
    handleScroll();
    target?.addEventListener('scroll', handleScroll, { passive: true });
    if (isPageVariant) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('resize', handleScroll);

    return () => {
      target?.removeEventListener('scroll', handleScroll);
      if (isPageVariant) {
        window.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', handleScroll);
    };
  }, [isPageVariant, hasVisibleContent]);
  const encodeRouteId = (value) => encodeURIComponent(normalizeText(value));
  const openCardItem = (itemOrId) => {
    if (itemOrId && typeof itemOrId === 'object') {
      if (itemOrId.type === 'product') {
        const categoryId = normalizeText(itemOrId.categoryId);
        const productId = normalizeText(itemOrId.productId);
        if (!categoryId || !productId) return;
        navigate(`/categories-products/list/${encodeRouteId(categoryId)}/detail/${encodeRouteId(productId)}`);
        return;
      }

      const categoryId = normalizeText(itemOrId.categoryId || itemOrId.id);
      if (!categoryId) return;
      navigate(`/categories-products/list/${encodeRouteId(categoryId)}`);
      return;
    }

    const categoryId = normalizeText(itemOrId);
    if (!categoryId) return;
    navigate(`/categories-products/list/${encodeRouteId(categoryId)}`);
  };
  const handleJumpToTop = () => {
    if (isPageVariant) {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main
      ref={rootRef}
      className={isPageVariant ? 'min-h-screen flex flex-col' : undefined}
      style={isPageVariant ? {
        background: THEME.page,
        color: THEME.text,
        fontFamily: "var(--font-family, 'Inter', sans-serif)",
      } : undefined}
    >
      <div className="ws-page">
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
                  className="rounded-xl p-2 transition-colors"
                  style={{
                    color: navbarTextColor,
                    background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
                  }}
                  aria-label="Go back to home"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <div className="min-w-0 flex-1 text-center">
                  <h1
                    className="truncate text-lg font-extrabold tracking-wide"
                    style={{ color: navbarTextColor }}
                  >
                    Categories
                  </h1>
                </div>

                <div className="flex h-10 items-center justify-end gap-3">
                  <button
                    type="button"
                    className="ws-header-icon-btn"
                    onClick={() => navigate('/wishlist')}
                    aria-label="Open wishlist"
                  >
                    <Heart size={20} strokeWidth={1.8} />
                    {wishlistItems.length > 0 && <span className="ws-cart-badge ">{wishlistItems.length}</span>}
                  </button>
                  <button
                    type="button"
                    className="ws-header-icon-btn"
                    onClick={() => navigate('/cart')}
                    aria-label="Open cart"
                  >
                    <ShoppingCart size={20} strokeWidth={1.5} />
                    {cartCount > 0 && <span className="ws-cart-badge">{cartCount}</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="ws-scroll" ref={scrollRef}>
          {showLoading ? (
            <>
              <div className="ws-circle-row no-scrollbar">
                <LoadingBubble />
                <LoadingBubble />
                <LoadingBubble />
              </div>
              <div className="ws-section">
                <div className="ws-section-title">Loading categories</div>
                <div className="ws-card-rows">
                  <div className="ws-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                    <LoadingCard />
                    <LoadingCard />
                    <LoadingCard />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {!showLoading && error ? (
            <div className="px-4 pt-4">
              <EmptyState
                title="Could not load categories"
                description={error}
                onRetry={() => setReloadToken((value) => value + 1)}
              />
            </div>
          ) : null}

          {showEmpty ? (
            <div className="px-4 pt-4">
              <EmptyState
                title="No product categories available"
                description="There are no active product categories for this trust yet."
                onRetry={() => setReloadToken((value) => value + 1)}
              />
            </div>
          ) : null}

          {!showLoading && !error ? (
            <>
              {sliderEntries.length > 0 ? (
                <CircleSlider
                  entries={sliderEntries}
                  onOpen={(id) => navigate(`/categories-products/list/${encodeRouteId(id)}`)}
                />
              ) : null}

              {cardSections.map((section) => (
                <CardGrid
                  key={section.id}
                  section={section}
                  onOpen={openCardItem}
                />
              ))}
            </>
          ) : null}

          <div style={{ height: 8 }} />
        </div>

        <button
          type="button"
          className={`ws-jump-top ${showJumpTop ? 'ws-jump-top-visible' : ''}`}
          style={jumpTopStyle || undefined}
          onClick={handleJumpToTop}
          aria-label="Jump to top"
          aria-hidden={!showJumpTop}
          tabIndex={showJumpTop ? 0 : -1}
        >
          <ArrowUp size={18} strokeWidth={2.2} />
        </button>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .ws-page {
          position: relative;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        .ws-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .ws-scroll::-webkit-scrollbar {
          display: none;
        }

        .ws-circle-row {
          display: flex;
          gap: 18px;
          padding: 18px 18px 8px;
          overflow-x: auto;
          align-items: flex-start;
        }

        .ws-circle-item {
          background: none;
          border: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          flex-shrink: 0;
          min-width: 92px;
          padding: 0;
        }

        .ws-circle-label {
          font-size: 13px;
          color: ${navbarTextColor};
          text-align: center;
          line-height: 1.2;
          max-width: 92px;
        }

        .ws-section {
          padding: 18px;
        }

        .ws-section-title {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 12px;
          color: ${navbarTextColor};
          cursor: pointer;
          outline: none;
          width: max-content;
          max-width: 100%;
        }

        .ws-section-title:focus-visible {
          text-decoration: underline;
          text-underline-offset: 4px;
        }

        .ws-card-rows {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .ws-grid {
          display: grid;
          gap: 10px;
        }

        .ws-tile {
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 8px;
          text-align: left;
          width: 100%;
        }

        .ws-tile-label {
          font-size: 13px;
          color: ${navbarTextColor};
          line-height: 1.25;
        }

        .ws-jump-top {
          position: fixed;
          right: max(18px, env(safe-area-inset-right));
          bottom: max(22px, env(safe-area-inset-bottom));
          z-index: 35;
          width: 46px;
          height: 46px;
          border: 0;
          border-radius: 999px;
          background: ${THEME.buttonBg};
          color: ${THEME.buttonText};
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 14px 28px color-mix(in srgb, var(--brand-navy) 24%, transparent);
          opacity: 0;
          transform: translateY(12px) scale(0.96);
          pointer-events: none;
          transition: opacity 0.18s ease, transform 0.18s ease;
        }

        .ws-jump-top-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }

        .ws-header-icon-btn {
          position: relative;
          width: 28px;
          height: 28px;
          border: 0;
          background: none;
          color: ${navbarTextColor};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
        }

        .ws-cart-badge {
          position: absolute;
          top: -7px;
          right: -8px;
          background: #c74212;
          color: white;
          font-size: 9px;
          font-weight: 700;
          border-radius: 999px;
          min-width: 15px;
          height: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 3px;
        }

        .ws-skeleton {
          position: relative;
          overflow: hidden;
          background: ${SKELETON_BG};
        }

        .ws-image-skeleton {
          position: absolute;
          inset: 0;
          z-index: 1;
        }

        .ws-skeleton::after {
          content: '';
          position: absolute;
          inset: 0;
          transform: translateY(-110%);
          background: linear-gradient(
            180deg,
            transparent 0%,
            color-mix(in srgb, var(--surface-color) 34%, transparent) 48%,
            transparent 100%
          );
          opacity: 0.48;
          animation: ws-shimmer 1.7s ease-in-out infinite;
        }

        @keyframes ws-shimmer {
          100% {
            transform: translateY(110%);
          }
        }

        .ws-category-sentinel {
          width: 100%;
          height: 1px;
        }

        @media (min-width: 1024px) {
          .ws-scroll {
            padding: 0 24px 24px;
          }

          .ws-circle-row {
            gap: 14px;
            padding: 18px 0 6px;
          }

          .ws-circle-item {
            min-width: 78px;
            gap: 6px;
          }

          .ws-circle-item > div:first-child {
            width: 78px !important;
            height: 78px !important;
          }

          .ws-circle-label {
            font-size: 12px;
            max-width: 86px;
          }

          .ws-section {
            padding: 16px 0 8px;
          }

          .ws-section-title {
            font-size: 15px;
            margin-bottom: 10px;
          }

          .ws-card-rows {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 16px;
          }

          .ws-grid {
            display: contents;
          }

          .ws-tile {
            gap: 7px;
            min-width: 0;
          }

          .ws-tile > div:first-child {
            width: 100% !important;
            height: 251px;
            aspect-ratio: auto !important;
            border-radius: 12px !important;
            margin: 0 !important;
          }

          .ws-tile-label {
            font-size: 12px;
            font-weight: 600;
            line-height: 1.2;
          }
        }
      `}</style>
    </main>
  );
}

function CategoriesProducts() {
  return <CategoriesProductsContent variant="page" />;
}

export default CategoriesProducts;
