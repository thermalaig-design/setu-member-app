import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Heart, Home as HomeIcon, ShoppingCart, Sparkles, Trash2, X } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';
import {
  readWishlistItems,
  removeWishlistProduct,
  updateWishlistProduct,
  subscribeWishlist,
} from './utils/productWishlist';
import {
  getCartKey,
  readCartItems,
  setCartProductQuantity,
  subscribeCart,
} from './utils/productCart';

const T = {
  text: 'var(--body-text-color)',
  muted: 'color-mix(in srgb, var(--body-text-color) 62%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--body-text-color) 12%, transparent)',
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  accent: 'var(--brand-red)',
  clay: "#c74212",
};

const SKELETON_BG = 'color-mix(in srgb, var(--brand-navy) 8%, transparent)';
const SKELETON_BORDER = 'color-mix(in srgb, var(--brand-navy) 12%, transparent)';
const PAGE_SIZE = 20;
const INITIAL_SKELETON_COUNT = 6;
const LOAD_MORE_DELAY_MS = 360;
const LOAD_MORE_ROOT_MARGIN = '240px 0px';

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const toTitleCase = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return '';
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatVariantValue = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length === 1) return text.toUpperCase();
  return toTitleCase(text);
};

const getVariantGroups = (options = {}) => {
  const groups = [];

  if (Array.isArray(options.size) && options.size.length > 0) {
    groups.push({ name: 'size', label: 'Size', values: options.size });
  }

  if (Array.isArray(options.colour) && options.colour.length > 0) {
    groups.push({ name: 'colour', label: 'Colour', values: options.colour });
  }

  return groups;
};

const isVariantSelectionComplete = (options = {}, selected = {}) => (
  (!Array.isArray(options.size) || options.size.length === 0 || Boolean(normalizeText(selected?.size)))
  && (!Array.isArray(options.colour) || options.colour.length === 0 || Boolean(normalizeText(selected?.colour)))
);

const resolveImageUrl = (item) => {
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

const normalizeAttributeKey = (value) => normalizeText(value).toLowerCase();

const normalizeAttributeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    return normalizeText(value.label || value.name || value.value || '');
  }

  return normalizeText(value);
};

const splitAttributeValueList = (value) => {
  const text = normalizeAttributeValue(value);
  if (!text) return [];

  return text
    .split(/[,|;/]+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
};

const normalizeSelectedAttributes = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const normalizedKey = normalizeAttributeKey(key);
    const normalizedValue = normalizeAttributeValue(rawValue);
    if (!normalizedKey || !normalizedValue) return acc;

    if (normalizedKey === 'color') {
      acc.colour = normalizedValue;
      return acc;
    }

    acc[normalizedKey] = normalizedValue;
    return acc;
  }, {});
};

const normalizeAttributeRows = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const attributeName = normalizeAttributeKey(row.attribute_name || row.name || row.label || row.attribute);
      const attributeValue = normalizeAttributeValue(row.value ?? row.attribute_value ?? row.attributeValue);
      if (!attributeName || !attributeValue) return null;

      return {
        attribute_name: attributeName,
        value: attributeValue,
      };
    })
    .filter(Boolean);
};

const pushUniqueValue = (list, value) => {
  const normalized = normalizeText(value);
  if (!normalized || list.includes(normalized)) return list;
  list.push(normalized);
  return list;
};

const getWishlistAttributeData = (item) => {
  const options = { size: [], colour: [] };
  const selected = normalizeSelectedAttributes(item?.selected_attributes || {});

  normalizeAttributeRows(item?.attribute_values).forEach(({ attribute_name, value }) => {
    if (attribute_name === 'size') {
      splitAttributeValueList(value).forEach((entry) => pushUniqueValue(options.size, entry));
    }

    if (attribute_name === 'colour' || attribute_name === 'color') {
      splitAttributeValueList(value).forEach((entry) => pushUniqueValue(options.colour, entry));
    }
  });

  return {
    options,
    selected: {
      size: selected.size || '',
      colour: selected.colour || selected.color || '',
    },
  };
};

function VariantSheet({
  open,
  itemName,
  groups,
  selected,
  onClose,
  onChange,
  onClear,
  onConfirm,
  confirmLabel,
  canConfirm,
}) {
  if (!open) return null;

  return (
    <div className="wishlist-sheet-overlay" onClick={onClose}>
      <div className="wishlist-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="wishlist-sheet-handle" />
        <div className="wishlist-sheet-header">
          <div className="wishlist-sheet-headings">
            <p className="wishlist-sheet-kicker">Select Options</p>
            <h2 className="wishlist-sheet-title">Choose Size And Colour</h2>
            {itemName ? <p className="wishlist-sheet-copy">{itemName}</p> : null}
          </div>
          <button type="button" className="wishlist-sheet-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="wishlist-sheet-body">
          {groups.length === 0 ? (
            <div className="wishlist-sheet-empty">No size or colour options available.</div>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="wishlist-sheet-group">
                <div className="wishlist-sheet-group-title">{group.label}</div>
                <div className="wishlist-chip-wrap">
                  {group.values.map((value) => {
                    const isOn = normalizeText(selected?.[group.name]) === value;
                    return (
                      <button
                        key={`${group.name}:${value}`}
                        type="button"
                        className={`wishlist-chip ${isOn ? 'wishlist-chip-on' : ''}`}
                        onClick={() => onChange(group.name, value)}
                      >
                        {isOn && <Check size={12} style={{ marginRight: 4 }} />}
                        {formatVariantValue(value)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="wishlist-sheet-footer">
          <button type="button" className="wishlist-sheet-btn wishlist-sheet-btn--ghost" onClick={onClear}>
            Clear All
          </button>
          <button
            type="button"
            className="wishlist-sheet-btn wishlist-sheet-btn--primary"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const WishlistCardSkeleton = () => (
  <article className="wishlist-card wishlist-card--skeleton" aria-hidden="true">
    <div className="wishlist-skeleton-layout">
      <div className="wishlist-skeleton wishlist-skeleton-image" />
      <div className="wishlist-skeleton-info">
        <div className="wishlist-skeleton wishlist-skeleton-line" style={{ width: '84%', height: 14 }} />
        <div className="wishlist-skeleton wishlist-skeleton-line" style={{ width: '62%', height: 14 }} />
        <div className="wishlist-skeleton-price-row">
          <div className="wishlist-skeleton wishlist-skeleton-line" style={{ width: 58, height: 14 }} />
          <div className="wishlist-skeleton wishlist-skeleton-line" style={{ width: 42, height: 11 }} />
        </div>
      </div>
    </div>
    <div className="wishlist-skeleton-actions">
      <div className="wishlist-skeleton wishlist-skeleton-button" />
      <div className="wishlist-skeleton wishlist-skeleton-button" />
    </div>
    <div className="wishlist-skeleton wishlist-skeleton-remove" />
  </article>
);

function RemoveWishlistConfirmModal({
  open,
  itemName,
  title = 'Remove From Wishlist?',
  description = 'Are you sure you want to remove this item from your wishlist?',
  confirmLabel = 'Yes, Remove',
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div className="wishlist-remove-overlay" onClick={onCancel}>
      <div
        className="wishlist-remove-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wishlist-remove-title"
        aria-describedby="wishlist-remove-description"
      >
        <div className="wishlist-remove-strip" />
        <div className="wishlist-remove-icon">
          <Trash2 size={22} />
        </div>
        <h2 id="wishlist-remove-title" className="wishlist-remove-title">
          {title}
        </h2>
        <p id="wishlist-remove-description" className="wishlist-remove-copy">
          {description}
        </p>
        {itemName ? <div className="wishlist-remove-item">{itemName}</div> : null}
        <div className="wishlist-remove-footer">
          <button type="button" className="wishlist-remove-btn wishlist-remove-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="wishlist-remove-btn wishlist-remove-btn--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Wishlist() {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [items, setItems] = useState(() => readWishlistItems());
  const [cartItems, setCartItems] = useState(() => readCartItems());
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');
  const [variantSheet, setVariantSheet] = useState(null);
  const [removeConfirmItem, setRemoveConfirmItem] = useState(null);
  const [cartRemoveConfirmItem, setCartRemoveConfirmItem] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const toastTimerRef = useRef(null);
  const sentinelRef = useRef(null);
  const loadMoreFrameRef = useRef(null);
  const loadMoreTimeoutRef = useRef(null);
  const isVariantSheetOpen = Boolean(variantSheet);
  const isOverlayOpen = isVariantSheetOpen || Boolean(removeConfirmItem) || Boolean(cartRemoveConfirmItem);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setLoading(false);
      return undefined;
    }

    const loadingTimer = window.setTimeout(() => setLoading(false), 280);
    return () => window.clearTimeout(loadingTimer);
  }, []);
  useEffect(() => subscribeWishlist(setItems), []);
  useEffect(() => subscribeCart(setCartItems), []);
  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    if (loadMoreFrameRef.current) {
      window.cancelAnimationFrame(loadMoreFrameRef.current);
      loadMoreFrameRef.current = null;
    }
    if (loadMoreTimeoutRef.current) {
      window.clearTimeout(loadMoreTimeoutRef.current);
      loadMoreTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (!isOverlayOpen || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOverlayOpen]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => normalizeText(b.saved_at).localeCompare(normalizeText(a.saved_at))),
    [items]
  );
  const visibleItems = useMemo(
    () => sortedItems.slice(0, visibleCount),
    [sortedItems, visibleCount]
  );
  const hasMore = visibleCount < sortedItems.length;

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
    setVisibleCount((current) => Math.min(Math.max(PAGE_SIZE, current), Math.max(PAGE_SIZE, sortedItems.length)));
  }, [sortedItems.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || !hasMore || typeof window === 'undefined') return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount((current) => Math.min(current + PAGE_SIZE, sortedItems.length));
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
            setVisibleCount((current) => Math.min(current + PAGE_SIZE, sortedItems.length));
            setLoadingMore(false);
          }, LOAD_MORE_DELAY_MS);
        });
      },
      { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0.01 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, sortedItems.length]);

  const cartCount = useMemo(
    () => cartItems.reduce((total, item) => total + Number(item?.quantity || 0), 0),
    [cartItems]
  );
  const cartItemsByKey = useMemo(
    () => new Map(cartItems.map((item) => [item.key, item])),
    [cartItems]
  );

  const getItemVariantState = (item) => {
    const cartItem = cartItemsByKey.get(getCartKey(item.id, item.trust_id)) || null;
    const attributeData = getWishlistAttributeData({
      ...item,
      selected_attributes: cartItem?.selected_attributes || item.selected_attributes,
    });

    return {
      cartItem,
      options: attributeData.options,
      selected: {
        size: attributeData.selected.size || '',
        colour: attributeData.selected.colour || '',
      },
    };
  };

  const updateCartQuantity = (item, nextQuantity, selectedAttributes = item?.selected_attributes || {}) => {
    const updated = setCartProductQuantity(item, {
      trustId: item.trust_id,
      categoryId: item.category_id,
      categoryName: item.category_name,
      price: item.price,
      quantity: nextQuantity,
      selectedImage: resolveImageUrl(item),
      selectedAttributes,
      attributeValues: item.attribute_values || [],
    });
    setCartItems(updated);
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

  const updateWishlistSelection = (item, nextSelection) => {
    const normalizedSelection = {
      size: normalizeText(nextSelection?.size),
      colour: normalizeText(nextSelection?.colour),
    };

    const updatedWishlist = updateWishlistProduct(item.id, item.trust_id, {
      selected_attributes: normalizedSelection,
      attribute_values: item.attribute_values || [],
    });
    setItems(updatedWishlist);

    const cartItem = cartItemsByKey.get(getCartKey(item.id, item.trust_id)) || null;
    if (cartItem) {
      const updatedCart = setCartProductQuantity(item, {
        trustId: item.trust_id,
        categoryId: item.category_id,
        categoryName: item.category_name,
        price: item.price,
        quantity: Number(cartItem.quantity) || 1,
        selectedImage: resolveImageUrl(item),
        selectedAttributes: normalizedSelection,
        attributeValues: item.attribute_values || [],
      });
      setCartItems(updatedCart);
    }

    return normalizedSelection;
  };

  const openVariantSheet = (item, action = 'edit') => {
    const variantState = getItemVariantState(item);
    setVariantSheet({
      item,
      action,
      options: variantState.options,
      selected: {
        size: variantState.selected.size || '',
        colour: variantState.selected.colour || '',
      },
    });
  };

  const closeVariantSheet = () => {
    setVariantSheet(null);
  };

  const updateVariantSheetSelection = (field, value) => {
    setVariantSheet((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        selected: {
          ...prev.selected,
          [field]: value,
        },
      };
    });
  };

  const clearVariantSheetSelection = () => {
    setVariantSheet((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        selected: {
          size: '',
          colour: '',
        },
      };
    });
  };

  const confirmVariantSheet = () => {
    if (!variantSheet) return;

    const nextSelection = buildSelectedAttributes(variantSheet.selected);
    if (!isVariantSelectionComplete(variantSheet.options, variantSheet.selected)) {
      return;
    }

    updateWishlistSelection(variantSheet.item, nextSelection);

    if (variantSheet.action === 'add') {
      updateCartQuantity(variantSheet.item, 1, nextSelection);
      showToast('Added To Cart');
      closeVariantSheet();
      return;
    }

    if (variantSheet.action === 'buy') {
      const cartItem = cartItemsByKey.get(getCartKey(variantSheet.item.id, variantSheet.item.trust_id)) || null;
      const nextQuantity = Number(cartItem?.quantity || 0) > 0 ? Number(cartItem.quantity) : 1;
      updateCartQuantity(variantSheet.item, nextQuantity, nextSelection);
      closeVariantSheet();
      navigate('/cart');
      return;
    }

    closeVariantSheet();
  };

  const buildSelectedAttributes = (selected = {}) => {
    const selectedAttributes = {};
    const size = normalizeText(selected?.size);
    const colour = normalizeText(selected?.colour);
    if (size) {
      selectedAttributes.size = size;
    }
    if (colour) {
      selectedAttributes.colour = colour;
    }
    return selectedAttributes;
  };

  const handleAddToCart = (item) => {
    const { options, selected } = getItemVariantState(item);
    if (!isVariantSelectionComplete(options, selected)) {
      openVariantSheet(item, 'add');
      return;
    }

    const nextSelection = buildSelectedAttributes(selected);
    updateWishlistSelection(item, nextSelection);
    updateCartQuantity(item, 1, nextSelection);
    showToast('Added To Cart');
  };

  const handleBuyNow = (item) => {
    const { options, selected } = getItemVariantState(item);
    if (!isVariantSelectionComplete(options, selected)) {
      openVariantSheet(item, 'buy');
      return;
    }

    const nextSelection = buildSelectedAttributes(selected);
    updateWishlistSelection(item, nextSelection);
    const cartItem = cartItemsByKey.get(getCartKey(item.id, item.trust_id)) || null;
    const nextQuantity = Number(cartItem?.quantity || 0) > 0 ? Number(cartItem.quantity) : 1;
    updateCartQuantity(item, nextQuantity, nextSelection);
    navigate('/cart');
  };

  const promptRemoveFromCart = (item) => {
    setCartRemoveConfirmItem(item);
  };

  const closeCartRemoveConfirm = () => {
    setCartRemoveConfirmItem(null);
  };

  const confirmRemoveFromCart = () => {
    if (!cartRemoveConfirmItem) return;

    const { selected } = getItemVariantState(cartRemoveConfirmItem);
    const selectedAttributes = buildSelectedAttributes(selected);
    updateCartQuantity(cartRemoveConfirmItem, 0, selectedAttributes);
    closeCartRemoveConfirm();
    showToast('Removed From Cart');
  };

  const handleDecreaseCartQuantity = (item, cartQuantity, selectedAttributes) => {
    if (Number(cartQuantity) <= 1) {
      promptRemoveFromCart(item);
      return;
    }

    updateCartQuantity(item, Number(cartQuantity) - 1, selectedAttributes);
  };

  const promptRemoveFromWishlist = (item) => {
    setRemoveConfirmItem(item);
  };

  const closeRemoveConfirm = () => {
    setRemoveConfirmItem(null);
  };

  const confirmRemoveFromWishlist = () => {
    if (!removeConfirmItem) return;

    if (variantSheet?.item?.key === removeConfirmItem.key) {
      closeVariantSheet();
    }

    const updated = removeWishlistProduct(removeConfirmItem.id, removeConfirmItem.trust_id);
    setItems(updated);
    closeRemoveConfirm();
    showToast('Removed From Wishlist');
  };

  const openItem = (item) => {
    const categoryId = normalizeText(item.category_id);
    const productId = normalizeText(item.id);
    if (!categoryId || !productId) {
      navigate('/categories-products');
      return;
    }

    navigate(`/categories-products/list/${categoryId}/detail/${productId}`);
  };

  return (
    <main className="wishlist-page">
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
              aria-label="Go Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 flex-1 text-center text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>
              Wishlist
            </h1>
            <div className="flex h-10 items-center justify-end gap-3">
              <button
                type="button"
                className="ws-header-icon-btn"
                onClick={() => navigate('/')}
                aria-label="Go Home"
              >
                <HomeIcon size={20} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="ws-header-icon-btn"
                onClick={() => navigate('/cart')}
                aria-label="Open Cart"
              >
                <ShoppingCart size={20} strokeWidth={1.5} />
                {cartCount > 0 && <span className="ws-cart-badge">{cartCount}</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="wishlist-content">
        {loading ? (
          <div className="wishlist-grid">
            {Array.from({ length: INITIAL_SKELETON_COUNT }).map((_, index) => (
              <WishlistCardSkeleton key={`initial-${index}`} />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="wishlist-empty">
            <Heart className="h-7 w-7" />
            <p className="wishlist-empty-title">No Wishlist Items Yet</p>
            
          </div>
        ) : (
          <div className="wishlist-grid">
            {visibleItems.map((item) => {
              const imageUrl = resolveImageUrl(item);
              const price = resolvePrice(item);
              const productName = toTitleCase(item.product_name);
              const variantState = getItemVariantState(item);
              const cartQuantity = Number(variantState.cartItem?.quantity || 0);
              const selectedAttributes = buildSelectedAttributes(variantState.selected);

              return (
                <article key={item.key} className="wishlist-card">
                  <button type="button" className="wishlist-open" onClick={() => openItem(item)} aria-label={`Open ${productName || 'Wishlist Item'}`}>
                    <div className="wishlist-image">
                      {imageUrl ? <img src={imageUrl} alt={productName || 'Wishlist Item'} loading="lazy" decoding="async" /> : <Heart className="h-8 w-8" />}
                    </div>
                    <div className="wishlist-info">
                      <p className="wishlist-name">{productName}</p>
                      {price ? (
                        <div className="wishlist-price">
                          <span>{formatCurrency(price.value)}</span>
                          {price.discountPct > 0 ? <span className="wishlist-mrp">{formatCurrency(price.mrp)}</span> : null}
                          {price.discountPct > 0 ? <span className="wishlist-discount">{price.discountPct}% Off</span> : null}
                        </div>
                      ) : null}
                      {selectedAttributes.size || selectedAttributes.colour ? (
                        <div className="wishlist-attributes" aria-label="Selected options">
                          {selectedAttributes.size ? (
                            <button
                              type="button"
                              className="wishlist-attribute-pill wishlist-attribute-pill--action"
                              onClick={(event) => {
                                event.stopPropagation();
                                openVariantSheet(item, 'edit');
                              }}
                              aria-label={`Change size, currently ${formatVariantValue(selectedAttributes.size)}`}
                            >
                              <span className="wishlist-attribute-label">Size</span>
                              <span className="wishlist-attribute-value">{formatVariantValue(selectedAttributes.size)}</span>
                            </button>
                          ) : null}
                          {selectedAttributes.colour ? (
                            <button
                              type="button"
                              className="wishlist-attribute-pill wishlist-attribute-pill--action"
                              onClick={(event) => {
                                event.stopPropagation();
                                openVariantSheet(item, 'edit');
                              }}
                              aria-label={`Change colour, currently ${formatVariantValue(selectedAttributes.colour)}`}
                            >
                              <span className="wishlist-attribute-label">Colour</span>
                              <span className="wishlist-attribute-value">{formatVariantValue(selectedAttributes.colour)}</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </button>
                  <div className="wishlist-actions">
                    <button
                      type="button"
                      className="wishlist-buy"
                      onClick={() => handleBuyNow(item)}
                    >
                      <Sparkles className="h-4 w-4" />
                      Buy Now
                    </button>
                    {cartQuantity > 0 ? (
                      <div className="wishlist-qty-control" aria-label={`Quantity For ${productName || 'Wishlist Item'}`}>
                        <button
                          type="button"
                          className="wishlist-qty-btn"
                          onClick={() => handleDecreaseCartQuantity(item, cartQuantity, selectedAttributes)}
                          aria-label="Decrease Quantity"
                        >
                          -
                        </button>
                        <div className="wishlist-qty-value">{cartQuantity}</div>
                        <button
                          type="button"
                          className="wishlist-qty-btn"
                          onClick={() => updateCartQuantity(item, cartQuantity + 1, selectedAttributes)}
                          aria-label="Increase Quantity"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="wishlist-add"
                        onClick={() => handleAddToCart(item)}
                      >
                        <ShoppingCart className="h-4 w-4" />
                        Add To Cart
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="wishlist-remove"
                    onClick={() => promptRemoveFromWishlist(item)}
                    aria-label={`Remove ${productName || 'Wishlist Item'}`}
                    aria-haspopup="dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </article>
              );
            })}
            {loadingMore && hasMore ? (
              Array.from({ length: Math.min(PAGE_SIZE, sortedItems.length - visibleCount) }).map((_, index) => (
                <WishlistCardSkeleton key={`more-${index}`} />
              ))
            ) : null}
          </div>
        )}

        {!loading && hasMore ? <div ref={sentinelRef} className="wishlist-sentinel" aria-hidden="true" /> : null}
      </section>

      <VariantSheet
        open={Boolean(variantSheet)}
        itemName={variantSheet ? toTitleCase(variantSheet.item?.product_name) : ''}
        groups={variantSheet ? getVariantGroups(variantSheet.options) : []}
        selected={variantSheet?.selected || {}}
        onClose={closeVariantSheet}
        onChange={updateVariantSheetSelection}
        onClear={clearVariantSheetSelection}
        onConfirm={confirmVariantSheet}
        confirmLabel={
          variantSheet?.action === 'add'
            ? 'Add To Cart'
            : variantSheet?.action === 'buy'
              ? 'Buy Now'
              : 'Apply'
        }
        canConfirm={variantSheet ? isVariantSelectionComplete(variantSheet.options, variantSheet.selected) : false}
      />

      <RemoveWishlistConfirmModal
        open={Boolean(removeConfirmItem)}
        itemName={removeConfirmItem ? toTitleCase(removeConfirmItem.product_name) : ''}
        onCancel={closeRemoveConfirm}
        onConfirm={confirmRemoveFromWishlist}
      />

      <RemoveWishlistConfirmModal
        open={Boolean(cartRemoveConfirmItem)}
        itemName={cartRemoveConfirmItem ? toTitleCase(cartRemoveConfirmItem.product_name) : ''}
        title="Remove From Cart?"
        description="Are you sure you want to remove this item from your cart?"
        confirmLabel="Remove From Cart"
        onCancel={closeCartRemoveConfirm}
        onConfirm={confirmRemoveFromCart}
      />

      {toastMessage ? (
        <div className="wishlist-toast" role="status" aria-live="polite">
          {normalizeText(toastMessage).toLowerCase().includes('removed') ? (
            <X className="h-4 w-4" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          <span>{toastMessage}</span>
        </div>
      ) : null}

      <style>{`
        .wishlist-page {
          min-height: 100vh;
          background: ${T.page};
          color: ${T.text};
        }
        .wishlist-content {
          width: 100%;
          max-width: 460px;
          margin: 0 auto;
          padding: 18px 16px 28px;
        }
        .wishlist-empty {
          min-height: 52vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
          color: ${T.muted};
        }
        .wishlist-empty-title {
          margin: 8px 0 0;
          font-size: 16px;
          font-weight: 800;
          color: ${T.text};
        }
        .wishlist-empty-copy {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          max-width: 260px;
        }
        .wishlist-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .wishlist-card {
          position: relative;
          padding: 14px 14px 16px;
          border-radius: 22px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: linear-gradient(180deg, color-mix(in srgb, var(--advertisement-card-bg) 96%, var(--brand-navy)) 0%, color-mix(in srgb, ${T.surface} 18%, transparent) 100%);
          box-shadow: 0 14px 28px color-mix(in srgb, var(--brand-navy) 8%, transparent);
          overflow: hidden;
        }
        .wishlist-card--skeleton {
          pointer-events: none;
        }
        .wishlist-skeleton-layout {
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          gap: 14px;
          padding-right: 38px;
        }
        .wishlist-skeleton {
          position: relative;
          overflow: hidden;
          background: ${SKELETON_BG};
          border-radius: 999px;
        }
        .wishlist-skeleton::after {
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
          animation: wishlistShimmer 1.7s ease-in-out infinite;
        }
        @keyframes wishlistShimmer {
          100% { transform: translateY(110%); }
        }
        .wishlist-skeleton-image {
          width: 88px;
          aspect-ratio: 3 / 4;
          border-radius: 18px;
          border: 1px solid ${SKELETON_BORDER};
        }
        .wishlist-skeleton-info {
          min-width: 0;
          padding-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .wishlist-skeleton-line {
          border-radius: 999px;
        }
        .wishlist-skeleton-price-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 2px;
        }
        .wishlist-skeleton-actions {
          margin-top: 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
        }
        .wishlist-skeleton-button {
          min-height: 44px;
          border-radius: 14px;
        }
        .wishlist-skeleton-remove {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 32px;
          height: 32px;
          border-radius: 14px;
        }
        .wishlist-sentinel {
          width: 100%;
          height: 1px;
        }
        .wishlist-open {
          width: 100%;
          border: 0;
          background: none;
          padding: 0 38px 0 0;
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          gap: 14px;
          text-align: left;
          color: inherit;
          cursor: pointer;
        }
        .wishlist-image {
          width: 88px;
          aspect-ratio: 3 / 4;
          border-radius: 18px;
          background: color-mix(in srgb, var(--brand-navy) 8%, ${T.surface});
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${T.accent};
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand-navy) 10%, transparent);
        }
        .wishlist-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .wishlist-info {
          min-width: 0;
          padding-top: 2px;
        }
        .wishlist-name {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--surface-color);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .wishlist-attributes {
          margin-top: 9px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .wishlist-attribute-pill {
          min-height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, ${primaryColor} 32%, transparent);
          background: color-mix(in srgb, ${primaryColor} 12%, ${T.surface});
          color: ${primaryColor};
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          text-align: center;
          font-family: inherit;
        }
        .wishlist-attribute-pill--placeholder {
          background: color-mix(in srgb, ${T.surface} 92%, transparent);
          border-style: dashed;
          color: ${T.muted};
        }
        .wishlist-attribute-label {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 10px;
          font-weight: 800;
        }
        .wishlist-attribute-value {
          font-size: 12px;
          font-weight: 800;
        }
        .wishlist-attribute-pill--action {
          cursor: pointer;
          border-style: dashed;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
        }
        .wishlist-attribute-pill--action:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px color-mix(in srgb, var(--brand-navy) 8%, transparent);
        }
        .wishlist-sheet-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 16px;
          background: rgba(28, 27, 25, 0.42);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .wishlist-sheet {
          width: min(100%, 460px);
          max-height: 76vh;
          border-radius: 22px 22px 0 0;
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 96%, var(--brand-navy)) 0%, color-mix(in srgb, ${T.surface} 90%, transparent) 100%);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          box-shadow: 0 24px 56px color-mix(in srgb, var(--brand-navy) 24%, transparent);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: wishlistSheetIn 0.18s ease-out;
        }
        .wishlist-sheet-handle {
          width: 36px;
          height: 4px;
          background: color-mix(in srgb, var(--body-text-color) 16%, transparent);
          border-radius: 999px;
          margin: 10px auto 4px;
          flex: 0 0 auto;
        }
        .wishlist-sheet-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 10px 18px 14px;
          border-bottom: 1px solid color-mix(in srgb, var(--body-text-color) 10%, transparent);
        }
        .wishlist-sheet-headings {
          min-width: 0;
        }
        .wishlist-sheet-kicker {
          margin: 0;
          color: ${T.muted};
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .wishlist-sheet-title {
          margin: 6px 0 0;
          color: ${T.text};
          font-size: 17px;
          font-weight: 800;
          line-height: 1.25;
        }
        .wishlist-sheet-copy {
          margin: 6px 0 0;
          color: ${T.muted};
          font-size: 12px;
          line-height: 1.45;
        }
        .wishlist-sheet-close {
          flex: 0 0 auto;
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
        .wishlist-sheet-body {
          padding: 16px 18px;
          overflow-y: auto;
        }
        .wishlist-sheet-group {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .wishlist-sheet-group + .wishlist-sheet-group {
          margin-top: 16px;
        }
        .wishlist-sheet-group-title {
          font-size: 12px;
          font-weight: 800;
          color: ${T.text};
        }
        .wishlist-chip-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .wishlist-chip {
          min-height: 34px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent);
          background: ${T.surface};
          color: ${T.text};
          padding: 0 13px;
          font-size: 12px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.18s ease, background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .wishlist-chip:active {
          transform: scale(0.98);
        }
        .wishlist-chip-on {
          background: ${primaryColor};
          border-color: ${primaryColor};
          color: white;
        }
        .wishlist-sheet-empty {
          color: ${T.muted};
          font-size: 13px;
          line-height: 1.5;
        }
        .wishlist-sheet-footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 14px 18px 18px;
          border-top: 1px solid color-mix(in srgb, var(--body-text-color) 10%, transparent);
        }
        .wishlist-sheet-btn {
          min-height: 44px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease;
        }
        .wishlist-sheet-btn:active {
          transform: scale(0.98);
        }
        .wishlist-sheet-btn--ghost {
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: ${T.surface};
          color: ${T.text};
        }
        .wishlist-sheet-btn--primary {
          border: 0;
          background: var(--app-button-bg);
          color: var(--app-button-text);
        }
        .wishlist-sheet-btn--primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .wishlist-remove-overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(28, 27, 25, 0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .wishlist-remove-modal {
          width: min(100%, 360px);
          border-radius: 24px;
          background: linear-gradient(180deg, color-mix(in srgb, ${T.surface} 97%, var(--brand-navy)) 0%, color-mix(in srgb, ${T.surface} 92%, transparent) 100%);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          box-shadow: 0 28px 60px color-mix(in srgb, var(--brand-navy) 26%, transparent);
          overflow: hidden;
          padding: 18px 18px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          animation: wishlistRemoveIn 0.18s ease-out;
        }
        .wishlist-remove-strip {
          width: 56px;
          height: 5px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--brand-red) 72%, white);
          margin-bottom: 14px;
        }
        .wishlist-remove-icon {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--brand-red);
          background: color-mix(in srgb, var(--brand-red) 12%, transparent);
          margin-bottom: 14px;
        }
        .wishlist-remove-title {
          margin: 0;
          color: ${T.text};
          font-size: 18px;
          font-weight: 800;
          line-height: 1.25;
        }
        .wishlist-remove-copy {
          margin: 8px 0 0;
          color: ${T.muted};
          font-size: 13px;
          line-height: 1.5;
        }
        .wishlist-remove-item {
          margin-top: 12px;
          padding: 10px 12px;
          width: 100%;
          border-radius: 16px;
          background: color-mix(in srgb, ${T.surface} 88%, transparent);
          border: 1px solid color-mix(in srgb, var(--brand-navy) 10%, transparent);
          color: ${T.text};
          font-size: 13px;
          font-weight: 700;
          line-height: 1.4;
        }
        .wishlist-remove-footer {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 16px;
        }
        .wishlist-remove-btn {
          min-height: 44px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
        }
        .wishlist-remove-btn:active {
          transform: scale(0.98);
        }
        .wishlist-remove-btn--ghost {
          border: 1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent);
          background: ${T.surface};
          color: ${T.text};
        }
        .wishlist-remove-btn--primary {
          border: 0;
          background: var(--brand-red);
          color: white;
        }
        .wishlist-remove-btn--primary:hover {
          background: ${T.clay};
        }
        @keyframes wishlistRemoveIn {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .wishlist-price {
          margin-top: 9px;
          display: flex;
          align-items: baseline;
          gap: 7px;
          flex-wrap: wrap;
          font-size: 13px;
          color: ${primaryColor};
          font-weight: 800;
        }
        .wishlist-mrp {
          color: ${T.muted};
          text-decoration: line-through;
          font-weight: 500;
        }
        .wishlist-discount {
          color: ${T.clay};
          font-size: 11px;
          font-weight: 800;
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
        .wishlist-actions {
          margin-top: 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
          align-items: stretch;
        }
        .wishlist-add {
          min-height: 44px;
          border: 0;
          border-radius: 14px;
          background: var(--app-button-bg);
          color: var(--app-button-text);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease;
          white-space: nowrap;
        }
        .wishlist-buy {
          min-height: 44px;
          border-radius: 14px;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, opacity 0.18s ease, background-color 0.18s ease;
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          background: ${T.surface};
          color: var(--brand-navy);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          white-space: nowrap;
        }
        .wishlist-add:active,
        .wishlist-buy:active {
          transform: scale(0.98);
        }
        .wishlist-add:disabled,
        .wishlist-buy:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .wishlist-qty-control {
          min-height: 42px;
          width: 100%;
          border-radius: 14px;
          overflow: hidden;
          background: ${T.surface};
          border: 1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent);
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) 42px;
        }
        .wishlist-qty-btn {
          border: 0;
          background: color-mix(in srgb, var(--brand-navy) 4%, ${T.surface});
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
        .wishlist-qty-btn:active {
          transform: scale(0.98);
        }
        .wishlist-qty-value {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          color: var(--brand-navy);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          user-select: none;
        }
        .wishlist-remove {
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
        }
        .wishlist-toast {
          position: fixed;
          left: 50%;
          bottom: max(18px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 40;
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
          animation: wishlistToastIn 0.18s ease-out;
        }
        @keyframes wishlistSheetIn {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes wishlistToastIn {
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

export default Wishlist;
