import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Home as HomeIcon, Search, ShoppingCart,
  SlidersHorizontal, ArrowUpDown, X, Check, Shirt, Sparkles, Heart,
  Briefcase, Dumbbell, Baby, Footprints, Lamp, Droplet, Palette, Gem,
  RefreshCw, ArrowUp,
} from "lucide-react";
import { useAppTheme } from './context/ThemeContext';
import { supabase } from './services/supabaseClient';
import { colorToHex } from './utils/colorUtils';
import { getNavbarThemeStyles } from './utils/themeUtils';
import {
  getWishlistKey,
  readWishlistItems,
  subscribeWishlist,
  toggleWishlistProduct,
} from './utils/productWishlist';
import {
  readCartItems,
  subscribeCart,
} from './utils/productCart';
import {
  isTrustCatalogCacheFresh,
  readTrustCatalogCacheForCandidates,
  writeTrustCatalogCache,
} from './utils/trustCatalogCache';

const THEME = {
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
  ink: 'var(--body-text-color)',
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

const SKELETON_BG = 'color-mix(in srgb, var(--brand-navy) 8%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const SHADOW = '0 18px 36px color-mix(in srgb, var(--brand-navy) 10%, transparent)';

const PAGE_SIZE = 24;
const INITIAL_SKELETON_COUNT = 6;
const JUMP_TOP_AFTER_CARD_COUNT = 6;
const LOAD_MORE_DELAY_MS = 360;
const LOAD_MORE_ROOT_MARGIN = '240px 0px';

const HIDDEN_STATUSES = new Set(['inactive', 'disabled', 'archived', 'hidden', 'draft']);
const VISIBLE_CATEGORY_STATUSES = new Set(['active']);
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

const PALETTE = [
  ['#EFE7D8', '#CBB994'],
  ['#E3E6DC', '#A9B79C'],
  ['#E9DAD2', '#C98B6B'],
  ['#DCE3E6', '#8FA6AD'],
  ['#EAE2EA', '#B79CC9'],
  ['#F0E6E6', '#C98B96'],
  ['#E4E4E0', '#9C9C94'],
  ['#EDE6D6', '#D6A24A'],
];
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
      if(product.status === 'active')
      {
        const productId = pickText(product?.id);
        if (productId) ids.add(productId);
      }
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
    console.warn('[ProductList] Failed to load product prices:', error.message || error);
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
  const childrenByParent = new Map();

  normalized.forEach((category) => {
    categoriesById.set(category.id, category);
  });

  normalized.forEach((category) => {
    if (!category.parentId) return;
    if (!childrenByParent.has(category.parentId)) {
      childrenByParent.set(category.parentId, []);
    }
    childrenByParent.get(category.parentId).push(category);
  });

  childrenByParent.forEach((children) => {
    children.sort((a, b) => a.sourceIndex - b.sourceIndex || pickText(a.name).localeCompare(pickText(b.name)));
  });

  return { normalized, categoriesById, childrenByParent };
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

const getScopedCategoryIds = (categoryId, childrenByParent, visited = new Set()) => {
  const normalizedId = pickText(categoryId);
  if (!normalizedId || visited.has(normalizedId)) return [];

  visited.add(normalizedId);
  const children = childrenByParent.get(normalizedId) || [];
  return [
    normalizedId,
    ...children.flatMap((child) => getScopedCategoryIds(child.id, childrenByParent, visited)),
  ];
};

const isVisibleProduct = (product) => {
  const status = pickText(product?.status).toLowerCase();
  if (!status) return true;
  return !HIDDEN_STATUSES.has(status);
};

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

  if (!Number.isFinite(mrp) && !Number.isFinite(priceAfterDiscount)) return null;

  return {
    ...priceSource,
    mrp: Number.isFinite(mrp) ? mrp : priceAfterDiscount,
    price_after_discount: Number.isFinite(priceAfterDiscount) ? priceAfterDiscount : mrp,
    discount_pct: Number.isFinite(discountPct) ? discountPct : 0,
  };
};

const getProductDisplayName = (product) =>
  pickText(product?.product_name, product?.alias_name, `Product ${pickText(product?.id)}`);

const getProductAttributeRows = (product) =>
  (Array.isArray(product?.attribute_values) ? product.attribute_values : [])
    .flatMap((row) => {
      const name = pickText(row?.attribute_name, row?.name, row?.label, row?.attribute);
      const value = pickText(row?.value, row?.attribute_value, row?.attributeValue);
      if (!name || !value) return [];

      if (normalizeAttributeKey(name) === 'size') {
        return value
          .split(',')
          .map((entry) => formatSizeLabel(entry))
          .filter(Boolean)
          .map((entry) => ({
            name,
            value: entry,
          }));
      }

      return [{
        name,
        value,
      }];
    });

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

const normalizeAttributeKey = (value) => pickText(value).toLowerCase();

const capitalizeFirst = (value) => {
  const text = pickText(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const formatSizeLabel = (value) => {
  const text = pickText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const compact = text.replace(/\s+/g, '');
  const upperCompact = compact.toUpperCase();

  if (/^\d+XL$/.test(upperCompact)) return upperCompact;
  if (['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL'].includes(upperCompact)) return upperCompact;
  if (upperCompact === 'FREESIZE') return 'Free Size';
  if (upperCompact === 'ONESIZE') return 'One Size';

  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const SIZE_SORT_ORDER = [
  'XXXS',
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  '2XL',
  '3XL',
  'XXXL',
  '4XL',
  'XXXXL',
  '5XL',
  '6XL',
];

const getSizeSortRank = (value) => {
  const compact = formatSizeLabel(value).replace(/\s+/g, '').toUpperCase();
  const directRank = SIZE_SORT_ORDER.indexOf(compact);
  if (directRank !== -1) return directRank;

  const numericXL = compact.match(/^(\d+)XL$/);
  if (numericXL) {
    return SIZE_SORT_ORDER.length + Number(numericXL[1]);
  }

  return Number.POSITIVE_INFINITY;
};

const compareFilterValues = (groupName, left, right) => {
  if (normalizeAttributeKey(groupName) === 'size') {
    const leftRank = getSizeSortRank(left);
    const rightRank = getSizeSortRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return formatSizeLabel(left).localeCompare(formatSizeLabel(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
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

const isLightHexColor = (hexColor) => {
  const hex = String(hexColor || '').trim().replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(hex)) return false;

  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  return luminance > 0.62;
};

const getSelectedChipStyles = (navbarTextColor) => {
  const resolvedColor = pickText(navbarTextColor) || '#111827';
  const resolvedHex = colorToHex(resolvedColor, '#111827');

  if (isLightHexColor(resolvedHex)) {
    return {
      background: 'rgba(17, 24, 39, 0.88)',
      borderColor: 'rgba(17, 24, 39, 0.88)',
      color: resolvedColor,
    };
  }

  return {
    background: `color-mix(in srgb, ${resolvedColor} 16%, ${T.bg})`,
    borderColor: `color-mix(in srgb, ${resolvedColor} 38%, ${T.line})`,
    color: resolvedColor,
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

const normalizeSearchText = (value) =>
  pickText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getProductSearchIndex = (product) => [
  product?.product_name,
  product?.alias_name,
  product?.product_code,
  product?.product_type,
  product?.category_name,
  product?.brand_name,
  product?.description,
  product?.short_description,
  ...getProductAttributeRows(product).flatMap(({ name, value }) => [name, value]),
]
  .map(normalizeSearchText)
  .filter(Boolean)
  .join(' ');

const matchesProductSearch = (product, normalizedQuery) => {
  if (!normalizedQuery) return true;

  const searchIndex = getProductSearchIndex(product);
  return normalizedQuery.split(' ').every((term) => searchIndex.includes(term));
};

const getFilterableAttributesForProducts = (products) => {
  const groups = new Map();

  (Array.isArray(products) ? products : []).forEach((product) => {
    getProductAttributeRows(product).forEach(({ name, value }) => {
      if (!groups.has(name)) groups.set(name, new Set());
      groups.get(name).add(value);
    });
  });

  return [...groups.entries()].map(([name, values]) => ({
    name,
    values: [...values].sort((a, b) => compareFilterValues(name, a, b)),
  }));
};

const productMatchesSelectedFilters = (product, selected) => {
  const productAttributes = getProductAttributeRows(product);

  return Object.entries(selected).every(([group, values]) => {
    const matchingValues = productAttributes
      .filter((attribute) => attribute.name === group)
      .map((attribute) => attribute.value);

    return matchingValues.some((value) => values.has(value));
  });
};

const buildScopedProducts = (categoryId, categories) => {
  const { categoriesById, childrenByParent } = buildCategoryTreeLookups(categories);
  const selectedCategory = categoriesById.get(pickText(categoryId)) || null;
  const path = selectedCategory ? getApiCategoryPath(categoryId, categoriesById) : [];
  const scopeCategoryIds = selectedCategory
    ? getScopedCategoryIds(categoryId, childrenByParent)
    : [];
  const productsById = new Map();

  scopeCategoryIds.forEach((scopedCategoryId) => {
    const category = categoriesById.get(scopedCategoryId);
    const categoryProducts = Array.isArray(category?.products) ? category.products : [];
    const categoryDepth = getApiCategoryPath(scopedCategoryId, categoriesById).length;

    categoryProducts
      .filter(isVisibleProduct)
      .forEach((product) => {
        const productId = pickText(product?.id);
        if (!productId) return;

        const candidate = {
          ...product,
          id: productId,
          category_id: scopedCategoryId,
          category_name: pickText(category?.name),
          product_name: getProductDisplayName(product),
          sort_order: normalizeOrder(product?.sort_order),
        };

        const existing = productsById.get(productId);
        if (!existing || categoryDepth > existing.categoryDepth) {
          productsById.set(productId, {
            ...candidate,
            categoryDepth,
          });
        }
      });
  });

  const products = [...productsById.values()].map((product) => {
    const cleanProduct = { ...product };
    delete cleanProduct.categoryDepth;
    return cleanProduct;
  });

  products.sort((a, b) => (
    normalizeOrder(a.sort_order) - normalizeOrder(b.sort_order)
    || getProductDisplayName(a).localeCompare(getProductDisplayName(b))
  ));

  return {
    selectedCategory,
    path,
    scopeCategoryIds,
    products,
  };
};

const getComparablePrice = (price) => {
  const value = Number(price?.price_after_discount ?? price?.total_payable ?? price?.mrp);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

function ProductImageCarousel({
  product,
  images,
  price,
  fallbackSeed,
  fallbackIcon,
  isWished,
  onToggleWishlist,
  onOpen,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const dragRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);
  const slides = images.length > 0 ? images : [{ id: 'fallback', image_url: '' }];
  const canSwipe = slides.length > 1;
  const safeActiveIndex = activeIndex % slides.length;
  const isCarouselControl = (target) => target?.closest?.('[data-carousel-control="true"]');

  const goToRelativeSlide = (direction) => {
    if (!canSwipe) return;
    setActiveIndex((current) => (current + direction + slides.length) % slides.length);
  };

  const handlePointerDown = (event) => {
    if (isCarouselControl(event.target)) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
  };

  const handlePointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (drag.moved && Math.abs(deltaX) > 36 && Math.abs(deltaX) > Math.abs(deltaY)) {
      goToRelativeSlide(deltaX < 0 ? 1 : -1);
    }

    if (drag.moved) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
    }

    dragRef.current = null;
  };

  const handleOpen = (event) => {
    if (isCarouselControl(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }

    onOpen?.();
  };

  return (
    <div
      className="ws-plp-carousel"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.();
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={() => {
        dragRef.current = null;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 250);
      }}
    >
      <div
        className="ws-plp-track"
        style={{ transform: `translateX(-${safeActiveIndex * 100}%)` }}
      >
        {slides.map((image, index) => {
          const imageUrl = pickText(image?.image_url);

          return (
            <div key={pickText(image?.id, imageUrl, index)} className="ws-plp-slide">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`${capitalizeFirst(product.product_name)} ${index + 1}`}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <Swatch paletteIdx={fallbackSeed} iconName={fallbackIcon} />
              )}
            </div>
          );
        })}
      </div>

      <button
      type="button"
      data-carousel-control="true"
      className={`ws-heart-btn ${isWished ? 'ws-heart-btn-on' : ''}`}
      aria-label={`Save ${capitalizeFirst(product.product_name)}`}
      onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleWishlist?.();
        }}
      >
        <Heart size={20} strokeWidth={1.8} fill={isWished ? 'currentColor' : 'none'} />
      </button>

      {(Number(price?.discount_pct) || 0) >= 30 && <span className="ws-sale-badge">SALE</span>}

      {canSwipe ? (
        <div className="ws-plp-dots" aria-hidden="true">
          {slides.map((image, index) => (
            <span
              key={pickText(image?.id, image?.image_url, index)}
              className={`ws-plp-dot ${safeActiveIndex === index ? 'ws-plp-dot-on' : ''}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

const CategoryBubble = ({ item }) => (
  <div className="flex flex-col items-center gap-2 snap-center">
    <CategoryArt
      variant="circle"
      label={capitalizeFirst(item.displayLabel)}
      imageUrl={item.imageUrl}
      icon={item.icon}
      colors={item.colors}
      badge={item.badge}
    />
    <p
      className="max-w-[92px] text-center text-[15px] font-medium leading-tight"
      style={{ color: THEME.text }}
    >
      {capitalizeFirst(item.displayLabel)}
    </p>
  </div>
);

const CategoryCard = ({ item, tall = false }) => (
  <article className="flex flex-col">
    <CategoryArt
      variant="card"
      label={capitalizeFirst(item.displayLabel)}
      imageUrl={item.imageUrl}
      icon={item.icon}
      colors={item.colors}
      badge={item.badge}
      tall={tall}
    />
    <p
      className="mt-2 text-center text-[14px] font-medium leading-tight"
      style={{
        color: THEME.text,
        minHeight: '2.4em',
      }}
    >
      {capitalizeFirst(item.displayLabel)}
    </p>
  </article>
);

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

const SORT_OPTIONS = [
  { key: "popularity", label: "Popularity" },
  { key: "price_asc", label: "Price: Low to High" },
  { key: "price_desc", label: "Price: High to Low" },
  { key: "discount", label: "Discount: High to Low" },
];

function FilterSheet({ open, onClose, groups, selected, onToggle, onClear, navbarTextColor }) {
  if (!open) return null;
  return (
    <div className="ws-sheet-overlay" onClick={onClose}>
      <div className="ws-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ws-sheet-handle" />
        <div className="ws-sheet-header">
          <span className="ws-sheet-title">Filter</span>
          <button className="ws-iconbtn" onClick={onClose}><X size={18} color={T.ink} /></button>
        </div>
        <div className="ws-sheet-body">
          {groups.length === 0 && <div style={{ color: T.inkSoft, fontSize: 13 }}>No filters available.</div>}
          {groups.map((g) => (
            <div key={g.name} className="ws-filter-group">
              <div className="ws-filter-group-title">{capitalizeFirst(g.name)}</div>
              <div className="ws-chip-wrap">
                {g.values.map((v) => {
                  const isOn = selected[g.name]?.has(v);
                  return (
                    <button
                      key={v}
                      className={`ws-chip ${isOn ? "ws-chip-on" : ""}`}
                      onClick={() => onToggle(g.name, v)}
                      style={isOn ? getSelectedChipStyles(navbarTextColor) : undefined}
                    >
                      {isOn && <Check size={12} style={{ marginRight: 4 }} />}
                      {capitalizeFirst(v)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="ws-sheet-footer">
          <button className="ws-btn-outline" onClick={onClear}>Clear all</button>
          <button className="ws-btn-primary" onClick={onClose}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function SortSheet({ open, onClose, value, onChange, primaryColor }) {
  if (!open) return null;
  const activeColor = primaryColor || 'var(--brand-red)';
  return (
    <div className="ws-sheet-overlay" onClick={onClose}>
      <div className="ws-sheet" onClick={(e) => e.stopPropagation()} style={{ '--ws-sort-primary': activeColor }}>
        <div className="ws-sheet-handle" />
        <div className="ws-sheet-header">
          <span className="ws-sheet-title">Sort by</span>
          <button className="ws-iconbtn" onClick={onClose}><X size={18} color={T.ink} /></button>
        </div>
        <div className="ws-sheet-body">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`ws-sort-row ${value === o.key ? 'ws-sort-row-on' : ''}`}
              onClick={() => { onChange(o.key); onClose(); }}
            >
              <span className="ws-sort-label">{o.label}</span>
              <span className={`ws-radio ${value === o.key ? "ws-radio-on" : ""}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const Price = ({ price, size = 'md' }) => {
  const big = size === 'lg';
  const mrp = Number(price?.mrp ?? price?.price_after_discount ?? price?.total_payable);
  const salePrice = Number(price?.price_after_discount ?? price?.total_payable ?? price?.mrp);
  const discountPct = Number(price?.discount_pct ?? 0);

  if (!price || !Number.isFinite(salePrice)) {
    return (
      <div className="ws-price-row">
        <span style={{ fontSize: big ? 16 : 13, fontWeight: 600, color: T.inkSoft }}>
          Currently unavailable
        </span>
      </div>
    );
  }

  return (
    <div className="ws-price-row">
      <span style={{ fontSize: big ? 20 : 14, fontWeight: 600, color: T.ink }}>
        ₹{Number.isFinite(salePrice) ? salePrice.toLocaleString('en-IN') : ''}
      </span>
      {discountPct > 0 ? (
        <>
          <span style={{ fontSize: big ? 14 : 12, color: T.inkFaint, textDecoration: 'line-through' }}>
            ₹{Number.isFinite(mrp) ? mrp.toLocaleString('en-IN') : ''}
          </span>
          <span style={{ fontSize: big ? 13 : 11, color: T.clay, fontWeight: 600 }}>
            {discountPct}% off
          </span>
        </>
      ) : null}
    </div>
  );
};

const ProductCardSkeleton = () => (
  <div className="ws-plp-card" aria-hidden="true">
    <div className="ws-plp-img ws-skeleton ws-skeleton-img" />
    <div className="ws-plp-info">
      <div className="ws-skeleton ws-skeleton-line" style={{ width: '82%', height: 13 }} />
      <div className="ws-skeleton-price-row">
        <div className="ws-skeleton ws-skeleton-line" style={{ width: 52, height: 14 }} />
        <div className="ws-skeleton ws-skeleton-line" style={{ width: 38, height: 11 }} />
      </div>
    </div>
  </div>
);

const ProductList = ({ categoryId, onBack, onOpenProduct }) => {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [categoryPayload, setCategoryPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState("popularity");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [wishlistItems, setWishlistItems] = useState(() => readWishlistItems());
  const [cartItems, setCartItems] = useState(() => readCartItems());
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeSearchText(deferredSearchQuery);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showJumpTop, setShowJumpTop] = useState(false);
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const cardRefs = useRef([]);
  const loadMoreFrameRef = useRef(null);
  const loadMoreTimeoutRef = useRef(null);

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
          setError(loadError?.message || 'Failed to load products');
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

  useEffect(() => {
    setSelected({});
    setSearchQuery('');
  }, [categoryId]);

  useEffect(() => () => {
    if (loadMoreFrameRef.current) {
      window.cancelAnimationFrame(loadMoreFrameRef.current);
      loadMoreFrameRef.current = null;
    }
    if (loadMoreTimeoutRef.current) {
      window.clearTimeout(loadMoreTimeoutRef.current);
      loadMoreTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => subscribeWishlist(setWishlistItems), []);
  useEffect(() => subscribeCart(setCartItems), []);

  const scopedResult = useMemo(
    () => buildScopedProducts(categoryId, categoryPayload?.categories || []),
    [categoryId, categoryPayload]
  );

  const path = scopedResult.path;
  const allProducts = scopedResult.products;
  const wishlistKeys = useMemo(
    () => new Set(wishlistItems.map((item) => item.key)),
    [wishlistItems]
  );
  const cartCount = useMemo(
    () => cartItems.reduce((total, item) => total + Number(item?.quantity || 0), 0),
    [cartItems]
  );
  const groups = useMemo(() => getFilterableAttributesForProducts(allProducts), [allProducts]);

  const toggle = (group, value) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[group] || []);
      set.has(value) ? set.delete(value) : set.add(value);
      if (set.size === 0) delete next[group]; else next[group] = set;
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = allProducts.filter(
      (p) => productMatchesSelectedFilters(p, selected) && matchesProductSearch(p, normalizedSearchQuery)
    );
    list = [...list].map((p) => ({ p, price: resolveProductPrice(p) }));
    if (sortKey === "price_asc") list.sort((a, b) => getComparablePrice(a.price) - getComparablePrice(b.price));
    if (sortKey === "price_desc") list.sort((a, b) => getComparablePrice(b.price) - getComparablePrice(a.price));
    if (sortKey === "discount") list.sort((a, b) => (Number(b.price?.discount_pct) || 0) - (Number(a.price?.discount_pct) || 0));
    return list;
  }, [allProducts, normalizedSearchQuery, selected, sortKey]);

  // Reset how many products are visible whenever the underlying filtered list changes
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
    setVisibleCount(PAGE_SIZE);
  }, [categoryId, normalizedSearchQuery, selected, sortKey, allProducts]);

  const visibleProducts = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = visibleCount < filtered.length;

  // Infinite scroll: grow visibleCount by PAGE_SIZE when the sentinel enters view
  useEffect(() => {
    const container = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel || loading || error) return undefined;
    if (!hasMore) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadMoreTimeoutRef.current && !loadMoreFrameRef.current) {
          setLoadingMore(true);
          loadMoreFrameRef.current = window.requestAnimationFrame(() => {
            loadMoreFrameRef.current = null;
            loadMoreTimeoutRef.current = window.setTimeout(() => {
              loadMoreTimeoutRef.current = null;
              setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
              setLoadingMore(false);
            }, LOAD_MORE_DELAY_MS);
          });
        }
      },
      { root: container, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0.01 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, error, hasMore, filtered.length]);

  // Jump-to-top button: show once the 14th product card has scrolled fully out of view above
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const targetCard = cardRefs.current[JUMP_TOP_AFTER_CARD_COUNT - 1];
      if (!targetCard) {
        setShowJumpTop(false);
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const cardBottom = targetCard.getBoundingClientRect().bottom;
      setShowJumpTop(cardBottom < containerTop);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [visibleProducts.length, loading]);

  const handleJumpToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeFilterCount = Object.values(selected).reduce((n, s) => n + s.size, 0);
  const hasSearchQuery = Boolean(normalizedSearchQuery);
  const emptyStateMessage = hasSearchQuery && activeFilterCount > 0
    ? 'No products match the current search and filters.'
    : hasSearchQuery
      ? 'No products match your search.'
      : activeFilterCount > 0
        ? 'No products match the selected filters.'
        : 'No products found for this category.';

  return (
    <div className="ws-page">
        <div
        className="theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: `0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)`,
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="px-4 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => (onBack ? onBack() : navigate('/categories-products'))}
              className="p-2 rounded-xl transition-colors"
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
                className="text-lg font-extrabold tracking-wide truncate"
                style={{ color: navbarTextColor }}
              >
                Products
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
                {wishlistItems.length > 0 && <span className="ws-cart-badge">{wishlistItems.length}</span>}
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
      <div className="ws-scroll" ref={scrollRef}>
        <div className="ws-breadcrumb">{path.map((c) => capitalizeFirst(c.name)).filter(Boolean).join(" / ") || 'Products'}</div>
        <div className="ws-plp-toolbar">
          <div className="ws-plp-search">
            <Search size={15} />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search products by name or code"
              aria-label="Search products"
            />
  
          </div>
          <div className="ws-plp-toolbar-actions">
            <button className="ws-toolbar-btn" onClick={() => setSortOpen(true)} disabled={loading || Boolean(error)}>
              <ArrowUpDown size={14} /> Sort
            </button>
            <button className="ws-toolbar-btn" onClick={() => setFilterOpen(true)} disabled={loading || Boolean(error)}>
              <SlidersHorizontal size={14} /> Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
            </button>
            <span className="ws-plp-count">
              {loading ? 'Loading...' : `${filtered.length} items`}
            </span>
          </div>
        </div>

        <div className="ws-plp-grid">
          {loading ? (
            Array.from({ length: INITIAL_SKELETON_COUNT }).map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))
          ) : null}

          {!loading && error ? (
            <div style={{ gridColumn: "1/-1" }}>
              <EmptyState
                title="Unable to load products"
                description={error}
                onRetry={() => setReloadToken((value) => value + 1)}
              />
            </div>
          ) : null}

          {!loading && !error ? visibleProducts.map(({ p, price }, index) => {
            const imgs = resolveProductImages(p);
            const fallbackSeed = hashString(`${p.id}:${p.product_name}`);
            const fallbackIcon = pickFallbackIcon(`${p.id}:${p.product_name}`);
            const openProduct = () => onOpenProduct?.(p.id);
            const wishlistKey = getWishlistKey(p.id, categoryPayload?.trustId);
            const isWished = wishlistKeys.has(wishlistKey);
            const toggleWishlist = () => {
              const result = toggleWishlistProduct(
                { ...p, price },
                {
                  trustId: categoryPayload?.trustId,
                  categoryId: p.category_id,
                  categoryName: p.category_name,
                  price,
                  selectedAttributes: p.selected_attributes || {},
                  attributeValues: p.attribute_values || [],
                }
              );
              setWishlistItems(result.items);
            };

            return (
              <article
                key={p.id}
                className="ws-plp-card"
                ref={(el) => { cardRefs.current[index] = el; }}
              >
                <ProductImageCarousel
                  product={p}
                  images={imgs}
                  price={price}
                  fallbackSeed={fallbackSeed}
                  fallbackIcon={fallbackIcon}
                  isWished={isWished}
                  onToggleWishlist={toggleWishlist}
                  onOpen={openProduct}
                />
                <button
                  type="button"
                  className="ws-plp-info ws-plp-info-btn"
                  onClick={openProduct}
                >
                  <div className="ws-plp-name">{capitalizeFirst(p.product_name)}</div>
                  <Price price={price} />
                  {/* {!price && p.product_code ? <div className="ws-plp-code">{p.product_code}</div> : null} */}
                </button>
              </article>
            );
          }) : null}

          {!loading && !error && loadingMore ? (
            Array.from({ length: Math.min(PAGE_SIZE, filtered.length - visibleCount) }).map((_, index) => (
              <ProductCardSkeleton key={`more-${index}`} />
            ))
          ) : null}

          {!loading && !error && filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "40px 0", color: T.inkSoft, fontSize: 13 }}>
              {emptyStateMessage}
            </div>
          )}
        </div>

        {!loading && !error && hasMore ? (
          <div ref={sentinelRef} className="ws-plp-sentinel" aria-hidden="true" />
        ) : null}

        <div style={{ height: 8 }} />
        <button
        type="button"
        className={`ws-jump-top ${showJumpTop ? 'ws-jump-top-visible' : ''}`}
        onClick={handleJumpToTop}
        aria-label="Jump to top"
        aria-hidden={!showJumpTop}
        tabIndex={showJumpTop ? 0 : -1}
      >
        <ArrowUp size={18} strokeWidth={2.2} />
      </button>
      </div>
      {/* <BottomNav active="categories" cartCount={cartCount} /> */}
      
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        groups={groups}
        selected={selected}
        onToggle={toggle}
        onClear={() => setSelected({})}
        navbarTextColor={navbarTextColor}
      />
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} value={sortKey} onChange={setSortKey} primaryColor={primaryColor} />
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,600&family=Inter:wght@400;500;600;700&display=swap');

        * { box-sizing: border-box; }
        .ws-shell {
          font-family: 'Inter', -apple-system, sans-serif;
          background: ${T.bg};
          color: ${T.ink};
          max-width: 430px;
          margin: 0 auto;
          min-height: 100vh;
          border-left: 1px solid ${T.line};
          border-right: 1px solid ${T.line};
          position: relative;
        }
        .ws-page { display: flex; flex-direction: column; height: 100vh; }
        .ws-scroll { flex: 1; overflow-y: auto; -ms-overflow-style: none; scrollbar-width: none; }
        .ws-scroll::-webkit-scrollbar { display: none; }

        .ws-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 18px; border-bottom: 1px solid ${T.line};
          position: sticky; top: 0; background: ${T.bg}; z-index: 5;
        }
        .ws-logo { font-family: 'Playfair Display', serif; font-size: 21px; font-weight: 600; letter-spacing: 0.5px; }
        .ws-logo-w { font-size: 34px; font-style: italic; font-weight: 600; line-height: 0; position: relative; top: 6px; margin-right: 1px; }
        .ws-header-title { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 600; }
        .ws-iconbtn { background: none; border: none; padding: 4px; cursor: pointer; display: flex; }
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
          position: absolute; top: -7px; right: -8px; background: ${T.clay}; color: white;
          font-size: 9px; font-weight: 700; border-radius: 999px; min-width: 15px; height: 15px;
          display: flex; align-items: center; justify-content: center; padding: 0 3px;
        }
        .ws-cart-badge-nav { top: -6px; right: -7px; }

        .ws-circle-row { display: flex; gap: 22px; padding: 20px 18px 6px; overflow-x: auto; }
        .ws-circle-item { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0; }
        .ws-circle-avatar { width: 84px; height: 84px; border-radius: 999px; overflow: hidden; }
        .ws-circle-label { font-size: 13px; color: ${navbarTextColor}; }

        .ws-section { padding: 22px 18px 4px; }
        .ws-section-title { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 600; margin-bottom: 12px; }
        .ws-grid { display: grid; gap: 10px; }
        .ws-tile { background: none; border: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; gap: 8px; text-align: left; }
        .ws-tile-img { width: 100%; overflow: hidden; }
        .ws-tile-label { font-size: 13px; color: ${navbarTextColor}; line-height: 1.3; }

        .ws-brand-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 4px; }
        .ws-brand-item { flex-shrink: 0; }
        .ws-brand-avatar { width: 74px; height: 74px; border-radius: 999px; display: flex; align-items: center; justify-content: center; padding: 8px; }
        .ws-brand-text { font-size: 10.5px; font-weight: 700; text-align: center; color: ${T.ink}; line-height: 1.2; }

        
        .ws-navitem { flex: 1; display: flex; flex-direction: column; align-items: center; }
        .ws-whitedoor { border: 1px solid ${T.ink}; border-radius: 20px; margin: -6px 2px -6px 0; padding: 6px 4px; color: ${T.ink} !important; }
        .ws-whitedoor-mark { width: 20px; height: 14px; position: relative; }
        .ws-whitedoor-c1, .ws-whitedoor-c2 { position: absolute; top: 0; width: 14px; height: 14px; border-radius: 999px; border: 1.5px solid ${T.ink}; }
        .ws-whitedoor-c1 { left: 0; } .ws-whitedoor-c2 { left: 6px; }

        .ws-breadcrumb { padding: 14px 18px 0; font-size: 11.5px; color: ${T.inkSoft}; }
        .ws-plp-toolbar { display: flex; flex-direction: column; gap: 10px; padding: 12px 18px; }
        .ws-plp-search {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 12px;
          border: 1px solid ${T.line};
          border-radius: 999px;
          background: ${T.paper};
          color: ${navbarTextColor};
        }
        .ws-plp-search input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          font: inherit;
          color: ${navbarTextColor};
        }
        .ws-plp-search input::placeholder { color: ${T.inkSoft}; }
        .ws-plp-search-clear {
          border: none;
          background: transparent;
          color: ${T.inkSoft};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
        }
        .ws-plp-toolbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ws-toolbar-btn {
          display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500;
          background: ${T.paper}; border: 1px solid ${T.line}; border-radius: 999px; padding: 7px 13px; cursor: pointer; color: ${T.ink};
        }
        .ws-toolbar-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ws-plp-count { margin-left: auto; font-size: 12px; color: ${T.inkSoft}; }
        .ws-plp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 10px; padding: 0 18px 20px; }
        .ws-plp-card { background: none; border: none; padding: 0; text-align: left; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
        .ws-plp-img { width: 100%; aspect-ratio: 3/4; position: relative; overflow: hidden; }

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
          100% { transform: translateY(110%); }
        }
        .ws-skeleton-img {
          border-radius: 16px;
          border: 1px solid ${SKELETON_BORDER};
        }
        .ws-skeleton-line { border-radius: 999px; }
        .ws-skeleton-price-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }

        .ws-plp-sentinel { width: 100%; height: 1px; }

        .ws-jump-top {
          position: absolute;
          right: 20px;
          bottom: 28px;
          z-index: 15;
          width: 42px;
          height: 42px;
          border: none;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: ${primaryColor};
          color: white;
          box-shadow: 0 15px 34px rgba(28, 27, 25, 0.28);
          cursor: pointer;
          opacity: 0;
          transform: translateY(12px) scale(0.9);
          pointer-events: none;
          transition: opacity 220ms ease, transform 220ms ease;
        }
        .ws-jump-top-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        .ws-plp-carousel {
          width: 100%;
          aspect-ratio: 3/4;
          position: relative;
          overflow: hidden;
          background: ${T.paper};
          touch-action: pan-y;
          cursor: pointer;
          user-select: none;
        }
        .ws-plp-carousel:focus-visible {
          outline: 2px solid ${T.clay};
          outline-offset: 2px;
        }
        .ws-plp-track {
          height: 100%;
          display: flex;
          transition: transform 220ms ease;
          will-change: transform;
        }
        .ws-plp-slide {
          flex: 0 0 100%;
          height: 100%;
          min-width: 0;
        }
        .ws-plp-slide img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          pointer-events: none;
        }
        .ws-heart-btn {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 2;
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 999px;
          background: color-mix(in srgb, white 72%, transparent);
          color: ${T.ink};
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
        }
        .ws-heart-btn-on {
          color: ${T.clay};
          background: color-mix(in srgb, white 86%, transparent);
        }
        .ws-plp-dots {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 10px;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          pointer-events: none;
        }
        .ws-plp-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.6);
          box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        }
        .ws-plp-dot-on {
          background: white;
          transform: scale(1.15);
        }
        .ws-plp-info-btn {
          width: 100%;
          border: none;
          background: none;
          padding: 0;
          text-align: left;
          cursor: pointer;
          color: inherit;
        }
        .ws-sale-badge { position: absolute; top: 8px; left: 8px; background: ${T.clay}; color: white; font-size: 9.5px; font-weight: 700; padding: 2px 7px; letter-spacing: 0.5px; }
        .ws-plp-name { font-size: 15px; color: ${navbarTextColor}; line-height: 1.3; }
        .ws-plp-code { margin-top: 2px; font-size: 11px; color: ${T.inkSoft}; line-height: 1.25; }
        .ws-price-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .ws-sheet-overlay { position: fixed; inset: 0; background: rgba(28,27,25,0.4); z-index: 20; display: flex; align-items: flex-end; max-width: 430px; margin: 0 auto; }
        .ws-sheet { background: ${T.bg}; width: 100%; border-radius: 18px 18px 0 0; max-height: 72vh; display: flex; flex-direction: column; }
        .ws-sheet-handle { width: 36px; height: 4px; background: ${T.line}; border-radius: 999px; margin: 10px auto 4px; }
        .ws-sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 18px 14px; border-bottom: 1px solid ${T.line}; }
        .ws-sheet-title { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 600; }
        .ws-sheet-body { padding: 16px 18px; overflow-y: auto; }
        .ws-sheet-footer { display: flex; gap: 10px; padding: 14px 18px; border-top: 1px solid ${T.line}; }

        .ws-filter-group { margin-bottom: 18px; }
        .ws-filter-group-title { font-size: 12.5px; font-weight: 600; color: ${T.inkSoft}; letter-spacing: 0.2px; margin-bottom: 9px; }
        .ws-chip-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
        .ws-chip { display: flex; align-items: center; font-size: 12.5px; padding: 7px 13px; border-radius: 999px; border: 1px solid ${T.line}; background: ${T.bg}; color: ${T.ink}; cursor: pointer; }
        .ws-chip-on { font-weight: 600; }

        .ws-sort-row { width: 100%; display: flex; align-items: center; justify-content: space-between; background: none; border: none; padding: 13px 0; border-bottom: 1px solid ${T.line}; font-size: 14px; color: ${T.ink}; cursor: pointer; }
        .ws-sort-row-on { color: var(--ws-sort-primary); font-weight: 600; }
        .ws-sort-label { color: inherit; }
        .ws-radio { width: 16px; height: 16px; border-radius: 999px; border: 1.5px solid ${T.inkFaint}; display: inline-block; }
        .ws-radio-on { border-color: currentColor; background: radial-gradient(circle, currentColor 0 5px, transparent 6px); }

        .ws-btn-primary { background: ${T.ink}; color: white; border: none; border-radius: 4px; padding: 13px; font-size: 14px; font-weight: 600; cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: center; }
        .ws-btn-outline { background: ${T.bg}; color: ${T.ink}; border: 1px solid ${T.ink}; border-radius: 4px; padding: 13px; font-size: 14px; font-weight: 600; cursor: pointer; flex: 1; }

        .ws-pdp-hero { width: 100%; aspect-ratio: 4/5; }
        .ws-pdp-thumbs { display: flex; gap: 8px; padding: 8px 18px; }
        .ws-pdp-thumb { width: 52px; height: 62px; border: none; padding: 0; cursor: pointer; opacity: 0.5; overflow: hidden; }
        .ws-pdp-thumb-on { opacity: 1; outline: 1.5px solid ${T.ink}; outline-offset: 1px; }
        .ws-pdp-body { padding: 12px 18px 100px; }
        .ws-pdp-cat { font-size: 12px; color: ${T.inkSoft}; margin-bottom: 4px; }
        .ws-pdp-name { font-family: 'Playfair Display', serif; font-size: 21px; font-weight: 600; line-height: 1.25; }
        .ws-pdp-code { font-size: 11.5px; color: ${T.inkFaint}; margin-top: 4px; }
        .ws-pdp-price-block { margin-top: 16px; padding-bottom: 16px; border-bottom: 1px solid ${T.line}; }
        .ws-pdp-gst { font-size: 11.5px; color: ${T.inkSoft}; margin-top: 6px; }
        .ws-member-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12.5px; color: ${T.ink}; font-weight: 500; }
        .ws-member-badge { background: ${T.paper}; border: 1px solid ${T.sage}; color: ${T.sage}; font-size: 10px; font-weight: 700; padding: 3px 7px; letter-spacing: 0.4px; }
        .ws-attr-group { margin-top: 18px; }
        .ws-attr-title { font-size: 13px; font-weight: 600; margin-bottom: 9px; }
        .ws-pdp-meta { margin-top: 22px; background: ${T.paper}; padding: 14px 16px; border-radius: 6px; }
        .ws-pdp-meta-row { display: flex; justify-content: space-between; font-size: 12.5px; color: ${T.inkSoft}; padding: 5px 0; }
        .ws-pdp-meta-row span:last-child { color: ${T.ink}; font-weight: 500; }
        .ws-pdp-cta-bar { position: sticky; bottom: 0; background: ${T.bg}; border-top: 1px solid ${T.line}; padding: 12px 18px; }
        .ws-pdp-cta { width: 100%; }
      `}</style>
    </div>
  );
}

export default ProductList;
