// Resolves where "go to app Home" should actually land.
//
// A white-label tenant PWA is installed from /app/<slug> (see
// TenantLanding.jsx / TenantContext.jsx) and keeps running from that same
// origin. On this host, bare '/' belongs to the separate marketing website,
// not the member app — so once installed, any in-app "Home" action must
// return to /app/<slug> instead of '/', or the installed PWA will appear to
// open the marketing site. In a normal (non-standalone) browser tab, Home is
// unaffected and still resolves to '/'.
//
// Which slug is THIS window's, though, cannot come from localStorage:
// every tenant PWA on this origin shares it, so opening another tenant's
// link in Chrome overwrites `installed_app_slug` and every later "Home"
// tap inside an already-open tenant app would jump to that other tenant.
// sessionStorage is per browsing context — each installed PWA window (and
// each browser tab) gets its own — so the slug this window actually
// launched with is remembered there instead.
const INSTALLED_SLUG_KEY = 'installed_app_slug';
const WINDOW_SLUG_KEY = 'active_app_slug';
const SLUG_PATTERN = /^[a-z0-9-]+$/;

const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  return Boolean(mql?.matches) || window.navigator?.standalone === true;
};

const sanitizeSlug = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || !SLUG_PATTERN.test(normalized)) return '';
  return normalized;
};

// Records the slug this browsing context belongs to. Called by
// TenantContext whenever the URL resolves a tenant, and opportunistically
// below whenever the current URL still carries it.
export const rememberWindowTenantSlug = (value) => {
  const slug = sanitizeSlug(value);
  if (!slug) return '';
  try {
    window.sessionStorage.setItem(WINDOW_SLUG_KEY, slug);
  } catch {
    // ignore storage failures
  }
  return slug;
};

const readWindowTenantSlug = () => {
  try {
    return sanitizeSlug(window.sessionStorage.getItem(WINDOW_SLUG_KEY));
  } catch {
    return '';
  }
};

// A standalone PWA always launches at its own start_url (/app/<slug>/), so
// the URL is authoritative whenever it still carries the slug — in-app SPA
// routes (/notices, /profile, …) drop it, which is exactly what the
// per-window record above covers.
const readUrlTenantSlug = () => {
  try {
    const match = String(window.location.pathname || '').match(/^\/app\/([^/?#]+)/i);
    if (!match || !match[1]) return '';
    return sanitizeSlug(decodeURIComponent(match[1]));
  } catch {
    return '';
  }
};

const readInstalledTenantSlug = () => {
  try {
    return sanitizeSlug(localStorage.getItem(INSTALLED_SLUG_KEY));
  } catch {
    return '';
  }
};

// getAppHomePath(): the path any "go Home" navigation should use.
// - Installed/standalone PWA -> '/app/<slug>' for THIS window's tenant
// - Everything else (normal browser tab, no slug, invalid slug) -> '/'
export const getAppHomePath = () => {
  if (!isStandaloneDisplay()) return '/';

  const urlSlug = readUrlTenantSlug();
  if (urlSlug) {
    // Still on /app/<slug> — authoritative, and worth recording so later
    // in-app routes (which drop the slug) still resolve Home correctly.
    rememberWindowTenantSlug(urlSlug);
    return `/app/${urlSlug}`;
  }

  // Legacy shared key is the last resort only: it is correct for a device
  // that has ever only opened one tenant, and wrong the moment a second
  // tenant's link is opened anywhere on this origin.
  const slug = readWindowTenantSlug() || readInstalledTenantSlug();
  return slug ? `/app/${slug}` : '/';
};
