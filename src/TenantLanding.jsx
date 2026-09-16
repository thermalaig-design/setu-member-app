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

const buildTenantUrl = (slug) => {
  const slugPath = String(slug || '').replace(/^\/+|\/+$/g, '');
  if (!slugPath) return '';
  return `${window.location.origin}/app/${encodeURIComponent(slugPath)}/`;
};

// An ordinary https navigation to an in-scope URL is handled by Chrome
// itself — it stays in the tab, which is why "Open App" so often just
// reloads the page instead of switching to the installed app. An
// `intent://` URL is resolved by ANDROID instead of by Chrome, so a WebAPK
// registered for these URLs can actually be launched by it. This is the
// only mechanism a web page has for that; it is still not a guarantee (the
// OS decides), which is what S.browser_fallback_url is for — if nothing
// handles the intent, Chrome lands on the normal https URL exactly as
// before instead of showing an error.
const buildAndroidIntentUrl = (httpsUrl) => {
  try {
    const parsed = new URL(httpsUrl);
    const fallback = encodeURIComponent(httpsUrl);
    return `intent://${parsed.host}${parsed.pathname}#Intent;scheme=https;S.browser_fallback_url=${fallback};end`;
  } catch {
    return '';
  }
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
  // accepts, until the real `appinstalled` event fires; 'finalizing' is
  // after appinstalled but before the app is verified actually launchable
  // (see handleAppInstalled below — appinstalled confirms Chrome
  // registered the install, not that Android's WebAPK package install has
  // finished); 'installed' is the existing success screen, only reached
  // once that verification (or its fallback/max-wait) says so. There is
  // no standard API to force-launch a newly installed PWA, so nothing in
  // this state machine auto-navigates — the success screen's "Open App"
  // button (handleOpenApp below) is the one reliable, user-initiated
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
  // The three timers handleAppInstalled below can start once appinstalled
  // fires, to confirm the app is actually launchable before showing the
  // Open App screen (Android's WebAPK package can still be mid-install for
  // a few more seconds after appinstalled — device shows "Installing
  // <App>...", and opening too early just reloads this browser tab):
  // - postInstallGraceTimeoutRef: the plain ~3s fallback delay used when
  //   navigator.getInstalledRelatedApps() isn't supported.
  // - finalizeCheckTimeoutRef: the getInstalledRelatedApps polling chain
  //   (a recursive setTimeout, not setInterval, so it can stop cleanly).
  // - finalizeMaxTimeoutRef: an outer ~15s cap so the user is never stuck
  //   on the finalizing screen forever if verification never confirms.
  const postInstallGraceTimeoutRef = useRef(null);
  const finalizeCheckTimeoutRef = useRef(null);
  const finalizeMaxTimeoutRef = useRef(null);
  // Guards handleOpenApp below against firing more than once per tap —
  // but only for a short debounce window (openAppResetTimeoutRef clears
  // it again), NOT permanently. The hand-off to an installed PWA is
  // best-effort and often just doesn't happen at all (Chrome stays on
  // this browser page instead) — if this flag were never reset, that
  // single failed attempt would silently disable the button for the rest
  // of the page's life, forcing a full refresh to use it again.
  const openAppInFlightRef = useRef(false);
  const openAppResetTimeoutRef = useRef(null);
  // One-shot, in-memory only (never persisted — a plain ref resets on every
  // remount/page load on its own). Set true ONLY when the user accepts the
  // native install prompt during THIS session (see handleInstallClick), and
  // read/cleared by the auto-entry effect declared after enterTenantTrust
  // below. This is what scopes "automatically continue into the tenant app"
  // to the fresh-install journey specifically — the separate "already
  // installed before this session" detection effect above never touches
  // this ref, so it keeps showing the existing Installed/Open App card
  // exactly as before, with no auto-navigation and no loop risk.
  const autoEnterAfterInstallRef = useRef(false);
  // True from the moment a fresh (this-session) install is verified
  // through to enterTenantTrust()'s async membership check settling — set
  // by markInstalled() itself (in the same batch as installPhase, so there
  // is no render in between where it could be stale) and read by the
  // finalizing render guard below, so the Installed/Open App card never
  // renders for that gap. Reset to false only on a failed resolution (see
  // the auto-entry effect below); on success, enterTenantTrust's own state
  // changes (showTenantHome / tenantAccessState) take over rendering
  // before this is ever consulted again, so no explicit "done" reset is
  // needed there.
  const [autoEntering, setAutoEntering] = useState(false);
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

  // Detects a tenant PWA that was installed in an EARLIER browser session
  // (appinstalled below only ever sees installs completed during the
  // current one). Deliberately does NOT infer "installed" from whether
  // beforeinstallprompt fired/didn't fire — that event's absence has many
  // unrelated causes (already prompted too recently, browser policy,
  // ineligible criteria, etc.) and is not an install-state signal.
  //
  // ALREADY-INSTALLED PAGE BEHAVIOR — deliberately different from the
  // fresh-install journey below: this effect sets isInstalled/
  // installOutcome/installPhase directly (skipping Install App straight to
  // the existing Installed/Open App page, for the user to tap Open App
  // themselves) but NEVER sets autoEnterAfterInstallRef.current = true and
  // NEVER calls enterTenantTrust() itself. Auto-entry is reserved
  // exclusively for an install accepted THIS session (see
  // handleInstallClick/the auto-entry effect after enterTenantTrust below)
  // — wiring it up here too would auto-navigate on every ordinary browser
  // visit to an already-installed tenant's URL, which is a navigation-loop
  // risk this effect must never introduce.
  useEffect(() => {
    if (!normalizedAppSlug) return;

    // Running standalone already means THIS exact tenant PWA is what
    // launched this window — no ambiguity, no API call needed.
    if (isStandaloneDisplay()) {
      setIsInstalled(true);
      setInstallOutcome('installed');
      setInstallPhase('installed');
      return;
    }

    // Still in a normal browser tab: navigator.getInstalledRelatedApps()
    // (Chrome/Android only) is the real "is this installed" signal. Where
    // it isn't supported/available, this simply does nothing — the
    // appinstalled listener below still covers this session's own
    // installs, and otherwise the normal Install App card is shown rather
    // than ever guessing "installed" without real evidence.
    if (typeof navigator === 'undefined' || typeof navigator.getInstalledRelatedApps !== 'function') {
      return undefined;
    }

    let cancelled = false;
    const manifestPath = `/pwa-manifest/${normalizedAppSlug}.webmanifest`.toLowerCase();

    navigator.getInstalledRelatedApps()
      .then((relatedApps) => {
        if (cancelled) return;
        // Per-tenant match against THIS slug's own manifest — a different
        // tenant PWA installed on the same device/browser must never flip
        // this tenant's card to the installed/Open App state; that tenant
        // must still show Install App unless it is itself installed.
        const matchesThisTenant = (Array.isArray(relatedApps) ? relatedApps : []).some((app) => {
          const url = String(app?.url || '').toLowerCase();
          const id = String(app?.id || '').toLowerCase();
          return url.includes(manifestPath) || id.includes(normalizedAppSlug);
        });
        if (matchesThisTenant) {
          setIsInstalled(true);
          setInstallOutcome('installed');
          setInstallPhase('installed');
        }
      })
      .catch(() => {
        // Unsupported/failed — never claim installed without real evidence.
      });

    return () => { cancelled = true; };
  }, [normalizedAppSlug]);

  // Keep a ref mirror of isInstalled so the safety-timeout callback below
  // (started from handleInstallClick, possibly still pending several
  // seconds later) always reads the latest value instead of a stale one
  // captured at setTimeout time.
  useEffect(() => {
    isInstalledRef.current = isInstalled;
  }, [isInstalled]);

  // appinstalled is the only reliable install-*registration* signal — the
  // native prompt's 'accepted' outcome just means the user tapped Install,
  // not that Chrome finished installing it. But appinstalled itself is
  // ALSO not proof the app is actually launchable yet: on Android, the
  // underlying WebAPK package can still be mid-install for a few more
  // seconds after this fires (the device shows "Installing <App>..."),
  // and flipping straight to the Open App screen during that window means
  // tapping it has nothing to hand off to yet — it just reloads this
  // browser tab, repeatedly, since there's still nothing to open. So
  // appinstalled moves to the 'finalizing' phase (its own full-screen
  // transition, not the success screen) and only moves on to 'installed'
  // once one of these actually confirms/gives up:
  // - Where navigator.getInstalledRelatedApps() is supported: polls it
  //   (a short initial delay, then a fixed interval — see the constants
  //   below) until it reports THIS tenant's own app as installed twice in
  //   a row (one positive match could be a transient/stale read; two
  //   consecutive ones is a much stronger signal without waiting for many
  //   more).
  // - Where it isn't supported: falls back to the plain grace delay used
  //   before this change.
  // - Either way, an outer max-wait timeout guarantees the user is never
  //   stuck on 'finalizing' forever if verification never confirms —
  //   appinstalled DID fire, so this eventually trusts it regardless.
  // None of this is a guarantee (no API reports "the WebAPK install
  // actually finished" to wait on instead) — same as everything else
  // about post-install hand-off, it's a heuristic. No automatic
  // navigation/hand-off attempt is made here regardless: there is no
  // standard API to force-launch a newly installed PWA, and any attempt
  // fired from this callback runs outside a user gesture, so a same-tab
  // navigation could yank the user away from the success screen
  // unexpectedly and a new-tab attempt would likely just be popup-blocked.
  // The success screen's "Open App" button (handleOpenApp below) is the
  // one reliable, user-initiated launch action.
  useEffect(() => {
    // First getInstalledRelatedApps() check fires this long after
    // appinstalled; subsequent checks repeat at this interval; two
    // consecutive positive matches are required before trusting it; and
    // the whole finalizing phase gives up (and just trusts appinstalled)
    // after this long regardless of which path is verifying it.
    const FIRST_CHECK_DELAY_MS = 1200;
    const CHECK_INTERVAL_MS = 750;
    const REQUIRED_CONSECUTIVE_MATCHES = 2;
    const UNSUPPORTED_FALLBACK_DELAY_MS = 3000;
    const MAX_FINALIZING_MS = 15000;

    const clearAllFinalizeTimers = () => {
      if (postInstallGraceTimeoutRef.current) {
        clearTimeout(postInstallGraceTimeoutRef.current);
        postInstallGraceTimeoutRef.current = null;
      }
      if (finalizeCheckTimeoutRef.current) {
        clearTimeout(finalizeCheckTimeoutRef.current);
        finalizeCheckTimeoutRef.current = null;
      }
      if (finalizeMaxTimeoutRef.current) {
        clearTimeout(finalizeMaxTimeoutRef.current);
        finalizeMaxTimeoutRef.current = null;
      }
    };

    const markInstalled = () => {
      clearAllFinalizeTimers();
      setIsInstalled(true);
      setInstallOutcome('installed');
      // For a fresh install accepted this session, flip autoEntering in
      // the SAME batch as installPhase below — React 18 batches these
      // into one commit, so the finalizing/autoEntering render guard never
      // sees installPhase === 'installed' with autoEntering still false.
      // Doing this from the separate auto-entry effect instead (which only
      // runs after this commit has already painted) left exactly that one
      // render — and the Installed/Open App card flashing during it —
      // uncovered.
      if (autoEnterAfterInstallRef.current) {
        setAutoEntering(true);
      }
      setInstallPhase('installed');
    };

    const handleAppInstalled = () => {
      if (acceptedTimeoutRef.current) {
        clearTimeout(acceptedTimeoutRef.current);
        acceptedTimeoutRef.current = null;
      }
      clearInstallPrompt();
      setDeferredPrompt(null);
      setInstallPhase('finalizing');

      // Never leave the user stuck finalizing forever if verification
      // below never confirms — appinstalled already fired, so eventually
      // trust it regardless of which path (or neither) confirmed it.
      finalizeMaxTimeoutRef.current = setTimeout(markInstalled, MAX_FINALIZING_MS);

      if (typeof navigator === 'undefined' || typeof navigator.getInstalledRelatedApps !== 'function') {
        postInstallGraceTimeoutRef.current = setTimeout(markInstalled, UNSUPPORTED_FALLBACK_DELAY_MS);
        return;
      }

      const expectedId = `/app/${normalizedAppSlug}`.toLowerCase();
      const manifestPath = `/pwa-manifest/${normalizedAppSlug}.webmanifest`.toLowerCase();
      let consecutiveMatches = 0;

      const checkInstalled = () => {
        navigator.getInstalledRelatedApps()
          .then((relatedApps) => {
            // Per-tenant match against THIS slug specifically — a
            // different tenant PWA installed on the same device/browser
            // must never confirm this one as finalized.
            const matches = (Array.isArray(relatedApps) ? relatedApps : []).some((app) => {
              const id = String(app?.id || '').toLowerCase();
              const url = String(app?.url || '').toLowerCase();
              return id === expectedId || url.includes(manifestPath);
            });
            consecutiveMatches = matches ? consecutiveMatches + 1 : 0;
            if (consecutiveMatches >= REQUIRED_CONSECUTIVE_MATCHES) {
              markInstalled();
              return;
            }
            finalizeCheckTimeoutRef.current = setTimeout(checkInstalled, CHECK_INTERVAL_MS);
          })
          .catch(() => {
            consecutiveMatches = 0;
            finalizeCheckTimeoutRef.current = setTimeout(checkInstalled, CHECK_INTERVAL_MS);
          });
      };

      finalizeCheckTimeoutRef.current = setTimeout(checkInstalled, FIRST_CHECK_DELAY_MS);
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
      clearAllFinalizeTimers();
    };
  }, [normalizedAppSlug]);

  // Not every Chromium build fires appinstalled after 'accepted' (browser
  // bugs, unusual install flows, older/newer versions behaving
  // inconsistently) — clear the safety timeout on unmount so it never
  // fires setState after this component is gone. (The finalizing timers
  // started from handleAppInstalled above are cleaned up by that same
  // effect's own cleanup, since they're created and torn down together.)
  // Also clears handleOpenApp's debounce-reset timeout for the same
  // reason — it only ever touches a plain ref, but no pending timer
  // should outlive the component regardless.
  useEffect(() => () => {
    if (acceptedTimeoutRef.current) {
      clearTimeout(acceptedTimeoutRef.current);
      acceptedTimeoutRef.current = null;
    }
    if (openAppResetTimeoutRef.current) {
      clearTimeout(openAppResetTimeoutRef.current);
      openAppResetTimeoutRef.current = null;
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

  // Fresh-install auto-continue: once a verified-installed state is
  // reached FOR AN INSTALL ACCEPTED THIS SESSION (autoEnterAfterInstallRef
  // — set only in handleInstallClick's accepted branch above, never by the
  // separate "already installed before this session" detection effect),
  // immediately run the exact same tenant-access flow the installed PWA
  // itself uses instead of leaving the user on an Installed/Open App card
  // they'd have to tap through. Reusing enterTenantTrust() as-is means
  // login/public/private/pending/needs-profile behavior is 100% unchanged
  // — this effect only decides WHEN to call it, never what it does.
  // (autoEntering itself is already set to true by markInstalled above, in
  // the same batch as installPhase — not here — so there is no render in
  // between where the finalizing guard could miss it.)
  //
  // Loop protection: the ref is reset to false BEFORE calling
  // enterTenantTrust(), so this can only ever fire once per accepted
  // install — later re-renders (including the ones enterTenantTrust's own
  // state updates cause) see the ref already false and no-op immediately.
  // The ref is an in-memory-only useRef, so it can't survive a page
  // refresh either; a refreshed page starts at autoEnterAfterInstallRef =
  // false, same as any other fresh mount.
  useEffect(() => {
    if (!autoEnterAfterInstallRef.current) return;
    if (installPhase !== 'installed' || !isInstalled) return;

    autoEnterAfterInstallRef.current = false;

    // Single best-effort attempt (never repeated — this effect only ever
    // runs once per accepted install, same guard as above) to hand off to
    // the just-installed standalone app, same idea as apps like AppSheet.
    // Deliberately a NEW browsing context, not a same-tab
    // window.location.assign(): a same-tab attempt that fails to hand off
    // would reload THIS tab back to /app/<slug>/, discarding the in-memory
    // autoEnterAfterInstallRef/fresh-install state and losing the "no
    // success page" guarantee (the reloaded page would show the plain
    // Installed/Open App card instead, via the separate already-installed
    // detection effect). A new-context attempt can only ever help — if
    // Android hands it off, the app opens in its own window; if it's
    // blocked as a non-gesture popup or just opens another browser tab,
    // this tab is completely unaffected and the enterTenantTrust() call
    // below still continues the tenant app flow here exactly as before.
    try {
      const tenantUrl = buildTenantUrl(normalizedAppSlug);
      // On Android an intent:// URL is what the OS (not Chrome) resolves,
      // so the freshly installed WebAPK can actually pick it up; elsewhere
      // there is no such mechanism, so the plain URL is all there is.
      const launchUrl = (isAndroid() && buildAndroidIntentUrl(tenantUrl)) || tenantUrl;
      if (launchUrl) {
        window.open(launchUrl, '_blank', 'noopener');
      }
    } catch {
      // ignore — enterTenantTrust() below still continues in this tab
    }

    enterTenantTrust()
      .then((success) => {
        // A successful outcome moves rendering on via showTenantHome /
        // tenantAccessState (checked earlier in the render than the
        // finalizing/autoEntering branch below), so no "done" reset is
        // needed there. A failure (e.g. a transient network error) must
        // not strand the user on the finalizing loader forever though —
        // fall back to the existing Installed/Open App card, which
        // already surfaces enterTenantTrust's own membershipMessage and
        // still lets them continue manually via Open App.
        if (!success) setAutoEntering(false);
      })
      .catch(() => {
        setAutoEntering(false);
      });
  }, [installPhase, isInstalled, enterTenantTrust, normalizedAppSlug]);

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

  // Full-screen transition covering the ENTIRE install flow from the
  // moment the user taps Install (replacing the tenant card entirely — no
  // card, no "Powered by Setu", no install instructions, no Open App, no
  // success checkmark) through to verified-installed:
  // - 'prompting': deferredPrompt.prompt() is awaiting the user's choice
  //   in the native browser dialog. This must render too, not just
  //   'launching' — otherwise the Install App card is still what's
  //   sitting underneath/behind that dialog, and can flash back into view
  //   the instant it closes but before 'launching' is set.
  // - 'launching': the user accepted; waiting on the real `appinstalled`
  //   event.
  // - 'finalizing': appinstalled fired, but Android's WebAPK package can
  //   still be mid-install for a few more seconds — waiting on
  //   handleAppInstalled's verification (or its fallback/max-wait) below
  //   before trusting the app is actually launchable. Gets its own,
  //   more active-looking UI (indeterminate progress bar) since this is
  //   the phase most likely to run long enough on a slow Android device
  //   that a plain spinner reads as "stuck"/"failed" to the user.
  // - autoEntering (fresh-install path only, see the effect declared after
  //   enterTenantTrust above): installPhase has already reached 'installed'
  //   but enterTenantTrust()'s own async membership check is still in
  //   flight — this keeps the SAME finalizing UI up instead of letting the
  //   Installed/Open App card render for that gap, so a fresh install
  //   never shows that card at all before continuing into the tenant app.
  // See handleInstallClick/handleAppInstalled above for the state
  // transitions and the safety-timeout fallbacks. ('idle' — e.g. the user
  // dismissed the dialog — correctly falls through to the normal card
  // below; only a genuine dismissal should ever bring it back.)
  if (installPhase === 'finalizing' || autoEntering) {
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <h2 style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '18px', fontWeight: 800, marginTop: '18px' }}>
          Installing on your device…
        </h2>
        <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '6px' }}>
          Almost ready — this can take a few extra seconds.
        </p>
        <div style={{ width: '220px', maxWidth: '72vw', height: '6px', borderRadius: '999px', overflow: 'hidden', marginTop: '22px', background: palette.cardBorder }}>
          {/* Indeterminate only — Chrome exposes no real WebAPK install
              byte progress, so this must never show a fake percentage. */}
          <div
            className="tenant-install-progress-bar"
            style={{ width: '40%', height: '100%', borderRadius: '999px', background: accentGradient }}
          />
        </div>
        <p style={{ ...styles.loadingText, color: palette.textMuted, marginTop: '12px', fontSize: '12px' }}>
          Please keep this screen open.
        </p>
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes tenantInstallProgress {
            0% { transform: translateX(-140%); }
            50% { transform: translateX(120%); }
            100% { transform: translateX(340%); }
          }
          .tenant-install-progress-bar {
            animation: tenantInstallProgress 1.4s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  if (installPhase === 'prompting' || installPhase === 'launching') {
    const isPrompting = installPhase === 'prompting';
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <p style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '15px', fontWeight: 700, marginTop: '18px' }}>
          {isPrompting ? 'Preparing installation…' : 'Launching your app…'}
        </p>
        <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '4px' }}>
          {isPrompting ? 'Complete the install prompt to continue.' : 'Please wait while we finish setting things up.'}
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
        // This is what scopes the auto-continue-into-app-flow behavior
        // (see the effect declared after enterTenantTrust below) to THIS
        // fresh install specifically — never a tenant detected as already
        // installed from an earlier session.
        autoEnterAfterInstallRef.current = true;
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
            // Gave up waiting on this attempt — it's no longer "in
            // progress", so a later, unrelated install-detection isn't
            // mistaken for this one.
            autoEnterAfterInstallRef.current = false;
            setInstallOutcome('');
            setInstallPhase('idle');
          }
        }, 20000);
      } else {
        autoEnterAfterInstallRef.current = false;
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

  // How long a tap "locks" handleOpenApp against a duplicate tap before
  // automatically unlocking again (see the ref's own comment above).
  const OPEN_APP_RETRY_RESET_MS = 1500;

  // The primary launch action, and the only one that is user-initiated
  // (this click is what makes it a real user gesture) — a top-level
  // navigation (not client-side routing) to the exact tenant URL, so
  // Chrome/Android gets a chance to hand it off to the installed PWA via
  // its app/URL association. That handoff is entirely browser/OS-
  // controlled and not guaranteed; if it doesn't happen, this just
  // reloads the page, which is why the helper text below points the user
  // at their Home Screen icon as the fallback.
  //
  // Guarded against firing more than once per tap (openAppInFlightRef,
  // declared with the component's other refs above), but only for a
  // short debounce window (OPEN_APP_RETRY_RESET_MS): a second
  // window.location.assign() call while the first is still in flight
  // (double-tap, or the click landing on both the button and the card's
  // own onClick below) aborts that first navigation and restarts it. That
  // debounce window MUST expire on its own though — the hand-off to an
  // installed PWA is best-effort and the common case is Chrome just
  // staying on this page, not unloading it, so a permanent lock here
  // would silently disable the button after its first (failed) attempt
  // until the user refreshes.
  //
  // The installPhase/isInstalled check up front is a defensive repeat of
  // the button's own render gate below (installPhase === 'installed' &&
  // isInstalled) — this function must never actually launch anything
  // while Android could still be finishing installation, even if it were
  // ever invoked some other way.
  const handleOpenApp = () => {
    if (installPhase !== 'installed' || !isInstalled) return;

    if (openAppInFlightRef.current) return;

    openAppInFlightRef.current = true;

    // Exactly one trailing slash, always — matches the installed PWA's
    // own scope/start_url so Chrome/Android has the best chance of
    // recognizing this as "the same app" instead of an ordinary page.
    const tenantUrl = buildTenantUrl(normalizedAppSlug);

    if (!tenantUrl) {
      openAppInFlightRef.current = false;
      return;
    }

    if (openAppResetTimeoutRef.current) {
      window.clearTimeout(openAppResetTimeoutRef.current);
    }

    openAppResetTimeoutRef.current = window.setTimeout(() => {
      openAppInFlightRef.current = false;
      openAppResetTimeoutRef.current = null;
    }, OPEN_APP_RETRY_RESET_MS);

    // Android: hand the URL to the OS intent resolver rather than
    // navigating this tab, so an installed WebAPK can actually take it
    // (see buildAndroidIntentUrl). Its browser_fallback_url means a device
    // without the app installed still lands on the normal URL, i.e. the
    // exact behavior this button had before. Everywhere else (desktop,
    // iOS) there is no such mechanism at all — plain navigation as before.
    const androidIntentUrl = isAndroid() ? buildAndroidIntentUrl(tenantUrl) : '';
    window.location.assign(androidIntentUrl || tenantUrl);
  };

  // Single click handler shared by the whole card (see cardBody below) so
  // Install/Open App/mid-install all stay mutually exclusive with no
  // duplicate handlers on the button itself.
  const handleCardClick = () => {
    if (isInstalled) {
      handleOpenApp();
      return;
    }
    if (installPhase === 'prompting' || installPhase === 'launching' || installPhase === 'finalizing' || autoEntering) return;
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

          {installPhase === 'installed' && isInstalled ? (
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

          {installPhase === 'installed' && isInstalled ? (
            <button
              type="button"
              className="tenant-install-btn"
              style={{ ...styles.installBtn, background: accentGradient, color: accent.text, boxShadow: `0 10px 26px ${accentGlow(0.4)}` }}
              // Direct handler on the button itself (not just relying on
              // the card's own onClick bubbling up to it) — the actual
              // launch action the user taps should never depend on an
              // event making it through the rest of the card first.
              onClick={(event) => {
                event.stopPropagation();
                handleOpenApp();
              }}
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

          {installPhase === 'installed' && isInstalled && (
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
