// First-level path segments already used by existing app routes in App.jsx,
// plus common static/infra paths. A first-level URL segment matching one of
// these must NEVER be treated as a Trust app_slug for the white-label flow.
export const RESERVED_APP_ROUTES = [
  'login',
  'vip-login',
  'profile',
  'directory',
  'healthcare-trustee-directory',
  'appointment',
  'reports',
  'reference',
  'notices',
  'facilities',
  'events',
  'achievements',
  'donation',
  'donation-form',
  'categories-products',
  'categoriesproducts',
  'wishlist',
  'cart',
  'create-order',
  'order-history',
  'executive-body',
  'notifications',
  'executive_members_details',
  'committee-members',
  'sponsor-details',
  'sponsors',
  'developers',
  'gallery',
  'contact-us',
  'my-family',
  'nomination-details',
  'add-community',
  'trust-id-card',
  'admin-profiles',
  'other-memberships',
  'otp-verification',
  'special-otp-verification',
  'terms-and-conditions',
  'privacy-policy',
  // Common static/infra paths that must never resolve as a Trust slug.
  'assets',
  'static',
  'api',
  'manifest.json',
  'favicon.ico',
  'sw.js',
  'service-worker.js',
  'robots.txt',
  'index.html',
];

const RESERVED_APP_ROUTES_SET = new Set(RESERVED_APP_ROUTES.map((route) => route.toLowerCase()));

export const isReservedSlug = (slug) => {
  const normalized = String(slug || '').trim().toLowerCase();
  if (!normalized) return true;
  return RESERVED_APP_ROUTES_SET.has(normalized);
};
