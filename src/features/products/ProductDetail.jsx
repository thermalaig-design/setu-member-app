import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Home as HomeIcon, ShoppingCart, Shirt, Sparkles, Heart, Briefcase, Dumbbell, Baby, Footprints, Lamp, Droplet, Palette, Gem, RefreshCw, X } from "lucide-react";
import { useAppTheme } from '../../shared/context/ThemeContext';
import { supabase } from '../../shared/services/supabaseClient';
import { formatInr, getDisplayPricing } from '../../shared/utils/productPricing';
import { useThemeButtonVars } from '../../shared/utils/themeButtonVars';
import { getNavbarThemeStyles } from '../../shared/utils/themeUtils';
import {
  isWishlistProductInItems,
  readWishlistItems,
  resolveWishlistProductPriceId,
  subscribeWishlist,
  toggleWishlistProductAsync,
} from './productWishlist';
import { getCartKey, readCartItems, setCartProductQuantity, subscribeCart } from './productCart';
import { getAppHomePath } from '../../shared/utils/tenantNavigation';
import { logMetaViewContent } from '../../shared/services/metaEvents';
import { track } from '../../shared/services/analytics';
import {
  isTrustCatalogCacheFresh,
  readTrustCatalogCacheForCandidates,
  writeTrustCatalogCache,
} from '../../shared/utils/trustCatalogCache';
import { lockBodyScroll } from '../../shared/utils/scrollLock';


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
// Every colour below resolves from the active theme (see the --pd-* tokens on .ws-page),
// so the page stays readable on light, dark and gradient themes alike.
const T = {
  bg: 'var(--pd-card)',
  ink: 'var(--pd-ink)',
  inkSoft: 'var(--pd-soft)',
  inkFaint: 'var(--pd-faint)',
  line: 'var(--pd-line)',
  paper: 'var(--pd-tint-strong)',
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

const SKELETON_BG = 'color-mix(in srgb, var(--page-text-color, var(--body-text-color)) 10%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const SHADOW = '0 18px 36px color-mix(in srgb, var(--brand-navy) 10%, transparent)';
const VISIBLE_CATEGORY_STATUSES = new Set(['active']);
const IMAGE_ZOOM_MIN_SCALE = 1;
const IMAGE_ZOOM_MAX_SCALE = 4;
const HERO_DRAG_ACTIVATION_PX = 8;
const HERO_CLICK_SUPPRESS_MS = 250;
const trustGatewayCache = new Map();
const HERO_AUTOPLAY_MS = 3500;
const HERO_AUTOPLAY_PAUSE_MS = 7000;
const HERO_SWIPE_THRESHOLD_PX = 48;
const IMAGE_ZOOM_RESET_EPSILON = 0.02;
const PRODUCT_SPEC_TABS = [
  { id: 'features', label: 'Features & Specs' },
  { id: 'measurements', label: 'Measurements' },
  { id: 'itemDetails', label: 'Item details' },
];
const MEASUREMENT_SPEC_PATTERN = /(size|dimension|length|width|height|weight|area|sq\.?\s*ft|measurement|capacity|volume|floor|seat|tonne|ton|inch|cm|mm|meter|metre|kg|gram|liter|litre)/i;
const ITEM_DETAIL_SPEC_PATTERN = /(product\s*code|code|sku|brand|model|item\s*form|material|color|colour|type|category|manufacturer|seller|maintenance|electricity|water|security|location|availability|warranty)/i;

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

const splitSpecLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([^:：-]{2,60})\s*[:：-]\s*(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (!label || !value) return null;
  return { label: toTitleCase(label), value };
};

const getSpecTabId = (label) => {
  if (MEASUREMENT_SPEC_PATTERN.test(label)) return 'measurements';
  if (ITEM_DETAIL_SPEC_PATTERN.test(label)) return 'itemDetails';
  return 'features';
};

const buildProductSpecs = (lines) => {
  const sections = PRODUCT_SPEC_TABS.reduce((acc, tab) => {
    acc[tab.id] = [];
    return acc;
  }, {});
  const overviewLines = [];

  lines.forEach((line) => {
    const spec = splitSpecLine(line);
    if (!spec) {
      const cleanLine = String(line || '').trim();
      if (cleanLine) overviewLines.push(cleanLine);
      return;
    }
    sections[getSpecTabId(spec.label)].push(spec);
  });

  return { sections, overviewText: overviewLines.join('\n\n') };
};

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
  const primaryColor = theme?.primaryColor || '--brand-navy';
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  if (!price) return null;
  const big = size === 'lg';
  return (
    <div className="ws-price-row">
      <span style={{ fontSize: big ? 20 : 14, fontWeight: 700, color: 'var(--page-price-color, ' + primaryColor + ')' }}>
        ₹{price.price_after_discount.toLocaleString('en-IN')}
      </span>
      {price.discount_pct > 0 ? (
        <>
          <span style={{ fontSize: big ? 14 : 12, color: 'color-mix(in srgb, var(--page-text-color, var(--body-text-color)) 62%, transparent)', textDecoration: 'line-through' }}>
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

const normalizeAttributeType = (value) => pickText(value).toLowerCase();

const isDisplayAttributeType = (value) => normalizeAttributeType(value) === 'display';

const isMultiSelectionAttributeType = (value) => {
  const type = normalizeAttributeType(value);
  return ['multiselect', 'multi-select', 'multi_select', 'multi select'].includes(type);
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

const formatGeneralAttributeLabel = (value) => {
  const text = pickText(value);
  if (!text) return '';

  const compact = text.replace(/\s+/g, '');
  if (/^[\d.]+$/.test(compact)) return compact;
  if (text === text.toUpperCase()) return text;

  return toTitleCase(text);
};

const formatAttributeToken = (attributeName, value) => {
  if (isSizeAttributeName(attributeName)) return formatSizeLabel(value);
  return formatGeneralAttributeLabel(value);
};

const formatAttributeValueText = (attributeName, value) => {
  const tokens = splitAttributeValues(value);
  if (tokens.length > 1) {
    return tokens
      .map((token) => formatAttributeToken(attributeName, token))
      .filter(Boolean)
      .join(', ');
  }

  return formatAttributeToken(attributeName, value);
};

const compareAttributeTokens = (attributeName, left, right) => {
  if (isSizeAttributeName(attributeName)) {
    const leftRank = getSizeSortRank(left);
    const rightRank = getSizeSortRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return formatAttributeToken(attributeName, left).localeCompare(
    formatAttributeToken(attributeName, right),
    undefined,
    { numeric: true, sensitivity: 'base' }
  );
};

const buildAttributeSchemaLookups = (category) => {
  const categoryList = Array.isArray(category) ? category : [category];
  const schemaRows = categoryList.flatMap((entry) => (
    Array.isArray(entry?.attributes_schema) ? entry.attributes_schema : []
  ));
  const byId = new Map();
  const byName = new Map();

  schemaRows.forEach((row, index) => {
    if (normalizeAttributeType(row?.status) && normalizeAttributeType(row?.status) !== 'active') return;

    const name = pickText(row?.attribute_name);
    if (!name) return;

    const id = pickText(row?.id, row?.attribute_id);
    const entry = {
      id,
      name,
      type: normalizeAttributeType(row?.attribute_type),
      order: Number.isFinite(Number(row?.sort_order))
        ? Number(row?.sort_order)
        : index,
    };

    if (id) byId.set(id, entry);
    byName.set(normalizeAttributeName(name), entry);
  });

  return { byId, byName };
};

const buildProductAttributeSections = (product, category) => {
  const { byId, byName } = buildAttributeSchemaLookups(category);
  const groupsByKey = new Map();
  const rows = Array.isArray(product?.attribute_values) ? product.attribute_values : [];

  rows.forEach((row, index) => {
    if (normalizeAttributeType(row?.status) && normalizeAttributeType(row?.status) !== 'active') return;

    const schemaEntry = byId.get(pickText(row?.attribute_id))
      || byName.get(normalizeAttributeName(row?.attribute_name));
    const rawName = pickText(row?.attribute_name, schemaEntry?.name);
    if (!rawName) return;

    const rowType = normalizeAttributeType(schemaEntry?.type || row?.attribute_type);
    const isDisplay = isDisplayAttributeType(rowType);
    const isMulti = isMultiSelectionAttributeType(rowType) || isMultiSelectionAttributeType(schemaEntry?.type);
    const attributeKey = normalizeAttributeName(rawName) || pickText(row?.attribute_id) || `attribute-${index}`;
    const valueText = pickText(row?.value, row?.attribute_value, row?.attributeValue);
    if (!valueText) return;

    const existing = groupsByKey.get(attributeKey) || {
      key: attributeKey,
      attributeId: pickText(row?.attribute_id, schemaEntry?.id),
      name: rawName,
      type: isDisplay ? 'display' : 'selection',
      mode: isMulti ? 'multi' : 'single',
      order: Number.isFinite(Number(schemaEntry?.order)) ? Number(schemaEntry.order) : index,
      values: [],
    };

    existing.name = pickText(existing.name, rawName);
    existing.attributeId = pickText(existing.attributeId, row?.attribute_id, schemaEntry?.id);
    existing.order = Math.min(existing.order, Number.isFinite(Number(schemaEntry?.order)) ? Number(schemaEntry.order) : index);
    if (!isDisplay) {
      existing.type = 'selection';
    } else if (!existing.type) {
      existing.type = 'display';
    }
    if (isMulti) {
      existing.mode = 'multi';
    }

    const nextValues = existing.type === 'display'
      ? [valueText]
      : splitAttributeValues(valueText);

    nextValues.forEach((token) => {
      const normalized = pickText(token);
      if (!normalized) return;

      const normalizedToken = normalized.toLowerCase();
      if (existing.values.some((entry) => pickText(entry).toLowerCase() === normalizedToken)) return;
      existing.values.push(normalized);
    });

    groupsByKey.set(attributeKey, existing);
  });

  const groups = [...groupsByKey.values()]
    .map((group) => {
      if (group.type !== 'display') {
        return {
          ...group,
          values: [...group.values].sort((left, right) => compareAttributeTokens(group.name, left, right)),
        };
      }

      return group;
    })
    .sort((a, b) => (
      a.order - b.order
      || a.name.localeCompare(b.name)
    ));

  return {
    displayAttributes: groups.filter((group) => group.type === 'display'),
    selectionAttributes: groups.filter((group) => group.type !== 'display' && group.values.length > 0),
  };
};

const normalizeChosenSelectionValue = (value, mode) => {
  if (mode === 'multi') {
    const values = Array.isArray(value) ? value : splitAttributeValues(value);
    return [...new Set(values.map((entry) => pickText(entry)).filter(Boolean))];
  }

  if (Array.isArray(value)) {
    return pickText(value.find((entry) => isMeaningfulText(entry)));
  }

  const tokens = splitAttributeValues(value);
  return pickText(tokens[0] || value);
};

const formatChosenSelectionValue = (attributeName, value, mode) => {
  if (mode === 'multi') {
    const values = Array.isArray(value) ? value : splitAttributeValues(value);
    return values
      .map((entry) => formatAttributeToken(attributeName, entry))
      .filter(Boolean)
      .join(', ');
  }

  return formatAttributeToken(attributeName, value);
};

const hasChosenSelectionValue = (value, mode) => {
  if (mode === 'multi') {
    return Array.isArray(value) && value.some((entry) => isMeaningfulText(entry));
  }

  return isMeaningfulText(value);
};

const isSelectedSelectionValue = (selectedValue, optionValue, mode) => {
  const normalizedOption = pickText(optionValue).toLowerCase();
  if (!normalizedOption) return false;

  if (mode === 'multi') {
    return Array.isArray(selectedValue)
      && selectedValue.some((entry) => pickText(entry).toLowerCase() === normalizedOption);
  }

  return pickText(selectedValue).toLowerCase() === normalizedOption;
};

const toggleSelectionValue = (currentValue, optionValue, mode) => {
  const normalizedOption = pickText(optionValue);
  if (!normalizedOption) return currentValue;

  if (mode === 'multi') {
    const selectedValues = Array.isArray(currentValue)
      ? currentValue.map((entry) => pickText(entry)).filter(Boolean)
      : splitAttributeValues(currentValue);
    const lowerOption = normalizedOption.toLowerCase();
    const exists = selectedValues.some((entry) => pickText(entry).toLowerCase() === lowerOption);

    return exists
      ? selectedValues.filter((entry) => pickText(entry).toLowerCase() !== lowerOption)
      : [...selectedValues, normalizedOption];
  }

  return normalizedOption;
};

const joinWithAnd = (values) => {
  const items = (Array.isArray(values) ? values : []).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const getTrustCandidates = () => {
  const candidates = [
    localStorage.getItem('selected_trust_id'),
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
  return status === 'active';
};

const getProductDisplayName = (product) =>
  pickText(product?.product_name, product?.alias_name, `Product ${pickText(product?.id)}`);

const isActiveImage = (image) => {
  const status = pickText(image?.status).toLowerCase();
  if (['inactive', 'disabled', 'deleted', 'archived'].includes(status)) return false;
  if (image?.is_active === false || image?.isActive === false) return false;
  return true;
};

const resolveProductImages = (product) =>
  (Array.isArray(product?.images) ? product.images : [])
    .filter((image) => pickText(image?.image_url) && isActiveImage(image))
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
  const attributeCategories = productPath.length > 0
    ? productPath
    : detail.category
      ? [detail.category]
      : [];
  const attributeState = detail.product
    ? buildProductAttributeSections(detail.product, attributeCategories)
    : { displayAttributes: [], selectionAttributes: [] };

  return {
    ...detail,
    path: routePath.length > 0 ? routePath : productPath,
    images: detail.product ? resolveProductImages(detail.product) : [],
    price: detail.product ? resolveProductPrice(detail.product) : null,
    attributeState,
  };
};

// Variants: a base product has root_product_id = null; its variants point to it via root_product_id.
// Every row sharing the same base id (the base itself + all rows pointing to it) is one variant group.
const getVariantGroupKey = (product) => pickText(product?.root_product_id, product?.id);

const buildVariantGroup = (currentProduct, categories) => {
  const groupKey = getVariantGroupKey(currentProduct);
  if (!groupKey) return [];

  const seen = new Set();
  const members = [];

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    (Array.isArray(category?.products) ? category.products : []).forEach((item) => {
      const id = pickText(item?.id);
      if (!id || seen.has(id) || !isVisibleProduct(item)) return;
      if (getVariantGroupKey(item) !== groupKey) return;
      seen.add(id);
      members.push({ ...item, id, category_id: pickText(category?.id) });
    });
  });

  if (members.length < 2) return [];

  members.sort((a, b) => (
    (pickText(a.root_product_id) ? 1 : 0) - (pickText(b.root_product_id) ? 1 : 0)
    || normalizeOrder(a.sort_order) - normalizeOrder(b.sort_order)
    || pickText(a.created_at).localeCompare(pickText(b.created_at))
  ));

  const activeAttrValues = (item) => (Array.isArray(item?.attribute_values) ? item.attribute_values : [])
    .filter((row) => {
      const status = normalizeAttributeType(row?.status);
      return (!status || status === 'active') && pickText(row?.value, row?.attribute_value);
    })
    .map((row) => ({
      name: pickText(row?.attribute_name),
      key: normalizeAttributeName(row?.attribute_name) || pickText(row?.attribute_id),
      value: pickText(row?.value, row?.attribute_value),
    }))
    .filter((row) => row.key);

  // Only attributes whose value differs between siblings describe a variant.
  const valuesByKey = new Map();
  members.forEach((item) => {
    activeAttrValues(item).forEach((row) => {
      const set = valuesByKey.get(row.key) || new Set();
      set.add(row.value.toLowerCase());
      valuesByKey.set(row.key, set);
    });
  });
  const differingKeys = new Set(
    [...valuesByKey.entries()].filter(([, set]) => set.size > 1).map(([key]) => key)
  );

  return members.map((item, index) => {
    const parts = activeAttrValues(item)
      .filter((row) => differingKeys.has(row.key))
      .map((row) => formatAttributeValueText(row.name, row.value))
      .filter(Boolean);
    const label = parts.join(' · ')
      || pickText(item.product_code, item.alias_name)
      || `Option ${index + 1}`;

    return {
      id: item.id,
      categoryId: item.category_id,
      label,
      image: resolveProductImages(item)[0] || null,
      price: resolveProductPrice(item),
    };
  });
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

    const releaseScroll = lockBodyScroll();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      releaseScroll();

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
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const themeButtonVars = useThemeButtonVars(theme);
  const heroDragStartXRef = useRef(null);
  const heroDragStartYRef = useRef(null);
  const heroDragDeltaXRef = useRef(0);
  const heroIsDraggingRef = useRef(false);
  const heroClickSuppressedUntilRef = useRef(0);
  const actionMessageTimerRef = useRef(null);
  const heroAutoplayPausedUntilRef = useRef(0);
  const selectionGroupRefs = useRef({});
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
  const [activeSpecTab, setActiveSpecTab] = useState('features');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionHasOverflow, setDescriptionHasOverflow] = useState(false);
  const [ctaMessage, setCtaMessage] = useState('');
  const [wishlistItems, setWishlistItems] = useState(() => readWishlistItems());
  const [cartItems, setCartItems] = useState(() => readCartItems());
  const [wishlistPending, setWishlistPending] = useState(false);
  // null = not known yet, true = checkout (cart / buy now), false = enquiry only
  const [paymentGatewayEnabled, setPaymentGatewayEnabled] = useState(null);
  const [isEnquiryPopupOpen, setIsEnquiryPopupOpen] = useState(false);
  const descriptionRef = useRef(null);
  const metaViewContentLoggedIdRef = useRef(null);

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

  useEffect(() => {
    const trustId = pickText(categoryPayload?.trustId);
    if (!trustId) return undefined;

    if (trustGatewayCache.has(trustId)) {
      setPaymentGatewayEnabled(trustGatewayCache.get(trustId));
    }

    let active = true;
    (async () => {
      try {
        const { data, error: trustError } = await supabase
          .from('Trust')
          .select('id, payment_gateway')
          .eq('id', trustId)
          .maybeSingle();
        if (trustError) throw trustError;
        if (!active) return;
        const enabled = Boolean(data?.payment_gateway);
        trustGatewayCache.set(trustId, enabled);
        setPaymentGatewayEnabled(enabled);
      } catch (gatewayError) {
        console.warn('[ProductDetail] Failed to load payment gateway flag:', gatewayError?.message || gatewayError);
        // Keep the existing checkout flow if the flag cannot be read.
        if (active && !trustGatewayCache.has(trustId)) setPaymentGatewayEnabled(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [categoryPayload?.trustId]);

  useEffect(() => subscribeWishlist(setWishlistItems, categoryPayload?.trustId), [categoryPayload?.trustId]);
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

  const {
    product,
    path,
    images,
    price,
    category,
    attributeState = {},
  } = detailState;
  const {
    displayAttributes = [],
    selectionAttributes = [],
  } = attributeState;

  const variants = useMemo(
    () => (product ? buildVariantGroup(product, categoryPayload?.categories || []) : []),
    [product, categoryPayload]
  );

  // Log Meta ViewContent once per product view (StrictMode re-runs and cache -> network refreshes are ignored).
  useEffect(() => {
    const viewedProductId = pickText(product?.id);
    const viewedProductName = pickText(product?.product_name);
    if (!viewedProductId || !viewedProductName) return;
    if (metaViewContentLoggedIdRef.current === viewedProductId) return;

    metaViewContentLoggedIdRef.current = viewedProductId;
    logMetaViewContent({
      contentId: viewedProductId,
      contentType: 'product',
      contentName: viewedProductName,
    });
  }, [product?.id, product?.product_name]);

  const activeImage = images[activeImg] || images[0] || null;
  const activeImageUrl = pickText(activeImage?.image_url);
  const heroCanPreview = Boolean(activeImageUrl);
  const heroSlides = images.length > 0 ? images : [null];
  const fallbackSeed = hashString(`${productId}:${product?.product_name || ''}`);
  const fallbackIcon = pickFallbackIcon(`${productId}:${product?.product_name || ''}`);
  const wishlistProductPriceId = resolveWishlistProductPriceId(product, { price });
  const wishlistIdentityId = wishlistProductPriceId || product?.id;
  const isWished = isWishlistProductInItems(
    wishlistItems,
    product || {},
    {
      trustId: categoryPayload?.trustId,
      price,
      product_price_id: wishlistProductPriceId,
    }
  );
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
  const pricing = useMemo(() => getDisplayPricing(price), [price]);
  const productDescriptionText = pickText(product?.description, product?.short_description);
  const descriptionLines = [];

  if (productDescriptionText) {
    descriptionLines.push(productDescriptionText);
  }

  if (pickText(product?.product_code)) {
    descriptionLines.push(`Product code: ${product.product_code}`);
  }

  displayAttributes.forEach((attribute) => {
    const displayValue = (Array.isArray(attribute?.values) ? attribute.values : [])
      .map((value) => formatAttributeValueText(attribute?.name, value))
      .filter(Boolean)
      .join(', ');
    if (!displayValue) return;
    descriptionLines.push(`${toTitleCase(attribute?.name)} : ${displayValue}`);
  });

  const descriptionText = descriptionLines.join('\n');
  const descriptionSpecLines = descriptionLines.flatMap((line) => String(line || '').split(/\r?\n/));
  const productSpecs = useMemo(
    () => buildProductSpecs(descriptionSpecLines),
    [descriptionText]
  );
  const availableSpecTabs = PRODUCT_SPEC_TABS.filter((tab) => productSpecs.sections[tab.id]?.length > 0);
  const hasStructuredSpecs = availableSpecTabs.length > 0;
  const activeSpecRows = productSpecs.sections[activeSpecTab] || [];

  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionHasOverflow(false);
  }, [productId, descriptionText]);

  useEffect(() => {
    const hasActiveTab = availableSpecTabs.some((tab) => tab.id === activeSpecTab);
    if (!hasActiveTab) {
      setActiveSpecTab(availableSpecTabs[0]?.id || 'features');
    }
  }, [availableSpecTabs, activeSpecTab]);

  useEffect(() => {
    if (!productSpecs.overviewText || descriptionExpanded) return undefined;

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
  }, [productSpecs.overviewText, descriptionExpanded]);

  const missingRequiredSelections = selectionAttributes
    .filter((group) => !hasChosenSelectionValue(chosen[group.key], group.mode))
    .map((group) => toTitleCase(group.name))
    .filter(Boolean);
  const selectionBlocked = missingRequiredSelections.length > 0;
  const selectionHint = selectionBlocked
    ? `Select ${joinWithAnd(missingRequiredSelections)}`
    : '';
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
      const selectionGroupsByKey = new Map(
        selectionAttributes.map((group) => [group.key, group])
      );
      const nextAttributes = {};

      Object.entries(storedAttributes).forEach(([key, value]) => {
        const normalizedKey = normalizeAttributeName(key);
        const group = selectionGroupsByKey.get(normalizedKey);
        if (!group) return;

        const normalizedValue = normalizeChosenSelectionValue(value, group.mode);
        if (!hasChosenSelectionValue(normalizedValue, group.mode)) return;

        nextAttributes[group.key] = normalizedValue;
      });

      setChosen(nextAttributes);
      return;
    }
    setChosen({});
  }, [cartItem?.updated_at, cartItem?.selected_attributes, productId, selectionAttributes]);

  // Auto-slide the hero gallery; pauses while the user interacts / previews, and honours reduced motion.
  const heroSlideCount = images.length;
  useEffect(() => {
    if (heroSlideCount <= 1 || isImagePreviewOpen) return undefined;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (heroIsDraggingRef.current) return;
      if (Date.now() < heroAutoplayPausedUntilRef.current) return;
      setActiveImg((current) => (current + 1) % heroSlideCount);
    }, HERO_AUTOPLAY_MS);

    return () => clearInterval(timer);
  }, [heroSlideCount, isImagePreviewOpen, productId]);

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
    heroAutoplayPausedUntilRef.current = Date.now() + HERO_AUTOPLAY_PAUSE_MS;
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
        if (deltaX < 0) return (current + 1) % heroSlides.length;
        return (current - 1 + heroSlides.length) % heroSlides.length;
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

  const handleToggleWishlist = async () => {
    if (!product || !wishlistIdentityId || wishlistPending) return;

    setWishlistPending(true);
    try {
      const result = await toggleWishlistProductAsync(product, {
        trustId: categoryPayload?.trustId || '',
        categoryId: product?.category_id || categoryId,
        categoryName: category?.name || '',
        price,
        product_price_id: wishlistProductPriceId,
        selectedImage: activeImageUrl,
        selectedAttributes: chosen,
        attributeValues: product?.attribute_values || [],
      });

      setWishlistItems(readWishlistItems(categoryPayload?.trustId));
      if (!result.ok) {
        flashActionMessage(result.error?.message || 'Unable to update wishlist');
        return;
      }

      track(result.wished ? 'add_to_wishlist' : 'remove_from_wishlist', { product_id: pickText(product?.id) });
      flashActionMessage(result.wished ? 'Added to wishlist' : 'Removed from wishlist');
    } finally {
      setWishlistPending(false);
    }
  };

  const updateSelectionChoice = (group, value) => {
    if (!group?.key) return;

    setChosen((prev) => {
      const nextValue = toggleSelectionValue(prev[group.key], value, group.mode);
      const next = { ...prev };

      if (group.mode === 'multi') {
        const normalizedValues = Array.isArray(nextValue)
          ? nextValue.map((entry) => pickText(entry)).filter(Boolean)
          : [];
        if (normalizedValues.length > 0) {
          next[group.key] = normalizedValues;
        } else {
          delete next[group.key];
        }
        return next;
      }

      if (isMeaningfulText(nextValue)) {
        next[group.key] = nextValue;
      } else {
        delete next[group.key];
      }
      return next;
    });
  };

  const ensureSelectionsBeforeCart = () => {
    if (!selectionBlocked) return true;

    flashActionMessage(selectionHint);

    const firstMissingGroup = selectionAttributes.find((group) => !hasChosenSelectionValue(chosen[group.key], group.mode));
    const targetRef = firstMissingGroup ? selectionGroupRefs.current[firstMissingGroup.key] : null;

    targetRef?.scrollIntoView?.({
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

  const updateCartQuantity = async (nextQuantity) => {
    if (!product) return null;

    try {
      const updated = await setCartProductQuantity(product, buildActionPayload(nextQuantity));
      setCartItems(updated);
      return updated;
    } catch (cartError) {
      flashActionMessage(cartError?.message || 'Unable to update cart');
      return null;
    }
  };

  const handleAddToCart = async () => {
    if (!product) return;
    if (!ensureSelectionsBeforeCart()) return;
    track('add_to_cart', { product_id: pickText(product?.id) });
    const updated = await updateCartQuantity(1);
    if (updated) {
      flashActionMessage('Added to cart');
    }
  };

  const handleIncreaseQuantity = async () => {
    if (!product) return;
    const nextQuantity = bagQuantity + 1;
    await updateCartQuantity(nextQuantity);
    // flashActionMessage(`Quantity ${nextQuantity}`);
  };

  const handleDecreaseQuantity = async () => {
    if (!product) return;
    const nextQuantity = Math.max(0, bagQuantity - 1);
    if (nextQuantity > 0) {
      await updateCartQuantity(nextQuantity);
      // flashActionMessage(`Quantity ${nextQuantity}`);
    } else {
      const updated = await updateCartQuantity(0);
      if (updated) {
        flashActionMessage('Removed from cart');
      }
    }
  };

  const handleBuyNow = async () => {
    if (!product) return;
    if (!ensureSelectionsBeforeCart()) return;
    track('order_click', { product_id: pickText(product?.id) });
    const updated = await updateCartQuantity(bagQuantity > 0 ? bagQuantity : 1);
    if (updated) {
      navigate('/cart');
    }
  };

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    navigate(getAppHomePath());
  };

  return (
    <div className="ws-page" style={themeButtonVars}>
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
                        Product
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
        {path.length > 0 ? (
          <nav className="ws-pdp-crumbs" aria-label="Breadcrumb">
            {path.slice(-2).map((category, index, list) => (
              <React.Fragment key={category.id}>
                {index > 0 ? <span className="ws-pdp-crumb-sep" aria-hidden="true">›</span> : null}
                <button
                  type="button"
                  className={`ws-pdp-crumb ${index === list.length - 1 ? 'ws-pdp-crumb--current' : ''}`}
                  onClick={() => navigate(`/categories-products/list/${encodeURIComponent(pickText(category.id))}`)}
                >
                  {capitalizeFirst(category.name)}
                </button>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <div className="ws-pdp-hero">
          <button
            type="button"
            className="ws-pdp-wishlist-btn"
            disabled={!wishlistIdentityId || wishlistPending}
            style={{
              color: isWished ? T.clay : '#1f2937',
              background: 'rgba(255, 255, 255, 0.92)',
              borderColor: 'rgba(0, 0, 0, 0.06)',
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
                  <>
                  <img src={img.image_url} alt="" aria-hidden="true" className="ws-pdp-hero-backdrop" draggable={false} />
                  <img
                    src={img.image_url}
                    alt={`${capitalizeFirst(product?.product_name) || 'Product'} ${i + 1}`}
                    className="ws-pdp-hero-media"
                    loading="eager"
                    fetchPriority={i === activeImg ? 'high' : 'auto'}
                    decoding="async"
                    draggable={false}
                  />
                  </>
                ) : (
                  <Swatch paletteIdx={fallbackSeed} iconName={fallbackIcon} />
                )}
              </div>
            ))}
        </div>
          {heroSlides.length > 1 ? (
            <div className="ws-pdp-dots" role="tablist" aria-label="Product images">
              {heroSlides.map((img, i) => (
                <button
                  key={`dot-${pickText(img?.id, img?.image_url, i)}`}
                  type="button"
                  role="tab"
                  aria-selected={i === activeImg}
                  aria-label={`Show image ${i + 1} of ${heroSlides.length}`}
                  className={`ws-pdp-dot ${i === activeImg ? 'ws-pdp-dot--on' : ''}`}
                  onClick={() => {
                    heroAutoplayPausedUntilRef.current = Date.now() + HERO_AUTOPLAY_PAUSE_MS;
                    setActiveImg(i);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
       

        <div className="ws-pdp-body">
          <div className="ws-pdp-title-row">
            <div className="ws-pdp-name" role="heading" aria-level={2}>{capitalizeFirst(product?.product_name)}</div>
            {hasPrice && paymentGatewayEnabled === true ? (
              <button
                type="button"
                className={`ws-pdp-title-cart ${bagQuantity > 0 ? 'ws-pdp-title-cart--on' : ''}`}
                onClick={bagQuantity > 0 ? () => navigate('/cart') : handleAddToCart}
                aria-label={bagQuantity > 0 ? 'View cart' : 'Add to cart'}
              >
                <ShoppingCart size={20} strokeWidth={1.9} />
                {bagQuantity > 0 ? <span className="ws-pdp-title-cart-count">{bagQuantity}</span> : null}
              </button>
            ) : null}
          </div>

          {hasPrice ? (
            <div className="ws-pdp-price-block">
              <div className="ws-pdp-price-top">
                <span className="ws-pdp-price-now">{formatInr(pricing?.total)}</span>
                {pricing?.hasDiscount ? (
                  <>
                    <span className="ws-pdp-price-mrp">{formatInr(pricing.mrpTotal)}</span>
                    <span className="ws-pdp-price-off">{Math.round(pricing.discountPct)}% OFF</span>
                  </>
                ) : null}
              </div>
              {(() => {
                const notes = [];
                if (pricing?.hasDiscount) notes.push(`You save ${formatInr(pricing.saving)}`);
                if (pricing?.addOn > 0) notes.push('Inclusive of all taxes');
                if (pickText(product?.product_code)) notes.push(`Code ${product.product_code}`);
                return notes.length > 0 ? <div className="ws-pdp-meta">{notes.join('  •  ')}</div> : null;
              })()}
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

          {variants.length > 1 ? (
            <div className="ws-variant-section">
              <div className="ws-variant-title">
                Choose variant <span>{variants.find((v) => v.id === pickText(product?.id))?.label || ''}</span>
              </div>
              <div className="ws-variant-row" role="listbox" aria-label="Product variants">
                {variants.map((variant) => {
                  const isCurrent = variant.id === pickText(product?.id);
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      className={`ws-variant-card ${isCurrent ? 'ws-variant-card--on' : ''}`}
                      onClick={() => {
                        if (isCurrent) return;
                        navigate(
                          `/categories-products/list/${encodeURIComponent(variant.categoryId || pickText(categoryId))}/detail/${encodeURIComponent(variant.id)}`,
                          { replace: true }
                        );
                      }}
                    >
                      <span className="ws-variant-thumb">
                        {isCurrent ? <span className="ws-variant-check" aria-hidden="true">✓</span> : null}
                        {variant.image?.image_url ? (
                          <img src={variant.image.image_url} alt="" loading="lazy" draggable={false} />
                        ) : (
                          <Swatch paletteIdx={hashString(variant.id)} iconName={pickFallbackIcon(variant.id)} />
                        )}
                      </span>
                      <span className="ws-variant-label">{variant.label}</span>
                      {variant.price ? (
                        <span className="ws-variant-price">{formatInr(getDisplayPricing(variant.price)?.total)}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {selectionAttributes.map((group) => {
            const selectedValue = chosen[group.key];
            const selectedLabel = formatChosenSelectionValue(group.name, selectedValue, group.mode);
            const isColour = isColourAttributeName(group.name);

            return (
              <div
                key={group.key}
                ref={(node) => {
                  if (node) {
                    selectionGroupRefs.current[group.key] = node;
                  } else {
                    delete selectionGroupRefs.current[group.key];
                  }
                }}
                className="ws-attr-group ws-attr-group--panel ws-attr-group--selection"
              >
                <div className="ws-attr-title ws-attr-title--selection">
                  <span>
                    Select {toTitleCase(group.name)}
                    {!selectedLabel ? <em className="ws-attr-required"> *</em> : null}
                  </span>
                  {selectedLabel ? <span className="ws-attr-picked">{selectedLabel}</span> : null}
                </div>
                <div className="ws-chip-wrap">
                  {group.values.map((value) => {
                    const isSelected = isSelectedSelectionValue(selectedValue, value, group.mode);

                    return (
                      <button
                        key={`${group.key}:${value}`}
                        type="button"
                        className={`ws-chip ${isColour ? 'ws-chip--colour' : 'ws-chip--selection'} ${isSelected ? 'ws-chip-on' : ''}`}
                        onClick={() => updateSelectionChoice(group, value)}
                        aria-pressed={isSelected}
                      >
                        {isColour ? (
                          <span
                            className="ws-chip-swatch"
                            style={{
                              backgroundColor: typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', value)
                                ? value
                                : 'var(--brand-navy)',
                            }}
                          />
                        ) : null}
                        <span>{formatAttributeToken(group.name, value)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {descriptionText ? (
            <div className="ws-attr-group ws-attr-group--panel ws-description-group">
              {hasStructuredSpecs ? (
                <>
                  <div className="ws-description-title">Product specifications</div>
                  <div className="ws-spec-tabs" role="tablist" aria-label="Product specifications">
                    {availableSpecTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        className={`ws-spec-tab ${activeSpecTab === tab.id ? 'ws-spec-tab--active' : ''}`}
                        onClick={() => setActiveSpecTab(tab.id)}
                        aria-selected={activeSpecTab === tab.id}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="ws-spec-table" role="table" aria-label={`${PRODUCT_SPEC_TABS.find((tab) => tab.id === activeSpecTab)?.label || 'Product'} specifications`}>
                    {activeSpecRows.map((row, index) => (
                      <div className="ws-spec-row" role="row" key={`${row.label}:${index}`}>
                        <div className="ws-spec-key" role="cell">{row.label}</div>
                        <div className="ws-spec-value" role="cell">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="ws-description-title">Description</div>
              )}
              {productSpecs.overviewText ? (
                <>
                  {hasStructuredSpecs ? <div className="ws-description-subtitle">Overview</div> : null}
                  <p
                    id={`product-description-${productId || 'detail'}`}
                    ref={descriptionRef}
                    className={`ws-description-text ${!descriptionExpanded && descriptionHasOverflow ? 'ws-description-text--clamped' : ''}`}
                  >
                    {productSpecs.overviewText}
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
                </>
              ) : null}
            </div>
          ) : null}

         
        </div>
          </>
        ) : null}
      </div>

      {!loading && !error && product && hasPrice && paymentGatewayEnabled !== null ? (
        <div className="ws-pdp-footer">
          <div className="ws-pdp-footer-price">
            <span className="ws-pdp-footer-label">Price</span>
            <span className="ws-pdp-footer-amount">{formatInr(pricing?.total)}</span>
          </div>
          {paymentGatewayEnabled ? (
            <div className="ws-pdp-footer-actions">
              {bagQuantity > 0 ? (
                <div className="ws-pdp-qty-control" aria-label="Selected quantity">
                  <button type="button" className="ws-pdp-qty-btn" onClick={handleDecreaseQuantity} aria-label="Decrease quantity">-</button>
                  <div className="ws-pdp-qty-value">{bagQuantity}</div>
                  <button type="button" className="ws-pdp-qty-btn" onClick={handleIncreaseQuantity} aria-label="Increase quantity">+</button>
                </div>
              ) : (
                <button type="button" className="ws-pdp-action-btn ws-pdp-action-btn-secondary" onClick={handleAddToCart}>
                  <ShoppingCart className="h-4 w-4" />
                  Add to Cart
                </button>
              )}
              <button type="button" className="ws-pdp-action-btn ws-pdp-action-btn-primary" onClick={handleBuyNow}>
                <Sparkles className="h-4 w-4" />
                Buy Now
              </button>
            </div>
          ) : (
            <div className="ws-pdp-footer-actions ws-pdp-footer-actions--single">
              <button
                type="button"
                className="ws-pdp-action-btn ws-pdp-action-btn-primary"
                onClick={() => setIsEnquiryPopupOpen(true)}
              >
                <Sparkles className="h-4 w-4" />
                Enquire Now
              </button>
            </div>
          )}
        </div>
      ) : null}

      {isEnquiryPopupOpen ? (
        <div
          className="ws-enquiry-overlay"
          role="presentation"
          onClick={() => setIsEnquiryPopupOpen(false)}
        >
          <div
            className="ws-enquiry-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ws-enquiry-title"
            aria-describedby="ws-enquiry-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ws-enquiry-halo">
              <div className="ws-enquiry-icon">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path className="ws-enquiry-check" d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
            </div>
            <div id="ws-enquiry-title" className="ws-enquiry-title">Request submitted successfully</div>
            <div id="ws-enquiry-desc" className="ws-enquiry-desc">We will contact you shortly.</div>
            <button
              type="button"
              className="ws-pdp-action-btn ws-pdp-action-btn-primary ws-enquiry-ok"
              onClick={() => setIsEnquiryPopupOpen(false)}
              autoFocus
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

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
          --pd-ink: var(--page-text-color, var(--body-text-color));
          --pd-strong: var(--page-strong-color, var(--page-text-color, var(--body-text-color)));
          --pd-line-strong: color-mix(in srgb, var(--pd-strong) 38%, transparent);
          --pd-accent: var(--page-price-color, var(--page-text-color, var(--body-text-color)));
          --pd-soft: color-mix(in srgb, var(--pd-ink) 66%, transparent);
          --pd-faint: color-mix(in srgb, var(--pd-ink) 46%, transparent);
          --pd-line: color-mix(in srgb, var(--pd-ink) 16%, transparent);
          --pd-tint: color-mix(in srgb, var(--pd-ink) 6%, transparent);
          --pd-tint-strong: color-mix(in srgb, var(--pd-ink) 11%, transparent);
          --pd-card: color-mix(in srgb, var(--pd-ink) 6%, transparent);
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
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          padding: 0;
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--pd-accent);
        }

        .ws-breadcrumb-link {
          padding: 4px 10px !important;
          border-radius: 999px;
          background: color-mix(in srgb, var(--pd-accent) 11%, transparent) !important;
          border: 1px solid color-mix(in srgb, var(--pd-accent) 22%, transparent) !important;
        }

        .ws-breadcrumb-link {
          border: 0;
          background: none;
          padding: 0;
          color: inherit;
          font: inherit;
          cursor: pointer;
          text-align: left;
        }

        .ws-breadcrumb-link:active {
          opacity: 0.72;
        }

        .ws-breadcrumb-link:focus-visible {
          outline: 2px solid ${T.clay};
          outline-offset: 3px;
          border-radius: 4px;
        }

        .ws-breadcrumb-separator {
          color: ${T.inkFaint};
        }

        .ws-price-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }
        

        .ws-pdp-hero {
          width: 100%;
          aspect-ratio: 1 / 1;
          max-height: 62vh;
          position: relative;
          overflow: hidden;
          background: ${T.paper};
          border-radius: 0 0 26px 26px;
          box-shadow: 0 14px 30px color-mix(in srgb, ${THEME.navy} 14%, transparent);
        }

        .ws-pdp-discount-badge {
          position: absolute;
          left: 12px;
          top: 12px;
          z-index: 3;
          padding: 6px 11px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: var(--pd-btn-text, ${THEME.buttonText});
          background: var(--pd-btn-bg, ${THEME.buttonBg});
          box-shadow: 0 8px 18px color-mix(in srgb, ${THEME.navy} 24%, transparent);
        }

        .ws-pdp-dots {
          position: absolute;
          left: 50%;
          bottom: 14px;
          transform: translateX(-50%);
          z-index: 3;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: color-mix(in srgb, #000 28%, transparent);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .ws-pdp-dot {
          width: 6px;
          height: 6px;
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.55);
          cursor: pointer;
          transition: width 0.25s ease, background-color 0.25s ease;
        }

        .ws-pdp-dot--on {
          width: 20px;
          background: #fff;
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

        .ws-pdp-wishlist-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
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
          position: relative;
          flex: 0 0 100%;
          height: 100%;
          overflow: hidden;
        }

        .ws-pdp-hero-backdrop {
          position: absolute;
          inset: -24px;
          width: calc(100% + 48px);
          height: calc(100% + 48px);
          object-fit: cover;
          filter: blur(22px) saturate(1.1);
          opacity: 0.55;
          pointer-events: none;
          user-select: none;
        }

        .ws-pdp-hero-media {
          display: block;
          width: 100%;
          height: 100%;
          position: relative;
          object-fit: contain;
          object-position: center center;
          background: transparent;
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
          padding: 18px 18px 28px;
        }

        .ws-pdp-title-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .ws-pdp-title-row .ws-pdp-name {
          flex: 1;
          min-width: 0;
        }

        .ws-pdp-title-cart {
          position: relative;
          flex: 0 0 auto;
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
          border: 1.5px solid var(--pd-line-strong);
          background: transparent;
          color: var(--pd-strong);
          cursor: pointer;
          transition: transform 0.15s ease, background-color 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .ws-pdp-title-cart:active {
          transform: scale(0.94);
        }

        .ws-pdp-title-cart--on {
          background: var(--pd-btn-bg, ${THEME.buttonBg});
          border-color: transparent;
          color: var(--pd-btn-text, ${THEME.buttonText});
        }

        .ws-pdp-title-cart-count {
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10.5px;
          font-weight: 800;
          color: #fff;
          background: #c74212;
        }

        .ws-pdp-name {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 23px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--pd-strong);
          line-height: 1.3;
        }

        .ws-pdp-code {
          font-size: 11.5px;
          color: ${T.inkFaint};
          margin-top: 4px;
        }

        .ws-pdp-price-block {
          margin-top: 8px;
          padding-bottom: 16px;
          color: ${primaryColor};
          border-bottom: 1px solid ${T.line};
        }

        .ws-pdp-price-top {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px 10px;
        }

        .ws-pdp-price-now {
          font-size: 28px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.02em;
          color: var(--pd-accent);
        }

        .ws-pdp-price-mrp {
          font-size: 15px;
          font-weight: 500;
          color: ${T.inkSoft};
          text-decoration: line-through;
        }

        .ws-pdp-price-off {
          padding: 3px 9px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: var(--pd-btn-text, ${THEME.buttonText});
          background: var(--pd-btn-bg, ${THEME.buttonBg});
        }

        .ws-pdp-meta {
          margin-top: 6px;
          font-size: 12.5px;
          font-weight: 500;
          color: ${T.inkSoft};
          white-space: pre-wrap;
        }

        .ws-pdp-crumbs {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 2px 0;
          padding: 10px 14px;
        }

        .ws-pdp-crumb {
          flex: 0 1 auto;
          min-width: 0;
          padding: 3px 4px;
          border: 0;
          background: none;
          color: var(--pd-ink);
          font-size: 12.5px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .ws-pdp-crumb--current {
          color: var(--pd-strong);
          font-weight: 800;
        }

        .ws-pdp-crumb:active {
          opacity: 0.7;
        }

        .ws-pdp-crumb-sep {
          flex: 0 0 auto;
          color: color-mix(in srgb, var(--pd-ink) 75%, transparent);
          font-size: 15px;
          line-height: 1;
        }

        .ws-attr-group {
          margin-top: 10px;
        }

        .ws-attr-group--panel {
          border-radius: 18px;
        }

        .ws-attr-group--selection {
          margin-top: 18px;
          padding: 0;
          border-radius: 0;
          background: none;
          border: 0;
          box-shadow: none;
        }

        .ws-attr-title {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 9px;
          color: ${T.inkFaint};
        }

        .ws-attr-title--selection {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          color: var(--pd-strong);
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 10px;
        }

        .ws-attr-required {
          font-style: normal;
          color: ${T.clay};
        }

        .ws-attr-picked {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--pd-accent);
        }

        .ws-description-group {
          border-radius: 18px;
          margin-top: 20px;
          padding: 16px;
          background: var(--pd-tint);
          border: 1px solid ${T.line};
        }

        .ws-description-title {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 18px;
          color: var(--pd-strong);
        }

        .ws-description-subtitle {
          margin: 14px 0 7px;
          color: var(--pd-accent);
          font-size: 13px;
          font-weight: 800;
        }

        .ws-spec-tabs {
          display: flex;
          gap: 8px;
          margin: 12px 0 10px;
          padding-bottom: 2px;
          overflow-x: auto;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .ws-spec-tabs::-webkit-scrollbar {
          display: none;
        }

        .ws-spec-tab {
          flex: 0 0 auto;
          min-height: 38px;
          max-width: 170px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid var(--pd-line);
          background: transparent;
          color: var(--pd-soft);
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
        }

        .ws-spec-tab--active {
          border: 1px solid var(--pd-accent);
          background: color-mix(in srgb, var(--pd-accent) 16%, transparent);
          color: var(--pd-strong);
        }

        .ws-spec-table {
          border-top: 1px solid ${T.line};
        }

        .ws-spec-row {
          display: grid;
          grid-template-columns: minmax(104px, 36%) minmax(0, 1fr);
          gap: 14px;
          padding: 11px 0;
          border-bottom: 1px solid ${T.line};
        }

        .ws-spec-key {
          color: var(--pd-strong);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .ws-spec-value {
          color: var(--pd-soft);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.45;
          overflow-wrap: anywhere;
          white-space: pre-line;
        }

        .ws-description-text {
          margin: 0;
          color: color-mix(in srgb, var(--pd-ink) 78%, transparent);
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
          color: var(--pd-accent);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        .ws-variant-section {
          margin-top: 18px;
        }

        .ws-variant-title {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
          color: var(--pd-strong);
          margin-bottom: 10px;
        }

        .ws-variant-title span {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--pd-accent);
        }

        .ws-variant-check {
          position: absolute;
          top: 5px;
          right: 5px;
          z-index: 1;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: var(--pd-btn-text, ${THEME.buttonText});
          background: var(--pd-btn-bg, ${THEME.buttonBg});
        }

        .ws-variant-row {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding: 4px 2px 10px;
          margin: 0 -2px;
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .ws-variant-row::-webkit-scrollbar {
          display: none;
        }

        .ws-variant-card {
          flex: 0 0 96px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
          padding: 6px;
          border-radius: 14px;
          border: 1.5px solid ${T.line};
          background: ${T.bg};
          color: var(--pd-strong);
          text-align: left;
          cursor: pointer;
          scroll-snap-align: start;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .ws-variant-card:active {
          transform: scale(0.97);
        }

        .ws-variant-card--on {
          border-color: var(--pd-accent);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--pd-accent) 25%, transparent),
            0 8px 18px color-mix(in srgb, ${THEME.navy} 14%, transparent);
        }

        .ws-variant-thumb {
          position: relative;
          display: block;
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: 9px;
          overflow: hidden;
          background: var(--pd-tint-strong);
        }

        .ws-variant-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .ws-variant-label {
          font-size: 12px;
          font-weight: 700;
          line-height: 1.25;
          padding: 0 2px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
        }

        .ws-variant-price {
          font-size: 11.5px;
          font-weight: 600;
          opacity: 0.75;
          padding: 0 2px 2px;
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

        .ws-chip--selection {
          min-width: 56px;
          min-height: 42px;
          padding: 0 16px;
          border-radius: 12px;
          font-weight: 700;
          letter-spacing: 0.01em;
          border: 1.5px solid ${T.line};
          background: ${T.bg};
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }

        .ws-chip--selection:active {
          transform: scale(0.96);
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
          background: var(--pd-btn-bg, ${THEME.buttonBg});
          border-color: transparent;
          color: var(--pd-btn-text, ${THEME.buttonText});
          box-shadow: 0 6px 14px color-mix(in srgb, var(--pd-accent) 28%, transparent);
        }

        .ws-pdp-footer {
          flex: 0 0 auto;
          z-index: 25;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
          background: var(--page-bg, var(--app-page-bg));
          border-top: 1px solid ${T.line};
          box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
        }

        .ws-pdp-footer-price {
          display: flex;
          flex-direction: column;
          min-width: 0;
          line-height: 1.15;
        }

        .ws-pdp-footer-label {
          font-size: 11px;
          font-weight: 600;
          color: ${T.inkSoft};
        }

        .ws-pdp-footer-amount {
          font-size: 18px;
          font-weight: 800;
          color: var(--pd-strong);
        }

        .ws-enquiry-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          animation: wsEnquiryFade 0.18s ease-out;
        }

        .ws-enquiry-dialog {
          width: 100%;
          max-width: 340px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 30px 22px 22px;
          border-radius: 26px;
          background: var(--page-bg, var(--app-page-bg));
          border: 1px solid var(--pd-line);
          box-shadow: 0 28px 70px rgba(0, 0, 0, 0.38);
          text-align: center;
          animation: wsEnquiryPop 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.1);
        }

        .ws-enquiry-halo {
          width: 104px;
          height: 104px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--pd-accent) 12%, transparent);
          box-shadow: 0 0 0 12px color-mix(in srgb, var(--pd-accent) 7%, transparent);
          margin-bottom: 18px;
        }

        .ws-enquiry-icon {
          width: 70px;
          height: 70px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--pd-btn-bg, ${THEME.buttonBg});
          color: var(--pd-btn-text, ${THEME.buttonText});
          animation: wsEnquiryIcon 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.08s both;
        }

        .ws-enquiry-check {
          stroke-dasharray: 26;
          stroke-dashoffset: 26;
          animation: wsEnquiryCheck 0.4s ease-out 0.38s forwards;
        }

        .ws-enquiry-title {
          font-size: 19px;
          font-weight: 800;
          line-height: 1.3;
          letter-spacing: -0.01em;
          color: var(--pd-strong);
        }

        .ws-enquiry-desc {
          margin-top: 6px;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--pd-soft);
        }

        .ws-enquiry-ok {
          width: 100%;
          margin-top: 22px;
        }

        @keyframes wsEnquiryFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes wsEnquiryIcon {
          from { transform: scale(0.4); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        @keyframes wsEnquiryCheck {
          to { stroke-dashoffset: 0; }
        }

        @keyframes wsEnquiryPop {
          from { opacity: 0; transform: translateY(10px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .ws-pdp-footer-actions.ws-pdp-footer-actions--single {
          grid-template-columns: minmax(0, 1fr);
        }

        .ws-pdp-footer-actions {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1.15fr;
          gap: 10px;
          min-width: 0;
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
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 14px;
          padding: 0 12px;
          font-size: 14px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
        }

        .ws-pdp-action-btn:active {
          transform: scale(0.98);
        }

        .ws-pdp-action-btn-primary {
          background: var(--pd-btn-bg, ${THEME.buttonBg});
          color: var(--pd-btn-text, ${THEME.buttonText});
          border: 1px solid transparent;
        }

        .ws-pdp-action-btn-secondary {
          background: transparent;
          border: 1.5px solid var(--pd-line-strong);
          color: var(--pd-strong);
        }

        .ws-pdp-qty-control {
          min-height: 48px;
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) 46px;
          border-radius: 14px;
          overflow: hidden;
          background: ${T.bg};
          border: 1px solid var(--pd-line);
        }

        .ws-pdp-qty-btn {
          border: 0;
          background: var(--pd-tint);
          color: var(--pd-ink);
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
          color: var(--pd-strong);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          user-select: none;
        }

        .ws-pdp-toast {
          position: fixed;
          left: 50%;
          bottom: calc(84px + env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 40;
          min-width: 190px;
          max-width: calc(100vw - 32px);
          padding: 12px 16px;
          border-radius: 999px;
          background: rgba(17, 17, 17, 0.9);
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
          border: 1px solid rgba(255, 255, 255, 0.18);
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
