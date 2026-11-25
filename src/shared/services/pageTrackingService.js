import { supabase } from './supabaseClient';
import {
  PAGE_TRACKING_MANIFEST,
  PAGE_TRACKING_MANIFEST_VERSION,
  PAGE_TRACKING_PLATFORM,
} from '../config/pageTrackingManifest';

// Page activity tracking via the existing `page_tracking_rpc` function.
// Everything here is best-effort: no function in this module throws to callers.

const RPC_NAME = 'page_tracking_rpc';
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 5;
const MAX_QUEUE_SIZE = 50;
const DUPLICATE_WINDOW_MS = 1500;
const INIT_RETRY_COOLDOWN_MS = 30000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_RE.test(String(value || '').trim());
const warn = (...args) => {
  if (import.meta.env.DEV) console.warn('[PageTracking]', ...args);
};

// ─── Identity ───────────────────────────────────────────────────────────────

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    return {};
  }
};

// members_id: same resolution the app uses elsewhere (App.jsx birthday check):
// the first UUID among user.members_id / member_id / id in localStorage 'user'.
// trust_id: the active trust (`selected_trust_id`), falling back like
// sessionAuditService does. Returns null unless both are valid UUIDs.
export const resolveTrackingIdentity = () => {
  const user = readStoredUser();
  const membersId = [user.members_id, user.member_id, user.id].find(isUuid) || '';
  let trustId = '';
  try {
    trustId = [
      localStorage.getItem('selected_trust_id'),
      localStorage.getItem('last_selected_trust_id'),
      user?.trust?.id,
      user?.primary_trust?.id,
      user?.trust_id,
    ].find(isUuid) || '';
  } catch {
    trustId = '';
  }
  if (!membersId || !trustId) return null;
  return { membersId: String(membersId).trim(), trustId: String(trustId).trim() };
};

// ─── RPC ────────────────────────────────────────────────────────────────────

const callTrackingRpc = async (action, payload = {}) => {
  const { data, error } = await supabase.rpc(RPC_NAME, {
    p_action: action,
    p_payload: payload,
  });
  if (error) throw error;
  return data;
};

const extractRows = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.routes)) return data.routes;
  return [];
};

const normalizeRoute = (value) => {
  const route = String(value || '').split(/[?#]/)[0].trim();
  if (!route || route === '/') return '/';
  return route.replace(/\/+$/, '');
};

// ─── Route registration + cache ─────────────────────────────────────────────

let routePageIds = null; // { '/events/:eventId': '<page_id>', ... }
let dynamicMatchers = []; // compiled templates, most specific first
let initPromise = null;
let lastInitFailureAt = 0;

const fetchRegisteredRoutes = async () => {
  const data = await callTrackingRpc('route_view', {
    platform: PAGE_TRACKING_PLATFORM,
    is_active: true,
  });
  const map = {};
  extractRows(data).forEach((row) => {
    const route = normalizeRoute(row?.route);
    const pageId = row?.id ?? row?.page_id;
    if (route && pageId) map[route] = String(pageId);
  });
  return map;
};

const compileDynamicMatchers = (routes) => routes
  .filter((route) => route.includes(':'))
  .map((route) => {
    const segments = route.split('/').filter(Boolean);
    return {
      route,
      segments,
      staticCount: segments.filter((s) => !s.startsWith(':')).length,
    };
  })
  // More literal segments wins, e.g. /a/list/:x/detail/:y over /a/:x/:y/...
  .sort((a, b) => b.staticCount - a.staticCount);

const buildRouteCache = async () => {
  // Read-only: routes are registered in page_routes by hand, never by the app.
  // A manifest route with no row there simply isn't tracked (warned in dev).
  const map = await fetchRegisteredRoutes();

  PAGE_TRACKING_MANIFEST.forEach((entry) => {
    if (!map[normalizeRoute(entry.route)]) warn('route not registered in page_routes:', entry.route);
  });

  // Keep only manifest routes: the cache must never map unknown routes.
  const manifestRoutes = PAGE_TRACKING_MANIFEST.map((entry) => normalizeRoute(entry.route));
  const filtered = {};
  manifestRoutes.forEach((route) => {
    if (map[route]) filtered[route] = map[route];
  });
  routePageIds = filtered;
  dynamicMatchers = compileDynamicMatchers(Object.keys(filtered));
};

const ensureRouteCache = () => {
  if (routePageIds) return Promise.resolve(true);
  if (!initPromise) {
    if (Date.now() - lastInitFailureAt < INIT_RETRY_COOLDOWN_MS) return Promise.resolve(false);
    initPromise = buildRouteCache()
      .then(() => true)
      .catch((error) => {
        lastInitFailureAt = Date.now();
        warn(`route initialisation failed (manifest v${PAGE_TRACKING_MANIFEST_VERSION})`, error);
        return false;
      })
      .finally(() => {
        initPromise = null;
      });
  }
  return initPromise;
};

// Static routes win; otherwise match templates segment by segment.
// '/events/123' -> { route: '/events/:eventId', params: { eventId: '123' } }
export const matchTrackedRoute = (pathname) => {
  if (!routePageIds) return null;
  const normalized = normalizeRoute(pathname);
  if (routePageIds[normalized] && !normalized.includes(':')) {
    return { route: normalized, pageId: routePageIds[normalized], params: {} };
  }
  const actual = normalized.split('/').filter(Boolean);
  for (const matcher of dynamicMatchers) {
    if (matcher.segments.length !== actual.length) continue;
    const params = {};
    const ok = matcher.segments.every((segment, index) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(actual[index]);
        return true;
      }
      return segment === actual[index];
    });
    if (ok) return { route: matcher.route, pageId: routePageIds[matcher.route], params };
  }
  return null;
};

// ─── Queue + flush ──────────────────────────────────────────────────────────

let queue = [];
let flushTimer = null;
let isFlushing = false;
let listenersAttached = false;

export const flushPageActivity = async () => {
  if (isFlushing || queue.length === 0) return;
  clearTimeout(flushTimer);
  flushTimer = null;
  isFlushing = true;
  const events = queue;
  queue = [];
  try {
    await callTrackingRpc('activity_add', { events });
  } catch (error) {
    warn('activity_add failed, will retry with next flush', error);
    queue = [...events, ...queue].slice(-MAX_QUEUE_SIZE);
  } finally {
    isFlushing = false;
  }
};

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPageActivity();
  }, FLUSH_INTERVAL_MS);
};

const attachFlushListeners = () => {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  const flushNow = () => { flushPageActivity(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('pagehide', flushNow);
};

// ─── Navigation entry point ─────────────────────────────────────────────────

let lastTracked = { pathname: '', at: 0 };

export const trackNavigation = async (pathname) => {
  try {
    const actualPathname = String(pathname || '').split(/[?#]/)[0];
    if (!actualPathname) return;

    // Drop immediate repeats (StrictMode / re-render). A genuine return to a
    // page passes because a different pathname was recorded in between.
    const now = Date.now();
    if (lastTracked.pathname === actualPathname && now - lastTracked.at < DUPLICATE_WINDOW_MS) return;
    lastTracked = { pathname: actualPathname, at: now };

    // Capture identity at navigation time so a later logout can't re-attribute it.
    const identity = resolveTrackingIdentity();
    if (!identity) return;

    const ready = await ensureRouteCache();
    if (!ready) return;

    const match = matchTrackedRoute(actualPathname);
    if (!match?.pageId) return;

    const metadata = {
      route: match.route,
      pathname: actualPathname,
      source: 'navigation',
      platform: PAGE_TRACKING_PLATFORM,
    };
    if (Object.keys(match.params).length > 0) metadata.params = match.params;

    queue.push({
      page_id: match.pageId,
      members_id: identity.membersId,
      user_reg_id: null,
      trust_id: identity.trustId,
      metadata,
    });
    if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE);

    attachFlushListeners();
    if (queue.length >= FLUSH_BATCH_SIZE) {
      flushPageActivity();
    } else {
      scheduleFlush();
    }
  } catch (error) {
    warn('trackNavigation failed', error);
  }
};

// ─── Action entry point ─────────────────────────────────────────────────────

// Records a button/form action (not a navigation) against the page the member
// is currently on. Same RPC, same queue; metadata.source = 'action' tells it
// apart from navigation rows. Flushed immediately: actions are often followed
// by a full-page navigation that would otherwise drop the queued event.
export const trackAction = async (action, extra = {}, options = {}) => {
  try {
    const actionName = String(action || '').trim();
    if (!actionName || typeof window === 'undefined') return;

    const identity = resolveTrackingIdentity();
    if (!identity) return;

    const ready = await ensureRouteCache();
    if (!ready) return;

    // options.route attributes the action to a registered page that has no URL
    // of its own (e.g. '/sidebar'); metadata.pathname still records the page
    // the member was actually on.
    const pathname = String(window.location.pathname || '').split(/[?#]/)[0];
    const match = matchTrackedRoute(options.route || pathname);
    if (!match?.pageId) return;

    const metadata = {
      route: match.route,
      pathname,
      source: 'action',
      action: actionName,
      platform: PAGE_TRACKING_PLATFORM,
      ...extra,
    };
    if (Object.keys(match.params).length > 0) metadata.params = match.params;

    queue.push({
      page_id: match.pageId,
      members_id: identity.membersId,
      user_reg_id: null,
      trust_id: identity.trustId,
      metadata,
    });
    if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE);

    attachFlushListeners();
    flushPageActivity();
  } catch (error) {
    warn('trackAction failed', error);
  }
};
