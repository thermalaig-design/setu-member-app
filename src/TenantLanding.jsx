import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import { isReservedSlug } from './constants/reservedRoutes';
import { fetchMemberTrustMemberships, resolveTenantAppAccess, syncTenantMembershipName } from './services/trustService';
import { saveProfile } from './services/api';
import { getUserHospitalMemberships, clearTenantUserSession } from './utils/storageUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import { getInstallPrompt, clearInstallPrompt, subscribeInstallPrompt } from './utils/installPrompt';
import Home from './Home';
import TenantProfileModal from './components/TenantProfileModal';

const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const normalizeText = (value) => String(value || '').trim();

// Module-scoped (not component state): survives TenantLanding unmount/remount
// caused by in-app SPA navigation (e.g. open Notices, then go back to
// /app/<slug>), but resets on a real page reload since the module
// re-evaluates from scratch then. Without this, every "back to /app/<slug>"
// remount re-ran the membership check and flashed the "Opening <Trust>…"
// loading screen, even though the standalone session was already verified
// moments earlier.
const verifiedStandaloneEntries = new Set();

const getUserSessionKey = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return normalizeText(parsed?.members_id || parsed?.member_id || parsed?.id || parsed?.mobile || parsed?.Mobile || '');
  } catch {
    return '';
  }
};

const getStandaloneVerificationKey = (trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return '';
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  if (!isLoggedIn) return '';
  return `${normalizedTrustId}:${getUserSessionKey()}`;
};

const isIosSafari = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
};

// Desktop macOS Safari never fires beforeinstallprompt either (same as iOS
// Safari — Apple doesn't implement the API on either platform), but its
// manual "install" step lives under File ▸ Add to Dock… instead of a Share
// sheet, so it needs its own instructions rather than iOS Safari's.
const isMacSafari = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouchMac = ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document;
  const isMac = ua.includes('Macintosh') && !isTouchMac;
  const isRealSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg\/|EdgiOS|OPR\/|FxiOS|Firefox/.test(ua);
  return isMac && isRealSafari;
};

// Embedded in-app browsers (WhatsApp/Instagram/Facebook) never fire
// beforeinstallprompt and their limited chrome often can't complete an
// install even via manual browser-menu steps — the only reliable guidance
// is to open the link in a real browser. Checked before the iOS/Android
// branches below since these in-app UAs can otherwise be misclassified as
// plain iOS Safari (their UA still contains "Safari").
const isInAppEmbeddedBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp/i.test(ua);
};

// Lightweight UA check used only to pick the right install-instructions
// copy for Android when beforeinstallprompt didn't fire (already dismissed
// too many times, unsupported browser, etc.) — not used for any
// functional/behavioral branching beyond which text to show.
const isAndroid = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
};

const isStandaloneDisplay = () => {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  return Boolean(mql?.matches) || window.navigator?.standalone === true;
};

// Local public assets (e.g. '/assets/setu-logo.png') are only ever deployed
// under Vite's configured base ('/' in dev, '/_setu-app/' in production) —
// a bare '/' path resolves against the host's domain root instead, which
// 404s in production. Resolve against BASE_URL so this works on any host.
const SETU_POWERED_LOGO = `${String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '')}/assets/setu-logo.png`;
const SETU_DOWNLOAD_URL = 'https://teiltd.in/app-download';

// --- Contrast-safe tenant theming -----------------------------------------
// Trusts can set arbitrary pwa_theme_color / pwa_background_color values
// (including #ffffff). These helpers make sure body/heading text always
// stays readable instead of trusting the tenant color directly for text.
const hexToRgb = (hex) => {
  const raw = String(hex || '').trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
};

const relativeLuminance = ({ r, g, b }) => {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrastRatio = (hexA, hexB) => {
  const lumA = relativeLuminance(hexToRgb(hexA) || { r: 0, g: 0, b: 0 });
  const lumB = relativeLuminance(hexToRgb(hexB) || { r: 255, g: 255, b: 255 });
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
};

const isLightColor = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return relativeLuminance(rgb) > 0.5;
};

const hexToHsl = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
};

const hslToHex = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// Builds a richer two-stop gradient (and matching readable text color) from
// the tenant's theme color, for the Install button and the card's accent
// bar. A flat pale/near-white theme color (like Setu's #ffffff) otherwise
// renders as a dull, low-contrast button — this keeps the tenant's own hue
// when there is one, and only falls back to the app's own gold accent (the
// same one used on Login/OTP) when the theme color carries no real hue
// (white/gray/black) to derive a gradient from.
const getAccentGradient = (themeColor) => {
  const hsl = hexToHsl(themeColor);
  const hue = (!hsl || hsl.s < 0.08) ? 42 : hsl.h;
  const from = hslToHex(hue, 0.72, 0.5);
  const to = hslToHex((hue + 22) % 360, 0.8, 0.38);
  const text = Math.min(contrastRatio('#181510', from), contrastRatio('#181510', to))
    >= Math.min(contrastRatio('#fff8ec', from), contrastRatio('#fff8ec', to))
    ? '#181510'
    : '#fff8ec';
  return { from, to, text };
};

// Derives a safe, readable text/surface palette for the card from the
// tenant's background color (theming for accents like the Install button
// lives in getAccentGradient instead, since text needs a plain neutral).
const getTenantPalette = (backgroundColor) => {
  const lightBg = isLightColor(backgroundColor);

  const textPrimary = lightBg ? '#181510' : '#f5f0e0';
  const textSecondary = lightBg ? '#4a4438' : '#c8c2b0';
  const textMuted = lightBg ? '#6b6558' : '#a8a190';

  const cardBackground = lightBg ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.28)';
  const cardBorder = lightBg ? 'rgba(20,16,8,0.10)' : 'rgba(255,255,255,0.08)';
  const cardHoverTint = lightBg ? 'rgba(20,16,8,0.06)' : 'rgba(255,255,255,0.08)';
  const warningText = lightBg ? '#8a5a00' : '#f5c842';

  return { lightBg, textPrimary, textSecondary, textMuted, cardBackground, cardBorder, cardHoverTint, warningText };
};

function TenantLanding({ onNavigate, onLogout, isMember } = {}) {
  const { appSlug } = useParams();
  const navigate = useNavigate();
  const { tenantTrust, tenantLoading, tenantError, resolveTenantFromSlug, installedSlug } = useTenant();

  const normalizedAppSlug = normalizeText(appSlug).toLowerCase();
  // TenantProvider wraps the whole app and outlives TenantLanding, so a
  // matching tenantTrust here means this slug was already resolved earlier
  // this page session (e.g. we're remounting because the user opened
  // another in-app route and came back) — no need to re-fetch or flash the
  // "Loading…" screen again.
  const alreadyResolvedThisSlug = Boolean(tenantTrust) && installedSlug === normalizedAppSlug;

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installOutcome, setInstallOutcome] = useState('');
  // Only appinstalled (not the native prompt's 'accepted' outcome) actually
  // confirms the browser finished installing — see the appinstalled
  // listener below and handleInstallClick's comments.
  const [isInstalled, setIsInstalled] = useState(false);
  // Drives the post-install experience: 'idle' is the normal marketing
  // card; 'prompting' is while the native browser install dialog is open;
  // 'launching' is the full-screen transition shown the instant the user
  // accepts, until the real `appinstalled` event confirms the browser
  // finished installing; 'installed' is the existing success screen. There
  // is no standard API to force-launch a newly installed PWA, so nothing
  // in this state machine auto-navigates — the success screen's "Open
  // App" button (handleOpenApp below) is the one reliable, user-initiated
  // launch action.
  const [installPhase, setInstallPhase] = useState('idle');
  // Not every Chromium build/version fires appinstalled reliably after an
  // 'accepted' outcome (browser bugs, unusual install flows, etc.) — a ref
  // (not state, so the timeout callback below always reads the latest
  // value) plus a pending-timeout id let the full-screen "Launching your
  // app…" transition fall back to the normal Install button instead of
  // hanging forever if that event never arrives.
  const isInstalledRef = useRef(false);
  const acceptedTimeoutRef = useRef(null);
  const [resolvedOnce, setResolvedOnce] = useState(() => alreadyResolvedThisSlug);
  const [membershipMessage, setMembershipMessage] = useState('');
  // Set by enterTenantTrust when resolveTenantAppAccess reports an
  // incomplete profile ('needs_profile') or a not-yet-active membership
  // ('pending') for the logged-in member on this tenant Trust. tenantAccessPayload
  // holds that resolver response so the profile modal / pending screen (and
  // the modal's submit handler) have the trust/member/reg_member data they need.
  const [tenantAccessState, setTenantAccessState] = useState(null);
  const [tenantAccessPayload, setTenantAccessPayload] = useState(null);
  // Standalone (installed PWA) sessions render Home in place instead of
  // navigating to '/', so the browser stays on /app/<appSlug> — see
  // enterTenantTrust below. Initialized synchronously from the same-session
  // verification cache so remounting on /app/<slug> (in-app back navigation)
  // renders Home immediately instead of flashing the membership-check
  // spinner again.
  const [showTenantHome, setShowTenantHome] = useState(() => {
    if (!alreadyResolvedThisSlug || !isStandaloneDisplay()) return false;
    const cacheKey = getStandaloneVerificationKey(tenantTrust?.id);
    return Boolean(cacheKey) && verifiedStandaloneEntries.has(cacheKey);
  });

  const reserved = isReservedSlug(appSlug);

  useEffect(() => {
    if (reserved) return;
    if (alreadyResolvedThisSlug) {
      setResolvedOnce(true);
      return;
    }
    let active = true;
    resolveTenantFromSlug(appSlug).finally(() => {
      if (active) setResolvedOnce(true);
    });
    return () => { active = false; };
  }, [appSlug, reserved, resolveTenantFromSlug, alreadyResolvedThisSlug]);

  // The actual beforeinstallprompt listener lives in index.html's inline
  // bootstrap script — registered before any JS module loads, so an event
  // firing before this component (or even React) mounts is never lost. Pick
  // up one that already arrived, then subscribe for any that fire later.
  useEffect(() => {
    const existingPrompt = getInstallPrompt();
    if (existingPrompt) setDeferredPrompt(existingPrompt);

    return subscribeInstallPrompt((event) => setDeferredPrompt(event));
  }, []);

  // Keep a ref mirror of isInstalled so the safety-timeout callback below
  // (started from handleInstallClick, possibly still pending several
  // seconds later) always reads the latest value instead of a stale one
  // captured at setTimeout time.
  useEffect(() => {
    isInstalledRef.current = isInstalled;
  }, [isInstalled]);

  // appinstalled is the only reliable install-completion signal — the
  // native prompt's 'accepted' outcome just means the user tapped Install,
  // not that Chrome finished installing it. Stops the full-screen
  // "Launching your app…" transition and shows the success screen. No
  // automatic navigation/hand-off attempt is made here: there is no
  // standard API to force-launch a newly installed PWA, and any attempt
  // fired from this callback runs outside a user gesture, so a same-tab
  // navigation could yank the user away from the success screen
  // unexpectedly and a new-tab attempt would likely just be popup-blocked.
  // The success screen's "Open App" button (handleOpenApp below) is the
  // one reliable, user-initiated launch action.
  useEffect(() => {
    const handleAppInstalled = () => {
      if (acceptedTimeoutRef.current) {
        clearTimeout(acceptedTimeoutRef.current);
        acceptedTimeoutRef.current = null;
      }
      clearInstallPrompt();
      setDeferredPrompt(null);
      setIsInstalled(true);
      setInstallOutcome('installed');
      setInstallPhase('installed');
    };
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => window.removeEventListener('appinstalled', handleAppInstalled);
  }, []);

  // Not every Chromium build fires appinstalled after 'accepted' (browser
  // bugs, unusual install flows, older/newer versions behaving
  // inconsistently) — clear any pending safety timeout on unmount so it
  // never fires setState after this component is gone.
  useEffect(() => () => {
    if (acceptedTimeoutRef.current) {
      clearTimeout(acceptedTimeoutRef.current);
      acceptedTimeoutRef.current = null;
    }
  }, []);

  // Shared by the initial resolve below and by the profile-modal submit
  // handler: switches selected_trust_id to this tenant Trust and renders
  // Home in place (staying on /app/<appSlug>) instead of navigating to '/'.
  const grantTenantHome = useCallback((trustId, trustName) => {
    const normalizedTrustId = normalizeText(trustId);
    const normalizedTrustName = normalizeText(trustName);
    localStorage.setItem('selected_trust_id', normalizedTrustId);
    localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, normalizedTrustId);
    if (normalizedTrustName) localStorage.setItem('selected_trust_name', normalizedTrustName);
    window.dispatchEvent(new CustomEvent('trust-changed', {
      detail: { trustId: normalizedTrustId, trustName: normalizedTrustName || null, source: 'tenant-standalone-launch' }
    }));

    // Installed PWA: stay on /app/<appSlug> and render Home in place.
    // Navigating to '/' here is what previously caused a refresh on
    // /app/setu to fall through to the separate marketing site, since
    // '/' is served by that site, not the member app, for this host.
    setShowTenantHome(true);
    const cacheKey = getStandaloneVerificationKey(normalizedTrustId);
    if (cacheKey) verifiedStandaloneEntries.add(cacheKey);
  }, []);

  // Called by the standalone (installed PWA) auto-entry effect below: verifies
  // the logged-in member actually belongs to this Trust — creating that
  // membership server-side (via resolveTenantAppAccess) if this is their
  // first time here — and either renders Home in place, prompts for a
  // missing profile, or shows a pending-access screen, instead of navigating
  // to '/'.
  const enterTenantTrust = useCallback(async () => {
    setMembershipMessage('');
    setTenantAccessState(null);
    setTenantAccessPayload(null);

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const rawUser = isLoggedIn ? localStorage.getItem('user') : null;
    let user = null;
    try {
      user = rawUser ? JSON.parse(rawUser) : null;
    } catch {
      user = null;
    }

    if (!isLoggedIn || !user) {
      navigate('/login', { replace: true, state: { tenantSlug: normalizedAppSlug } });
      return false;
    }

    const tenantTrustId = normalizeText(tenantTrust?.id);
    const membersId = user.members_id || user.member_id || user.id || null;
    const membershipNumber = user.membership_number || user['Membership number'] || '';

    try {
      const access = await resolveTenantAppAccess({ appSlug: normalizedAppSlug, membersId });
      if (!access) {
        setMembershipMessage('Unable to verify your membership right now. Please try again.');
        return false;
      }

      const trustName = normalizeText(access.trust?.name || tenantTrust?.name);

      // Profile modal only ever applies to a membership just created for
      // this visit — an existing reg_members row (active or not) must go
      // straight to Home/Pending below, even if its Name happens to be
      // blank. Checking is_new_membership first is what keeps an existing
      // active member from ever seeing "Complete your profile" again.
      if (access.is_new_membership && access.needs_profile) {
        setTenantAccessPayload(access);
        setTenantAccessState('needs_profile');
        return true;
      }

      if (access.is_active) {
        grantTenantHome(access.trust?.id || tenantTrustId, trustName);
        return true;
      }

      setTenantAccessPayload(access);
      setTenantAccessState('pending');
      return true;
    } catch (accessErr) {
      console.warn('[TenantLanding] resolveTenantAppAccess failed, falling back to read-only membership check:', accessErr?.message || accessErr);

      try {
        // Reuse the same membership-lookup service OTPVerification.jsx uses to
        // verify Trust membership, instead of introducing a second model.
        // Read-only fallback for transient errors — never creates a
        // membership itself, so a failed resolveTenantAppAccess call never
        // silently grants access to a non-member.
        let memberships = [];
        try {
          memberships = await fetchMemberTrustMemberships({ membersId, membershipNumber });
        } catch (fetchErr) {
          console.warn('[TenantLanding] Live membership check failed, using cached memberships:', fetchErr?.message || fetchErr);
          memberships = getUserHospitalMemberships(user);
        }

        const tenantMembership = (Array.isArray(memberships) ? memberships : [])
          .find((membership) => normalizeText(membership?.trust_id) === tenantTrustId);

        if (tenantMembership) {
          const trustName = normalizeText(tenantMembership.trust_name || tenantTrust?.name);
          grantTenantHome(tenantTrustId, trustName);
          return true;
        }

        setMembershipMessage('Unable to verify your membership right now. Please try again.');
        return false;
      } catch (err) {
        console.warn('[TenantLanding] Membership verification failed:', err?.message || err);
        setMembershipMessage('Unable to verify your membership right now. Please try again.');
        return false;
      }
    }
  }, [navigate, tenantTrust, normalizedAppSlug, grantTenantHome]);

  // Called when TenantProfileModal's form is submitted: saves the profile
  // (existing saveProfile — writes Members.Name/Email directly), syncs the
  // denormalized reg_members.Name so a later resolve doesn't keep asking for
  // a profile, then either grants Home (public / already-active) or moves to
  // the pending-access screen (private, still inactive).
  const handleProfileSubmit = useCallback(async ({ name, email }) => {
    await saveProfile({ name, email });
    const regMemberId = tenantAccessPayload?.reg_member?.id;
    if (regMemberId) {
      await syncTenantMembershipName({ regMemberId, name });
    }

    if (tenantAccessPayload?.is_active) {
      grantTenantHome(tenantAccessPayload.trust?.id || tenantTrust?.id, tenantAccessPayload.trust?.name || tenantTrust?.name);
      setTenantAccessState(null);
    } else {
      setTenantAccessState('pending');
    }
  }, [tenantAccessPayload, grantTenantHome, tenantTrust]);

  // "Use another mobile number" on the profile/onboarding screen: a stale
  // SETU session saved on this device (from a different login, possibly for
  // a different Trust) must never be silently reused here without the user
  // being able to see/reject it. Clears only auth/session/selected-Trust
  // keys — never the installed_app_trust_id/installed_app_slug identity
  // TenantContext owns, so this device's tenant PWA context is untouched —
  // then sends the user into this same tenant's login flow.
  const handleUseAnotherNumber = useCallback(() => {
    clearTenantUserSession();
    setTenantAccessState(null);
    setTenantAccessPayload(null);
    navigate('/login', { replace: true, state: { tenantSlug: normalizedAppSlug } });
  }, [navigate, normalizedAppSlug]);

  // If the app is already installed (running standalone) and the tenant
  // resolved successfully, skip the marketing landing and go straight to
  // the normal auth flow for this Trust identity — verifying membership and
  // switching selected_trust_id, so opening the installed Setu app never
  // lands you inside another Trust.
  useEffect(() => {
    if (!resolvedOnce || !tenantTrust) return;
    if (!isStandaloneDisplay()) return;
    // Already showing Home this render (e.g. synchronous init from the
    // same-session verification cache) — nothing left to do.
    if (showTenantHome) return;
    const cacheKey = getStandaloneVerificationKey(tenantTrust?.id);
    if (cacheKey && verifiedStandaloneEntries.has(cacheKey)) {
      setShowTenantHome(true);
      return;
    }
    enterTenantTrust();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedOnce, tenantTrust, showTenantHome]);

  if (reserved) {
    return <Navigate to={getAppHomePath()} replace />;
  }

  if (tenantLoading || !resolvedOnce) {
    return (
      <div style={styles.page}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Loading…</p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  if (!tenantTrust || tenantError === 'not_found') {
    return (
      <div style={styles.page}>
        <div style={styles.notAvailableCard}>
          <h1 style={styles.notAvailableHeading}>App not available</h1>
          <p style={styles.notAvailableText}>
            This link is not active. Please check the link or contact your organization.
          </p>
        </div>
      </div>
    );
  }

  const themeColor = tenantTrust.pwa_theme_color || '#d4af37';
  const backgroundColor = tenantTrust.pwa_background_color || '#1a1a1a';
  const logoUrl = tenantTrust.pwa_icon_192_url || tenantTrust.icon_url || '';
  const palette = getTenantPalette(backgroundColor);
  // A richer two-stop gradient derived from the tenant's theme color (falls
  // back to the app's own gold accent when the theme color is a flat
  // white/gray/black with no usable hue) — used for the Install button, the
  // card's signature top bar, and the ambient background glow, so the page
  // reads as vivid/colorful even when the raw theme color is pale.
  const accent = getAccentGradient(themeColor);
  const accentRgb = hexToRgb(accent.from) || { r: 212, g: 175, b: 55 };
  const accentGlow = (alpha) => `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${alpha})`;
  const accentGradient = `linear-gradient(135deg, ${accent.from}, ${accent.to})`;
  const pageBackground = `radial-gradient(circle at 50% 15%, ${accentGlow(0.22)}, transparent 55%), ${backgroundColor}`;

  // Standalone tenant session already validated membership (see
  // enterTenantTrust): render the existing Home UI in place, reused as-is,
  // while the browser stays on /app/<appSlug> instead of navigating to '/'.
  if (showTenantHome) {
    return <Home onNavigate={onNavigate} onLogout={onLogout} isMember={isMember} />;
  }

  // New membership (or an existing one with a blank Name) needs a profile
  // before continuing — full-screen tenant-branded modal, submit handled by
  // handleProfileSubmit above.
  if (tenantAccessState === 'needs_profile') {
    return (
      <TenantProfileModal
        trustName={tenantTrust.name}
        mobile={tenantAccessPayload?.member?.Mobile}
        initialName={tenantAccessPayload?.member?.Name || ''}
        initialEmail={tenantAccessPayload?.member?.Email || ''}
        isActive={Boolean(tenantAccessPayload?.is_active)}
        accent={accent}
        palette={palette}
        onSubmit={handleProfileSubmit}
        onUseAnotherNumber={handleUseAnotherNumber}
      />
    );
  }

  // Membership exists (or was just created) but is not yet active — private
  // Trust, pending admin approval. Home must never render in this state.
  if (tenantAccessState === 'pending') {
    return (
      <div style={{ ...styles.page, background: pageBackground }}>
        <div style={{ ...styles.notAvailableCard, background: palette.cardBackground, borderColor: palette.cardBorder }}>
          <h1 style={{ ...styles.notAvailableHeading, color: palette.textPrimary }}>Access request submitted</h1>
          <p style={{ ...styles.notAvailableText, color: palette.textSecondary }}>
            Your access request for {tenantTrust.name} is pending approval. You'll be able to open the app once an admin approves your request.
          </p>
        </div>
      </div>
    );
  }

  // Standalone (installed PWA) launches auto-enter via enterTenantTrust above;
  // show a branded spinner instead of flashing the Install/Continue card
  // while that redirect/membership check is in flight.
  if (isStandaloneDisplay() && !membershipMessage) {
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <p style={{ ...styles.loadingText, color: palette.textSecondary }}>Opening {tenantTrust.name}…</p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  // Full-screen transition shown the instant the user accepts the native
  // install prompt, replacing the tenant card entirely (no card, no
  // "Powered by Setu", no install instructions) until the real
  // `appinstalled` event confirms the browser finished installing — see
  // handleInstallClick/handleAppInstalled above for the state transitions
  // and the safety-timeout fallback if that event never arrives.
  if (installPhase === 'launching') {
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <p style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '15px', fontWeight: 700, marginTop: '18px' }}>
          Launching your app…
        </p>
        <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '4px' }}>
          Please wait while we finish setting things up.
        </p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      setInstallPhase('prompting');
      deferredPrompt.prompt();
      // The native prompt's outcome only tells us the user tapped
      // Install/Cancel — it is NOT confirmation the browser finished
      // installing. For 'accepted' we deliberately do not set isInstalled
      // here; the UI shows the full-screen launching transition below and
      // only the appinstalled listener flips isInstalled to true.
      const { outcome } = await deferredPrompt.userChoice;
      // Consumed — a BeforeInstallPromptEvent can only be prompted once, so
      // clear the shared store too, not just this component's own state.
      clearInstallPrompt();
      setInstallOutcome(outcome);
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        setInstallPhase('launching');
        // Safety net for browser/version inconsistencies where appinstalled
        // never fires after 'accepted' — don't leave the user stuck on the
        // full-screen "Launching your app…" transition forever; fall back
        // to the normal Install button so they can retry or use the
        // manual browser menu.
        if (acceptedTimeoutRef.current) clearTimeout(acceptedTimeoutRef.current);
        acceptedTimeoutRef.current = setTimeout(() => {
          acceptedTimeoutRef.current = null;
          if (!isInstalledRef.current) {
            setInstallOutcome('');
            setInstallPhase('idle');
          }
        }, 8000);
      } else {
        setInstallPhase('idle');
      }
      return;
    }
    if (isInAppEmbeddedBrowser()) {
      setInstallOutcome('in-app-browser');
    } else if (isIosSafari()) {
      setInstallOutcome('ios-instructions');
    } else if (isMacSafari()) {
      setInstallOutcome('mac-safari-instructions');
    } else if (isAndroid()) {
      setInstallOutcome('android-manual');
    } else {
      setInstallOutcome('unsupported');
    }
  };

  // The primary launch action, and the only one that is user-initiated
  // (this click is what makes it a real user gesture) — a top-level
  // navigation (not client-side routing) to the exact tenant URL, so
  // Chrome/Android gets a chance to hand it off to the installed PWA via
  // its app/URL association. That handoff is entirely browser/OS-
  // controlled and not guaranteed; if it doesn't happen, this just
  // reloads the page, which is why the helper text below points the user
  // at their Home Screen icon as the fallback.
  const handleOpenApp = () => {
    const tenantUrl = `${window.location.origin}/app/${normalizedAppSlug}/`;
    window.location.assign(tenantUrl);
  };

  // Single click handler shared by the whole card (see cardBody below) so
  // Install/Open App/mid-install all stay mutually exclusive with no
  // duplicate handlers on the button itself.
  const handleCardClick = () => {
    if (isInstalled) {
      handleOpenApp();
      return;
    }
    if (installPhase === 'prompting' || installPhase === 'launching') return;
    handleInstallClick();
  };

  // Safari (iOS and macOS) never fires beforeinstallprompt — there is no
  // automatic install on that browser, only its own manual add-to-device
  // step. Spelling that out as numbered steps is the simplest experience
  // Safari allows.
  const installSteps = installOutcome === 'ios-instructions'
    ? ['Tap the Share icon in Safari’s toolbar', 'Scroll down and tap "Add to Home Screen"', 'Tap "Add" to confirm']
    : installOutcome === 'mac-safari-instructions'
      ? ['Click "File" in Safari’s menu bar', 'Choose "Add to Dock…"', 'Click "Add" to confirm']
      : null;

  return (
    <div style={{ ...styles.page, background: pageBackground }}>
      <div style={{ ...styles.glowOrb, top: '-70px', left: '-60px', background: accentGlow(0.4) }} />
      <div style={{ ...styles.glowOrb, bottom: '-70px', right: '-60px', background: accentGlow(0.28) }} />

      <div
        className="tenant-card"
        style={{ ...styles.card, background: palette.cardBackground, borderColor: palette.cardBorder }}
      >
        <div style={{ ...styles.accentBar, background: accentGradient }} />
        <div
          className="tenant-card-body"
          style={{ ...styles.cardBody, cursor: 'pointer' }}
          onClick={handleCardClick}
        >
          <p style={{ ...styles.eyebrow, color: palette.textMuted }}>
            Welcome to {tenantTrust.legal_name || tenantTrust.name}
          </p>

          {logoUrl && (
            <img
              src={logoUrl}
              alt={tenantTrust.name || 'App icon'}
              className="tenant-logo"
              style={{ ...styles.logo, boxShadow: `0 0 0 6px ${accentGlow(0.16)}, 0 14px 28px ${accentGlow(0.32)}` }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <h1 style={{ ...styles.trustName, color: palette.textPrimary }}>{tenantTrust.name}</h1>

          {isInstalled ? (
            <>
              <div style={{ ...styles.installedBadge, background: accentGradient, color: accent.text }} aria-hidden="true">✓</div>
              <p style={{ ...styles.installedHeading, color: palette.textPrimary }}>
                {tenantTrust.name} installed successfully
              </p>
              <p style={{ ...styles.subheading, color: palette.textSecondary }}>
                You can now open it from your Home Screen / Apps.
              </p>
            </>
          ) : (
            <p style={{ ...styles.subheading, color: palette.textSecondary }}>
              Get faster access and open directly.
            </p>
          )}

          {isInstalled ? (
            <button
              type="button"
              className="tenant-install-btn"
              style={{ ...styles.installBtn, background: accentGradient, color: accent.text, boxShadow: `0 10px 26px ${accentGlow(0.4)}` }}
            >
              <span>Open App</span>
              <span className="tenant-install-btn-arrow" aria-hidden="true">→</span>
            </button>
          ) : (
            <button
              type="button"
              className="tenant-install-btn"
              style={{ ...styles.installBtn, background: accentGradient, color: accent.text, boxShadow: `0 10px 26px ${accentGlow(0.4)}` }}
            >
              <span>Install App</span>
              <span className="tenant-install-btn-arrow" aria-hidden="true">→</span>
            </button>
          )}

          {isInstalled && (
            <p style={{ ...styles.instructions, color: palette.textMuted }}>
              If the app does not open automatically, tap the app icon on your Home Screen.
            </p>
          )}

          {tenantTrust.remark && (
            <p style={{ ...styles.trustDescription, color: palette.textSecondary }}>
              {tenantTrust.remark}
            </p>
          )}

          {membershipMessage && (
            <p style={{ ...styles.membershipMessage, color: palette.warningText }}>{membershipMessage}</p>
          )}

          {installOutcome && !['accepted', 'installed', 'ios-instructions', 'mac-safari-instructions'].includes(installOutcome) && (
            <p style={{ ...styles.instructions, color: palette.textMuted }}>
              {installOutcome === 'unsupported' && 'Use your browser menu and choose Install App / Add to Home Screen.'}
              {installOutcome === 'dismissed' && 'You can install the app anytime from your browser menu.'}
              {installOutcome === 'android-manual' && 'Open browser menu → Install app / Add to Home screen'}
              {installOutcome === 'in-app-browser' && 'Open this link in Chrome to install the app'}
            </p>
          )}
        </div>
      </div>

      {installSteps && (
        <div
          className="tenant-safari-modal-overlay"
          style={styles.modalOverlay}
          onClick={() => setInstallOutcome('')}
        >
          <div
            className="tenant-safari-modal"
            style={{ ...styles.modalCard, background: palette.cardBackground, borderColor: palette.cardBorder }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ ...styles.accentBar, background: accentGradient }} />
            <div style={styles.modalBody}>
              <button
                type="button"
                aria-label="Close"
                className="tenant-safari-modal-close"
                style={{ ...styles.modalCloseBtn, color: palette.textMuted }}
                onClick={() => setInstallOutcome('')}
              >
                ×
              </button>
              <h2 style={{ ...styles.modalTitle, color: palette.textPrimary }}>
                Install {tenantTrust.name} on Safari
              </h2>
              <ol style={{ ...styles.instructionsList, color: palette.textMuted }}>
                {installSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
          </div>
        </div>
      )}

      <a
        href={SETU_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="tenant-powered-by"
        style={{ ...styles.poweredBy, color: palette.textMuted, borderColor: palette.cardBorder, background: palette.cardBackground }}
      >
        <img
          src={SETU_POWERED_LOGO}
          alt="Setu"
          style={styles.poweredLogo}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <span>Powered by Setu</span>
      </a>

      <style>{`
        @keyframes tenantCardIn { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }
        @keyframes tenantLogoFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .tenant-card { animation: tenantCardIn 0.4s cubic-bezier(0.2, 0.8, 0.3, 1); }
        .tenant-logo { animation: tenantLogoFloat 3.2s ease-in-out infinite; transition: transform 0.25s ease; }
        .tenant-logo:hover { transform: scale(1.05); }
        .tenant-install-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .tenant-install-btn:hover { transform: translateY(-2px); }
        .tenant-install-btn:active { transform: scale(0.97); }
        .tenant-install-btn-arrow { display: inline-block; transition: transform 0.2s ease; }
        .tenant-install-btn:hover .tenant-install-btn-arrow { transform: translateX(4px); }
        .tenant-powered-by { transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease; }
        .tenant-powered-by:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.18); }
        .tenant-powered-by:active { transform: translateY(0); }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 16px',
    fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
    background: '#1a1a1a',
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    width: '220px',
    height: '220px',
    borderRadius: '50%',
    filter: 'blur(60px)',
    zIndex: -1,
    pointerEvents: 'none',
  },
  spinner: {
    width: '28px',
    height: '28px',
    border: '3px solid rgba(255,255,255,0.2)',
    borderTopColor: '#d4af37',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    color: '#a0a0a0',
    marginTop: '12px',
    fontSize: '13px',
  },
  notAvailableCard: {
    background: '#222',
    border: '1px solid #3a3a3a',
    borderRadius: '14px',
    padding: '32px 24px',
    textAlign: 'center',
    maxWidth: '360px',
  },
  notAvailableHeading: {
    color: '#f0e8d0',
    margin: '0 0 8px',
    fontSize: '20px',
  },
  notAvailableText: {
    color: '#8a8a8a',
    fontSize: '13px',
    margin: 0,
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: '460px',
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '18px',
    overflow: 'hidden',
    boxShadow: '0 20px 44px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(6px)',
    margin: '0 auto',
  },
  accentBar: {
    height: '5px',
    width: '100%',
  },
  cardBody: {
    padding: '46px 30px 50px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '12px',
  },
  logo: {
    width: '84px',
    height: '84px',
    borderRadius: '20px',
    objectFit: 'cover',
    marginBottom: '4px',
  },
  trustName: {
    margin: 0,
    fontSize: '25px',
    fontWeight: 800,
    letterSpacing: '-0.3px',
  },
  eyebrow: {
    margin: '0 0 4px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.5px',
  },
  subheading: {
    margin: '0 0 14px',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  trustDescription: {
    margin: '2px 0 0',
    fontSize: '12px',
    lineHeight: 1.55,
  },
  installedBadge: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 800,
    margin: '2px 0 0',
  },
  installedHeading: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 800,
    lineHeight: 1.35,
  },
  installBtn: {
    width: '100%',
    border: 'none',
    borderRadius: '10px',
    padding: '15px',
    fontWeight: 700,
    fontSize: '15px',
    cursor: 'pointer',
  },
  membershipMessage: {
    color: '#f5c842',
    fontSize: '12px',
    marginTop: '4px',
    lineHeight: 1.4,
  },
  instructions: {
    fontSize: '12px',
    marginTop: '4px',
  },
  instructionsList: {
    textAlign: 'left',
    display: 'inline-block',
    margin: '4px auto 0',
    padding: '0 0 0 20px',
    fontSize: '12px',
    lineHeight: 1.7,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modalCard: {
    position: 'relative',
    width: '100%',
    maxWidth: '360px',
    borderRadius: '18px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 20px 44px rgba(0,0,0,0.45)',
  },
  modalBody: {
    position: 'relative',
    padding: '28px 24px 26px',
    textAlign: 'center',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: '10px',
    right: '12px',
    background: 'transparent',
    border: 'none',
    fontSize: '22px',
    lineHeight: 1,
    cursor: 'pointer',
    padding: '4px',
  },
  modalTitle: {
    margin: '0 0 6px',
    fontSize: '16px',
    fontWeight: 800,
    lineHeight: 1.35,
  },
  poweredBy: {
    marginTop: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 20px',
    borderRadius: '999px',
    border: '1px solid transparent',
    fontSize: '13px',
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  poweredLogo: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    objectFit: 'cover',
  },
};

export default TenantLanding;
