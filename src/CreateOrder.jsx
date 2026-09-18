import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  ChevronLeft,
  Home as HomeIcon,
  Mail,
  PhoneCall,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getProfile } from './services/api';
import { resolveOrderHistoryMemberId } from './services/orderHistoryService';
import { openRazorpayCheckout } from './services/paymentService';
import { supabase } from './services/supabaseClient';
import { applyOpacity } from './utils/colorUtils';
import { clearCartItems, getCartItemPricing, getCartSummary, readCartItems, refreshCartCache, subscribeCart } from './utils/productCart';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { getAppHomePath } from './utils/tenantNavigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const T = {
  page: 'var(--page-bg, var(--app-page-bg))',
  surface: 'var(--surface-color)',
  text: 'var(--surface-color)',
  muted: 'color-mix(in srgb, var(--surface-color) 64%, var(--surface-color))',
  line: 'color-mix(in srgb, var(--surface-color) 12%, transparent)',
};

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
};

const titleCaseWords = (value) => {
  const text = normalizeText(value);
  if (!text) return '';

  return text.replace(/\S+/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
};

const _resolveLocationFromGeocode = (payload = {}) => {
  const address = payload?.address && typeof payload.address === 'object' ? payload.address : payload;

  const city = pickFirstText(
    payload?.city,
    payload?.town,
    payload?.village,
    payload?.locality,
    payload?.principalSubdivision,
    address?.city,
    address?.town,
    address?.village,
    address?.locality,
    address?.suburb,
    address?.hamlet
  );

  const state = pickFirstText(
    payload?.principalSubdivision,
    payload?.state,
    address?.state,
    address?.state_district,
    address?.region,
    address?.province
  );

  const pincode = pickFirstText(
    payload?.postcode,
    payload?.postalCode,
    address?.postcode,
    address?.postalCode,
    address?.zip,
    address?.zipcode
  );

  const locationLabel = pickFirstText(
    payload?.localityDisplayName,
    payload?.locationLabel,
    [city, state].filter(Boolean).join(', '),
    [city, state, pincode].filter(Boolean).join(' • '),
    pincode
  );

  return {
    city,
    state,
    pincode,
    locationLabel,
  };
};

const _reverseGeocodeCoordinates = async (latitude, longitude) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const endpoints = [
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: endpoint.includes('nominatim')
          ? { Accept: 'application/json' }
          : undefined,
      });

      if (!response.ok) continue;

      const data = await response.json();
      const location = _resolveLocationFromGeocode(data);
      if (location.city || location.state || location.pincode || location.locationLabel) {
        return location;
      }
    } catch {
      // Try the next geocoding source before giving up.
    }
  }

  return null;
};

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readLoggedInUser = () => {
  if (typeof window === 'undefined') return {};
  const parsed = safeParse(window.localStorage.getItem('user') || '');
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const readCachedProfileSnapshot = (user = {}) => {
  if (typeof window === 'undefined') return {};
  const userId = String(user?.Mobile || user?.mobile || user?.id || 'default').trim() || 'default';
  const parsed = safeParse(window.localStorage.getItem(`userProfile_${userId}`) || '');
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const buildInitialForm = () => {
  return {
    fullName: '',
    mobile: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    locationLabel: '',
    paymentMethod: 'UPI',
    notes: '',
  };
};

const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;

const normalizeRpcValue = (value) => {
  return normalizeText(value);
};

const resolvePurchaseProductPriceId = (item = {}) => normalizeRpcValue(
  item?.price?.id
  || item?.price?.product_price_id
  || item?.price?.price_id
  || item?.product_price_id
  || item?.productPriceId
);

const buildPurchaseRequests = (items = [], memberId, trustId, status = 'order_payment_pending') => {
  const normalizedItems = Array.isArray(items) ? items : [];

  return normalizedItems.map((item, index) => {
    const productName = normalizeText(item?.product_name || item?.alias_name) || `Item ${index + 1}`;
    const productPriceId = resolvePurchaseProductPriceId(item);
    const purchaseId = normalizeText(item?.purchase_id || item?.purchaseId);

    const pricing = getCartItemPricing(item);
    const quantity = Number(pricing.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for ${productName}.`);
    }

    const unitPrice = Number(
      pricing.unitBaseAmount
      || pricing.unitTotalAmount
      || item?.price?.price_after_discount
      || item?.price?.total_payable
      || item?.price?.member_price
      || item?.price?.selling_price
      || item?.price?.mrp
      || 0
    );

    if (purchaseId) {
      return {
        p_member_id: memberId,
        p_trust_id: trustId,
        p_action: 'upsert_purchase',
        p_payload: {
          id: purchaseId,
          type: 'order',
          quantity,
          unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
          status,
          selected_attributes: item?.selected_attributes || {},
        },
      };
    }

    if (!productPriceId) {
      throw new Error(`Missing product price ID for ${productName}.`);
    }

    return {
      p_member_id: memberId,
      p_trust_id: trustId,
      p_action: 'upsert_purchase',
      p_payload: {
        product_price_id: productPriceId,
        type: 'order',
        quantity,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
        status,
        selected_attributes: item?.selected_attributes || {},
      },
    };
  });
};

function CreateOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const checkoutTrustIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeText(params.get('trustId'));
  }, [location.search]);

  const [items, setItems] = useState(() => readCartItems(checkoutTrustIdFromUrl || undefined));
  const [form, setForm] = useState(() => buildInitialForm());
  const [customerInfo, setCustomerInfo] = useState(() => ({
    fullName: '',
    mobile: '',
    email: '',
  }));
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCartLoading, setIsCartLoading] = useState(true);
  const [isCustomerDetailsLoading, setIsCustomerDetailsLoading] = useState(true);
  const [selectedTrustPaymentGateway, setSelectedTrustPaymentGateway] = useState(false);
  const [isTrustSettingsLoading, setIsTrustSettingsLoading] = useState(true);
  const [_locationStatus, setLocationStatus] = useState('');
  const [_isCapturingLocation, setIsCapturingLocation] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const trustId = normalizeText(
    checkoutTrustIdFromUrl
    || items[0]?.trust_id
    || localStorage.getItem('selected_trust_id')
    || localStorage.getItem('last_selected_trust_id')
  );
  const trustName = normalizeText(localStorage.getItem('selected_trust_name')) || 'Selected trust';

  useEffect(() => {
    const scopedTrustId = trustId || undefined;
    return subscribeCart(setItems, scopedTrustId);
  }, [trustId]);

  useEffect(() => {
    let active = true;
    const scopedTrustId = trustId || undefined;

    const loadCheckoutCart = async () => {
      setIsCartLoading(true);

      try {
        const refreshedItems = await refreshCartCache(scopedTrustId);
        if (active) {
          setItems(refreshedItems);
        }
      } catch (cartError) {
        if (active) {
          setItems(readCartItems(scopedTrustId));
          setError((current) => current || cartError?.message || 'Unable to refresh your cart right now.');
        }
      } finally {
        if (active) {
          setIsCartLoading(false);
        }
      }
    };

    void loadCheckoutCart();

    return () => {
      active = false;
    };
  }, [trustId]);

  useEffect(() => {
    if (!showSuccessPopup || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showSuccessPopup]);

  useEffect(() => {
    let active = true;

    const loadCustomerInfo = async () => {
      setIsCustomerDetailsLoading(true);
      try {
        const storedUser = readLoggedInUser();
        const cachedProfile = readCachedProfileSnapshot(storedUser);
        const response = await getProfile();
        if (!active) return;

        const source = response?.profile || response?.data || response || {};
        const nextCustomerInfo = {
          fullName: normalizeText(
            source?.name
            || source?.Name
            || source?.fullName
            || source?.customer_name
            || cachedProfile?.name
            || cachedProfile?.Name
            || cachedProfile?.fullName
            || storedUser?.Name
            || storedUser?.name
            || storedUser?.full_name
          ),
          mobile: normalizeText(
            source?.mobile
            || source?.Mobile
            || source?.customer_mobile
            || cachedProfile?.mobile
            || cachedProfile?.Mobile
            || storedUser?.Mobile
            || storedUser?.mobile
          ),
          email: normalizeText(
            source?.email
            || source?.Email
            || source?.customer_email
            || cachedProfile?.email
            || cachedProfile?.Email
            || storedUser?.Email
            || storedUser?.email
          ),
        };

        setCustomerInfo(nextCustomerInfo);
        setForm((prev) => ({
          ...prev,
          fullName: nextCustomerInfo.fullName,
          mobile: nextCustomerInfo.mobile,
          email: nextCustomerInfo.email,
        }));

      } catch {
        if (!active) return;
      } finally {
        if (active) {
          setIsCustomerDetailsLoading(false);
        }
      }
    };

    void loadCustomerInfo();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadTrustSettings = async () => {
      setIsTrustSettingsLoading(true);

      try {
        if (!trustId) {
          if (!active) return;
          setSelectedTrustPaymentGateway(false);
          return;
        }

        const { data, error: trustError } = await supabase
          .from('Trust')
          .select('id, payment_gateway')
          .eq('id', trustId)
          .maybeSingle();

        if (trustError) throw trustError;
        if (!active) return;

        setSelectedTrustPaymentGateway(Boolean(data?.payment_gateway));
      } catch {
        if (!active) return;
        setSelectedTrustPaymentGateway(false);
      } finally {
        if (active) {
          setIsTrustSettingsLoading(false);
        }
      }
    };

    void loadTrustSettings();

    return () => {
      active = false;
    };
  }, [trustId]);

  const summary = useMemo(() => getCartSummary(items), [items]);
  const hasDeliveryCharge = Number(summary.transportAmount || 0) > 0;
  const _locationDisplayText = titleCaseWords(
    form.locationLabel || [form.city, form.state, form.pincode].filter(Boolean).join(' • ') || 'No location detected yet'
  );

  const _handleUseCurrentLocation = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationStatus('Location Services Are Not Available In This Browser.');
      return;
    }

    setIsCapturingLocation(true);
    setLocationStatus('Fetching Device Location...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = Number(position?.coords?.latitude ?? 0);
        const longitude = Number(position?.coords?.longitude ?? 0);
        try {
          setLocationStatus('Resolving Address From Your Location...');
          const location = await _reverseGeocodeCoordinates(latitude, longitude);
          const locationLabel = location?.locationLabel || '';

          setForm((prev) => ({
            ...prev,
            city: location?.city || prev.city,
            state: location?.state || prev.state,
            pincode: location?.pincode || prev.pincode,
            locationLabel,
          }));

          setLocationStatus(
            locationLabel
              ? `Detected ${locationLabel}${location?.pincode ? ` (${location.pincode})` : ''}.`
              : 'Device Location Captured. Please Fill City, State, And Pincode Manually.'
          );
        } catch (err) {
          setLocationStatus(err?.message || 'Unable To Resolve Address From Your Location.');
        } finally {
          setIsCapturingLocation(false);
        }
      },
      (geoError) => {
        setLocationStatus(geoError?.message || 'Unable To Capture Device Location.');
        setIsCapturingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  const handlePayNow = async (event) => {
    event.preventDefault();

    setIsSubmitting(true);
    setError('');

    try {
      if (isTrustSettingsLoading) {
        setError('Loading selected trust payment settings. Please try again in a moment.');
        return;
      }

      if (!Array.isArray(items) || items.length === 0) {
        setError('Your cart is empty. Please add items before paying.');
        return;
      }

      if (!trustId || !isUuid(trustId)) {
        setError('Selected trust is missing or invalid. Please reopen the checkout and try again.');
        return;
      }

      const storedUser = readLoggedInUser();
      const memberId = resolveOrderHistoryMemberId(storedUser);
      if (!memberId || !isUuid(memberId)) {
        setError('Could not find your member profile ID. Please sign in again and retry.');
        return;
      }

      const runPurchaseRequests = async (status) => {
        const purchaseRequests = buildPurchaseRequests(items, memberId, trustId, status);
        for (const request of purchaseRequests) {
          const { data, error: rpcError } = await supabase.rpc('manage_purchase_by_member', request);
          if (rpcError) throw rpcError;

          if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
            throw new Error(normalizeText(data.message) || 'Unable to save your purchase right now.');
          }
        }
      };

      if (selectedTrustPaymentGateway === true) {
        // Convert the cart rows into a pending order before Razorpay opens, so a
        // dropped/closed checkout still leaves a traceable pending order in the DB.
        await runPurchaseRequests('order_payment_pending');

        try {
          await openRazorpayCheckout({
            amountInRupees: summary.totalAmount,
            receipt: `order_${trustId}_${Date.now()}`,
            name: trustName,
            description: `Order payment for ${trustName}`,
            prefill: {
              name: customerInfo.fullName || form.fullName,
              email: customerInfo.email || form.email,
              contact: customerInfo.mobile || form.mobile,
            },
            notes: { trust_id: trustId, member_id: memberId },
          });
        } catch (paymentError) {
          setError(paymentError?.message || 'Payment was not completed. Please try again.');
          return;
        }

        await runPurchaseRequests('order_payment_done');
      } else {
        await runPurchaseRequests('order_payment_pending');
      }

      try {
        await clearCartItems(trustId, { sync: false });
      } catch {
        // Ignore cart cleanup issues and continue to the success modal.
      }

      setShowSuccessPopup(true);
    } catch (err) {
      console.error('Checkout purchase save failed:', err);
      setError(err?.message || 'Unable to place your order right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const orderCardStyle = {
    background: `linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 96%, transparent), color-mix(in srgb, var(--surface-color) 92%, var(--page-bg)))`,
    border: `1px solid ${applyOpacity(theme.primary, 0.08)}`,
    boxShadow: `0 18px 44px ${applyOpacity('#000', 0.08)}`,
  };

  const successOverlayStyle = {
    background: applyOpacity(theme.secondary, 0.78),
  };

  const successCardStyle = {
    background: 'var(--surface-color)',
    borderColor: applyOpacity(theme.primary, 0.18),
    boxShadow: `0 30px 90px ${applyOpacity(theme.secondary, 0.28)}`,
  };

  const successBadgeStyle = {
    background: `linear-gradient(135deg, ${applyOpacity(theme.primary, 0.92)}, ${applyOpacity(theme.secondary, 0.92)})`,
  };

  const successButtonStyle = {
    background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
    color: 'var(--surface-color)',
  };

  const skeletonLineStyle = {
    backgroundColor: applyOpacity(theme.primary, 0.12),
  };

  const skeletonLineStrongStyle = {
    backgroundColor: applyOpacity(theme.primary, 0.18),
  };

  const isCheckoutDataLoading = isCartLoading || isCustomerDetailsLoading || isTrustSettingsLoading;

  const successPopup = showSuccessPopup && typeof document !== 'undefined'
    ? createPortal(
      <div className="fixed inset-0 z-[2147483647] flex items-center justify-center px-4 py-6 backdrop-blur-sm" style={successOverlayStyle}>
        <div
          className="w-full max-w-md rounded-[30px] border p-6 sm:p-7 text-center"
          style={{
            ...successCardStyle,
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-success-title"
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl"
                style={successBadgeStyle}
              >
                <BadgeCheck className="h-7 w-7" style={{ color: theme.accent }} />
              </div>
              <div className="min-w-0">
                <h2 id="order-success-title" className="mt-1 text-2xl font-extrabold leading-tight" style={{ color: theme.secondary }}>
                  {trustName}
                </h2>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                  Order confirmed
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 h-px w-full" style={{ background: T.line }} />

          <p className="mt-4 text-sm leading-6" style={{ color: theme.secondary }}>
            Thank You for shopping from us.
            <br />
            {trustName} team will contact you within 24 hours.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowSuccessPopup(false);
              navigate('/categories-products', { replace: true });
            }}
            className="mt-6 min-h-[50px] w-full rounded-2xl px-4 text-sm font-extrabold transition-transform active:scale-[0.99]"
            style={successButtonStyle}
          >
            Continue shopping
          </button>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <>
      {successPopup}
      <main
        className="min-h-screen pb-8"
        style={{
          background: T.page,
          color: T.text,
        }}
      >
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
                Create Order
              </h1>
            </div>
            <button
              type="button"
              className="p-2 rounded-xl transition-colors"
              style={{
                color: navbarTextColor,
                background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
              }}
              onClick={() => navigate(getAppHomePath())}
              aria-label="Go home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <section className="px-4 pt-4">
        {isCartLoading && items.length === 0 ? (
          <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center capitalize">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.65)}, ${theme.accentBg})` }}>
              <ShoppingBag className="h-7 w-7" style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                Loading your cart
              </p>
              <p className="mt-2 text-sm leading-6" style={{ color: T.muted }}>
                Syncing the latest items before checkout.
              </p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center capitalize">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.65)}, ${theme.accentBg})` }}>
              <ShoppingBag className="h-7 w-7" style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                Your cart is empty
              </p>
              <p className="mt-2 text-sm leading-6" style={{ color: T.muted }}>
                Add products first, then come back here to enter your details and pay.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/cart')}
              className="min-h-[46px] rounded-2xl px-5 text-sm font-extrabold transition-transform active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.85)}, ${theme.accentBg})`,
                color: '#fff',
              }}
            >
              Go to cart
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            <form id="create-order-form" onSubmit={handlePayNow} className="space-y-4">
              <div className="rounded-[30px] p-5 sm:p-6" style={orderCardStyle}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                      Customer Details
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                      Your profile details
                    </h2>
                  </div>
                  <div
                    className="rounded-2xl px-3 py-2 text-xs font-bold"
                    style={{
                      background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                      color: theme.primary,
                    }}
                  >
                    {isTrustSettingsLoading ? (
                      <span
                        className="block h-3.5 w-24 rounded-full animate-pulse"
                        style={skeletonLineStyle}
                        aria-hidden="true"
                      />
                    ) : (
                      trustName
                    )}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div
                    className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                    style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))' }}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))` }}>
                      <UserRound className="h-4 w-4" style={{ color: theme.primary }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      {isCustomerDetailsLoading ? (
                        <div className="space-y-2.5" aria-hidden="true">
                          <span className="block h-4 w-3/4 rounded-full animate-pulse" style={skeletonLineStyle} />
                          <span className="block h-4 w-1/2 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                          <span className="block h-4 w-2/3 rounded-full animate-pulse" style={skeletonLineStyle} />
                        </div>
                      ) : (
                        <p className="mt-0.5 truncate text-sm font-semibold" style={{ color: 'var(--surface-color)' }}>
                          {customerInfo.fullName || 'Not available'}<br/>
                          {customerInfo.mobile || 'Not available'}<br/>
                          {customerInfo.email || null}
                        </p>
                      )}
                    </div>
                  </div>

                  
                </div>

              </div>

            </form>

            <aside className="space-y-4">
              <div className="rounded-[30px] p-5 sm:p-6 capitalize" style={orderCardStyle}>
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))` }}>
                    <ShoppingBag className="h-5 w-5" style={{ color: theme.primary }} />
                  </div>
                  <div>
                    {isCheckoutDataLoading ? (
                      <div className="space-y-2" aria-hidden="true">
                        <span className="block h-3 w-24 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="block h-6 w-40 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                          Order summary
                        </p>
                        <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                          Review your order
                        </h2>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {isCheckoutDataLoading ? items.map((item, index) => (
                    <div
                      key={item.key || item.id || `summary-skeleton-${index}`}
                      className="rounded-2xl p-4"
                      style={{ background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', border: `1px solid ${T.line}` }}
                      aria-hidden="true"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <span className="block h-4 w-3/4 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                          <span className="block h-3 w-1/2 rounded-full animate-pulse" style={skeletonLineStyle} />
                        </div>
                        <div className="text-right space-y-2">
                          <span className="block h-3 w-12 rounded-full animate-pulse ml-auto" style={skeletonLineStyle} />
                          <span className="block h-4 w-16 rounded-full animate-pulse ml-auto" style={skeletonLineStrongStyle} />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="h-6 w-16 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="h-6 w-24 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                    </div>
                  )) : items.map((item) => {
                    const pricing = getCartItemPricing(item);
                    const attributeEntries = Object.entries(item.selected_attributes || {}).filter(([, value]) => normalizeText(value));

                    return (
                      <div
                        key={item.key || item.id}
                        className="rounded-2xl p-4"
                        style={{ background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', border: `1px solid ${T.line}` }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-extrabold" style={{ color: 'var(--surface-color)' }}>
                              {item.product_name}
                            </p>
                            {item.category_name ? (
                              <p className="mt-0.5 text-[11px] font-medium" style={{ color: T.muted }}>
                                {item.category_name}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
                              Qty {pricing.quantity}
                            </p>
                            <p className="mt-1 text-sm font-extrabold" style={{ color: 'var(--surface-color)' }}>
                              {formatCurrency(pricing.totalAmount)}
                            </p>
                          </div>
                        </div>

                        {attributeEntries.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {attributeEntries.map(([label, value]) => (
                              <span
                                key={`${item.key || item.id}:${label}`}
                                className="rounded-full px-3 py-1 text-[11px] font-semibold"
                                style={{
                                  background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                                  color: theme.primary,
                                }}
                              >
                                {label}: {value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 border-t pt-4" style={{ borderColor: T.line }}>
                  {isCheckoutDataLoading ? (
                    <div className="space-y-2.5" aria-hidden="true">
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="block h-4 w-20 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="block h-4 w-6 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="block h-4 w-24 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="block h-4 w-6 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="block h-4 w-16 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="block h-4 w-16 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="block h-4 w-12 rounded-full animate-pulse" style={skeletonLineStyle} />
                        <span className="block h-4 w-12 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                      {hasDeliveryCharge ? (
                        <div className="flex items-center justify-between gap-3 py-1">
                          <span className="block h-4 w-14 rounded-full animate-pulse" style={skeletonLineStyle} />
                          <span className="block h-4 w-10 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: T.line }}>
                        <span className="block h-5 w-24 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                        <span className="block h-6 w-20 rounded-full animate-pulse" style={skeletonLineStrongStyle} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: T.muted }}>
                        <span>Products</span>
                        <strong style={{ color: 'var(--surface-color)' }}>{summary.distinctItems}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: T.muted }}>
                        <span>Total quantity</span>
                        <strong style={{ color: 'var(--surface-color)' }}>{summary.totalQuantity}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: T.muted }}>
                        <span>Subtotal</span>
                        <strong style={{ color: 'var(--surface-color)' }}>{formatCurrency(summary.subtotal)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: T.muted }}>
                        <span>Taxes</span>
                        <strong style={{ color: 'var(--surface-color)' }}>{formatCurrency(summary.taxAmount)}</strong>
                      </div>
                      {hasDeliveryCharge ? (
                        <div className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: T.muted }}>
                          <span>Delivery</span>
                          <strong style={{ color: 'var(--surface-color)' }}>{formatCurrency(summary.transportAmount)}</strong>
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: T.line }}>
                        <span className="text-sm font-semibold" style={{ color: T.muted }}>
                          Grand total
                        </span>
                        <strong className="text-lg" style={{ color: 'var(--surface-color)' }}>
                          {formatCurrency(summary.totalAmount)}
                        </strong>
                      </div>
                    </>
                  )}
                </div>

                {error ? (
                  <div
                    className="mt-4 rounded-2xl px-4 py-3 text-sm font-semibold"
                    style={{
                      background: applyOpacity('#ef4444', 0.08),
                      color: '#b91c1c',
                    }}
                  >
                    {error}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3">
                  <button
                    type="button"
                    onClick={() => navigate('/cart')}
                    className="min-h-[50px] rounded-2xl border px-4 text-sm font-extrabold transition-transform active:scale-[0.99]"
                    style={{
                      background: T.surface,
                      borderColor: applyOpacity(theme.primary, 0.18),
                      color: 'var(--brand-navy)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="create-order-form"
                    className="min-h-[50px] rounded-2xl px-4 text-sm font-extrabold transition-transform active:scale-[0.99]"
                    style={{
                      background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.85)}, ${theme.accentBg})`,
                      color: '#fff',
                    }}
                  >
                    {isTrustSettingsLoading
                      ? 'Loading trust settings...'
                      : isCustomerDetailsLoading
                        ? 'Loading profile...'
                        : isSubmitting
                          ? 'Processing...'
                          : 'Pay now'}
                  </button>
                </div>

                <p className="mt-3 text-center text-[11px] leading-5" style={{ color: T.muted }}>
                  By tapping Pay now, you confirm the order details above.
                </p>
              </div>
            </aside>
          </div>
        )}
      </section>
      </main>
    </>
  );
}

export default CreateOrder;
