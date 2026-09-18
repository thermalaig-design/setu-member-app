import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrustByAppSlug } from '../services/trustService';
import { applyTenantManifest } from '../utils/pwaManifest';
import { isReservedSlug } from '../constants/reservedRoutes';
import { rememberWindowTenantSlug } from '../utils/tenantNavigation';

// These keys represent the identity of THIS installed PWA / customer link.
// They are set once when a valid Trust slug is resolved and must never be
// overwritten by in-app Trust switching (that uses `selected_trust_id`).
const INSTALLED_TRUST_ID_KEY = 'installed_app_trust_id';
const INSTALLED_SLUG_KEY = 'installed_app_slug';

const TenantContext = createContext(null);

const readStored = (key) => {
  try {
    return String(localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
};

const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  return Boolean(mql?.matches) || window.navigator?.standalone === true;
};

const writeStored = (key, value) => {
  try {
    if (value) {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore storage failures
  }
};

// The URL is the only thing that reliably tells two different /app/{slug}
// PWAs apart — localStorage is shared across all of them on this origin.
// Whenever the current path is /app/{slug}, that slug must win over
// whatever tenant happens to be cached from a previously opened/installed
// PWA on the same device. Exported so other Trust-selection code (e.g.
// App.jsx's activeTrustId/theme resolution) can ask the same question
// instead of re-deriving it (and risking it disagreeing with this file).
export const getTenantSlugFromPath = (pathname) => {
  try {
    const path = String(pathname ?? window.location.pathname ?? '');
    const match = path.match(/^\/app\/([^/?#]+)/i);
    const slug = match && match[1] ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
    // /app/login, /app/profile, etc. are existing app routes, not a Trust
    // slug — never treat a reserved first-level segment as tenant identity.
    if (!slug || isReservedSlug(slug)) return '';
    return slug;
  } catch {
    return '';
  }
};

const getUrlSlug = () => getTenantSlugFromPath();

export const TenantProvider = ({ children }) => {
  const [tenantTrust, setTenantTrust] = useState(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState('');
  const [installedSlug, setInstalledSlug] = useState(() => {
    const urlSlug = getUrlSlug();
    return urlSlug || (isStandaloneDisplay() ? readStored(INSTALLED_SLUG_KEY) : '');
  });
  const [installedTrustId, setInstalledTrustId] = useState(() => {
    const urlSlug = getUrlSlug();
    if (!urlSlug && !isStandaloneDisplay()) return '';
    const storedSlug = readStored(INSTALLED_SLUG_KEY);
    // A cached trust id is only trustworthy when it belongs to the same
    // slug the URL is asking for right now (or when this route carries no
    // slug at all, e.g. a deeper in-app route within an already-resolved
    // session) — otherwise it's another tenant's identity leaking in from
    // shared localStorage, and must not be exposed even momentarily.
    if (urlSlug && urlSlug !== storedSlug) return '';
    return readStored(INSTALLED_TRUST_ID_KEY);
  });
  const rehydratedRef = useRef(false);

  const resolveTenantFromSlug = useCallback(async (slug) => {
    const normalizedSlug = String(slug || '').trim().toLowerCase();
    if (!normalizedSlug) {
      setTenantError('');
      return null;
    }

    setTenantLoading(true);
    setTenantError('');
    try {
      const trust = await fetchTrustByAppSlug(normalizedSlug);
      if (!trust) {
        setTenantTrust(null);
        setTenantError('not_found');
        return null;
      }

      setTenantTrust(trust);
      writeStored(INSTALLED_TRUST_ID_KEY, String(trust.id));
      writeStored(INSTALLED_SLUG_KEY, normalizedSlug);
      // Per-window (sessionStorage) copy — the two keys above are shared by
      // every tenant PWA on this origin, so they can't tell this window's
      // tenant apart from one opened in another window/tab. getAppHomePath()
      // reads this one, so in-app "Home" never jumps to another tenant.
      rememberWindowTenantSlug(normalizedSlug);
      setInstalledTrustId(String(trust.id));
      setInstalledSlug(normalizedSlug);

      return trust;
    } catch (err) {
      console.warn('[Tenant] Failed to resolve slug:', err?.message || err);
      setTenantTrust(null);
      setTenantError('error');
      return null;
    } finally {
      setTenantLoading(false);
    }
  }, []);

  // On app boot: if the URL is /app/<slug>, that slug is authoritative and
  // TenantLanding (mounted for that route) resolves it itself — never
  // rehydrate a different, possibly stale, cached tenant here in that case.
  // Only when this route carries no slug (a deeper in-app route within an
  // already-resolved session) do we fall back to the last resolved tenant
  // identity for this device, same as before.
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    const urlSlug = getUrlSlug();
    if (urlSlug) {
      // Claim this window for this tenant immediately, before the (async)
      // resolve finishes — a standalone PWA always launches on its own
      // /app/<slug>/ start_url, and in-app routes drop the slug soon after.
      rememberWindowTenantSlug(urlSlug);
      return;
    }
    if (!isStandaloneDisplay()) {
      return;
    }
    if (installedSlug && !tenantTrust) {
      resolveTenantFromSlug(installedSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantTrust || !installedSlug) return;
    applyTenantManifest({ slug: installedSlug, trust: tenantTrust });
  }, [tenantTrust, installedSlug]);

  const value = useMemo(() => ({
    tenantTrust,
    tenantLoading,
    tenantError,
    installedTrustId,
    installedSlug,
    resolveTenantFromSlug
  }), [tenantTrust, tenantLoading, tenantError, installedTrustId, installedSlug, resolveTenantFromSlug]);

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return ctx;
};
