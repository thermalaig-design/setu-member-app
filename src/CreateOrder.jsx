import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  ChevronLeft,
  CreditCard,
  Home as HomeIcon,
  Mail,
  MapPinned,
  LocateFixed,
  PhoneCall,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { clearCartItems, getCartItemPricing, getCartSummary, readCartItems, subscribeCart } from './utils/productCart';
import { getNavbarThemeStyles } from './utils/themeUtils';

const ORDER_HISTORY_STORAGE_KEYS = ['order_history_v1', 'order_history', 'orders_v1'];

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

const resolveUserDisplayName = (user = {}) => {
  const directName = pickFirstText(
    user?.fullName,
    user?.full_name,
    user?.displayName,
    user?.display_name,
    user?.name,
    user?.Name,
    user?.member_name,
    user?.memberName,
    user?.profile?.name,
    user?.profile?.fullName
  );
  if (directName) return directName;

  const firstName = pickFirstText(user?.first_name, user?.firstName);
  const lastName = pickFirstText(user?.last_name, user?.lastName);
  return [firstName, lastName].filter(Boolean).join(' ');
};

const resolveLocationFromGeocode = (payload = {}) => {
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

const reverseGeocodeCoordinates = async (latitude, longitude) => {
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
      const location = resolveLocationFromGeocode(data);
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

const buildInitialForm = () => {
  const user = readLoggedInUser();

  return {
    fullName: resolveUserDisplayName(user),
    mobile: normalizeText(user?.Mobile || user?.mobile || user?.phone),
    email: normalizeText(user?.Email || user?.email || user?.email_id),
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

const readStoredOrderHistory = () => {
  if (typeof window === 'undefined') return [];

  for (const key of ORDER_HISTORY_STORAGE_KEYS) {
    const parsed = safeParse(window.localStorage.getItem(key) || '');
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.orders)
        ? parsed.orders
        : Array.isArray(parsed?.history)
          ? parsed.history
          : Array.isArray(parsed?.items)
            ? parsed.items
            : [];

    if (list.length > 0) {
      return list;
    }
  }

  return [];
};

const persistOrderHistory = (orders) => {
  if (typeof window === 'undefined') return [];

  const nextOrders = Array.isArray(orders) ? orders : [];
  try {
    window.localStorage.setItem(ORDER_HISTORY_STORAGE_KEYS[0], JSON.stringify(nextOrders));
  } catch {
    // Ignore storage failures so checkout can still continue locally.
  }
  return nextOrders;
};

const formatCurrency = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;

const buildOrderLineItems = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => {
    const pricing = getCartItemPricing(item);

    return {
      key: item?.key || `${item?.id || index}`,
      id: item?.id || '',
      product_name: normalizeText(item?.product_name || item?.alias_name) || `Product ${index + 1}`,
      quantity: pricing.quantity,
      price: pricing.unitBaseAmount,
      subtotal_amount: pricing.subtotal,
      tax_amount: pricing.taxAmount,
      delivery_amount: pricing.transportAmount,
      total_amount: pricing.totalAmount,
      selected_attributes: item?.selected_attributes || {},
      category_name: normalizeText(item?.category_name),
    };
  });

const buildOrderRecord = ({ form, items, summary, trustId, trustName }) => {
  const lineItems = buildOrderLineItems(items);
  const now = new Date().toISOString();
  const orderId = `ORD-${Date.now()}`;

  return {
    order_id: orderId,
    id: orderId,
    created_at: now,
    updated_at: now,
    status: 'placed',
    payment_status: 'paid',
    payment_method: form.paymentMethod,
    paymentMethod: form.paymentMethod,
    subtotal_amount: summary.subtotal,
    tax_amount: summary.taxAmount,
    delivery_amount: summary.transportAmount,
    total_amount: summary.totalAmount,
    grand_total: summary.totalAmount,
    amount: summary.totalAmount,
    item_count: summary.totalQuantity,
    items_count: summary.totalQuantity,
    trust_id: trustId,
    trust_name: trustName,
    customer_name: form.fullName,
    customer_mobile: form.mobile,
    customer_email: form.email,
    shipping_address: {
      line1: form.addressLine1,
      line2: form.addressLine2,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
    },
    device_location: form.locationLabel ? {
      label: form.locationLabel,
      latitude: form.latitude,
      longitude: form.longitude,
      accuracy: form.locationAccuracy,
    } : null,
    notes: form.notes,
    items: lineItems,
  };
};

function CreateOrder() {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  const [items, setItems] = useState(() => readCartItems());
  const [form, setForm] = useState(() => buildInitialForm());
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [isCapturingLocation, setIsCapturingLocation] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  useEffect(() => subscribeCart(setItems), []);

  useEffect(() => {
    if (!showSuccessPopup || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showSuccessPopup]);

  const summary = useMemo(() => getCartSummary(items), [items]);
  const trustId = normalizeText(items[0]?.trust_id || localStorage.getItem('selected_trust_id') || localStorage.getItem('last_selected_trust_id'));
  const trustName = normalizeText(localStorage.getItem('selected_trust_name')) || 'Selected trust';
  const hasDeliveryCharge = Number(summary.transportAmount || 0) > 0;
  const trustNameDisplay = titleCaseWords(trustName) || 'Selected Trust';
  const locationDisplayText = titleCaseWords(
    form.locationLabel || [form.city, form.state, form.pincode].filter(Boolean).join(' • ') || 'No location detected yet'
  );

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError('');
    if (locationStatus && ['locationLabel', 'city', 'state', 'pincode'].includes(field)) {
      setLocationStatus('');
    }
  };

  const handleUseCurrentLocation = async () => {
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
          const location = await reverseGeocodeCoordinates(latitude, longitude);
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

  const handlePayNow = (event) => {
    event.preventDefault();

    setIsSubmitting(true);
    setError('');

    try {
      const order = buildOrderRecord({
        form: {
          ...form,
          fullName: normalizeText(form.fullName),
          mobile: normalizeText(form.mobile),
          email: normalizeText(form.email),
          addressLine1: normalizeText(form.addressLine1),
          addressLine2: normalizeText(form.addressLine2),
          city: normalizeText(form.city),
          state: normalizeText(form.state),
          pincode: normalizeText(form.pincode),
          paymentMethod: normalizeText(form.paymentMethod) || 'UPI',
          notes: normalizeText(form.notes),
        },
        items,
        summary,
        trustId,
        trustName,
      });

      const nextOrders = [order, ...readStoredOrderHistory().filter((entry) => entry?.order_id !== order.order_id)];
      persistOrderHistory(nextOrders);
      try {
        clearCartItems(trustId);
      } catch {
        // Ignore cart cleanup issues and continue to the shop page.
      }
      setShowSuccessPopup(true);
    } catch (err) {
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

  const successPopup = showSuccessPopup && typeof document !== 'undefined'
    ? createPortal(
      <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
        <div
          className="w-full max-w-md rounded-[30px] border p-6 text-center shadow-2xl"
          style={{
            background: 'color-mix(in srgb, var(--surface-color) 98%, var(--page-bg))',
            borderColor: applyOpacity(theme.primary, 0.12),
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-success-title"
        >
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl"
            style={{
              background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.75)}, ${theme.accentBg})`,
            }}
          >
            <BadgeCheck className="h-7 w-7" style={{ color: '#fff' }} />
          </div>
          <h2 id="order-success-title" className="mt-5 text-2xl font-extrabold" style={{ color: 'var(--heading-color)' }}>
            Your order is created successfully
          </h2>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--body-text-color)' }}>
            Thank You for shopping from us.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowSuccessPopup(false);
              navigate('/categories-products', { replace: true });
            }}
            className="mt-6 min-h-[50px] w-full rounded-2xl px-4 text-sm font-extrabold transition-transform active:scale-[0.99]"
            style={{
              background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.85)}, ${theme.accentBg})`,
              color: '#fff',
            }}
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
              onClick={() => navigate('/')}
              aria-label="Go home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <section className="px-4 pt-4">
        {items.length === 0 ? (
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
            <div className="rounded-[30px] p-5 sm:p-6" style={orderCardStyle}>
              <div className="flex items-start gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px]"
                  style={{
                    background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.78)}, ${theme.accentBg})`,
                  }}
                >
                  <ShoppingBag className="h-6 w-6" style={{ color: '#fff' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.28em]" style={{ color: theme.primary }}>
                    Secure Checkout
                  </p>
                  <h2 className="mt-1 text-2xl font-extrabold leading-tight" style={{ color: 'var(--surface-color)' }}>
                    Create Your Order
                  </h2>
                  <p className="mt-2 text-sm leading-6" style={{ color: T.muted }}>
                    Review Your Items, Enter Delivery Details, And Pay Only When Everything Looks Right.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className="rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                    color: theme.primary,
                  }}
                >
                  {summary.totalQuantity} item{summary.totalQuantity === 1 ? '' : 's'}
                </span>
                <span
                  className="rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                    color: theme.primary,
                  }}
                >
                  Total {formatCurrency(summary.totalAmount)}
                </span>
                <span
                  className="rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                    color: theme.primary,
                  }}
                >
                  {trustNameDisplay}
                </span>
              </div>
            </div>

            <form onSubmit={handlePayNow} className="space-y-4">
              <div className="rounded-[30px] p-5 sm:p-6" style={orderCardStyle}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                      Customer Details
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                      Enter Your Details
                    </h2>
                  </div>
                  <div
                    className="rounded-2xl px-3 py-2 text-xs font-bold"
                    style={{
                      background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))`,
                      color: theme.primary,
                    }}
                  >
                    {trustNameDisplay}
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Full Name
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))' }}>
                      <UserRound className="h-4 w-4 shrink-0" style={{ color: theme.primary }} />
                      <input
                        value={form.fullName}
                        onChange={updateField('fullName')}
                        className="w-full border-0 bg-transparent p-0 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ color: 'var(--surface-color)' }}
                        placeholder="Your Name"
                        autoComplete="name"
                      />
                    </div>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Mobile Number
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))' }}>
                      <PhoneCall className="h-4 w-4 shrink-0" style={{ color: theme.primary }} />
                      <input
                        value={form.mobile}
                        onChange={updateField('mobile')}
                        className="w-full border-0 bg-transparent p-0 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ color: 'var(--surface-color)' }}
                        placeholder="10-Digit Mobile"
                        autoComplete="tel"
                        inputMode="tel"
                      />
                    </div>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Email Address
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))' }}>
                      <Mail className="h-4 w-4 shrink-0" style={{ color: theme.primary }} />
                      <input
                        value={form.email}
                        onChange={updateField('email')}
                        className="w-full border-0 bg-transparent p-0 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ color: 'var(--surface-color)' }}
                        placeholder="Your Email"
                        autoComplete="email"
                        inputMode="email"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-[30px] p-5 sm:p-6" style={orderCardStyle}>
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))` }}>
                    <MapPinned className="h-5 w-5" style={{ color: theme.primary }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                      Delivery Address
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                      Where Should We Deliver?
                    </h2>
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Address Line 1
                    </span>
                    <input
                      value={form.addressLine1}
                      onChange={updateField('addressLine1')}
                      className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                      style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                      placeholder="House Number, Street"
                      autoComplete="street-address"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Address Line 2
                    </span>
                    <input
                      value={form.addressLine2}
                      onChange={updateField('addressLine2')}
                      className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                      style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                      placeholder="Apartment, Landmark, Etc. (Optional)"
                    />
                  </label>

                  <div className="grid gap-4">
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold" style={{ color: T.muted }}>
                        City
                      </span>
                      <input
                        value={form.city}
                        onChange={updateField('city')}
                        className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                        placeholder="City"
                        autoComplete="address-level2"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-sm font-semibold" style={{ color: T.muted }}>
                        State
                      </span>
                      <input
                        value={form.state}
                        onChange={updateField('state')}
                        className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                        placeholder="State"
                        autoComplete="address-level1"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-sm font-semibold" style={{ color: T.muted }}>
                        Pincode
                      </span>
                      <input
                        value={form.pincode}
                        onChange={updateField('pincode')}
                        className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                        style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                        placeholder="Postal Code"
                        inputMode="numeric"
                        autoComplete="postal-code"
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl p-4 capitalize" style={{ background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))' }}>
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: T.muted }}>
                          Device location
                        </p>
                        <p className="mt-1 text-xs leading-5" style={{ color: T.muted }}>
                          Use your device location to autofill city, state, and postal code.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleUseCurrentLocation}
                        disabled={isCapturingLocation}
                        className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                        style={{
                          background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.85)}, ${theme.accentBg})`,
                          color: '#fff',
                        }}
                      >
                        <LocateFixed className="h-4 w-4" />
                        {isCapturingLocation ? 'Getting location...' : 'Use current location'}
                      </button>
                    </div>

                    <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 95%, var(--page-bg))' }}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: theme.primary }}>
                        Detected area
                      </p>
                      <p className="mt-1 text-sm font-semibold leading-6" style={{ color: 'var(--surface-color)' }}>
                        {locationDisplayText}
                      </p>
                      {locationStatus ? (
                        <p className="mt-2 text-[11px] font-semibold leading-5" style={{ color: T.muted }}>
                          {locationStatus}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] p-5 sm:p-6 capitalize" style={orderCardStyle}>
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: `color-mix(in srgb, ${theme.primary} 10%, var(--surface-color))` }}>
                    <CreditCard className="h-5 w-5" style={{ color: theme.primary }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                      Payment
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                      Choose how you want to pay
                    </h2>
                  </div>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Payment method
                    </span>
                    <select
                      value={form.paymentMethod}
                      onChange={updateField('paymentMethod')}
                      className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none"
                      style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                    >
                      <option value="UPI">UPI</option>
                      <option value="Card">Card</option>
                      <option value="Net banking">Net banking</option>
                    </select>
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-semibold" style={{ color: T.muted }}>
                      Order notes
                    </span>
                    <textarea
                      value={form.notes}
                      onChange={updateField('notes')}
                      rows={4}
                      className="rounded-2xl border px-4 py-3 text-sm font-semibold outline-none placeholder:font-medium"
                      style={{ borderColor: T.line, background: 'color-mix(in srgb, var(--surface-color) 88%, var(--page-bg))', color: 'var(--surface-color)' }}
                      placeholder="Any delivery instructions or notes"
                    />
                  </label>
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
                    <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
                      Order summary
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold" style={{ color: 'var(--surface-color)' }}>
                      Review your order
                    </h2>
                  </div>
                </div>

                <div className="space-y-3">
                  {items.map((item) => {
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
                    disabled={isSubmitting || items.length === 0}
                    className="min-h-[50px] rounded-2xl px-4 text-sm font-extrabold transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.85)}, ${theme.accentBg})`,
                      color: '#fff',
                    }}
                  >
                    {isSubmitting ? 'Processing...' : 'Pay now'}
                  </button>
                </div>

                <p className="mt-3 text-center text-[11px] leading-5" style={{ color: T.muted }}>
                  By tapping Pay now, you confirm the order details and payment method above.
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
