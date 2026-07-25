import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Home as HomeIcon, ShoppingCart, Shirt, Sparkles, Heart, Briefcase, Dumbbell, Baby, Footprints, Lamp, Droplet, Palette, Gem, RefreshCw, X } from "lucide-react";
import { useAppTheme } from './context/ThemeContext';
import { supabase } from './services/supabaseClient';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { getWishlistKey, readWishlistItems, subscribeWishlist, toggleWishlistProduct } from './utils/productWishlist';
import { getCartKey, readCartItems, setCartProductQuantity, subscribeCart } from './utils/productCart';
import {
  isTrustCatalogCacheFresh,
  readTrustCatalogCacheForCandidates,
  writeTrustCatalogCache,
} from './utils/trustCatalogCache';


const THEME = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  card: 'var(--advertisement-card-bg)',
  cardBorder: 'var(--advertisement-card-border)',
  text: 'var(--body-text-color)',
  navy: 'var(--brand-navy)',
  gold: 'var(--brand-red)',
  buttonBg: 'var(--app-button-bg)',
  buttonText: 'var(--app-button-text)',
  accentBg: 'var(--app-accent-bg)',
};
const T = {
  bg: "#FFFFFF",
  ink: 'var()',
  inkSoft: "#726F68",
  inkFaint: "#A9A399",
  line: "#E7E2D8",
  paper: "#F7F4EE",
  clay: "#c74212",
  clayDeep: "#8A3D22",
  sage: "#8B9578",
};
const ICONS = {
  Shirt, Sparkles, Heart, Briefcase, Dumbbell, Baby, Footprints,
  Home: HomeIcon, Lamp, Droplet, Palette, Gem, ShoppingCart,
};

const FALLBACK_ICONS = [
  'Shirt',
  'Sparkles',
  'Heart',
  'Briefcase',
  'Dumbbell',
  'Baby',
  'Footprints',
  'Home',
  'Lamp',
  'Droplet',
  'Palette',
  'Gem',
];

const DESCRIPTION_COLLAPSE_LINES = 10;

const SKELETON_BG = 'color-mix(in srgb, var(--brand-navy) 8%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const SHADOW = '0 18px 36px color-mix(in srgb, var(--brand-navy) 10%, transparent)';
const HIDDEN_STATUSES = new Set(['inactive', 'disabled', 'archived', 'hidden', 'draft']);
const VISIBLE_CATEGORY_STATUSES = new Set(['active']);
const IMAGE_ZOOM_MIN_SCALE = 1;
const IMAGE_ZOOM_MAX_SCALE = 4;
const HERO_DRAG_ACTIVATION_PX = 8;
const HERO_CLICK_SUPPRESS_MS = 250;
const HERO_SWIPE_THRESHOLD_PX = 48;
const IMAGE_ZOOM_RESET_EPSILON = 0.02;

const PALETTE = [
  ["#EFE7D8", "#CBB994"],
  ["#E3E6DC", "#A9B79C"],
  ["#E9DAD2", "#C98B6B"],
  ["#DCE3E6", "#8FA6AD"],
  ["#EAE2EA", "#B79CC9"],
  ["#F0E6E6", "#C98B96"],
  ["#E4E4E0", "#9C9C94"],
  ["#EDE6D6", "#D6A24A"],
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getTouchDistance = (touches) => {
  if (!touches || touches.length < 2) return 0;
  const [first, second] = touches;
  const dx = Number(second?.clientX || 0) - Number(first?.clientX || 0);
  const dy = Number(second?.clientY || 0) - Number(first?.clientY || 0);
  return Math.hypot(dx, dy);
};

const getTouchMidpoint = (touches) => {
  if (!touches || touches.length < 2) return null;
  const [first, second] = touches;
  return {
    x: (Number(first?.clientX || 0) + Number(second?.clientX || 0)) / 2,
    y: (Number(first?.clientY || 0) + Number(second?.clientY || 0)) / 2,
  };
};

const clampTranslateToViewport = (translate, scale, rect) => {
  if (!rect) return translate;

  const maxOffsetX = Math.max(0, ((rect.width * scale) - rect.width) / 2);
  const maxOffsetY = Math.max(0, ((rect.height * scale) - rect.height) / 2);

  return {
    x: clamp(Number(translate?.x || 0), -maxOffsetX, maxOffsetX),
    y: clamp(Number(translate?.y || 0), -maxOffsetY, maxOffsetY),
  };
};

function Swatch({ paletteIdx = 0, iconName = 'Shirt', size = '100%', radius = 0 }) {
  const [a, b] = PALETTE[paletteIdx % PALETTE.length];
  const Icon = ICONS[iconName] || Shirt;
  return (
    <div style={{
      width: size, height: '100%', position: 'relative', overflow: 'hidden',
      borderRadius: radius, background: `linear-gradient(155deg, ${a} 0%, ${b} 100%)`,
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
        textAlign: 'center',
      }}>
        <div style={{
          maxWidth: '78%',
          borderRadius: '999px',
          padding: '7px 12px',
          background: 'rgba(255, 255, 255, 0.78)',
          color: '#6F5F45',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          boxShadow: '0 8px 20px rgba(66, 48, 22, 0.12)',
        }}>
          No image preview
        </div>
      </div>
      <Icon size="34%" color="#ffffff" strokeWidth={1.25}
        style={{ position: 'absolute', right: '10%', bottom: '10%', opacity: 0.55 }} />
    </div>
  );
}

const Price = ({ price, size = 'md' }) => {
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  if (!price) return null;
  const big = size === 'lg';
  return (
    <div className="ws-price-row">
      <span style={{ fontSize: big ? 20 : 14, fontWeight: 600, color: `${navbarTextColor}` }}>
        ₹{price.price_after_discount.toLocaleString('en-IN')}
      </span>
      {price.discount_pct > 0 ? (
        <>
          <span style={{ fontSize: big ? 14 : 12, color: T.inkFaint, textDecoration: 'line-through' }}>
            ₹{price.mrp.toLocaleString('en-IN')}
          </span>
          <span style={{ fontSize: big ? 13 : 11, color: T.clay, fontWeight: 600 }}>
            {price.discount_pct}% off
          </span>
        </>
      ) : null}
    </div>
  );
};

const ProductDetailSkeleton = () => {
  const sizeChipWidths = [78, 62, 70, 56];
  const colorChipWidths = [92, 76, 84];

  return (
    <div aria-hidden="true">
      <div className="ws-pdp-hero ws-pdp-skeleton-hero ws-skeleton">
        <div className="ws-skeleton ws-pdp-skeleton-fab" />
        <div className="ws-skeleton ws-pdp-skeleton-pill" />
      </div>

      <div className="ws-pdp-body ws-pdp-skeleton-body">
        <div className="ws-skeleton ws-pdp-skeleton-name" />
        <div className="ws-pdp-price-block">
          <div className="ws-skeleton ws-pdp-skeleton-price" />
        </div>

        <div className="ws-pdp-actions ws-pdp-skeleton-actions">
          <div className="ws-skeleton ws-pdp-skeleton-button" />
          <div className="ws-skeleton ws-pdp-skeleton-button" />
        </div>

        <div className="ws-attr-group ws-attr-group--panel ws-pdp-skeleton-group">
          <div className="ws-skeleton ws-pdp-skeleton-section-title" />
          <div className="ws-chip-wrap">
            {sizeChipWidths.map((width, index) => (
              <div
                key={`pdp-size-skeleton-${index}`}
                className="ws-skeleton ws-pdp-skeleton-chip"
                style={{ width }}
              />
            ))}
          </div>
        </div>

        <div className="ws-attr-group ws-attr-group--panel ws-pdp-skeleton-group">
          <div className="ws-skeleton ws-pdp-skeleton-section-title" />
          <div className="ws-chip-wrap">
            {colorChipWidths.map((width, index) => (
              <div
                key={`pdp-color-skeleton-${index}`}
                className="ws-skeleton ws-pdp-skeleton-chip ws-pdp-skeleton-chip--colour"
                style={{ width }}
              />
            ))}
          </div>
        </div>

        <div className="ws-attr-group ws-attr-group--panel ws-description-group ws-pdp-skeleton-description">
          <div className="ws-skeleton ws-pdp-skeleton-section-title" />
          <div className="ws-skeleton ws-pdp-skeleton-line" />
          <div className="ws-skeleton ws-pdp-skeleton-line ws-pdp-skeleton-line--wide" />
          <div className="ws-skeleton ws-pdp-skeleton-line ws-pdp-skeleton-line--short" />
        </div>
      </div>
    </div>
  );
};

const isMeaningfulText = (value) => {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  return !['null', 'undefined', 'n/a', 'na', 'none'].includes(lowered);
};

const pickText = (...values) => {
  for (const value of values) {
    if (isMeaningfulText(value)) return String(value).trim();
  }
  return '';
};

const capitalizeFirst = (value) => {
  const text = pickText(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const toTitleCase = (value) => {
  const text = pickText(value);
  if (!text) return '';
  if (text === text.toUpperCase()) return text;

  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const normalizeAttributeName = (value) => pickText(value).toLowerCase();

const isSizeAttributeName = (value) => ['size', 'sizes'].includes(normalizeAttributeName(value));

const isColourAttributeName = (value) => ['colour', 'color', 'colours', 'colors'].includes(normalizeAttributeName(value));

const splitAttributeValues = (value) => {
  const text = pickText(value);
  if (!text) return [];

  return text
    .split(/[,|;/]+/)
    .flatMap((part) => String(part).split(/\s*\/\s*/))
    .map((part) => pickText(part))
    .filter(Boolean);
};

const normalizeOrder = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const hashString = (value) => {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pickFallbackIcon = (seed) => FALLBACK_ICONS[hashString(seed) % FALLBACK_ICONS.length];

const getTrustCandidates = () => {
  const candidates = [
    localStorage.getItem('selected_trust_id'),
    import.meta.env.VITE_DEFAULT_TRUST_ID,
  ]
    .map((value) => pickText(value))
    .filter(Boolean);

  return [...new Set(candidates)];
};

const fetchProductCategoryTree = async (signal) => {
  const trustCandidates = getTrustCandidates();
  let lastError = '';

  for (const trustId of trustCandidates) {
    let query = supabase.rpc('get_products_by_trust_id', {
      p_trust_id: trustId,
    });

    if (typeof query.abortSignal === 'function') {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query;
    if (signal?.aborted) return null;

    if (error) {
      lastError = error.message || String(error);
      continue;
    }

    const payload = data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : { categories: Array.isArray(data) ? data : [] };
    const categories = Array.isArray(payload.categories) ? payload.categories : [];

    if (payload.success === false) {
      lastError = payload.message || 'RPC returned success=false';
      continue;
    }

    if (categories.length > 0) {
      return {
        trustId: pickText(payload.trust_id, trustId),
        categories,
      };
    }

    lastError = `No categories returned for trust ${trustId}`;
  }

  throw new Error(lastError || 'No categories found for the selected trust');
};

const PRODUCT_PRICE_SELECT = [
  'id',
  'product_id',
  'mrp',
  'discount_pct',
  'discount_amount',
  'price_after_discount',
  'gst_pct',
  'gst_amount',
  'transport_fee',
  'total_payable',
  'member_price',
  'billing_type',
  'status',
].join(', ');

const collectProductIdsFromCategories = (categories) => {
  const ids = new Set();

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    (Array.isArray(category?.products) ? category.products : []).forEach((product) => {
      const productId = pickText(product?.id);
      if (productId) ids.add(productId);
    });
  });

  return [...ids];
};

const fetchProductPricesById = async (productIds, signal) => {
  const ids = [...new Set((productIds || []).map((id) => pickText(id)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  let query = supabase
    .from('product_price')
    .select(PRODUCT_PRICE_SELECT)
    .in('product_id', ids);

  if (typeof query.abortSignal === 'function') {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[ProductDetail] Failed to load product prices:', error.message || error);
    return new Map();
  }

  const pricesById = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const productId = pickText(row?.product_id);
    if (!productId) return;

    const status = pickText(row?.status).toLowerCase();
    const existing = pricesById.get(productId);
    const isActive = !status || status === 'active';
    const existingStatus = pickText(existing?.status).toLowerCase();
    const existingIsActive = !existingStatus || existingStatus === 'active';

    if (!existing || (isActive && !existingIsActive)) {
      pricesById.set(productId, row);
    }
  });

  return pricesById;
};

const attachPricesToPayload = (payload, pricesById) => ({
  ...payload,
  categories: (Array.isArray(payload?.categories) ? payload.categories : []).map((category) => ({
    ...category,
    products: (Array.isArray(category?.products) ? category.products : []).map((product) => {
      const price = pricesById.get(pickText(product?.id));
      return price ? { ...product, price } : product;
    }),
  })),
});

const enrichPayloadWithPrices = async (payload, signal) => {
  if (!payload) return payload;
  const productIds = collectProductIdsFromCategories(payload.categories);
  const pricesById = await fetchProductPricesById(productIds, signal);
  if (signal?.aborted) return payload;
  return attachPricesToPayload(payload, pricesById);
};

const normalizeApiCategories = (categories) =>
  (Array.isArray(categories) ? categories : [])
    .map((category, index) => ({
      ...category,
      id: pickText(category?.id),
      parentId: pickText(category?.parent_id),
      status: pickText(category?.status).toLowerCase(),
      sourceIndex: Number.isFinite(Number(category?.sourceIndex))
        ? Number(category?.sourceIndex)
        : index,
    }))
    .filter((category) => Boolean(category.id));

const isVisibleCategory = (category) =>
  VISIBLE_CATEGORY_STATUSES.has(pickText(category?.status).toLowerCase());

const buildCategoryTreeLookups = (categories) => {
  const normalized = normalizeApiCategories(categories).filter(isVisibleCategory);
  const categoriesById = new Map();

  normalized.forEach((category) => {
    categoriesById.set(category.id, category);
  });

  return { normalized, categoriesById };
};

const getApiCategoryPath = (categoryId, categoriesById) => {
  const path = [];
  const visited = new Set();
  let current = categoriesById.get(pickText(categoryId));

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? categoriesById.get(current.parentId) : null;
  }

  return path;
};

const isVisibleProduct = (product) => {
  const status = pickText(product?.status).toLowerCase();
  if (!status) return true;
  return !HIDDEN_STATUSES.has(status);
};

const getProductDisplayName = (product) =>
  pickText(product?.product_name, product?.alias_name, `Product ${pickText(product?.id)}`);

const resolveProductImages = (product) =>
  (Array.isArray(product?.images) ? product.images : [])
    .filter((image) => pickText(image?.image_url))
    .sort((a, b) => normalizeOrder(a?.sort_order) - normalizeOrder(b?.sort_order));

const resolveProductPrice = (product) => {
  const priceSource = Array.isArray(product?.prices)
    ? product.prices[0]
    : product?.price || product?.product_price || product?.pricing || null;

  if (!priceSource || typeof priceSource !== 'object') return null;

  const mrp = Number(priceSource.mrp ?? priceSource.price ?? priceSource.amount);
  const priceAfterDiscount = Number(
    priceSource.price_after_discount
    ?? priceSource.total_payable
    ?? priceSource.member_price
    ?? priceSource.selling_price
    ?? mrp
  );
  const discountPct = Number(priceSource.discount_pct ?? priceSource.discount_percent ?? 0);
  const gstAmount = Number(priceSource.gst_amount ?? 0);
  const totalPayable = Number(priceSource.total_payable ?? priceAfterDiscount);

  if (!Number.isFinite(mrp) && !Number.isFinite(priceAfterDiscount)) return null;

  return {
    ...priceSource,
    mrp: Number.isFinite(mrp) ? mrp : priceAfterDiscount,
    price_after_discount: Number.isFinite(priceAfterDiscount) ? priceAfterDiscount : mrp,
    discount_pct: Number.isFinite(discountPct) ? discountPct : 0,
    gst_amount: Number.isFinite(gstAmount) ? gstAmount : 0,
    total_payable: Number.isFinite(totalPayable) ? totalPayable : priceAfterDiscount,
  };
};

const getProductAttributeRows = (product) =>
  (Array.isArray(product?.attribute_values) ? product.attribute_values : [])
    .map((row) => ({
      name: pickText(row?.attribute_name),
      value: pickText(row?.value),
    }))
    .filter((row) => row.name && row.value);

const groupProductAttributes = (product) => {
  const groups = new Map();

  getProductAttributeRows(product).forEach(({ name, value }) => {
    if (!groups.has(name)) groups.set(name, new Set());
    groups.get(name).add(value);
  });

  return [...groups.entries()].map(([name, values]) => [name, [...values]]);
};

const findProductDetail = (productId, categories) => {
  const normalizedProductId = pickText(productId);
  const { normalized, categoriesById } = buildCategoryTreeLookups(categories);
  const orderedCategories = [...normalized]
    .map((category) => ({
      category,
      categoryDepth: getApiCategoryPath(category.id, categoriesById).length,
    }))
    .sort((a, b) => (
      b.categoryDepth - a.categoryDepth
      || a.category.sourceIndex - b.category.sourceIndex
      || pickText(a.category.name).localeCompare(pickText(b.category.name))
    ));

  for (const { category } of orderedCategories) {
    const products = Array.isArray(category?.products) ? category.products : [];
    const product = products.find((item) => pickText(item?.id) === normalizedProductId);

    if (product && isVisibleProduct(product)) {
      return {
        product: {
          ...product,
          id: pickText(product?.id),
          category_id: category.id,
          product_name: getProductDisplayName(product),
        },
        category,
        categoriesById,
      };
    }
  }

  return { product: null, category: null, categoriesById };
};

const buildProductDetailState = (categoryId, productId, categories) => {
  const detail = findProductDetail(productId, categories);
  const routePath = getApiCategoryPath(categoryId, detail.categoriesById);
  const productPath = detail.category ? getApiCategoryPath(detail.category.id, detail.categoriesById) : [];

  return {
    ...detail,
    path: routePath.length > 0 ? routePath : productPath,
    images: detail.product ? resolveProductImages(detail.product) : [],
    price: detail.product ? resolveProductPrice(detail.product) : null,
    groupedAttrs: detail.product ? groupProductAttributes(detail.product) : [],
  };
};

const buildGradient = (colors) =>
  `linear-gradient(145deg, ${colors[0]} 0%, ${colors[1]} 100%)`;

const CategoryArt = ({
  variant = 'card',
  label,
  imageUrl,
  icon: Icon,
  colors,
  badge,
  tall = false,
}) => {
  const FallbackIcon = Icon || Shirt;
  const frameClasses = variant === 'circle'
    ? 'h-[92px] w-[92px] rounded-full'
    : tall
      ? 'aspect-[0.92/1.18] rounded-[1.85rem]'
      : 'aspect-square rounded-[1.45rem]';

  const iconBoxClasses = variant === 'circle'
    ? 'h-12 w-12'
    : 'h-14 w-14';

  const iconClasses = variant === 'circle'
    ? 'h-5 w-5'
    : 'h-6 w-6';

  return (
    <div
      className={`relative overflow-hidden border ${frameClasses}`}
      style={{
        background: buildGradient(colors),
        borderColor: SKELETON_BORDER,
        boxShadow: SHADOW,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={label}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}

      <div
        className="absolute inset-0"
        style={{
          background: imageUrl
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 14%, transparent) 0%, color-mix(in srgb, var(--brand-navy) 10%, transparent) 100%)'
            : buildGradient(colors),
        }}
      />

      {!imageUrl ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full shadow-lg backdrop-blur-sm ${iconBoxClasses}`}
            style={{
              background: 'color-mix(in srgb, var(--surface-color) 86%, transparent)',
              border: '1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)',
            }}
          >
            {React.createElement(FallbackIcon, {
              className: iconClasses,
              style: { color: THEME.navy },
            })}
          </div>
        </div>
      ) : null}

      {badge ? (
        <div
          className="absolute left-3 top-3 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
          style={{
            color: THEME.navy,
            background: 'color-mix(in srgb, var(--surface-color) 90%, transparent)',
            border: '1px solid color-mix(in srgb, var(--brand-navy) 10%, transparent)',
          }}
        >
          {badge}
        </div>
      ) : null}
    </div>
  );
};

const EmptyState = ({ title, description, onRetry }) => (
  <div
    className="rounded-[1.75rem] border px-4 py-5 text-center"
    style={{
      background: `color-mix(in srgb, ${THEME.card} 94%, transparent)`,
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
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    ) : null}
  </div>
);

const ZoomableImageModal = ({ imageUrl, imageAlt, onClose }) => {
  const viewportRef = useRef(null);
  const scrollSnapshotRef = useRef(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef({
    mode: 'idle',
    pinchStartDistance: 0,
    pinchStartScale: 1,
    pinchStartTranslate: { x: 0, y: 0 },
    panStartX: 0,
    panStartY: 0,
    panStartTranslate: { x: 0, y: 0 },
  });
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState('idle');

  const applyTransform = (nextScale, nextTranslate, nextMode = 'idle') => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    const boundedScale = clamp(nextScale, IMAGE_ZOOM_MIN_SCALE, IMAGE_ZOOM_MAX_SCALE);
    const boundedTranslate = clampTranslateToViewport(nextTranslate, boundedScale, viewport);
    scaleRef.current = boundedScale;
    translateRef.current = boundedTranslate;
    setScale(boundedScale);
    setTranslate(boundedTranslate);
    setInteractionMode(nextMode);
  };

  const resetTransform = () => {
    gestureRef.current = {
      mode: 'idle',
      pinchStartDistance: 0,
      pinchStartScale: 1,
      pinchStartTranslate: { x: 0, y: 0 },
      panStartX: 0,
      panStartY: 0,
      panStartTranslate: { x: 0, y: 0 },
    };
    applyTransform(1, { x: 0, y: 0 }, 'idle');
  };

  useEffect(() => {
    if (!imageUrl) return undefined;

    const scrollY = window.scrollY;
    scrollSnapshotRef.current = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyWidth: document.body.style.width,
      bodyTop: document.body.style.top,
      bodyTouchAction: document.body.style.touchAction,
      scrollY,
    };

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.touchAction = 'none';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      const snapshot = scrollSnapshotRef.current;
      scrollSnapshotRef.current = null;

      if (snapshot) {
        document.documentElement.style.overflow = snapshot.htmlOverflow;
        document.body.style.overflow = snapshot.bodyOverflow;
        document.body.style.position = snapshot.bodyPosition;
        document.body.style.width = snapshot.bodyWidth;
        document.body.style.top = snapshot.bodyTop;
        document.body.style.touchAction = snapshot.bodyTouchAction;
        window.scrollTo(0, snapshot.scrollY);
      }

      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [imageUrl, onClose]);

  const beginPinch = (touches) => {
    if (!touches || touches.length < 2) return;
    const distance = getTouchDistance(touches);
    if (!distance) return;

    const midpoint = getTouchMidpoint(touches);
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!midpoint || !viewport) return;

    gestureRef.current = {
      mode: 'pinch',
      pinchStartDistance: distance,
      pinchStartScale: scaleRef.current,
      pinchStartTranslate: { ...translateRef.current },
      panStartX: 0,
      panStartY: 0,
      panStartTranslate: { x: 0, y: 0 },
    };

    setInteractionMode('pinch');
  };

  const beginPan = (touch) => {
    if (!touch || scaleRef.current <= IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON) return;

    gestureRef.current = {
      mode: 'pan',
      pinchStartDistance: 0,
      pinchStartScale: scaleRef.current,
      pinchStartTranslate: { ...translateRef.current },
      panStartX: Number(touch.clientX || 0),
      panStartY: Number(touch.clientY || 0),
      panStartTranslate: { ...translateRef.current },
    };

    setInteractionMode('pan');
  };

  const handleTouchStart = (event) => {
    const touches = event.touches || [];
    if (touches.length === 2) {
      beginPinch(touches);
      return;
    }

    if (touches.length === 1) {
      beginPan(touches[0]);
    }
  };

  const handleTouchMove = (event) => {
    const touches = event.touches || [];
    const gesture = gestureRef.current;

    if (touches.length === 2) {
      if (gesture.mode !== 'pinch' || !gesture.pinchStartDistance) {
        beginPinch(touches);
      }

      const activeGesture = gestureRef.current;
      const currentDistance = getTouchDistance(touches);
      const midpoint = getTouchMidpoint(touches);
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (!currentDistance || !midpoint || !viewport || !activeGesture.pinchStartDistance) return;

      event.preventDefault();

      const nextScale = clamp(
        activeGesture.pinchStartScale * (currentDistance / activeGesture.pinchStartDistance),
        IMAGE_ZOOM_MIN_SCALE,
        IMAGE_ZOOM_MAX_SCALE
      );

      const focalPoint = {
        x: midpoint.x - viewport.left - (viewport.width / 2),
        y: midpoint.y - viewport.top - (viewport.height / 2),
      };

      const nextTranslate = {
        x: activeGesture.pinchStartTranslate.x + ((activeGesture.pinchStartScale - nextScale) * focalPoint.x),
        y: activeGesture.pinchStartTranslate.y + ((activeGesture.pinchStartScale - nextScale) * focalPoint.y),
      };

      applyTransform(nextScale, nextTranslate, 'pinch');
      return;
    }

    if (touches.length === 1 && gesture.mode === 'pan' && scaleRef.current > IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON) {
      event.preventDefault();
      const touch = touches[0];
      const nextTranslate = {
        x: gesture.panStartTranslate.x + (Number(touch.clientX || 0) - gesture.panStartX),
        y: gesture.panStartTranslate.y + (Number(touch.clientY || 0) - gesture.panStartY),
      };

      applyTransform(scaleRef.current, nextTranslate, 'pan');
    }
  };

  const handleTouchEnd = (event) => {
    const touches = event.touches || [];

    if (touches.length === 1 && scaleRef.current > IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON) {
      beginPan(touches[0]);
      return;
    }

    if (touches.length > 0) return;

    gestureRef.current = {
      mode: 'idle',
      pinchStartDistance: 0,
      pinchStartScale: scaleRef.current,
      pinchStartTranslate: { ...translateRef.current },
      panStartX: 0,
      panStartY: 0,
      panStartTranslate: { ...translateRef.current },
    };

    if (scaleRef.current <= IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON) {
      resetTransform();
      return;
    }

    const viewport = viewportRef.current?.getBoundingClientRect();
    const nextTranslate = clampTranslateToViewport(translateRef.current, scaleRef.current, viewport);
    translateRef.current = nextTranslate;
    setTranslate(nextTranslate);
    setInteractionMode('idle');
  };

  const handleWheel = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();

    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextScale = clamp(scaleRef.current + delta, IMAGE_ZOOM_MIN_SCALE, IMAGE_ZOOM_MAX_SCALE);

    if (nextScale <= IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON) {
      resetTransform();
      return;
    }

    const viewport = viewportRef.current?.getBoundingClientRect();
    const nextTranslate = clampTranslateToViewport(translateRef.current, nextScale, viewport);
    applyTransform(nextScale, nextTranslate, 'idle');
  };

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/95 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Product image preview"
      onClick={onClose}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-bold tracking-[0.12em] text-white backdrop-blur-sm transition-transform active:scale-[0.98]"
          aria-label="Close image preview"
        >
          <X className="h-4 w-4" />
          
        </button>

        <div
          ref={viewportRef}
          className="relative flex h-full w-full items-center justify-center overflow-hidden"
          style={{
            touchAction: 'none',
            cursor: interactionMode === 'pinch' ? 'zoom-out' : scale > IMAGE_ZOOM_MIN_SCALE + IMAGE_ZOOM_RESET_EPSILON ? 'grab' : 'zoom-in',
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onWheel={handleWheel}
        >
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
              transformOrigin: 'center center',
              transition: interactionMode === 'idle' ? 'transform 180ms ease-out' : 'none',
              willChange: 'transform',
            }}
          >
            <img
              src={imageUrl}
              alt={imageAlt}
              className="max-h-full max-w-full select-none object-contain pointer-events-none"
              draggable={false}
              loading="eager"
              decoding="async"
            />
          </div>
        </div>

        {/* <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75 backdrop-blur-sm">
          Pinch to zoom
        </div> */}

        <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold text-white/75 backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      </div>
    </div>
  );
};

const ProductDetail = ({ categoryId, productId, onBack }) => {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const heroDragStartXRef = useRef(null);
  const heroDragStartYRef = useRef(null);
  const heroDragDeltaXRef = useRef(0);
  const heroIsDraggingRef = useRef(false);
  const heroClickSuppressedUntilRef = useRef(0);
  const actionMessageTimerRef = useRef(null);
  const sizeAttributeGroupRef = useRef(null);
  const colourAttributeGroupRef = useRef(null);
  const [categoryPayload, setCategoryPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [activeImg, setActiveImg] = useState(0);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState(null);
  const [heroDragX, setHeroDragX] = useState(0);
  const [heroIsDragging, setHeroIsDragging] = useState(false);
  const [chosen, setChosen] = useState({});
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionHasOverflow, setDescriptionHasOverflow] = useState(false);
  const [ctaMessage, setCtaMessage] = useState('');
  const [wishlistItems, setWishlistItems] = useState(() => readWishlistItems());
  const [cartItems, setCartItems] = useState(() => readCartItems());
  const descriptionRef = useRef(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async () => {
      const trustCandidates = getTrustCandidates();
      const cached = readTrustCatalogCacheForCandidates(trustCandidates);
      const canUseCachedPayload = Boolean(cached?.payload) && cached.hasPrices;
      const forceRefresh = reloadToken > 0;

      if (canUseCachedPayload) {
        setCategoryPayload(cached.payload);
        setError('');
        setLoading(false);

        if (isTrustCatalogCacheFresh(cached) && !forceRefresh) {
          return;
        }
      } else {
        setLoading(true);
        setError('');
      }

      try {
        const payload = await fetchProductCategoryTree(controller.signal);
        if (!active || controller.signal.aborted || !payload) return;
        const pricedPayload = await enrichPayloadWithPrices(payload, controller.signal);
        if (!active || controller.signal.aborted || !pricedPayload) return;
        setCategoryPayload(pricedPayload);
        const cacheTrustId = pricedPayload?.trustId || payload?.trustId || trustCandidates[0];
        if (cacheTrustId) {
          writeTrustCatalogCache(cacheTrustId, pricedPayload, { hasPrices: true });
        }
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        if (!canUseCachedPayload) {
          setCategoryPayload(null);
          setError(loadError?.message || 'Failed to load product');
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
  }, [reloadToken]);

  useEffect(() => subscribeWishlist(setWishlistItems), []);
  useEffect(() => subscribeCart(setCartItems), []);

  useEffect(() => () => {
    if (actionMessageTimerRef.current) {
      clearTimeout(actionMessageTimerRef.current);
    }
  }, []);

  const detailState = useMemo(
    () => buildProductDetailState(categoryId, productId, categoryPayload?.categories || []),
    [categoryId, productId, categoryPayload]
  );

  const { product, path, images, price, groupedAttrs, category } = detailState;
  const activeImage = images[activeImg] || images[0] || null;
  const activeImageUrl = pickText(activeImage?.image_url);
  const heroCanPreview = Boolean(activeImageUrl);
  const heroSlides = images.length > 0 ? images : [null];
  const fallbackSeed = hashString(`${productId}:${product?.product_name || ''}`);
  const fallbackIcon = pickFallbackIcon(`${productId}:${product?.product_name || ''}`);
  const wishlistKey = useMemo(
    () => getWishlistKey(product?.id, categoryPayload?.trustId),
    [product?.id, categoryPayload?.trustId]
  );
  const isWished = Boolean(wishlistKey) && wishlistItems.some((item) => item.key === wishlistKey);
  const cartKey = useMemo(
    () => getCartKey(product?.id, categoryPayload?.trustId),
    [product?.id, categoryPayload?.trustId]
  );
  const cartItem = useMemo(
    () => cartItems.find((item) => item.key === cartKey) || null,
    [cartItems, cartKey]
  );
  const cartCount = useMemo(
    () => cartItems.reduce((total, item) => total + Number(item?.quantity || 0), 0),
    [cartItems]
  );
  const bagQuantity = Number(cartItem?.quantity || 0);
  const hasPrice = Boolean(price);
  const sizeAttributeGroup = groupedAttrs.find(([name]) => isSizeAttributeName(name)) || null;
  const colourAttributeGroup = groupedAttrs.find(([name]) => isColourAttributeName(name)) || null;
  const otherAttributeGroups = groupedAttrs.filter(([name]) => !isSizeAttributeName(name) && !isColourAttributeName(name));
  const productDescriptionText = pickText(product?.description, product?.short_description);
  const descriptionLines = [];

  if (productDescriptionText) {
    descriptionLines.push(productDescriptionText);
  }

  if (pickText(product?.product_code)) {
    descriptionLines.push(`Product code: ${product.product_code}`);
  }

  otherAttributeGroups.forEach(([name, values]) => {
    const displayValue = values.map((value) => toTitleCase(value)).filter(Boolean).join(', ');
    if (!displayValue) return;
    descriptionLines.push(`${toTitleCase(name)} : ${displayValue}`);
  });

  const descriptionText = descriptionLines.join('\n');

  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionHasOverflow(false);
  }, [productId, descriptionText]);

  useEffect(() => {
    if (!descriptionText || descriptionExpanded) return undefined;

    const element = descriptionRef.current;
    if (!element) return undefined;

    let frameId = null;
    const measure = () => {
      const nextHasOverflow = element.scrollHeight > element.clientHeight + 1;
      setDescriptionHasOverflow(nextHasOverflow);
    };
    const scheduleMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(element);
    } else {
      window.addEventListener('resize', scheduleMeasure);
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', scheduleMeasure);
      }
    };
  }, [descriptionText, descriptionExpanded]);

  const sizeAttributeValues = useMemo(() => {
    if (!sizeAttributeGroup) return [];

    return [...new Set(
      sizeAttributeGroup[1]
        .flatMap((value) => splitAttributeValues(value))
        .filter(Boolean)
    )];
  }, [sizeAttributeGroup]);
  const sizeOptions = sizeAttributeValues.length > 0 ? sizeAttributeValues : (sizeAttributeGroup?.[1] || []);
  const missingRequiredSelections = [];
  const sizeSelectionMissing = Boolean(sizeAttributeGroup && !pickText(chosen[sizeAttributeGroup[0]]));
  const colourSelectionMissing = Boolean(colourAttributeGroup && !pickText(chosen[colourAttributeGroup[0]]));

  if (sizeSelectionMissing) {
    missingRequiredSelections.push('Size');
  }

  if (colourSelectionMissing) {
    missingRequiredSelections.push('Colour');
  }

  const selectionBlocked = missingRequiredSelections.length > 0;
  const selectionHint = !selectionBlocked
    ? ''
    : sizeSelectionMissing && colourSelectionMissing
      ? 'Select Colour and Size'
      : sizeSelectionMissing
        ? 'Select Size'
        : 'Select Colour';
  const actionNote = ctaMessage;

  useEffect(() => {
    if (actionMessageTimerRef.current) {
      clearTimeout(actionMessageTimerRef.current);
      actionMessageTimerRef.current = null;
    }
    heroDragStartXRef.current = null;
    heroDragStartYRef.current = null;
    heroDragDeltaXRef.current = 0;
    heroIsDraggingRef.current = false;
    heroClickSuppressedUntilRef.current = 0;
    setHeroDragX(0);
    setHeroIsDragging(false);
    setActiveImg(0);
    setImagePreviewIndex(null);
    setIsImagePreviewOpen(false);
    setChosen({});
    setCtaMessage('');
  }, [productId]);

  useEffect(() => {
    const storedAttributes = cartItem?.selected_attributes;
    if (storedAttributes && typeof storedAttributes === 'object' && !Array.isArray(storedAttributes)) {
      const nextAttributes = { ...storedAttributes };
      const sizeKey = sizeAttributeGroup?.[0];

      if (sizeKey && pickText(nextAttributes[sizeKey])) {
        const parsedSizeValues = splitAttributeValues(nextAttributes[sizeKey]);
        const normalizedSizeValue = parsedSizeValues.find((value) => sizeAttributeValues.includes(value))
          || parsedSizeValues[0]
          || pickText(nextAttributes[sizeKey]);

        nextAttributes[sizeKey] = normalizedSizeValue;
      }

      setChosen(nextAttributes);
      return;
    }
    setChosen({});
  }, [cartItem?.updated_at, cartItem?.selected_attributes, productId, sizeAttributeGroup, sizeAttributeValues]);

  useEffect(() => {
    const imageUrls = (Array.isArray(images) ? images : [])
      .map((image) => pickText(image?.image_url))
      .filter(Boolean);

    imageUrls.forEach((url) => {
      const preloaded = new Image();
      preloaded.src = url;
    });
  }, [images]);

  const flashActionMessage = (message) => {
    if (actionMessageTimerRef.current) {
      clearTimeout(actionMessageTimerRef.current);
    }

    setCtaMessage(message);
    actionMessageTimerRef.current = setTimeout(() => {
      setCtaMessage('');
      actionMessageTimerRef.current = null;
    }, 1000);
  };

  const resetHeroGesture = () => {
    heroDragStartXRef.current = null;
    heroDragStartYRef.current = null;
    heroDragDeltaXRef.current = 0;
    heroIsDraggingRef.current = false;
    setHeroDragX(0);
    setHeroIsDragging(false);
  };

  const startHeroGesture = (clientX, clientY) => {
    if (heroSlides.length <= 1) return;
    heroDragStartXRef.current = clientX;
    heroDragStartYRef.current = clientY;
    heroDragDeltaXRef.current = 0;
    heroIsDraggingRef.current = false;
    setHeroDragX(0);
    setHeroIsDragging(false);
  };

  const moveHeroGesture = (clientX, clientY, event) => {
    if (heroSlides.length <= 1) return;
    if (heroDragStartXRef.current === null || heroDragStartYRef.current === null) return;

    const deltaX = clientX - heroDragStartXRef.current;
    const deltaY = clientY - heroDragStartYRef.current;
    const isHorizontalGesture = Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY);

    if (!heroIsDraggingRef.current) {
      if (!isHorizontalGesture) return;
      heroIsDraggingRef.current = true;
      setHeroIsDragging(true);
    }

    event?.preventDefault?.();
    const boundedDelta = Math.max(-120, Math.min(120, deltaX));
    heroDragDeltaXRef.current = boundedDelta;
    setHeroDragX(boundedDelta);
  };

  const endHeroGesture = () => {
    const deltaX = heroDragDeltaXRef.current;
    const wasDragging = heroIsDraggingRef.current;

    if (wasDragging && Math.abs(deltaX) > HERO_SWIPE_THRESHOLD_PX) {
      setActiveImg((current) => {
        if (deltaX < 0) return Math.min(current + 1, heroSlides.length - 1);
        return Math.max(current - 1, 0);
      });
    }

    if (wasDragging) {
      heroClickSuppressedUntilRef.current = Date.now() + HERO_CLICK_SUPPRESS_MS;
    }

    resetHeroGesture();
  };

  const handleHeroTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    startHeroGesture(Number(touch.clientX || 0), Number(touch.clientY || 0));
  };

  const handleHeroTouchMove = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    moveHeroGesture(Number(touch.clientX || 0), Number(touch.clientY || 0), event);
  };

  const handleHeroTouchEnd = () => {
    endHeroGesture();
  };

  const handleHeroTouchCancel = () => {
    resetHeroGesture();
  };

  const handleHeroMouseDown = (event) => {
    startHeroGesture(Number(event?.clientX || 0), Number(event?.clientY || 0));
  };

  const handleHeroMouseMove = (event) => {
    if (heroDragStartXRef.current === null) return;

    moveHeroGesture(
      Number(event?.clientX || 0),
      Number(event?.clientY || 0),
      event
    );
  };

  const handleHeroMouseUp = () => {
    endHeroGesture();
  };

  const handleHeroMouseLeave = () => {
    if (heroIsDraggingRef.current || heroDragStartXRef.current !== null) {
      endHeroGesture();
    }
  };

  const handleHeroClick = () => {
    if (Date.now() < heroClickSuppressedUntilRef.current) return;
    if (heroDragStartXRef.current !== null || heroIsDraggingRef.current) return;
    if (!heroCanPreview) return;

    setImagePreviewIndex(activeImg);
    setIsImagePreviewOpen(true);
  };

  const closeImagePreview = () => {
    setIsImagePreviewOpen(false);
    setImagePreviewIndex(null);
  };

  const handleToggleWishlist = () => {
    if (!product) return;

    const result = toggleWishlistProduct(product, {
      trustId: categoryPayload?.trustId || '',
      categoryId: product?.category_id || categoryId,
      categoryName: category?.name || '',
      price,
      selectedImage: activeImageUrl,
      selectedAttributes: chosen,
      attributeValues: product?.attribute_values || [],
    });

    setWishlistItems(result.items);
    flashActionMessage(result.wished ? 'Added to wishlist' : 'Removed from wishlist');
  };

  const chooseAttr = (name, val) => setChosen((prev) => ({ ...prev, [name]: val }));

  const ensureSelectionsBeforeCart = () => {
    if (!selectionBlocked) return true;

    flashActionMessage(selectionHint);

    const targetRef = sizeSelectionMissing
      ? sizeAttributeGroupRef
      : colourSelectionMissing
        ? colourAttributeGroupRef
        : null;

    targetRef?.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'center',
    });

    return false;
  };

  const buildActionPayload = (quantity = bagQuantity) => ({
    id: product?.id,
    productId: product?.id,
    trustId: categoryPayload?.trustId || '',
    categoryId: product?.category_id || categoryId,
    categoryName: category?.name || '',
    productName: product?.product_name,
    productCode: product?.product_code || '',
    selectedImage: activeImageUrl,
    selectedAttributes: chosen,
    attributeValues: product?.attribute_values || [],
    price,
    quantity,
    categoryPath: path.map((item) => ({
      id: item.id,
      name: item.name,
    })),
  });

  const updateCartQuantity = (nextQuantity) => {
    if (!product) return;

    const updated = setCartProductQuantity(product, buildActionPayload(nextQuantity));
    setCartItems(updated);
  };

  const handleAddToCart = () => {
    if (!product) return;
    if (!ensureSelectionsBeforeCart()) return;
    updateCartQuantity(1);
    flashActionMessage('Added to cart');
  };

  const handleIncreaseQuantity = () => {
    if (!product) return;
    const nextQuantity = bagQuantity + 1;
    updateCartQuantity(nextQuantity);
    // flashActionMessage(`Quantity ${nextQuantity}`);
  };

  const handleDecreaseQuantity = () => {
    if (!product) return;
    const nextQuantity = Math.max(0, bagQuantity - 1);
    if (nextQuantity > 0) {
      updateCartQuantity(nextQuantity);
      // flashActionMessage(`Quantity ${nextQuantity}`);
    } else {
      updateCartQuantity(0);
      flashActionMessage('Removed from cart');
    }
  };

  const handleBuyNow = () => {
    if (!product) return;
    if (!ensureSelectionsBeforeCart()) return;
    updateCartQuantity(bagQuantity > 0 ? bagQuantity : 1);
    navigate('/cart');
  };

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    navigate('/');
  };

  return (
    <div className="ws-page">
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
                      onClick={handleBack}
                      className="rounded-xl p-2 transition-colors"
                      style={{
                        color: navbarTextColor,
                        background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
                      }}
                      aria-label="Go back"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
        
                    <div className="min-w-0 flex-1 text-center">
                      <h1
                        className="truncate text-lg font-extrabold tracking-wide"
                        style={{ color: navbarTextColor }}
                      >
                        {capitalizeFirst(product?.product_name)}
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
      <div className="ws-scroll">
        <div className="ws-breadcrumb">{path.map((c) => capitalizeFirst(c.name)).filter(Boolean).join(" / ") || 'Products'}</div>

        {loading ? (
          <ProductDetailSkeleton />
        ) : null}

        {!loading && error ? (
          <div className="px-4 pt-6">
            <EmptyState
              title="Unable to load product"
              description={error}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          </div>
        ) : null}

        {!loading && !error && !product ? (
          <div className="px-4 pt-6">
            <EmptyState
              title="Product not found"
              description="This product is not available in the selected trust data."
            />
          </div>
        ) : null}

        {!loading && !error && product ? (
          <>
        <div className="ws-pdp-hero">
          <button
            type="button"
            className="ws-pdp-wishlist-btn"
            style={{
              color: isWished ? T.clay : THEME.navy,
              background: 'color-mix(in srgb, var(--surface-color) 90%, transparent)',
              borderColor: isWished
                ? 'color-mix(in srgb, var(--brand-red) 20%, transparent)'
                : 'color-mix(in srgb, var(--brand-navy) 10%, transparent)',
            }}
            aria-label={isWished ? 'Remove from wishlist' : 'Add to wishlist'}
            aria-pressed={isWished}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleToggleWishlist();
            }}
          >
            <Heart size={20} strokeWidth={1.8} fill={isWished ? 'currentColor' : 'none'} />
          </button>
          <div
            className="ws-pdp-hero-track"
            style={{
              transform: `translateX(calc(-${activeImg * 100}% + ${heroDragX}px))`,
              transition: heroIsDragging ? 'none' : 'transform 0.28s ease',
              cursor: heroCanPreview ? (heroIsDragging ? 'grabbing' : 'grab') : 'default',
            }}
            {...(
              heroCanPreview
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': 'Open product image preview',
                    onTouchStart: handleHeroTouchStart,
                    onTouchMove: handleHeroTouchMove,
                    onTouchEnd: handleHeroTouchEnd,
                    onTouchCancel: handleHeroTouchCancel,
                    onMouseDown: handleHeroMouseDown,
                    onMouseMove: handleHeroMouseMove,
                    onMouseUp: handleHeroMouseUp,
                    onMouseLeave: handleHeroMouseLeave,
                    onClick: handleHeroClick,
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleHeroClick();
                      }
                    },
                  }
                : {
                    'aria-label': 'No image preview available',
                  }
            )}
          >
            {heroSlides.map((img, i) => (
              <div key={pickText(img?.id, img?.image_url, i)} className="ws-pdp-slide">
                {pickText(img?.image_url) ? (
                  <img
                    src={img.image_url}
                    alt={`${capitalizeFirst(product?.product_name) || 'Product'} ${i + 1}`}
                    className="ws-pdp-hero-media"
                    loading="eager"
                    fetchPriority={i === activeImg ? 'high' : 'auto'}
                    decoding="async"
                    draggable={false}
                  />
                ) : (
                  <Swatch paletteIdx={fallbackSeed} iconName={fallbackIcon} />
                )}
              </div>
            ))}
        </div>
        {heroSlides.length > 1 ? (
            <div className="ws-pdp-hero-pill">
              {activeImg + 1} / {heroSlides.length}
            </div>
          ) : null}
        </div>
       

        <div className="ws-pdp-body">
          <div className="ws-pdp-name">{capitalizeFirst(product?.product_name)}</div>

          {hasPrice ? (
            <div className="ws-pdp-price-block">
              <Price price={price} size="lg" />
            </div>
          ) : null}
          {hasPrice ? (
            <div className="ws-pdp-actions">
              <button
                type="button"
                className="ws-pdp-action-btn ws-pdp-action-btn-primary"
                onClick={handleBuyNow}
              >
                <Sparkles className="h-4 w-4" />
                Buy Now
              </button>
              {bagQuantity > 0 ? (
                <div className="ws-pdp-qty-control" aria-label="Selected quantity">
                  <button
                    type="button"
                    className="ws-pdp-qty-btn"
                    onClick={handleDecreaseQuantity}
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <div className="ws-pdp-qty-value">{bagQuantity}</div>
                  <button
                    type="button"
                    className="ws-pdp-qty-btn"
                    onClick={handleIncreaseQuantity}
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="ws-pdp-action-btn ws-pdp-action-btn-secondary"
                  onClick={handleAddToCart}
                >
                  <ShoppingCart className="h-4 w-4" />
                  Add to Cart
                </button>
              )}
            </div>
          ) : null}

          {actionNote ? (
            <div className="ws-pdp-toast" role="status" aria-live="polite" aria-atomic="true">
              {String(actionNote).toLowerCase().includes('removed') ? (
                <X className="h-4 w-4" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
              <span>{actionNote}</span>
            </div>
          ) : null}

          {sizeAttributeGroup ? (
            <div
              ref={sizeAttributeGroupRef}
              className={`ws-attr-group ws-attr-group--panel }`}
            >
              <div className="ws-attr-title">
                Size{chosen[sizeAttributeGroup[0]] ? `: ${toTitleCase(chosen[sizeAttributeGroup[0]])}` : ''}
              </div>
              <div className="ws-chip-wrap">
                {sizeOptions.map((v) => (
                  <button
                    key={`size:${v}`}
                    type="button"
                    className={`ws-chip ws-chip--size ${chosen[sizeAttributeGroup[0]] === v ? 'ws-chip-on' : ''}`}
                    onClick={() => chooseAttr(sizeAttributeGroup[0], v)}
                    aria-pressed={chosen[sizeAttributeGroup[0]] === v}
                  >
                    {toTitleCase(v)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {colourAttributeGroup ? (
            <div
              ref={colourAttributeGroupRef}
              className={`ws-attr-group ws-attr-group--panel }`}
            >
              <div className="ws-attr-title">
                Colour{chosen[colourAttributeGroup[0]] ? `: ${toTitleCase(chosen[colourAttributeGroup[0]])}` : ''}
              </div>
              <div className="ws-chip-wrap">
                {colourAttributeGroup[1].map((v) => (
                  <button
                    key={`colour:${v}`}
                    type="button"
                    className={`ws-chip ws-chip--colour ${chosen[colourAttributeGroup[0]] === v ? 'ws-chip-on' : ''}`}
                    onClick={() => chooseAttr(colourAttributeGroup[0], v)}
                    aria-pressed={chosen[colourAttributeGroup[0]] === v}
                  >
                    <span
                      className="ws-chip-swatch"
                      style={{
                        backgroundColor: typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', v)
                          ? v
                          : 'var(--brand-navy)',
                      }}
                    />
                    <span>{toTitleCase(v)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {descriptionText ? (
            <div className="ws-attr-group ws-attr-group--panel ws-description-group">
              <div className="ws-description-title">Description</div>
              <p
                id={`product-description-${productId || 'detail'}`}
                ref={descriptionRef}
                className={`ws-description-text ${!descriptionExpanded && descriptionHasOverflow ? 'ws-description-text--clamped' : ''}`}
              >
                {descriptionText}
              </p>
              {descriptionHasOverflow ? (
                <button
                  type="button"
                  className="ws-description-more"
                  onClick={() => setDescriptionExpanded((value) => !value)}
                  aria-expanded={descriptionExpanded}
                  aria-controls={`product-description-${productId || 'detail'}`}
                >
                  {descriptionExpanded ? 'Show less' : 'Read more'}
                </button>
              ) : null}
            </div>
          ) : null}

         
        </div>
          </>
        ) : null}
      </div>

      {isImagePreviewOpen && imagePreviewIndex !== null && pickText(images[imagePreviewIndex]?.image_url) ? (
        <ZoomableImageModal
          imageUrl={pickText(images[imagePreviewIndex]?.image_url)}
          imageAlt={`${capitalizeFirst(product?.product_name) || 'Product'} ${imagePreviewIndex + 1}`}
          onClose={closeImagePreview}
        />
      ) : null}

      

      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,600&family=Inter:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }

        .ws-page {
          display: flex;
          flex-direction: column;
          height: 100vh;
        }

        .ws-scroll {
          flex: 1;
          overflow-y: auto;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .ws-scroll::-webkit-scrollbar {
          display: none;
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

        .ws-breadcrumb {
          padding: 14px 18px 0;
          font-size: 11.5px;
          color: ${T.inkSoft};
        }

        .ws-price-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }

        .ws-pdp-hero {
          width: 100%;
          aspect-ratio: 4 / 5;
          position: relative;
          overflow: hidden;
          background: ${T.paper};
        }

        .ws-pdp-wishlist-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 3;
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0 12px 24px color-mix(in srgb, var(--brand-navy) 14%, transparent);
          transition: transform 0.18s ease, background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }

        .ws-pdp-wishlist-btn:active {
          transform: scale(0.96);
        }

        .ws-pdp-hero-track {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: visible;
  transition: transform 0.28s ease;
  will-change: transform;
  touch-action: pan-y;
  user-select: none;
}

        .ws-pdp-slide {
          flex: 0 0 100%;
          height: 100%;
        }

        .ws-pdp-hero-media {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center center;
          background: ${T.paper};
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }

        .ws-pdp-hero-pill {
          position: absolute;
          right: 12px;
          bottom: 12px;
          z-index: 2;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 700;
          color: ${T.ink};
          background: color-mix(in srgb, ${THEME.surface} 88%, transparent);
          border: 1px solid color-mix(in srgb, ${T.ink} 12%, transparent);
          backdrop-filter: blur(8px);
        }

        .ws-pdp-thumbs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 18px;
          overflow: visible;
        }

        .ws-pdp-thumb {
          width: 52px;
          height: 62px;
          border: none;
          padding: 0;
          cursor: pointer;
          opacity: 0.5;
          overflow: hidden;
          flex: 0 0 auto;
          border-radius: 12px;
          background: ${T.paper};
        }

        .ws-pdp-thumb-on {
          opacity: 1;
          outline: 1.5px solid ${T.ink};
          outline-offset: 1px;
        }

        .ws-pdp-body {
          padding: 12px 18px 120px;
        }

        .ws-pdp-name {
          font-family: 'Playfair Display', serif;
          font-size: 21px;
          font-weight: 600;
          color: ${navbarTextColor};
          line-height: 1.25;
        }

        .ws-pdp-code {
          font-size: 11.5px;
          color: ${T.inkFaint};
          margin-top: 4px;
        }

        .ws-pdp-price-block {
          margin-top: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid ${T.line};
        }

        .ws-attr-group {
          margin-top: 10px;
        }

        .ws-attr-group--panel {
          padding: 0 14px 0 14px;
          border-radius: 18px;
        
        }

        

        .ws-attr-title {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 9px;
           color: ${T.inkFaint};
        }

        .ws-description-group {
          padding: 12px 14px;
          border-radius: 16px;
          
        }

        .ws-description-title {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 8px;
          color: ${THEME.buttonBg};
        }

        .ws-description-text {
          margin: 0;
          color: ${T.inkFaint};
          font-size: 13px;
          line-height: 1.6;
          font-weight: 500;
          white-space: pre-line;
          overflow-wrap: anywhere;
        }

        .ws-description-text--clamped {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: ${DESCRIPTION_COLLAPSE_LINES};
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ws-description-more {
          display: inline-flex;
          align-self: flex-start;
          margin-top: 8px;
          padding: 0;
          border: 0;
          background: none;
          color: ${THEME.buttonBg};
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        .ws-chip-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .ws-chip {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12.5px;
          padding: 7px 13px;
          border-radius: 999px;
          border: 1px solid ${T.line};
          background: ${T.bg};
          color: ${T.ink};
          cursor: pointer;
        }

        .ws-chip--size {
          min-width: 56px;
          min-height: 44px;
          padding: 0 15px;
          border-radius: 16px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: linear-gradient(180deg, color-mix(in srgb, ${T.bg} 96%, ${THEME.navy} 4%) 0%, ${T.bg} 100%);
          box-shadow: 0 8px 18px color-mix(in srgb, ${THEME.navy} 6%, transparent);
        }

        .ws-chip--colour {
          min-width: 94px;
          justify-content: flex-start;
          gap: 8px;
        }

        .ws-chip-swatch {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          flex: 0 0 auto;
        }

        .ws-chip-on {
          background: ${T.bg};
          border-color: ${THEME.buttonBg};
          color: ${THEME.buttonBg};
          box-shadow: 0 0 0 1px color-mix(in srgb, ${THEME.buttonBg} 16%, transparent);
        }

        .ws-pdp-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 12px;
          flex: 0 0 100%;
          width: 100%;
        }

        .ws-pdp-action-btn {
          min-height: 46px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 14px;
          padding: 0 16px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
        }

        .ws-pdp-action-btn:active {
          transform: scale(0.98);
        }

        .ws-pdp-action-btn-primary {
          background: ${THEME.buttonBg};
          color: ${THEME.buttonText};
          border: 1px solid transparent;
        }

        .ws-pdp-action-btn-secondary {
          background: ${T.bg};
          color: ${THEME.navy};
          border: 1px solid color-mix(in srgb, ${THEME.navy} 18%, transparent);
        }

        .ws-pdp-qty-control {
          min-height: 46px;
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) 46px;
          border-radius: 14px;
          overflow: hidden;
          background: ${T.bg};
          border: 1px solid color-mix(in srgb, ${THEME.navy} 18%, transparent);
        }

        .ws-pdp-qty-btn {
          border: 0;
          background: color-mix(in srgb, ${THEME.navy} 4%, ${T.bg});
          color: ${THEME.navy};
          font-size: 20px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background-color 0.18s ease, transform 0.18s ease;
        }

        .ws-pdp-qty-btn:active {
          transform: scale(0.98);
        }

        .ws-pdp-qty-value {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          color: ${THEME.navy};
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          user-select: none;
        }

        .ws-pdp-toast {
          position: fixed;
          left: 50%;
          bottom: max(18px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 40;
          min-width: 190px;
          max-width: calc(100vw - 32px);
          padding: 12px 16px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-color) 88%, rgba(255, 255, 255, 0.18));
          color: var(--app-button-bg);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          box-shadow: 0 16px 34px color-mix(in srgb, var(--brand-navy) 18%, transparent);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          pointer-events: none;
          animation: wsPdpToastIn 0.18s ease-out;
        }

        @keyframes wsAttrGlow {
          from {
            box-shadow: 0 0 0 1px color-mix(in srgb, ${T.clay} 8%, transparent), 0 10px 24px color-mix(in srgb, ${T.clay} 8%, transparent);
          }
          to {
            box-shadow: 0 0 0 1px color-mix(in srgb, ${T.clay} 18%, transparent), 0 16px 30px color-mix(in srgb, ${T.clay} 16%, transparent);
          }
        }

        @keyframes wsPdpToastIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }

        .ws-skeleton {
          position: relative;
          overflow: hidden;
          background: ${SKELETON_BG};
          border-radius: 999px;
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

        .ws-pdp-skeleton-hero {
          background: ${SKELETON_BG};
          border-radius: 0;
        }

        .ws-pdp-skeleton-fab {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 2;
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid ${SKELETON_BORDER};
        }

        .ws-pdp-skeleton-pill {
          position: absolute;
          right: 12px;
          bottom: 12px;
          z-index: 2;
          width: 58px;
          height: 24px;
          border-radius: 999px;
          border: 1px solid ${SKELETON_BORDER};
        }

        .ws-pdp-skeleton-body {
          padding-bottom: 120px;
        }

        .ws-pdp-skeleton-name {
          width: 72%;
          height: 26px;
          border-radius: 14px;
        }

        .ws-pdp-skeleton-price {
          width: 54%;
          height: 30px;
          border-radius: 16px;
        }

        .ws-pdp-skeleton-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 12px;
        }

        .ws-pdp-skeleton-button {
          min-height: 46px;
          border-radius: 14px;
          border: 1px solid ${SKELETON_BORDER};
        }

        .ws-pdp-skeleton-group {
          gap: 8px;
        }

        .ws-pdp-skeleton-section-title {
          width: 88px;
          height: 14px;
          border-radius: 999px;
          margin-bottom: 9px;
        }

        .ws-pdp-skeleton-chip {
          height: 44px;
          border-radius: 16px;
          border: 1px solid ${SKELETON_BORDER};
        }

        .ws-pdp-skeleton-chip--colour {
          border-radius: 999px;
        }

        .ws-pdp-skeleton-description {
          gap: 10px;
        }

        .ws-pdp-skeleton-line {
          width: 100%;
          height: 12px;
          border-radius: 999px;
        }

        .ws-pdp-skeleton-line--wide {
          width: 84%;
        }

        .ws-pdp-skeleton-line--short {
          width: 68%;
        }
      `}</style>
    </div>
  );
}

export default ProductDetail;
