import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, Heart, Home as HomeIcon, ShoppingCart, Trash2, X } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { supabase } from './services/supabaseClient';
import { getNavbarThemeStyles } from './utils/themeUtils';
import {
  clearCartItems,
  getCartKey,
  getCartItemPricing,
  getCartSummary,
  readCartItems,
  removeCartProduct,
  setCartProductQuantity,
  subscribeCart,
} from './utils/productCart';
import {
  addWishlistProduct,
  readWishlistItems,
  subscribeWishlist,
} from './utils/productWishlist';
import {
  isTrustCatalogCacheFresh,
  readTrustCatalogCache,
} from './utils/trustCatalogCache';

const T = {
  text: 'var(--body-text-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 62%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  accent: 'var(--brand-red)',
  clay: '#c74212',
};

const SKELETON_BG = 'color-mix(in srgb, var(--brand-navy) 8%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const CART_SKELETON_COUNT = 3;

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const resolveImageUrl = (item) => {
  const selectedImage = normalizeText(item?.selected_image);
  if (selectedImage) return selectedImage;

  const images = Array.isArray(item?.images) ? [...item.images] : [];
  images.sort((a, b) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0));
  return normalizeText(images[0]?.image_url);
};

const resolvePrice = (item) => {
  const price = item?.price;
  if (!price || typeof price !== 'object') return null;

  const value = Number(price.price_after_discount ?? price.total_payable ?? price.member_price ?? price.mrp);
  const mrp = Number(price.mrp);
  const discountPct = Number(price.discount_pct ?? 0);
  if (!Number.isFinite(value)) return null;

  return {
    value,
    mrp: Number.isFinite(mrp) ? mrp : value,
    discountPct: Number.isFinite(discountPct) ? discountPct : 0,
  };
};

const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;

const titleCaseText = (value) => {
  const text = normalizeText(value);
  if (!text) return '';

  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment;

      return segment
        .split(/([-/&:.,!?()]+)/)
        .map((piece) => {
          if (!piece || /^[-/&:.,!?()]+$/.test(piece)) return piece;
          return piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase();
        })
        .join('');
    })
    .join('');
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

const isVisibleCategory = (category) => {
  const status = pickText(category?.status).toLowerCase();
  return !status || status === 'active';
};

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
  return !['inactive', 'disabled', 'archived', 'hidden', 'draft'].includes(status);
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

const getProductAttributeRows = (product) =>
  (Array.isArray(product?.attribute_values) ? product.attribute_values : [])
    .flatMap((row) => {
      const name = pickText(row?.attribute_name, row?.name, row?.label, row?.attribute);
      const value = pickText(row?.value, row?.attribute_value, row?.attributeValue);
      if (!name || !value) return [];

      if (isSizeAttributeName(name)) {
        return splitAttributeValues(value)
          .map((entry) => formatSizeLabel(entry))
          .filter(Boolean)
          .map((entry) => ({
            name,
            value: entry,
          }));
      }

      if (isColourAttributeName(name)) {
        return splitAttributeValues(value)
          .map((entry) => titleCaseText(entry))
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

const buildVariantOptions = (product) => {
  const options = { size: [], colour: [] };
  const pushUnique = (list, value) => {
    const normalized = pickText(value);
    if (!normalized || list.includes(normalized)) return;
    list.push(normalized);
  };

  getProductAttributeRows(product).forEach(({ name, value }) => {
    if (isSizeAttributeName(name)) {
      splitAttributeValues(value).forEach((entry) => pushUnique(options.size, entry));
    }

    if (isColourAttributeName(name)) {
      splitAttributeValues(value).forEach((entry) => pushUnique(options.colour, entry));
    }
  });

  return options;
};

const fetchTrustCatalog = async (trustId, signal) => {
  const normalizedTrustId = pickText(trustId);
  if (!normalizedTrustId) return [];

  const cached = readTrustCatalogCache(normalizedTrustId);
  const cachedCategories = Array.isArray(cached?.payload?.categories) ? cached.payload.categories : [];
  if (cachedCategories.length > 0 && isTrustCatalogCacheFresh(cached)) {
    return cachedCategories;
  }

  let query = supabase.rpc('get_products_by_trust_id', {
    p_trust_id: normalizedTrustId,
  });

  if (typeof query.abortSignal === 'function') {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || String(error));
  }

  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : { categories: Array.isArray(data) ? data : [] };

  if (payload.success === false) {
    throw new Error(payload.message || 'Unable to load variant options');
  }

  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  return categories.length > 0 ? categories : cachedCategories;
};

const findProductInCatalog = (productId, categories = []) => {
  const normalizedProductId = pickText(productId);
  if (!normalizedProductId) return null;

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
    if (product && isVisibleProduct(product)) return product;
  }

  return null;
};

const hasVariantEntries = (options) => Boolean(
  Array.isArray(options?.size) && options.size.length > 0
  || Array.isArray(options?.colour) && options.colour.length > 0
);

const CartItemSkeleton = () => (
  <article className="cart-card cart-card--skeleton" aria-hidden="true">
    <div className="cart-open cart-open--skeleton">
      <div className="cart-image cart-image--skeleton ws-skeleton ws-skeleton-img" />
      <div className="cart-info cart-info--skeleton">
        <div className="ws-skeleton ws-skeleton-line cart-skeleton-line cart-skeleton-line--title" />
        <div className="ws-skeleton ws-skeleton-line cart-skeleton-line cart-skeleton-line--price" />
        <div className="cart-skeleton-chips">
          <div className="ws-skeleton cart-skeleton-chip" />
          <div className="ws-skeleton cart-skeleton-chip" />
        </div>
      </div>
    </div>
    <div className="cart-actions cart-actions--skeleton">
      <div className="ws-skeleton cart-skeleton-qty" />
      <div className="ws-skeleton cart-skeleton-remove" />
    </div>
  </article>
);

const CartSummarySkeleton = () => (
  <div className="cart-summary cart-summary--skeleton" aria-hidden="true">
    <div className="cart-summary-row cart-summary-row--skeleton">
      <div className="ws-skeleton cart-summary-label" />
      <div className="ws-skeleton cart-summary-value" />
    </div>
    <div className="cart-summary-row cart-summary-row--skeleton">
      <div className="ws-skeleton cart-summary-label" />
      <div className="ws-skeleton cart-summary-value" />
    </div>
    <div className="cart-summary-row cart-summary-row--skeleton">
      <div className="ws-skeleton cart-summary-label" />
      <div className="ws-skeleton cart-summary-value" />
    </div>
    <div className="cart-summary-row cart-summary-row--skeleton">
      <div className="ws-skeleton cart-summary-label" />
      <div className="ws-skeleton cart-summary-value" />
    </div>
    <div className="cart-summary-row cart-summary-row--skeleton cart-summary-row--total">
      <div className="ws-skeleton cart-summary-label cart-summary-label--total" />
      <div className="ws-skeleton cart-summary-value cart-summary-value--total" />
    </div>
    <div className="cart-summary-actions cart-summary-actions--skeleton">
      <div className="ws-skeleton cart-skeleton-button" />
      <div className="ws-skeleton cart-skeleton-button cart-skeleton-button--secondary" />
    </div>
  </div>
);

function Cart() {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [items, setItems] = useState(() => readCartItems());
  const [wishlistItems, setWishlistItems] = useState(() => readWishlistItems());
  const [isCartLoading, setIsCartLoading] = useState(true);
  const [removalPrompt, setRemovalPrompt] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [attributeMenu, setAttributeMenu] = useState(null);
  const [variantOptionsByItemKey, setVariantOptionsByItemKey] = useState({});
  const [attributeLoadingByItemKey, setAttributeLoadingByItemKey] = useState({});
  const toastTimerRef = useRef(null);
  const catalogCacheRef = useRef(new Map());
  const catalogPromiseRef = useRef(new Map());
  const isMountedRef = useRef(true);

  useEffect(() => {
    const unsubscribeCart = subscribeCart(setItems);
    const unsubscribeWishlist = subscribeWishlist(setWishlistItems);
    setIsCartLoading(false);

    return () => {
      unsubscribeCart();
      unsubscribeWishlist();
    };
  }, []);
  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
  }, []);
  useEffect(() => {
    if (!removalPrompt || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [removalPrompt]);
  useEffect(() => {
    if (removalPrompt) {
      setAttributeMenu(null);
    }
  }, [removalPrompt]);
  useEffect(() => {
    if (!removalPrompt || typeof window === 'undefined') return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRemovalPrompt(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [removalPrompt]);
  useEffect(() => {
    if (!attributeMenu || typeof window === 'undefined') return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-cart-attribute-trigger]') || target.closest('[data-cart-attribute-menu]')) return;
      setAttributeMenu(null);
    };

    const closeOnViewportChange = () => {
      setAttributeMenu(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [attributeMenu]);
  useEffect(() => {
    items.forEach((item) => {
      if (item?.id && item?.trust_id) {
        void loadVariantOptionsForItem(item);
      }
    });
  }, [items]);

  const summary = useMemo(() => getCartSummary(items), [items]);
  const wishlistCount = wishlistItems.length;
  const pendingRemovalItem = removalPrompt?.item || null;

  const updateCartQuantity = (item, nextQuantity) => {
    closeAttributeMenu();
    const updated = setCartProductQuantity(item, {
      trustId: item.trust_id,
      categoryId: item.category_id,
      categoryName: item.category_name,
      price: item.price,
      quantity: nextQuantity,
      selectedImage: item.selected_image || resolveImageUrl(item),
      selectedAttributes: item.selected_attributes || {},
      attributeValues: item.attribute_values || [],
    });
    setItems(updated);
  };

  const showToast = (message) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage('');
      toastTimerRef.current = null;
    }, 1600);
  };

  const closeAttributeMenu = () => {
    setAttributeMenu(null);
  };

  const setAttributeLoadingState = (itemKey, isLoading) => {
    if (!itemKey) return;

    setAttributeLoadingByItemKey((current) => {
      const next = { ...current };

      if (isLoading) {
        next[itemKey] = true;
        return next;
      }

      if (!next[itemKey]) return current;
      delete next[itemKey];
      return next;
    });
  };

  const getAttributeMenuPosition = (rect) => {
    const menuWidth = 320;
    const viewportPadding = 12;
    const width = Math.min(menuWidth, Math.max(220, window.innerWidth - viewportPadding * 2));
    const estimatedHeight = 320;
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - width - viewportPadding)
    );
    const openAbove = rect.bottom + estimatedHeight + viewportPadding > window.innerHeight && rect.top > estimatedHeight;
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - estimatedHeight - 10)
      : Math.min(window.innerHeight - estimatedHeight - viewportPadding, rect.bottom + 10);

    return {
      left,
      top,
      width,
    };
  };

  const loadVariantOptionsForItem = async (item) => {
    const itemKey = item?.key || getCartKey(item?.id, item?.trust_id);
    if (!itemKey) return { size: [], colour: [] };

    const cachedOptions = variantOptionsByItemKey[itemKey];
    if (hasVariantEntries(cachedOptions)) return cachedOptions;

    const directOptions = buildVariantOptions(item);
    if (hasVariantEntries(directOptions)) {
      if (isMountedRef.current) {
        setVariantOptionsByItemKey((current) => ({ ...current, [itemKey]: directOptions }));
      }
      return directOptions;
    }

    const trustId = pickText(item?.trust_id);
    const productId = pickText(item?.id);
    const emptyOptions = { size: [], colour: [] };
    if (!trustId || !productId) {
      setAttributeLoadingState(itemKey, false);
      if (isMountedRef.current) {
        setVariantOptionsByItemKey((current) => (current[itemKey] ? current : { ...current, [itemKey]: emptyOptions }));
      }
      return emptyOptions;
    }

    setAttributeLoadingState(itemKey, true);

    try {
      let catalog = catalogCacheRef.current.get(trustId);
      if (!catalog) {
        let pending = catalogPromiseRef.current.get(trustId);
        if (!pending) {
          pending = fetchTrustCatalog(trustId);
          catalogPromiseRef.current.set(trustId, pending);
        }

        try {
          catalog = await pending;
          catalogCacheRef.current.set(trustId, catalog);
        } finally {
          catalogPromiseRef.current.delete(trustId);
        }
      }

      if (!isMountedRef.current) {
        return variantOptionsByItemKey[itemKey] || emptyOptions;
      }

      const product = findProductInCatalog(productId, catalog);
      const options = buildVariantOptions(product);
      if (isMountedRef.current) {
        setVariantOptionsByItemKey((current) => ({ ...current, [itemKey]: options }));
      }

      return options;
    } catch {
      if (isMountedRef.current) {
        setVariantOptionsByItemKey((current) => ({ ...current, [itemKey]: emptyOptions }));
      }
      return emptyOptions;
    } finally {
      setAttributeLoadingState(itemKey, false);
    }
  };

  const handleAttributeTrigger = async (event, item, attributeKey) => {
    const normalizedKey = normalizeAttributeName(attributeKey);
    const isColour = isColourAttributeName(normalizedKey);
    const isSize = isSizeAttributeName(normalizedKey);
    if (!isColour && !isSize) return;

    event.preventDefault();
    event.stopPropagation();

    const itemKey = item?.key || getCartKey(item?.id, item?.trust_id);
    if (!itemKey) return;

    const menuKey = `${itemKey}:${normalizedKey}`;
    if (attributeMenu?.menuKey === menuKey) {
      closeAttributeMenu();
      return;
    }

    closeRemovalPrompt();
    const rect = event.currentTarget.getBoundingClientRect();
    setAttributeMenu({
      menuKey,
      itemKey,
      trustId: item.trust_id,
      productId: item.id,
      attributeKey: normalizedKey,
      attributeLabel: titleCaseText(normalizedKey),
      attributeKind: isColour ? 'colour' : 'size',
      position: getAttributeMenuPosition(rect),
    });
    void loadVariantOptionsForItem(item);
  };

  const updateCartAttributeSelection = (item, attributeKey, value) => {
    const normalizedKey = normalizeAttributeName(attributeKey);
    const nextAttributes = { ...(item.selected_attributes || {}) };
    if (!normalizedKey) return;
    if (!item?.id || !item?.trust_id) return;

    const nextValue = pickText(value);
    const currentValue = pickText(nextAttributes[normalizedKey]);
    if (!nextValue) {
      closeAttributeMenu();
      return;
    }

    if (normalizeText(currentValue).toLowerCase() === normalizeText(nextValue).toLowerCase()) {
      closeAttributeMenu();
      return;
    }

    nextAttributes[normalizedKey] = nextValue;
    const updated = setCartProductQuantity(item, {
      trustId: item.trust_id,
      categoryId: item.category_id,
      categoryName: item.category_name,
      price: item.price,
      quantity: getCartItemPricing(item).quantity || Number(item.quantity) || 1,
      selectedImage: item.selected_image || resolveImageUrl(item),
      selectedAttributes: nextAttributes,
      attributeValues: item.attribute_values || [],
    });

    setItems(updated);
    closeAttributeMenu();
    showToast(`${titleCaseText(normalizedKey)} Updated`);
  };

  const closeRemovalPrompt = () => {
    setRemovalPrompt(null);
  };

  const handleDecreaseQuantity = (item, currentQuantity) => {
    closeAttributeMenu();
    if (Number(currentQuantity) <= 1) {
      setRemovalPrompt({ item });
      return;
    }

    updateCartQuantity(item, Math.max(0, Number(currentQuantity) - 1));
  };

  const removeItemFromCart = (item, toastLabel = 'Removed From Cart') => {
    if (!item) return;

    closeAttributeMenu();
    const updated = removeCartProduct(item.id, item.trust_id);
    setItems(updated);
    showToast(toastLabel);
  };

  const moveItemToWishlist = (item) => {
    if (!item) return;

    closeAttributeMenu();
    addWishlistProduct(item, {
      trustId: item.trust_id,
      categoryId: item.category_id,
      categoryName: item.category_name,
      price: item.price,
      selectedImage: item.selected_image || resolveImageUrl(item),
      selectedAttributes: item.selected_attributes || {},
      attributeValues: item.attribute_values || [],
    });
    removeItemFromCart(item, 'Moved To Wishlist');
  };

  const confirmRemoveFromCart = () => {
    if (!pendingRemovalItem) return;
    const item = pendingRemovalItem;
    closeRemovalPrompt();
    closeAttributeMenu();
    removeItemFromCart(item, 'Removed From Cart');
  };

  const confirmMoveToWishlist = () => {
    if (!pendingRemovalItem) return;
    const item = pendingRemovalItem;
    closeRemovalPrompt();
    closeAttributeMenu();
    moveItemToWishlist(item);
  };

  const openItem = (item) => {
    closeAttributeMenu();
    const categoryId = normalizeText(item.category_id);
    const productId = normalizeText(item.id);
    if (!categoryId || !productId) {
      navigate('/categories-products');
      return;
    }

    navigate(`/categories-products/list/${categoryId}/detail/${productId}`);
  };

  const handleClearCart = () => {
    closeAttributeMenu();
    setItems(clearCartItems());
  };

  return (
    <main className="cart-page">
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
              onClick={() => navigate(-1)}
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
              <h1 className="truncate text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>
                {titleCaseText('Cart')}
              </h1>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: T.muted }}>
                {summary.totalQuantity > 0
                  ? titleCaseText(`${summary.totalQuantity} item${summary.totalQuantity === 1 ? '' : 's'} in cart`)
                  : titleCaseText('Your shopping cart')}
              </p>
            </div>
            <div className="flex h-10 items-center justify-end gap-3">
              <button
                type="button"
                className="ws-header-icon-btn"
                onClick={() => navigate('/')}
                aria-label="Go home"
              >
                <HomeIcon size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="ws-header-icon-btn"
                onClick={() => navigate('/wishlist')}
                aria-label="Open wishlist"
              >
                <Heart size={20} strokeWidth={1.8} />
                {wishlistCount > 0 && <span className="ws-cart-badge">{wishlistCount}</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="cart-content">
        {isCartLoading ? (
          <>
            <div className="cart-grid cart-grid--skeleton">
              {Array.from({ length: CART_SKELETON_COUNT }).map((_, index) => (
                <CartItemSkeleton key={`cart-skeleton-${index}`} />
              ))}
            </div>
            <CartSummarySkeleton />
          </>
        ) : items.length === 0 ? (
          <div className="cart-empty">
            <ShoppingCart className="h-7 w-7" />
            <p className="cart-empty-title">{titleCaseText('Your cart is empty')}</p>
            <p className="cart-empty-copy">{titleCaseText('Add products from wishlist or product details to see them here.')}</p>
            <button type="button" className="cart-primary-btn" onClick={() => navigate('/categories-products')}>
              {titleCaseText('Browse products')}
            </button>
          </div>
        ) : (
          <>
            <div className="cart-grid">
              {items.map((item) => {
                const imageUrl = resolveImageUrl(item);
                const price = resolvePrice(item);
                const pricing = getCartItemPricing(item);
                const attributeEntries = Object.entries(item.selected_attributes || {}).filter(([, value]) => normalizeText(value));
                const itemKey = item.key || getCartKey(item.id, item.trust_id);

                return (
                  <article key={itemKey} className="cart-card">
                    <div
                      className="cart-open"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${titleCaseText(item.product_name)}`}
                      onClick={() => openItem(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openItem(item);
                        }
                      }}
                    >
                      <div className="cart-image">
                        {imageUrl ? <img src={imageUrl} alt={item.product_name} loading="lazy" decoding="async" /> : <ShoppingCart className="h-7 w-7" />}
                      </div>
                      <div className="cart-info">
                        <p className="cart-name">{titleCaseText(item.product_name)}</p>
                        {price ? (
                          <div className="cart-price">
                            <span className="cart-price-main">{formatCurrency(price.value)}</span>
                            {price.discountPct > 0 ? <span className="cart-mrp">{formatCurrency(price.mrp)}</span> : null}
                            {price.discountPct > 0 ? <span className="cart-discount">{titleCaseText(`${price.discountPct}% off`)}</span> : null}
                          </div>
                        ) : null}
                        {attributeEntries.length > 0 ? (
                          <div className="cart-attributes">
                            {attributeEntries.map(([label, value]) => (
                              <React.Fragment key={`${itemKey}:${label}`}>
                                {(() => {
                                  const normalizedLabel = normalizeAttributeName(label);
                                  const displayLabel = titleCaseText(label);
                                  const isInteractiveAttribute = isSizeAttributeName(normalizedLabel) || isColourAttributeName(normalizedLabel);

                                  if (!isInteractiveAttribute) {
                                    return (
                                      <span className="cart-attribute-chip">
                                        {displayLabel}: {titleCaseText(value)}
                                      </span>
                                    );
                                  }

                                  const currentValue = normalizedLabel === 'color'
                                    ? (item.selected_attributes?.color || item.selected_attributes?.colour || value)
                                    : value;

                                  return (
                                    <button
                                      type="button"
                                      className="cart-attribute-chip cart-attribute-chip--interactive"
                                      data-cart-attribute-trigger
                                      onClick={(event) => handleAttributeTrigger(event, item, label)}
                                      aria-label={`Change ${displayLabel}`}
                                    >
                                      <span>{displayLabel}: {titleCaseText(currentValue)}</span>
                                      <ChevronDown size={12} className="cart-attribute-chip-icon" />
                                    </button>
                                  );
                                })()}
                              </React.Fragment>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="cart-actions">
                      <div className="cart-qty-control" aria-label={`Quantity for ${item.product_name}`}>
                        <button
                          type="button"
                          className="cart-qty-btn"
                          onClick={() => handleDecreaseQuantity(item, pricing.quantity)}
                          aria-label="Decrease quantity"
                        >
                          -
                        </button>
                        <div className="cart-qty-value">{pricing.quantity}</div>
                        <button
                          type="button"
                          className="cart-qty-btn"
                          onClick={() => updateCartQuantity(item, pricing.quantity + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="cart-remove"
                        onClick={() => setRemovalPrompt({ item })}
                        aria-label={`Remove ${item.product_name}`}
                      >
                        <X className="h-4 w-4" />
                        
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="cart-summary">
              <div className="cart-summary-row">
                <span>{titleCaseText('Products')}</span>
                <strong>{summary.distinctItems}</strong>
              </div>
              <div className="cart-summary-row">
                <span>{titleCaseText('Total quantity')}</span>
                <strong>{summary.totalQuantity}</strong>
              </div>
              <div className="cart-summary-row">
                <span>{titleCaseText('Subtotal')}</span>
                <strong>{formatCurrency(summary.subtotal)}</strong>
              </div>
              <div className="cart-summary-row">
                <span>{titleCaseText('Taxes')}</span>
                <strong>{formatCurrency(summary.taxAmount)}</strong>
              </div>
              {summary.transportAmount > 0 ? (
                <div className="cart-summary-row">
                  <span>{titleCaseText('Delivery')}</span>
                  <strong>{formatCurrency(summary.transportAmount)}</strong>
                </div>
              ) : null}
              <div className="cart-summary-row cart-summary-total">
                <span>{titleCaseText('Grand total')}</span>
                <strong>{formatCurrency(summary.totalAmount)}</strong>
              </div>
              <div className="cart-summary-actions">
                <button type="button" className="cart-primary-btn" onClick={() => navigate('/create-order')}>
                  {titleCaseText('Create order')}
                </button>
                <button type="button" className="cart-secondary-btn" onClick={handleClearCart}>
                  {titleCaseText('Clear cart')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {attributeMenu ? (
        <div
          className="cart-attribute-menu"
          data-cart-attribute-menu
          role="dialog"
          aria-label={titleCaseText(attributeMenu.attributeLabel || attributeMenu.attributeKind)}
          style={{
            top: `${attributeMenu.position.top}px`,
            left: `${attributeMenu.position.left}px`,
            width: `${attributeMenu.position.width}px`,
          }}
        >
          <div className="cart-attribute-menu-body">
            {(() => {
              const activeOptions = variantOptionsByItemKey[attributeMenu.itemKey] || { size: [], colour: [] };
              const isLoading = Boolean(attributeLoadingByItemKey[attributeMenu.itemKey]);
              const menuOptions = attributeMenu.attributeKind === 'colour' ? activeOptions.colour : activeOptions.size;
              const activeItem = items.find((entry) => (entry.key || getCartKey(entry.id, entry.trust_id)) === attributeMenu.itemKey) || null;
              if (!activeItem) {
                return (
                  <div className="cart-attribute-menu-empty">
                    {titleCaseText('This item is no longer in the cart.')}
                  </div>
                );
              }
              const currentSelection = normalizeText(
                attributeMenu.attributeKey === 'color'
                  ? activeItem?.selected_attributes?.color || activeItem?.selected_attributes?.colour
                  : activeItem?.selected_attributes?.[attributeMenu.attributeKey]
              );

              if (isLoading && !variantOptionsByItemKey[attributeMenu.itemKey]) {
                return (
                  <div className="cart-attribute-menu-loading">
                    {titleCaseText('Loading options...')}
                  </div>
                );
              }

              if (!menuOptions || menuOptions.length === 0) {
                return (
                  <div className="cart-attribute-menu-empty">
                    {titleCaseText('No options available for this item.')}
                  </div>
                );
              }

              return (
                <div className="cart-attribute-menu-list">
                  {menuOptions.map((option) => {
                    const isActive = normalizeText(option) === currentSelection;
                    return (
                      <button
                        key={`${attributeMenu.itemKey}:${attributeMenu.attributeKey}:${option}`}
                        type="button"
                        className={`cart-attribute-menu-item ${isActive ? 'cart-attribute-menu-item--active' : ''}`}
                        onClick={() => updateCartAttributeSelection(activeItem, attributeMenu.attributeKey, option)}
                      >
                        <span>{titleCaseText(option)}</span>
                        {isActive ? <Check size={14} /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {removalPrompt ? (
        <div className="cart-modal-overlay" onClick={closeRemovalPrompt}>
          <div
            className="cart-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-modal-title"
            aria-describedby="cart-modal-copy"
          >
            <div className="cart-modal-accent" />
            <button type="button" className="cart-modal-close" onClick={closeRemovalPrompt} aria-label="Close">
              <X size={18} />
            </button>
            <div className="cart-modal-header">
              <div className="cart-modal-badge">
                <Trash2 size={18} />
              </div>
              <div className="cart-modal-headings">
                <h2 id="cart-modal-title" className="cart-modal-title">
                  {titleCaseText('Remove Item?')}
                </h2>
                <p id="cart-modal-copy" className="cart-modal-copy">
                  {titleCaseText(
                    `${pendingRemovalItem?.product_name || 'This item'} will be removed from your cart.`
                  )}
                </p>
              </div>
            </div>
            <div className="cart-modal-actions">
              <button type="button" className="cart-modal-btn cart-modal-btn--wishlist" onClick={confirmMoveToWishlist}>
                <Heart className="h-4 w-4" />
                {titleCaseText('Move To Wishlist')}
              </button>
              <button type="button" className="cart-modal-btn cart-modal-btn--remove" onClick={confirmRemoveFromCart}>
                <Trash2 className="h-4 w-4" />
                {titleCaseText('Remove From Cart')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="cart-toast" role="status" aria-live="polite">
          {normalizeText(toastMessage).toLowerCase().includes('removed') ? (
            <X className="h-4 w-4" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          <span>{titleCaseText(toastMessage)}</span>
        </div>
      ) : null}

      <style>{`
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
        .cart-page {
          min-height: 100vh;
          background: ${T.page};
          color: ${T.text};
          text-transform: capitalize;
        }
        .cart-content {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
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
          animation: cart-shimmer 1.7s ease-in-out infinite;
        }
        @keyframes cart-shimmer {
          100% { transform: translateY(110%); }
        }
        .ws-skeleton-img {
          border-radius: 16px;
          border: 1px solid ${SKELETON_BORDER};
        }
        .ws-skeleton-line {
          border-radius: 999px;
        }
        .cart-empty {
          min-height: 56vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
          color: ${T.muted};
        }
        .cart-empty-title {
          margin: 8px 0 0;
          font-size: 16px;
          font-weight: 800;
          color: ${T.text};
        }
        .cart-empty-copy {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          max-width: 270px;
        }
        .cart-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cart-grid--skeleton {
          gap: 16px;
        }
        .cart-card {
          position: relative;
          border-bottom: 1px solid ${T.line};
          padding-bottom: 12px;
        }
        .cart-card--skeleton {
          border-bottom: none;
          padding: 14px;
          border-radius: 18px;
          background: color-mix(in srgb, ${T.surface} 86%, ${T.text} 4%);
          border: 1px solid color-mix(in srgb, ${T.text} 10%, transparent);
          box-shadow: 0 10px 26px color-mix(in srgb, var(--brand-navy) 10%, transparent);
        }
        .cart-open {
          width: 100%;
          border: 0;
          background: none;
          padding: 0 40px 0 0;
          display: grid;
          grid-template-columns: 86px minmax(0, 1fr);
          gap: 12px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          outline: none;
        }
        .cart-open--skeleton {
          padding-right: 0;
          cursor: default;
        }
        .cart-open:focus-visible {
          outline: 2px solid color-mix(in srgb, ${primaryColor} 40%, transparent);
          outline-offset: 4px;
          border-radius: 18px;
        }
        .cart-image {
          width: 86px;
          aspect-ratio: 3 / 4;
          background: color-mix(in srgb, var(--brand-navy) 8%, ${T.surface});
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${T.accent};
        }
        .cart-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .cart-image--skeleton {
          flex: 0 0 auto;
          width: 86px;
          aspect-ratio: 3 / 4;
        }
        .cart-info {
          min-width: 0;
          padding-top: 2px;
        }
        .cart-info--skeleton {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-top: 2px;
        }
        .cart-name {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.35;
          color: ${primaryColor};
        }
        .cart-price {
          margin-top: 9px;
          display: flex;
          align-items: baseline;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 13px;
          font-weight: 800;
          color: ${primaryColor};
        }
        .cart-price-main {
          color: ${primaryColor};
        }
        .cart-mrp {
          color: ${T.muted};
          text-decoration: line-through;
          font-weight: 500;
        }
        .cart-discount {
          color: ${T.clay};
          font-size: 11px;
          font-weight: 800;
        }
        .cart-attributes {
          margin-top: 8px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .cart-attribute-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          padding: 4px 8px;
          background: color-mix(in srgb, var(--surface-color) 88%, transparent);
          border: 1px solid ${T.line};
          color: ${T.muted};
          font-size: 11px;
          font-weight: 600;
          line-height: 1;
          white-space: nowrap;
        }
        .cart-attribute-chip--interactive {
          border: 1px solid color-mix(in srgb, ${primaryColor} 20%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 96%, ${primaryColor}) 0%, color-mix(in srgb, ${T.surface} 88%, transparent) 100%);
          color: ${primaryColor};
          cursor: pointer;
          transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease;
        }
        .cart-attribute-chip--interactive:active {
          transform: translateY(0) scale(0.99);
        }
        .cart-attribute-chip-icon {
          flex-shrink: 0;
          color: color-mix(in srgb, ${primaryColor} 58%, transparent);
        }
        .cart-attribute-menu {
          position: fixed;
          z-index: 66;
          border-radius: 22px;
          overflow: hidden;
          max-width: 120px;
          border: 1px solid color-mix(in srgb, ${primaryColor} 16%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 98%, ${primaryColor}) 0%, color-mix(in srgb, ${T.surface} 92%, ${T.clay}) 100%);
          box-shadow: 0 20px 48px color-mix(in srgb, var(--brand-navy) 22%, transparent);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(10px);
        }
        .cart-attribute-menu-body {
          padding: 12px 14px 14px;
          max-height: 320px;
          overflow-y: auto;
        }
        .cart-attribute-menu-loading,
        .cart-attribute-menu-empty {
          color: ${T.muted};
          font-size: 12px;
          line-height: 1.5;
          padding: 10px 0;
        }
        .cart-attribute-menu-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .cart-attribute-menu-item {
          min-height: 44px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, ${primaryColor} 12%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 98%, ${primaryColor}) 0%, color-mix(in srgb, ${T.surface} 92%, transparent) 100%);
          color: ${T.text};
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
        }
        .cart-attribute-menu-item:active {
          transform: scale(0.99);
        }
        .cart-attribute-menu-item--active {
          background: linear-gradient(180deg, color-mix(in srgb, ${primaryColor} 14%, ${T.surface}) 0%, color-mix(in srgb, ${primaryColor} 8%, ${T.surface}) 100%);
          border-color: color-mix(in srgb, ${primaryColor} 30%, transparent);
          color: ${primaryColor};
        }
        .cart-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-left:60%;
        }
        .cart-actions--skeleton {
          padding-left: 0;
          margin-top: 16px;
        }
        .cart-qty-control {
          min-height: 42px;
          float:right;
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) 42px;
          border-radius: 14px;
          overflow: hidden;
          background: ${T.surface};
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          flex: 1;
          max-width: 150px;
        }
        .cart-qty-btn {
          border: 0;
          background:color-mix(in srgb, var(--brand-navy) 4%, ${T.surface});
          color: ${navbarTextColor};
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background-color 0.18s ease, transform 0.18s ease;
        }
        .cart-qty-btn:active {
          transform: scale(0.98);
        }
        .cart-qty-value {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          color: ${navbarTextColor};
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          user-select: none;
        }
        .cart-remove {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 32px;
          height: 32px;
          border-radius: 14px;
          border: 1px solid color-mix(in srgb, var(--body-text-color) 12%, transparent);
          background: color-mix(in srgb, ${T.surface} 88%, transparent);
          color: ${primaryColor};
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .cart-skeleton-line--title {
          width: 62%;
          height: 14px;
        }
        .cart-skeleton-line--price {
          width: 48%;
          height: 12px;
        }
        .cart-skeleton-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
        }
        .cart-skeleton-chip {
          width: 78px;
          height: 24px;
          border-radius: 999px;
        }
        .cart-skeleton-qty {
          flex: 1;
          max-width: 142px;
          height: 38px;
          border-radius: 12px;
        }
        .cart-skeleton-remove {
          width: 32px;
          height: 32px;
          border-radius: 14px;
        }
        .cart-summary--skeleton {
          pointer-events: none;
        }
        .cart-summary-row--skeleton {
          align-items: center;
        }
        .cart-summary-row--total {
          margin-top: 6px;
          padding-top: 10px;
          border-top: 1px solid ${T.line};
          font-size: 14px;
        }
        .cart-summary-label {
          width: 88px;
          height: 11px;
        }
        .cart-summary-label--total {
          width: 102px;
        }
        .cart-summary-value {
          width: 42px;
          height: 11px;
        }
        .cart-summary-value--total {
          width: 64px;
          height: 12px;
        }
        .cart-summary-actions--skeleton {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 14px;
        }
        .cart-skeleton-button {
          width: 100%;
          height: 46px;
          border-radius: 14px;
        }
        .cart-skeleton-button--secondary {
          background: color-mix(in srgb, ${T.surface} 92%, ${T.text} 5%);
        }
        .cart-summary {
          border-radius: 20px;
          padding: 16px;
          background: color-mix(in srgb, ${T.surface} 92%, transparent);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent);
          box-shadow: 0 14px 30px color-mix(in srgb, var(--brand-navy) 8%, transparent);
        }
        .cart-summary-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 13px;
          color: ${T.muted};
          padding: 4px 0;
        }
        .cart-summary-row strong {
          color: ${T.text};
          font-weight: 800;
        }
        .cart-summary-total {
          margin-top: 6px;
          padding-top: 10px;
          border-top: 1px solid ${T.line};
          font-size: 14px;
        }
        .cart-summary-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-top: 14px;
        }
        .cart-primary-btn,
        .cart-secondary-btn {
          min-height: 46px;
          border-radius: 14px;
          padding: 0 16px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
        }
        .cart-primary-btn:active,
        .cart-secondary-btn:active {
          transform: scale(0.98);
        }
        .cart-primary-btn {
          background: var(--app-button-bg);
          color: var(--app-button-text);
          border: 1px solid transparent;
        }
        .cart-secondary-btn {
          background: ${T.surface};
          color: var(--brand-navy);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
        }
        .cart-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: color-mix(in srgb, var(--brand-navy) 36%, transparent);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .cart-modal {
          position: relative;
          width: min(100%, 440px);
          border-radius: 26px;
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 98%, var(--brand-navy)) 0%, color-mix(in srgb, ${T.surface} 90%, transparent) 100%);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          box-shadow: 0 24px 56px color-mix(in srgb, var(--brand-navy) 24%, transparent);
          overflow: hidden;
          animation: cartModalIn 0.18s ease-out;
        }
        .cart-modal-accent {
          height: 4px;
          background: linear-gradient(90deg, ${primaryColor}, var(--brand-navy), ${primaryColor});
        }
        .cart-modal-close {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 999px;
          background: color-mix(in srgb, ${T.surface} 88%, transparent);
          color: ${T.muted};
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .cart-modal-header {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 18px 18px 12px;
        }
        .cart-modal-badge {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          background: color-mix(in srgb, ${primaryColor} 14%, ${T.surface});
          color: ${primaryColor};
          border: 1px solid color-mix(in srgb, ${primaryColor} 24%, transparent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        .cart-modal-headings {
          min-width: 0;
          flex: 1;
          padding-right: 36px;
        }
        .cart-modal-kicker {
          margin: 0;
          color: ${T.muted};
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .cart-modal-title {
          margin: 6px 0 0;
          color: ${T.text};
          font-size: 18px;
          font-weight: 800;
          line-height: 1.25;
        }
        .cart-modal-copy {
          margin: 6px 0 0;
          color: ${T.muted};
          font-size: 13px;
          line-height: 1.5;
        }
        .cart-modal-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          padding: 0 18px 18px;
        }
        .cart-modal-btn {
          min-height: 46px;
          border-radius: 14px;
          padding: 0 14px;
          font-size: 14px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
        }
        .cart-modal-btn:active {
          transform: scale(0.98);
        }
        .cart-modal-btn--wishlist {
          border: 1px solid transparent;
          background: linear-gradient(135deg, color-mix(in srgb, ${primaryColor} 84%, white) 0%, color-mix(in srgb, var(--brand-navy) 84%, white) 100%);
          color: white;
        }
        .cart-modal-btn--remove {
          border: 1px solid color-mix(in srgb, ${primaryColor} 24%, transparent);
          background: color-mix(in srgb, ${primaryColor} 10%, ${T.surface});
          color: ${primaryColor};
        }
        .cart-modal-btn--ghost {
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: ${T.surface};
          color: var(--brand-navy);
        }
        .cart-toast {
          position: fixed;
          left: 50%;
          bottom: max(18px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 70;
          min-width: 190px;
          max-width: calc(100vw - 32px);
          padding: 11px 14px;
          border-radius: 999px;
          background: var(--surface-color);
          color: var(--app-button-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
          box-shadow: 0 12px 28px color-mix(in srgb, var(--brand-navy) 22%, transparent);
          pointer-events: none;
          animation: cartToastIn 0.18s ease-out;
        }
        @media (min-width: 420px) {
          .cart-modal-actions {
            grid-template-columns: 1fr 1fr;
          }
          .cart-modal-btn--ghost {
            grid-column: 1 / -1;
          }
        }
        @keyframes cartModalIn {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes cartToastIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
      `}</style>
    </main>
  );
}

export default Cart;
