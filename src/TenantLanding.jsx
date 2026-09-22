import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import { isReservedSlug } from './constants/reservedRoutes';
import { fetchMemberTrustMemberships, resolveTenantAppAccess, resolveAccessAllowed, syncTenantMembershipName } from './services/trustService';
import { mergeTenantMembershipEntry } from './utils/tenantAuthSelection';
import { saveProfile } from './services/api';
import { getUserHospitalMemberships, clearTenantUserSession } from './utils/storageUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import { getInstallPrompt, clearInstallPrompt, subscribeInstallPrompt } from './utils/installPrompt';
import {
  readPendingRecord,
  writePendingRecord,
  clearPendingRecord,
  isInstallVerified,
  writeVerifiedRecord,
  clearVerifiedRecord,
  resolveInstallUiState,
  readCountdownDeadline,
  writeCountdownDeadline,
  clearCountdownDeadline,
  INSTALL_COUNTDOWN_DURATION_MS
} from './utils/installPendingState';
import Home from './Home';

import TenantProfileModal from './components/TenantProfileModal';

const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const PENDING_CREATED_APP_URL_KEY = 'pending_created_app_install_url';
const PENDING_CREATED_APP_TS_KEY = 'pending_created_app_install_url_ts';
const normalizeText = (value) => String(value || '').trim();

// TEMPORARY DIAGNOSTICS — added to compare the install flow on
// /app/business-app against a known-working tenant side by side on a real
// device. console.log only, never changes behavior/state and never renders
// anything into the page — an on-screen debug overlay used to live here too
// (a fixed DOM node appended straight to <body>) but has been removed from
// the user-facing UI; reproduce on-device now via chrome://inspect remote
// debugging instead. Safe to delete entirely once the tenant-specific cause
// is confirmed and fixed; every call site is tagged `logInstallFlow(...)`
// so they're easy to find and strip.
const INSTALL_FLOW_DEBUG = true;
const logInstallFlow = (label, data) => {
  if (!INSTALL_FLOW_DEBUG || typeof console === 'undefined') return;
  try {
    console.log(`[install-flow:${label}]`, data);
  } catch {
    // ignore
  }
};

// ANDROID FRESH-INSTALL PATH: after the user accepts the native install
// prompt, Android's WebAPK package install is a real OS-level operation that
// can run long enough for Chrome to background/discard this tab's renderer
// on a low-memory device — the tab then comes back via a genuine document
// reload, not a same-session remount. Every other piece of "did the user
// just accept install" state in this component (deferredPrompt,
// autoEnterAfterInstallRef, installPhase) lives in memory and is wiped by
// that reload, which is exactly what used to bring back the Install App
// card (and a second "Installing…" loader once appinstalled/verification
// caught up on the fresh page) even though the user had already accepted.
// This localStorage-backed flag (see installPendingState.js) is the one
// piece of that state that survives a same-tab reload, so the very first
// render after such a reload can resume straight into the waiting loader
// instead of flashing Install App again.
// Keyed per-slug (tenant_install_pending_v1:<slug>) rather than one shared
// key, so two different tenant PWAs mid-install in two different tabs at
// the same time can never clobber each other's pending flag. The actual
// record read/write/clear logic lives in utils/installPendingState.js (kept
// framework-free so it's unit-testable under plain `node --test`) — the
// thin wrappers below add this file's diagnostic logging on top of it.
//
// FRESH-INSTALL SUCCESS UI IS GATED BY THE REAL `appinstalled` EVENT ONLY.
// Two independent persisted records exist (see installPendingState.js's own
// comments for the full reasoning):
// - the PENDING record: "accepted, appinstalled not seen yet" — always
//   time-bounded (INSTALL_PENDING_MAX_AGE_MS), refreshed by the heartbeat
//   below for as long as we're waiting.
// - the VERIFIED record: written ONLY by handleAppInstalled, the instant a
//   genuine `appinstalled` DOM event fires — never by a timeout, a
//   heartbeat tick, or an early getInstalledRelatedApps() match. This used
//   to also be reachable via a `trustFallback` timeout and a resumed
//   "confirmed" pending record, which is exactly what let an earlier
//   [install-flow:appinstalled-fired] log show `alreadyInstalled: true` —
//   proof the app had already been marked installed before Chrome's own
//   event fired. Both of those promotion paths are gone: nothing but a
//   real appinstalled event (this session, or a persisted verified record
//   from an earlier one) can ever move this UI to the success/Open-App
//   screen.
//
//   The record also carries a POST-APPINSTALLED SETTLE WINDOW
//   (POST_APPINSTALLED_SETTLE_MS below): Android Chrome's `appinstalled`
//   can fire before the WebAPK/home-screen app is actually reliably
//   launchable, so appinstalled alone still isn't treated as "done" —
//   handleAppInstalled writes the verified record with a `readyAt`
//   deadline POST_APPINSTALLED_SETTLE_MS in the future, keeps installPhase
//   at 'finalizing' (still a loader, NOT the success screen) for exactly
//   that long, and only moves to 'installed' once `now >= readyAt` (see
//   scheduleSettle/completeSettle below). This delay is a stabilization
//   window ONLY, never proof of success by itself: if appinstalled never
//   fires at all, nothing here ever promotes to installed, no matter how
//   much time passes (the fresh-install flow stays in 'unconfirmed',
//   subject only to the existing pending-record staleness recovery).
//   readyAt is persisted (not a plain in-memory timer) specifically so a
//   remount/tab-discard mid-window resumes the REMAINING time rather than
//   restarting a fresh 20s, and a remount past the deadline shows success
//   immediately — see resolveInstallUiState in installPendingState.js and
//   its own tests for the exact math.
//
//   handleAppInstalled's order is strict: write the verified+readyAt
//   record FIRST, then set installPhase, then clear the pending record —
//   a remount racing any point in that sequence still finds at least the
//   verified record and resumes the settle window (or the success screen,
//   if the window had already elapsed) correctly.
//
// Mount-time state is always seeded via resolveInstallUiState in
// installPendingState.js (and its own unit tests): verified+settled ->
// verified+still-settling -> pending -> idle priority. A pending-without-
// verified record, or a verified-but-still-settling one, always renders a
// loader — never Install App and never success; only the total absence of
// both shows Install App. getInstalledRelatedApps() may still run as
// secondary, informational verification (see the separate "already
// installed on an earlier visit" mount effect below), but it must never by
// itself promote this fresh-install flow's UI before appinstalled (and its
// settle window) does.
//
// `/app/<slug>` and `/app/<slug>/` are treated as the same install identity
// throughout (normalizeSlugIdentity strips a trailing slash inside
// installPendingState.js, applied to every read/write here).
const INSTALL_PENDING_HEARTBEAT_MS = 5000;
// How long AFTER a real `appinstalled` event fires this component keeps
// showing the loader before trusting the app is actually launchable — see
// the big comment above. Requirement (1): a named constant, not a magic
// number, so this window is easy to find/tune later.
const POST_APPINSTALLED_SETTLE_MS = 20000;

const readInstallPending = (slug) => {
  const record = readPendingRecord(slug);
  logInstallFlow('pending-read', { requestedSlug: slug, record, result: Boolean(record) });
  return Boolean(record);
};

const readInstallVerified = (slug) => {
  const verified = isInstallVerified(slug);
  logInstallFlow('verified-read', { requestedSlug: slug, verified });
  return verified;
};

const writeInstallPending = (slug) => {
  const value = writePendingRecord(slug);
  if (value) {
    logInstallFlow('pending-write', value);
  } else {
    // Private-mode/quota failure — worst case the reload-resume fallback
    // below simply doesn't kick in; the rest of the flow is unaffected.
    logInstallFlow('pending-write-failed', { slug });
  }
};

const clearInstallPending = (slug, reason) => {
  clearPendingRecord(slug);
  logInstallFlow('pending-clear', { slug, reason: reason || 'unspecified' });
};

// `readyAt` omitted means "already settled" (see writeVerifiedRecord's own
// comment) — used by the independent "already installed" detection below,
// which has nothing to stabilize. A real appinstalled event always passes
// an explicit future `readyAt`.
const writeInstallVerified = (slug, options) => {
  const value = writeVerifiedRecord(slug, options);
  logInstallFlow('verified-write', { slug, value });
};

const clearInstallVerified = (slug, reason) => {
  clearVerifiedRecord(slug);
  logInstallFlow('verified-clear', { slug, reason: reason || 'unspecified' });
};

// Thin wrappers (same pattern/diagnostics as the pending/verified ones
// above) around the countdown-deadline helpers in installPendingState.js.
// Purely presentational bookkeeping — see that module's own comment: this
// never feeds resolveInstallUiState and never gates isInstalled/installPhase.
const readInstallCountdown = (slug) => {
  const deadline = readCountdownDeadline(slug);
  logInstallFlow('countdown-read', { slug, deadline });
  return deadline;
};

const writeInstallCountdown = (slug) => {
  const deadline = writeCountdownDeadline(slug);
  logInstallFlow('countdown-write', { slug, deadline });
  return deadline;
};

const clearInstallCountdown = (slug, reason) => {
  clearCountdownDeadline(slug);
  logInstallFlow('countdown-clear', { slug, reason: reason || 'unspecified' });
};

// Ticks every 300ms while `active`, always recomputing the remaining time
// from the persisted `deadline` timestamp rather than decrementing a
// counter each tick — mobile browsers throttle/suspend timers in a
// backgrounded tab, so a plain `count--` would drift or stall. Reading
// Date.now() against a fixed deadline on every tick self-corrects
// regardless of how many ticks actually fired while backgrounded.
const useRemainingMs = (deadline, active) => {
  const [remainingMs, setRemainingMs] = useState(() => (
    typeof deadline === 'number' ? Math.max(0, deadline - Date.now()) : 0
  ));
  useEffect(() => {
    if (!active || typeof deadline !== 'number') return undefined;
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [deadline, active]);
  return remainingMs;
};

const usePrefersReducedMotion = () => {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const handleChange = () => setReduced(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', handleChange);
    else mql.addListener(handleChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handleChange);
      else mql.removeListener(handleChange);
    };
  }, []);
  return reduced;
};

const INSTALL_COUNTDOWN_RING_SIZE = 124;
const INSTALL_COUNTDOWN_RING_STROKE = 8;

// Clock-face ring: a glowing gradient progress arc over a 12-tick dial (the
// ticks are pure decoration — a plain <circle> track underneath still
// carries the actual progress via stroke-dashoffset, animated with CSS
// (skipped under prefers-reduced-motion) rather than a JS animation loop. A
// soft blurred halo behind it (also skipped under reduced motion) is what
// gives it the "alive"/premium feel instead of a flat ring.
function InstallCountdownRing({ progress, confirmed, reducedMotion, accentFrom, accentTo, trackColor, glowColor, children }) {
  const size = INSTALL_COUNTDOWN_RING_SIZE;
  const center = size / 2;
  const radius = (size - INSTALL_COUNTDOWN_RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = confirmed ? 1 : Math.min(1, Math.max(0, progress));
  const dashOffset = circumference * (1 - clampedProgress);
  const gradientId = 'tenant-install-ring-gradient';
  const tickOuter = radius - INSTALL_COUNTDOWN_RING_STROKE / 2 - 3;
  const tickInner = tickOuter - 6;
  const wrapSize = size + 36;

  return (
    <div style={{ position: 'relative', width: `${wrapSize}px`, height: `${wrapSize}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        aria-hidden="true"
        className={reducedMotion ? undefined : 'tenant-install-ring-glow'}
        style={{
          position: 'absolute',
          width: `${size + 20}px`,
          height: `${size + 20}px`,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${glowColor} 0%, transparent 72%)`,
          filter: 'blur(18px)',
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'relative', filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.25))' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accentFrom} />
            <stop offset="100%" stopColor={accentTo} />
          </linearGradient>
        </defs>
        <g stroke={trackColor} strokeWidth="2" strokeLinecap="round" opacity="0.9">
          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1={center}
              y1={center - tickOuter}
              x2={center}
              y2={center - tickInner}
              transform={`rotate(${i * 30} ${center} ${center})`}
            />
          ))}
        </g>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={INSTALL_COUNTDOWN_RING_STROKE}
          opacity="0.55"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={INSTALL_COUNTDOWN_RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={reducedMotion ? undefined : { transition: 'stroke-dashoffset 0.3s linear' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
      <style>{`
        @keyframes tenantInstallRingPulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.1); opacity: 0.95; }
        }
        .tenant-install-ring-glow {
          animation: tenantInstallRingPulse 2.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function InstallCheckmark({ color, reducedMotion }) {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="tenant-install-checkmark-path"
        style={{ animation: reducedMotion ? 'none' : 'tenantInstallCheckmarkDraw 0.5s ease-out' }}
      />
    </svg>
  );
}

// The single full-screen surface for the ENTIRE fresh-install wait — see
// its render-site comment in TenantLanding for exactly which installPhase
// values map to it. This component OWNS NONE of the install state: it only
// reads `confirmed` (mirrors the one existing "installed" definition,
// installPhase === 'installed' && isInstalled) and a persisted countdown
// deadline, and purely as DISPLAY — reaching 0 here never marks anything
// installed; only a genuine `appinstalled` event (handled entirely outside
// this component) ever does that.
function InstallCountdownScreen({
  trustName,
  logoUrl,
  backgroundColor,
  palette,
  accent,
  accentGradient,
  accentGlow,
  countdownEndsAt,
  confirmed,
  onOpenApp,
}) {
  const reducedMotion = usePrefersReducedMotion();
  // Stop ticking once confirmed — the ring snaps straight to full/checkmark
  // and there is nothing left to count down to.
  const remainingMs = useRemainingMs(countdownEndsAt, !confirmed);
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = confirmed
    ? 1
    : Math.min(1, Math.max(0, (INSTALL_COUNTDOWN_DURATION_MS - remainingMs) / INSTALL_COUNTDOWN_DURATION_MS));
  const timedOut = !confirmed && remainingMs <= 0;
  const almostReady = !confirmed && !timedOut && remainingSeconds <= 10;
  // Same colorful ambient background (radial glow + two soft orbs) as the
  // main Install App card, instead of a flat single color — purely visual,
  // no effect on the state this screen reads.
  const pageBackground = `radial-gradient(circle at 50% 12%, ${accentGlow(0.24)}, transparent 55%), ${backgroundColor}`;

  let heading = `Installing ${trustName}…`;
  let subtext = 'We’re adding your app to this device. Please keep this screen open.';
  let statusLine = `About ${remainingSeconds}s remaining`;

  if (confirmed) {
    heading = `${trustName} is ready`;
    // Leads with the Home Screen icon as the RELIABLE way to open the app
    // standalone — a plain web page (even this one) generally cannot force
    // Android to hand a link off to an installed PWA the way tapping its
    // own Home Screen icon does, so "Open App" below is a best-effort
    // extra, never the primary instruction.
    subtext = `${trustName} has been added to your Home Screen. For the full app experience, open it from there.`;
    statusLine = '';
  } else if (timedOut) {
    heading = 'Installation is taking a little longer';
    subtext = 'Please check your Home Screen. The app icon may appear in a few moments.';
    statusLine = '';
  } else if (almostReady) {
    subtext = 'Almost ready…';
  }

  return (
    <div style={{ ...styles.page, background: pageBackground, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)', justifyContent: 'flex-start' }}>
      <div style={{ ...styles.glowOrb, top: '-70px', left: '-60px', background: accentGlow(0.4) }} />
      <div style={{ ...styles.glowOrb, bottom: '-70px', right: '-60px', background: accentGlow(0.28) }} />

      <p style={{ ...styles.eyebrow, color: palette.textMuted, marginBottom: '18px' }}>
        {confirmed ? 'Almost there' : 'Installing App'}
      </p>

      {logoUrl ? (
        <div
          style={{
            ...styles.countdownLogoWrap,
            background: accentGradient,
            boxShadow: `0 12px 30px ${accentGlow(0.35)}`,
          }}
        >
          <img src={logoUrl} alt="" style={styles.countdownLogo} />
        </div>
      ) : null}

      <div style={{ marginTop: logoUrl ? '26px' : '8px' }}>
        <InstallCountdownRing
          progress={progress}
          confirmed={confirmed}
          reducedMotion={reducedMotion}
          accentFrom={accent.from}
          accentTo={accent.to}
          trackColor={palette.cardBorder}
          glowColor={accentGlow(0.5)}
        >
          {confirmed
            ? <InstallCheckmark color={accent.from} reducedMotion={reducedMotion} />
            : (
              <span key={remainingSeconds} className={reducedMotion ? undefined : 'tenant-install-countdown-number'} style={{ ...styles.countdownNumber, color: palette.textPrimary }}>
                {remainingSeconds}s
              </span>
            )}
        </InstallCountdownRing>
      </div>

      <h2 style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '19px', fontWeight: 800, marginTop: '26px', maxWidth: '320px' }}>
        {heading}
      </h2>
      <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '6px', maxWidth: '300px' }}>
        {subtext}
      </p>
      {statusLine ? (
        <p style={{ ...styles.loadingText, color: accent.from, marginTop: '10px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.3px' }}>
          {statusLine}
        </p>
      ) : null}

      {confirmed ? (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 16px',
            borderRadius: '12px',
            background: palette.cardBackground,
            border: `1px solid ${palette.cardBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            maxWidth: '300px',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: '20px', lineHeight: 1 }}>🏠</span>
          <p style={{ ...styles.loadingText, color: palette.textPrimary, margin: 0, fontSize: '12.5px', textAlign: 'left', lineHeight: 1.45 }}>
            Look for the <strong>{trustName}</strong> icon on your Home Screen / App Drawer — that's the surest way to open it as its own app.
          </p>
        </div>
      ) : null}

      {(confirmed || timedOut) && typeof onOpenApp === 'function' ? (
        <>
          <button
            type="button"
            className="tenant-install-btn"
            style={{ ...styles.installBtn, width: 'auto', padding: '13px 30px', marginTop: '18px', background: accentGradient, color: accent.text, boxShadow: `0 10px 26px ${accentGlow(0.4)}` }}
            onClick={onOpenApp}
          >
            <span>{confirmed ? 'Try Open App' : 'Open App'}</span>
            <span className="tenant-install-btn-arrow" aria-hidden="true">→</span>
          </button>
          <p style={{ ...styles.loadingText, color: palette.textMuted, marginTop: '10px', fontSize: '12px', maxWidth: '280px' }}>
            {confirmed
              ? 'This may open inside your browser instead of the installed app — that’s expected on some devices.'
              : 'You can try opening the app now, or check your Home Screen / Apps in a moment.'}
          </p>
        </>
      ) : (
        <p style={{ ...styles.loadingText, color: palette.textMuted, marginTop: '18px', fontSize: '12px' }}>
          Please keep this screen open.
        </p>
      )}

      <style>{`
        @keyframes tenantInstallCheckmarkDraw {
          from { stroke-dasharray: 32; stroke-dashoffset: 32; }
          to { stroke-dasharray: 32; stroke-dashoffset: 0; }
        }
        @keyframes tenantInstallNumberTick {
          0% { transform: scale(1.14); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
        .tenant-install-countdown-number {
          display: inline-block;
          animation: tenantInstallNumberTick 0.35s ease-out;
        }
      `}</style>
    </div>
  );
}

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

// Detects "this page load is very likely a continuation of an install the
// user just accepted on this exact tenant's own page" — WITHOUT relying on
// any Web Storage. Real-device testing showed Android/Chrome can, on some
// devices, hand a just-accepted install off into a browsing context that
// shares neither sessionStorage nor localStorage with the original tab, so
// storage-based signals (INSTALL_PENDING_KEY) cannot be trusted to survive
// that specific transition. document.referrer, however, is set by the
// browser itself as part of that very navigation and needs no storage to
// read: when Chrome auto-navigates this tab to its canonical URL once the
// WebAPK finishes installing, the new page's referrer is the tenant's own
// previous URL. An ordinary fresh visitor (typed URL, bookmark, external
// link, QR code, home-screen icon) essentially never has that same-tenant
// referrer. This is used only to decide whether it's worth waiting longer
// for a delayed appinstalled/getInstalledRelatedApps signal before ever
// showing the Install App card — never to claim anything is installed by
// itself.
const isLikelyInstallContinuation = (slug) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  try {
    const ref = document.referrer;
    if (!ref) return false;
    const refUrl = new URL(ref);
    if (refUrl.origin !== window.location.origin) return false;
    const match = refUrl.pathname.match(/^\/app\/([^/?#]+)/i);
    const refSlug = match && match[1] ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
    return Boolean(refSlug) && refSlug === slug;
  } catch {
    return false;
  }
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
const buildAndroidIntentUrl = (httpsUrl, { includeFallback = true } = {}) => {
  try {
    const parsed = new URL(httpsUrl);
    const intentHead = `intent://${parsed.host}${parsed.pathname}#Intent;scheme=https;`;
    const fallbackPart = includeFallback
      ? `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};`
      : '';
    return `${intentHead}${fallbackPart}end`;
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
  const location = useLocation();
  const { tenantTrust, tenantLoading, tenantError, resolveTenantFromSlug, installedSlug } = useTenant();

  // Trailing slash stripped so /app/<slug> and /app/<slug>/ are always the
  // same install identity (item 9) — react-router already treats them as
  // the same route, but this also keeps every getInstalledRelatedApps
  // id/manifest-path comparison below and every installPendingState.js
  // storage key derived from this value consistent regardless of which
  // variant a given navigation lands on.
  const normalizedAppSlug = normalizeText(appSlug).toLowerCase().replace(/\/+$/, '');
  const forceInstallLanding = new URLSearchParams(location.search || '').get('install') === '1';
  // TenantProvider wraps the whole app and outlives TenantLanding, so a
  // matching tenantTrust here means this slug was already resolved earlier
  // this page session (e.g. we're remounting because the user opened
  // another in-app route and came back) — no need to re-fetch or flash the
  // "Loading…" screen again.
  const alreadyResolvedThisSlug = Boolean(tenantTrust) && installedSlug === normalizedAppSlug;
  // Computed once per mount (sessionStorage doesn't change out from under a
  // live tab) and used only to seed initial state below — see
  // INSTALL_PENDING_KEY's own comment for why this exists.
  //
  // Deliberately NOT gated on `!forceInstallLanding`: the install landing
  // link this component is opened from (see AddCommunity.jsx) always
  // carries `?install=1`, so a reload that lands back on that exact same
  // URL mid-WebAPK-install (Android can background/discard this tab while
  // the OS finishes installing) still has forceInstallLanding === true.
  // Gating this on it used to force isResumingAcceptedInstall to false on
  // exactly that reload, wiping the pending flag and dropping back to the
  // Install App card even though the user had already accepted — see the
  // forceInstallLanding reset effect below, which has the matching guard.
  // Highest-priority mount-time signal (verified -> pending -> idle) — a
  // terminal, non-expiring record written the instant a real `appinstalled`
  // event was handled (see handleAppInstalled below). Resolved once, up
  // front, via the shared, independently-unit-tested resolveInstallUiState
  // (see installPendingState.js) so this priority rule can never drift
  // between this seed and any other place in the codebase that needs it.
  const installUiSeed = resolveInstallUiState(normalizedAppSlug);
  const isFullyVerifiedInstall = installUiSeed.isInstalled;
  const isResumingAcceptedInstall = installUiSeed.isResumingAcceptedInstall;
  // True when a verified record exists but its POST_APPINSTALLED_SETTLE_MS
  // window hasn't elapsed yet — resuming straight into the settling loader
  // (phase 'finalizing') rather than 'unconfirmed', and straight into the
  // REMAINING settle time rather than a fresh 20s (see the mount effect
  // scheduling scheduleSettle below).
  const isResumingSettlingInstall = installUiSeed.phase === 'finalizing';
  const resumingSettleReadyAt = installUiSeed.readyAt;
  // Computed once per mount (document.referrer doesn't change during a
  // page's lifetime) — see isLikelyInstallContinuation's own comment. Used
  // below to scope the mount grace window to the cases that actually need
  // it, instead of delaying every ordinary fresh visitor.
  const cameFromOwnInstallPage = isLikelyInstallContinuation(normalizedAppSlug);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installOutcome, setInstallOutcome] = useState(() => (isFullyVerifiedInstall ? 'installed' : ''));
  // Only appinstalled (not the native prompt's 'accepted' outcome) actually
  // confirms the browser finished installing — see the appinstalled
  // listener below and handleInstallClick's comments.
  const [isInstalled, setIsInstalled] = useState(() => isFullyVerifiedInstall);
  // Drives the post-install experience: 'idle' is the normal marketing
  // card; 'prompting' is while the native browser install dialog is open;
  // 'launching' is the full-screen transition shown the instant the user
  // accepts, until the real `appinstalled` event fires; 'unconfirmed' is
  // the same kind of waiting screen, reached either after a 20s safety
  // timeout with no appinstalled yet, or by resuming an accepted-but-not-
  // yet-verified record across a reload; 'finalizing' is after appinstalled
  // fires but before its POST_APPINSTALLED_SETTLE_MS stabilization window
  // has elapsed (see scheduleSettle/completeSettle below) — a fixed delay,
  // never itself proof of success; 'installed' is the success screen,
  // reached ONLY once that window has actually elapsed for a verified
  // record (this session's completeSettle, or a persisted verified+readyAt
  // record from an earlier one already past its deadline — installUiSeed
  // above) — never from a timeout unrelated to that deadline, a heartbeat
  // tick, or an early getInstalledRelatedApps() match. There is no standard
  // API to force-launch a newly installed PWA, so nothing in this state
  // machine auto-navigates before that point — the success screen's "Open
  // App" button (handleOpenApp below) is the one reliable, user-initiated
  // launch action, alongside the best-effort automatic attempt
  // completeSettle makes on the app's behalf once settled. Seeded via
  // installUiSeed (installed / finalizing / unconfirmed / idle, in that
  // priority) so a reload that lands mid-install or mid-settle never
  // flashes the Install App card again but also never shows success before
  // it's actually earned. See handleInstallClick/handleAppInstalled below
  // for the state transitions and the safety-timeout fallback.
  const [installPhase, setInstallPhase] = useState(() => installUiSeed.phase);
  // Deadline (epoch ms) for the full-screen 60s install countdown ring —
  // written ONLY the instant the user accepts the native install prompt
  // (see handleInstallClick below), never reset on every render/tick. On a
  // mid-install reload that resumes a still-valid pending or still-settling
  // record (isResumingAcceptedInstall / isResumingSettlingInstall), seed
  // from whatever deadline was persisted for THIS slug so the ring resumes
  // the actual remaining time instead of restarting at 60 — falling back to
  // a fresh 60s only if that resume path somehow has no persisted deadline
  // at all (e.g. storage was cleared between tabs).
  const [countdownEndsAt, setCountdownEndsAt] = useState(() => {
    if (!(isResumingAcceptedInstall || isResumingSettlingInstall)) return null;
    const persisted = readInstallCountdown(normalizedAppSlug);
    return typeof persisted === 'number' ? persisted : writeInstallCountdown(normalizedAppSlug);
  });
  // MOUNT GRACE WINDOW — real-device captures showed Android/Chrome can, on
  // some devices, hand a just-accepted install off into a browsing context
  // that does NOT share sessionStorage OR localStorage with the tab the
  // user actually tapped Install in (confirmed: writeInstallPending()
  // demonstrably ran and persisted in the original context, yet the freshly
  // mounted page's very first readInstallPending() still came back empty) —
  // so INSTALL_PENDING_KEY cannot bridge that specific boundary no matter
  // which Web Storage it uses, and a fixed short delay isn't reliable either
  // (observed delays on real devices ranged from under a second to over 30
  // seconds — no fixed number covers every device). What DOES still arrive
  // on that fresh page is a second, genuine `appinstalled` event or a
  // getInstalledRelatedApps() match, just not instantly.
  //
  // Rather than guess a duration, this window is scoped by
  // cameFromOwnInstallPage (document.referrer — see its own comment): only
  // when this page load looks like a continuation of this exact tenant's
  // own previous page is it worth waiting a long, bounded time for that
  // delayed signal instead of showing Install App immediately. An ordinary
  // fresh visitor (empty/external referrer) gets zero extra delay — this
  // never applies to them at all. It never marks anything installed by
  // itself either way — only genuine signals do that.
  const MOUNT_INSTALL_CHECK_GRACE_MS = cameFromOwnInstallPage ? 20000 : 0;
  const [initialInstallCheckPending, setInitialInstallCheckPending] = useState(
    () => !isFullyVerifiedInstall && !isResumingAcceptedInstall && cameFromOwnInstallPage
  );
  // Not every Chromium build/version fires appinstalled reliably after an
  // 'accepted' outcome (browser bugs, unusual install flows, etc.) — a ref
  // (not state, so the timeout callback below always reads the latest
  // value) plus a pending-timeout id let the full-screen "Launching your
  // app…" transition fall back to the normal Install button instead of
  // hanging forever if that event never arrives.
  const isInstalledRef = useRef(false);
  const acceptedTimeoutRef = useRef(null);
  // Keeps INSTALL_PENDING_KEY's timestamp sliding forward for as long as an
  // install is actively being waited on/verified — see
  // start/stopInstallPendingHeartbeat below and INSTALL_PENDING_MAX_AGE_MS's
  // own comment for why this exists (a slow-but-progressing WebAPK install
  // must never let the pending flag go stale purely from wall-clock time).
  const installPendingHeartbeatRef = useRef(null);
  // Guards handleOpenApp below against firing more than once per tap —
  // but only for a short debounce window (openAppResetTimeoutRef clears
  // it again), NOT permanently. The hand-off to an installed PWA is
  // best-effort and often just doesn't happen at all (Chrome stays on
  // this browser page instead) — if this flag were never reset, that
  // single failed attempt would silently disable the button for the rest
  // of the page's life, forcing a full refresh to use it again.
  const openAppInFlightRef = useRef(false);
  const openAppResetTimeoutRef = useRef(null);
  // ANDROID FRESH-INSTALL PATH ONLY: the short "did the intent hand-off
  // actually leave this tab?" grace timer started right after
  // window.location.href = intentUrl below. Cleared the moment the page
  // is confirmed hidden/unloading (hand-off worked) or on unmount.
  const androidHandoffFallbackTimeoutRef = useRef(null);
  // Set true when the user accepts the native install prompt during THIS
  // session (see handleInstallClick), or when resuming an accepted-but-not-
  // yet-verified OR verified-but-still-settling install across a reload
  // (isResumingAcceptedInstall / isResumingSettlingInstall — the persisted
  // record is what makes this survive the reload; the ref itself is still
  // plain in-memory state). Read/cleared by the auto-entry effect declared
  // after enterTenantTrust below. This is what scopes "automatically
  // continue into the tenant app" to the fresh-install journey specifically
  // — the separate "already installed before this session" detection
  // effect above never touches this ref, so it keeps showing the existing
  // Installed/Open App card exactly as before, with no auto-navigation and
  // no loop risk.
  const autoEnterAfterInstallRef = useRef(isResumingAcceptedInstall || isResumingSettlingInstall);
  // True from the moment a fresh (this-session) install's settle window
  // completes through to enterTenantTrust()'s async membership check
  // resolving — set by completeSettle() itself (in the same batch as
  // installPhase, so there is no render in between where it could be
  // stale) and read by the finalizing render guard below, so the
  // Installed/Open App card never renders for that gap. Reset to false
  // only on a failed resolution (see
  // the auto-entry effect below); on success, enterTenantTrust's own state
  // changes (showTenantHome / tenantAccessState) take over rendering
  // before this is ever consulted again, so no explicit "done" reset is
  // needed there.
  const [autoEntering, setAutoEntering] = useState(false);
  // ANDROID FRESH-INSTALL PATH ONLY: true only once the post-intent grace
  // timer (see androidHandoffFallbackTimeoutRef) expires while this page is
  // STILL VISIBLE — i.e. Android did not visibly switch away to the
  // installed PWA. Never set on iOS/desktop, and never set while the
  // hand-off attempt is still pending (the finalizing/autoEntering loader
  // stays up for that whole window). Renders a minimal "Open App" screen —
  // never enterTenantTrust()/tenant Home in Chrome, never the Install App
  // card again.
  const [freshInstallHandoffBlocked, setFreshInstallHandoffBlocked] = useState(false);
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
    if (forceInstallLanding) return false;
    if (!alreadyResolvedThisSlug || !isStandaloneDisplay()) return false;
    const cacheKey = getStandaloneVerificationKey(tenantTrust?.id);
    return Boolean(cacheKey) && verifiedStandaloneEntries.has(cacheKey);
  });

  const reserved = isReservedSlug(appSlug);

  useEffect(() => {
    if (!forceInstallLanding) return;
    // THE PREMATURE CLEAR (see items 1/2/4/6 in the install-race fix):
    // this used to check readInstallPending alone. That is false the
    // instant handleAppInstalled has already cleared it on some earlier page —
    // including a page this exact component never saw, e.g. one destroyed
    // by an Android tab discard/reload right as verification finished. A
    // later remount that still carries ?install=1 (the install landing
    // link legitimately reopened, or Android replaying that same URL) then
    // read "no pending record" and treated that as "never installed",
    // wiping isInstalled/installPhase back to false/'idle' and flashing the
    // Install App card back up for an app that was already fully verified
    // installed a moment earlier — the exact race this fix closes. Checking
    // the terminal verified record FIRST (item 6's installed -> pending ->
    // idle priority) means a genuinely completed install can never be
    // un-done by this effect, no matter when/how often it re-runs.
    if (readInstallVerified(normalizedAppSlug) || readInstallPending(normalizedAppSlug)) {
      // A genuinely accepted (or already-verified) install is still being
      // resumed across a reload and this URL happens to still carry the
      // same ?install=1 the user originally opened — Android can
      // reload/discard this tab mid-WebAPK-install, landing back on that
      // exact URL. That reload must never be treated as a fresh "show the
      // Install App page" visit: doing so used to clear the pending flag
      // and drop installPhase back to 'idle', which is what made the
      // Install App card flash back up moments after the user had already
      // accepted the native prompt. Leave everything alone here — the
      // resume-across-reload path (isResumingAcceptedInstall above, and the
      // appinstalled listener below) owns this case.
      return;
    }
    try {
      sessionStorage.removeItem(PENDING_CREATED_APP_URL_KEY);
      sessionStorage.removeItem(PENDING_CREATED_APP_TS_KEY);
      localStorage.removeItem(PENDING_CREATED_APP_URL_KEY);
      localStorage.removeItem(PENDING_CREATED_APP_TS_KEY);
    } catch {
      // ignore storage failures
    }
    // Explicit request for the install landing (?install=1) — never resume
    // a stale accepted-install flag into this deliberately-fresh view.
    clearInstallPending(normalizedAppSlug, 'force-install-landing');
    clearInstallCountdown(normalizedAppSlug, 'force-install-landing');
    setShowTenantHome(false);
    setTenantAccessState(null);
    setTenantAccessPayload(null);
    setIsInstalled(false);
    setInstallOutcome('');
    setInstallPhase('idle');
    setCountdownEndsAt(null);
    setAutoEntering(false);
    setFreshInstallHandoffBlocked(false);
    if (androidHandoffFallbackTimeoutRef.current) {
      clearTimeout(androidHandoffFallbackTimeoutRef.current);
      androidHandoffFallbackTimeoutRef.current = null;
    }
  }, [forceInstallLanding, normalizedAppSlug]);

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
  // Deliberately NOT touching that capture mechanism itself here — only
  // reacting to the event once it reaches this component.
  useEffect(() => {
    const handlePromptEvent = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      // RECONCILE STALE "VERIFIED" STATE: the browser only ever fires
      // beforeinstallprompt for an origin/app it currently considers
      // installable — Chrome does not fire it for one it still believes is
      // already installed. So a refire while this slug's persisted
      // "verified installed" record is still set is itself strong evidence
      // the user uninstalled the PWA since that record was written (the
      // record is otherwise non-expiring — see installPendingState.js's own
      // comment on exactly this). Without this, a device that later
      // uninstalled would be stuck forever seeing the Installed/"Open App"
      // card with no way back to a working Install button, even though the
      // browser is right here handing us a fresh, promptable install event.
      //
      // Scoped entirely to normalizedAppSlug (every read/write below goes
      // through installPendingState.js's slug-scoped keys), so this can
      // never invalidate a DIFFERENT tenant's verified/pending state.
      if (readInstallVerified(normalizedAppSlug) || readInstallPending(normalizedAppSlug)) {
        logInstallFlow('reconcile-stale-verified', { slug: normalizedAppSlug });
        clearInstallVerified(normalizedAppSlug, 'beforeinstallprompt-refired');
        clearInstallPending(normalizedAppSlug, 'beforeinstallprompt-refired');
        autoEnterAfterInstallRef.current = false;
        setIsInstalled(false);
        setInstallOutcome('');
        // Only actually move the visible phase if it was showing the
        // (now-stale) installed/unconfirmed state — never stomp on
        // 'prompting'/'launching', which would mean a fresh accept is
        // active RIGHT NOW and this event is unrelated noise, not a signal
        // to reset anything.
        setInstallPhase((prev) => (
          prev === 'prompting' || prev === 'launching' ? prev : 'idle'
        ));
      }
    };

    const existingPrompt = getInstallPrompt();
    if (existingPrompt) handlePromptEvent(existingPrompt);

    return subscribeInstallPrompt(handlePromptEvent);
  }, [normalizedAppSlug]);

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
    if (forceInstallLanding) return;

    // Running standalone already means THIS exact tenant PWA is what
    // launched this window — no ambiguity, no API call needed.
    if (isStandaloneDisplay()) {
      writeInstallVerified(normalizedAppSlug);
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
    let attempt = 0;
    const manifestPath = `/pwa-manifest/${normalizedAppSlug}.webmanifest`.toLowerCase();
    // A single check right at mount can miss a genuine install: real-device
    // captures showed the OS's own installed-app registry (what this API
    // reads) can take anywhere from under a second to 30+ seconds to catch
    // up right after a WebAPK finishes. Retrying gives that catch-up a real
    // chance, without ever claiming "installed" on anything but a genuine
    // match. Deliberately still never touches autoEnterAfterInstallRef here
    // — a match found this way could equally be an ordinary revisit to an
    // already-installed tenant, which must never auto-navigate; only a
    // genuine `appinstalled` event (handled separately below) is trusted
    // for that.
    //
    // How long/hard this retries mirrors MOUNT_INSTALL_CHECK_GRACE_MS's own
    // reasoning (see its comment): only worth polling persistently when
    // cameFromOwnInstallPage suggests this page load is actually a
    // continuation of an install just accepted on this same tenant's page.
    // An ordinary fresh visitor gets a single, immediate check (same as
    // before) — never delayed waiting on retries that would rarely matter
    // for them.
    const MOUNT_CHECK_RETRY_MS = 500;
    const MOUNT_CHECK_MAX_ATTEMPTS = cameFromOwnInstallPage
      ? Math.ceil(MOUNT_INSTALL_CHECK_GRACE_MS / MOUNT_CHECK_RETRY_MS)
      : 1;

    const checkOnce = () => {
      attempt += 1;
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
          logInstallFlow('mount-getInstalledRelatedApps', { slug: normalizedAppSlug, relatedApps, matchesThisTenant, attempt });
          if (matchesThisTenant) {
            writeInstallVerified(normalizedAppSlug);
            setIsInstalled(true);
            setInstallOutcome('installed');
            setInstallPhase('installed');
            return;
          }
          if (attempt < MOUNT_CHECK_MAX_ATTEMPTS) {
            setTimeout(() => { if (!cancelled) checkOnce(); }, MOUNT_CHECK_RETRY_MS);
          }
        })
        .catch(() => {
          // Unsupported/failed — never claim installed without real evidence.
        });
    };

    checkOnce();

    return () => { cancelled = true; };
  }, [normalizedAppSlug, forceInstallLanding, cameFromOwnInstallPage, MOUNT_INSTALL_CHECK_GRACE_MS]);

  // Keep a ref mirror of isInstalled so the safety-timeout callback below
  // (started from handleInstallClick, possibly still pending several
  // seconds later) always reads the latest value instead of a stale one
  // captured at setTimeout time.
  useEffect(() => {
    isInstalledRef.current = isInstalled;
  }, [isInstalled]);

  // Runs the MOUNT_INSTALL_CHECK_GRACE_MS window described above — a single
  // bounded timer per mount, not tied to any other state, so it can't be
  // restarted/extended by later renders. If a real signal (appinstalled,
  // getInstalledRelatedApps match) arrives first and moves installPhase off
  // 'idle', this flag becomes irrelevant (the idle-card render branch below
  // never checks it once phase isn't 'idle') — it only ever delays, never
  // blocks, revealing the Install App card.
  useEffect(() => {
    if (!initialInstallCheckPending) return undefined;
    const timeoutId = setTimeout(() => setInitialInstallCheckPending(false), MOUNT_INSTALL_CHECK_GRACE_MS);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TEMPORARY DIAGNOSTICS — see INSTALL_FLOW_DEBUG at the top of this file.
  // Logs the resolved tenant identity and the <link rel="manifest"> href
  // actually present in <head> right now, so a side-by-side capture against
  // a known-working tenant shows whether business-app's slug/manifest
  // wiring resolves any differently at runtime than it does over plain
  // curl. installPhase/isInstalled are included on their own line below so
  // every phase transition is visible without re-logging tenant identity
  // each time.
  useEffect(() => {
    const manifestLink = typeof document !== 'undefined' ? document.querySelector('link[rel="manifest"]') : null;
    logInstallFlow('tenant-identity', {
      rawAppSlug: appSlug,
      normalizedAppSlug,
      forceInstallLanding,
      tenantTrustId: tenantTrust?.id || null,
      tenantTrustName: tenantTrust?.name || null,
      tenantTrustAppSlug: tenantTrust?.app_slug || null,
      installedSlug,
      manifestHref: manifestLink?.getAttribute('href') || null,
      isResumingAcceptedInstall
    });
  }, [appSlug, normalizedAppSlug, forceInstallLanding, tenantTrust, installedSlug, isResumingAcceptedInstall]);

  // TEMPORARY DIAGNOSTICS — logs every installPhase/isInstalled transition,
  // so a captured console session shows the exact sequence of phases this
  // tenant actually went through (idle -> prompting -> launching ->
  // finalizing/unconfirmed -> installed), without needing to instrument
  // every individual setInstallPhase call site.
  useEffect(() => {
    logInstallFlow('phase', { slug: normalizedAppSlug, installPhase, isInstalled, autoEntering });
  }, [normalizedAppSlug, installPhase, isInstalled, autoEntering]);

  // See INSTALL_PENDING_KEY/INSTALL_PENDING_MAX_AGE_MS above: keeps the
  // pending flag's timestamp fresh for as long as this tab is actively
  // waiting on/verifying an accepted install, so a slow-but-still-in-
  // progress WebAPK install never goes stale purely because a lot of wall-
  // clock time passed. Idempotent — calling it while already running is a
  // no-op, so it's safe to call from multiple entry points (accept,
  // resume-after-reload, appinstalled).
  const startInstallPendingHeartbeat = useCallback((slug) => {
    if (installPendingHeartbeatRef.current) return;
    installPendingHeartbeatRef.current = setInterval(() => {
      writeInstallPending(slug);
    }, INSTALL_PENDING_HEARTBEAT_MS);
  }, []);

  const stopInstallPendingHeartbeat = useCallback(() => {
    if (installPendingHeartbeatRef.current) {
      clearInterval(installPendingHeartbeatRef.current);
      installPendingHeartbeatRef.current = null;
    }
  }, []);

  // Resuming across a reload (see isResumingAcceptedInstall above): refresh
  // the timestamp immediately on this new page too, and keep the heartbeat
  // going for as long as this tab lives, in case IT also gets discarded
  // before verification finishes.
  useEffect(() => {
    if (!isResumingAcceptedInstall) return undefined;
    writeInstallPending(normalizedAppSlug);
    startInstallPendingHeartbeat(normalizedAppSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guards against a real `appinstalled` DOM event firing more than once
  // for the same install (real-device testing on some Android/Chrome
  // builds showed this happens — once on the original tab, again later on
  // a page reached after "Open App" navigates/hands off and falls back to
  // a plain navigation). True the instant the FIRST one is handled (or at
  // mount, if a verified record — settled or still settling — already
  // exists), so a later firing can never re-write the verified/readyAt
  // record and restart or otherwise disturb the settle window below.
  const appInstalledHandledRef = useRef(isFullyVerifiedInstall || isResumingSettlingInstall);
  const settleTimeoutRef = useRef(null);

  const clearSettleTimeout = useCallback(() => {
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
  }, []);

  // The ONLY function in this component allowed to move installPhase to
  // 'installed' / set isInstalled true — i.e. the one place "confirmed
  // installed" is ever persisted. It is only ever invoked once
  // `Date.now() >= readyAt` for a verified record (see scheduleSettle
  // below) — never earlier, and never just because some unrelated timeout
  // elapsed.
  //
  // Requirement (9) — "first render/persist success, then optionally
  // attempt the existing automatic Open App handoff" — needs no extra code
  // here: it falls out naturally from setting isInstalled/installPhase
  // below. The existing Android auto-handoff attempt (the
  // autoEnterAfterInstallRef effect declared after enterTenantTrust further
  // down, predating the settle window entirely) is itself gated on exactly
  // `installPhase === 'installed' && isInstalled`, so it can only ever fire
  // in a LATER effect pass, once this commit (the success screen) has
  // already been queued to render, and only now that this function delays
  // that transition until the settle window has actually elapsed. Adding a
  // second, separate auto-open attempt here would just race that existing
  // one — see "do not touch unrelated PWA/tenant logic".
  const completeSettle = useCallback(() => {
    clearSettleTimeout();
    logInstallFlow('settle-complete', { slug: normalizedAppSlug });
    // Purely presentational cleanup — the countdown deadline has already
    // served its purpose (the ring shows confirmed/checkmark from here on
    // regardless of this record), this just avoids leaving a stale
    // completed deadline sitting in storage for the slug.
    clearInstallCountdown(normalizedAppSlug, 'settled');
    setIsInstalled(true);
    setInstallOutcome('installed');
    // For a fresh install accepted this session, flip autoEntering in
    // the SAME batch as installPhase below — React 18 batches these
    // into one commit, so the autoEntering render guard never sees
    // installPhase === 'installed' with autoEntering still false. Doing
    // this from the separate auto-entry effect instead (which only runs
    // after this commit has already painted) left exactly that one render
    // — and the Installed/Open App card flashing during it — uncovered.
    if (autoEnterAfterInstallRef.current) {
      setAutoEntering(true);
    }
    setInstallPhase('installed');
  }, [clearSettleTimeout, normalizedAppSlug]);

  // Schedules completeSettle for the time REMAINING until `readyAt` —
  // never a fresh POST_APPINSTALLED_SETTLE_MS window (requirement 4). If
  // `readyAt` has already passed (e.g. a remount well after the settle
  // window elapsed, or a backgrounded tab that missed its own timer),
  // completes immediately instead of ever waiting a full window again.
  const scheduleSettle = useCallback((readyAt) => {
    clearSettleTimeout();
    const remainingMs = readyAt - Date.now();
    if (remainingMs <= 0) {
      completeSettle();
      return;
    }
    settleTimeoutRef.current = setTimeout(completeSettle, remainingMs);
  }, [clearSettleTimeout, completeSettle]);

  // RELOAD-RESUME PATH for a settle window already in progress: this page
  // never saw its own appinstalled event, but the persisted verified
  // record says one already fired (with a `readyAt` deadline) before
  // whatever reload/remount brought us here — installPhase was already
  // seeded to 'finalizing' for this same reason (see its useState
  // initializer above). Resumes the REMAINING time, not a fresh window.
  useEffect(() => {
    if (!isResumingSettlingInstall || !resumingSettleReadyAt) return undefined;
    logInstallFlow('settle-resume', {
      slug: normalizedAppSlug,
      readyAt: resumingSettleReadyAt,
      remainingMs: Math.max(0, resumingSettleReadyAt - Date.now())
    });
    scheduleSettle(resumingSettleReadyAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // appinstalled is the only reliable install-registration signal — the
  // native prompt's 'accepted' outcome just means the user tapped Install,
  // not that Chrome finished installing it. But appinstalled itself is
  // ALSO not proof the app is actually launchable yet: Android's WebAPK
  // package can still be mid-install for a few more seconds after this
  // fires. Earlier versions of this file waited on
  // navigator.getInstalledRelatedApps() for that, with a timeout that
  // eventually promoted to installed even without a genuine match
  // ("trustFallback") — exactly what let an
  // [install-flow:appinstalled-fired] log show `alreadyInstalled: true`:
  // proof the app had already been marked installed before Chrome's own
  // event fired. That's gone. In its place: a fixed
  // POST_APPINSTALLED_SETTLE_MS stabilization window (completeSettle/
  // scheduleSettle above) — a delay, never itself proof of success. If
  // appinstalled never fires at all, nothing here ever promotes to
  // installed, no matter how much time passes.
  useEffect(() => {
    const handleAppInstalled = () => {
      logInstallFlow('appinstalled-fired', {
        slug: normalizedAppSlug,
        at: Date.now(),
        alreadyHandled: appInstalledHandledRef.current
      });
      // See appInstalledHandledRef's own comment: a later/duplicate firing
      // once this page has already started (or finished) a settle window
      // must be a total no-op — it must never re-arm a fresh 20s window.
      if (appInstalledHandledRef.current) return;
      appInstalledHandledRef.current = true;
      if (acceptedTimeoutRef.current) {
        clearTimeout(acceptedTimeoutRef.current);
        acceptedTimeoutRef.current = null;
      }
      // A genuine `appinstalled` firing on THIS page is, by itself, proof a
      // fresh install just completed right now — the browser only ever
      // dispatches it once, at the moment installation finishes, never on
      // an ordinary revisit to an already-installed tenant's URL (that case
      // is handled entirely by the separate isStandaloneDisplay()/
      // getInstalledRelatedApps() effect above, which never touches this
      // ref). So this is safe to rely on directly, INSTEAD of only trusting
      // autoEnterAfterInstallRef's earlier value — real-device testing
      // showed Android/Chrome can hand the accepted install off into a
      // browsing context that shares neither sessionStorage nor
      // localStorage with the tab the user actually tapped Install in, so
      // neither this ref's original value nor isResumingAcceptedInstall
      // can be trusted to already be true on this exact page — without
      // this, that page fell back to the manual Installed/"Open App" card
      // instead of auto-continuing straight into the tenant app the way a
      // fresh install always should.
      autoEnterAfterInstallRef.current = true;
      clearInstallPrompt();
      setDeferredPrompt(null);
      const readyAt = Date.now() + POST_APPINSTALLED_SETTLE_MS;
      // Requirement 2, in this exact order: persist verified+readyAt
      // evidence FIRST, keep the UI on the settling loader (NOT
      // 'installed' yet), then clear pending last — a remount racing any
      // point in this sequence still finds the verified/readyAt record and
      // resumes the settle window correctly (see the resume effect above).
      writeInstallVerified(normalizedAppSlug, { readyAt });
      logInstallFlow('settle-start', { slug: normalizedAppSlug, readyAt, settleMs: POST_APPINSTALLED_SETTLE_MS });
      stopInstallPendingHeartbeat();
      setInstallPhase('finalizing');
      clearInstallPending(normalizedAppSlug, 'appinstalled');
      scheduleSettle(readyAt);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [normalizedAppSlug, scheduleSettle, stopInstallPendingHeartbeat]);

  // Not every Chromium build fires appinstalled after 'accepted' (browser
  // bugs, unusual install flows, older/newer versions behaving
  // inconsistently) — clear the safety timeout on unmount so it never
  // fires setState after this component is gone. Also clears the settle
  // window's own timeout (scheduleSettle/completeSettle above — its
  // persisted readyAt survives the unmount regardless, so a remount simply
  // resumes it), handleOpenApp's debounce-reset timeout, and the install-
  // pending heartbeat interval for the same reason — they only ever touch
  // plain refs, but no pending timer should outlive the component
  // regardless. Deliberately does NOT clear the sessionStorage pending flag
  // itself here — an in-app SPA navigation away from /app/<slug> unmounts
  // this component too, and that must not cancel a still-genuinely-pending
  // or still-settling install; only completeSettle/the explicit paths above
  // do that.
  useEffect(() => () => {
    if (acceptedTimeoutRef.current) {
      clearTimeout(acceptedTimeoutRef.current);
      acceptedTimeoutRef.current = null;
    }
    if (openAppResetTimeoutRef.current) {
      clearTimeout(openAppResetTimeoutRef.current);
      openAppResetTimeoutRef.current = null;
    }
    clearSettleTimeout();
    stopInstallPendingHeartbeat();
  }, [clearSettleTimeout, stopInstallPendingHeartbeat]);

  // Merges (never blindly replaces) the tenant Trust/reg_member resolved by
  // resolve_app_access (or grantTenantHome's read-only fallback caller)
  // into the saved user session BEFORE Home ever renders. Without this,
  // Home's very first mount can still read a pre-login
  // hospital_memberships/trust/primary_trust snapshot that never included
  // this tenant (most visibly a brand-new membership resolve_app_access
  // just created) — exactly what let a stale/foreign Trust flash before a
  // manual refresh. Dedupes by trust_id so this never creates a duplicate
  // entry for the same Trust on repeat logins/revalidations.
  const mergeResolvedTenantMembershipIntoUserSession = (trust, regMember) => {
    const trustId = normalizeText(trust?.id);
    if (!trustId) return;
    try {
      const rawUser = localStorage.getItem('user');
      const user = rawUser ? JSON.parse(rawUser) : null;
      if (!user) return;

      const { hospitalMemberships, trustSummary, membershipEntry } = mergeTenantMembershipEntry({
        hospitalMemberships: user.hospital_memberships,
        trust,
        regMember,
        fallbackMembersId: user.members_id || user.member_id || null
      });

      const nextUser = {
        ...user,
        hospital_memberships: hospitalMemberships,
        // trust/primary_trust reflect THIS tenant session only — updated
        // here, never merged with whatever trust they previously pointed
        // to (that would be a different Trust entirely).
        trust: trustSummary,
        primary_trust: { ...trustSummary, is_active: membershipEntry.is_active }
      };

      localStorage.setItem('user', JSON.stringify(nextUser));
    } catch (err) {
      console.warn('[TenantLanding] Failed to merge tenant membership into user session:', err?.message || err);
    }
  };

  // Shared by the initial resolve below and by the profile-modal submit
  // handler: switches selected_trust_id to this tenant Trust and renders
  // Home in place (staying on /app/<appSlug>) instead of navigating to '/'.
  // `trustDetails`/`regMember` (both optional) come from resolve_app_access
  // (or its read-only fallback) and drive mergeResolvedTenantMembershipIntoUserSession
  // above — never fabricated membership approval, only identity pinning.
  const grantTenantHome = useCallback((trustId, trustName, trustDetails = null, regMember = null) => {
    const normalizedTrustId = normalizeText(trustId);
    const normalizedTrustName = normalizeText(trustName);
    mergeResolvedTenantMembershipIntoUserSession(
      {
        id: normalizedTrustId,
        name: normalizedTrustName || trustDetails?.name,
        icon_url: trustDetails?.icon_url,
        remark: trustDetails?.remark
      },
      regMember
    );
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

      if (resolveAccessAllowed(access)) {
        grantTenantHome(access.trust?.id || tenantTrustId, trustName, access.trust, access.reg_member);
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
          grantTenantHome(tenantTrustId, trustName, {
            name: trustName,
            icon_url: tenantMembership.trust_icon_url,
            remark: tenantMembership.trust_remark
          }, tenantMembership);
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

  // PENDING-ACCESS REVALIDATION ON FOREGROUND: an installed PWA left open on
  // the pending screen never reloads on its own — if admin approval (or an
  // app_visibility flip to public) lands while this tab is backgrounded,
  // tenantAccessState would otherwise stay stuck on 'pending' forever, since
  // nothing re-runs enterTenantTrust() after the one call that set it. This
  // re-checks once whenever the tab becomes visible again while still
  // pending — no polling/retry loop, just the same resolver call already
  // used everywhere else, which naturally clears tenantAccessState back to
  // Home (via grantTenantHome) the moment access_allowed is true, or leaves
  // 'pending' untouched otherwise.
  useEffect(() => {
    if (tenantAccessState !== 'pending') return undefined;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') enterTenantTrust();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [tenantAccessState, enterTenantTrust]);

  // Fresh-install auto-continue: once a verified-installed state is
  // reached FOR AN INSTALL ACCEPTED THIS SESSION (autoEnterAfterInstallRef
  // — set only in handleInstallClick's accepted branch above, never by the
  // separate "already installed before this session" detection effect),
  // immediately run the exact same tenant-access flow the installed PWA
  // itself uses instead of leaving the user on an Installed/Open App card
  // they'd have to tap through. Reusing enterTenantTrust() as-is means
  // login/public/private/pending/needs-profile behavior is 100% unchanged
  // — this effect only decides WHEN to call it, never what it does.
  // (autoEntering itself is already set to true by completeSettle above, in
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
    if (!autoEnterAfterInstallRef.current) return undefined;
    if (installPhase !== 'installed' || !isInstalled) return undefined;

    autoEnterAfterInstallRef.current = false;

    if (isAndroid()) {
      // ANDROID-ONLY: best-effort, SAME-CONTEXT OS hand-off to the
      // just-installed WebAPK via a top-level navigation to an intent://
      // URL — never window.open/'_blank' (that opens a separate Chrome
      // tab instead of asking Android to resolve the intent for this
      // context). Built WITHOUT S.browser_fallback_url on purpose — if
      // Android doesn't hand this off (e.g. the WebAPK isn't registered
      // yet), the fallback would otherwise reload this tab on the plain
      // tenant URL, wiping the fresh-install state and bringing back the
      // Install/Installed card.
      //
      // The hand-off is asynchronous: Chrome doesn't unload/hide this tab
      // synchronously just because location.href was set to an intent://
      // URL, so we can't tell success from failure on the same tick. The
      // finalizing/autoEntering loader (already up from completeSettle)
      // stays visible while we wait up to ANDROID_HANDOFF_FALLBACK_MS for
      // either sign of success — the page being hidden (visibilitychange)
      // or actually unloading (pagehide) — before ever concluding the
      // hand-off failed and showing the Open App fallback screen. This is
      // what prevents a flash of Open App a split second before Android
      // switches apps anyway.
      const ANDROID_HANDOFF_FALLBACK_MS = 1400;
      let settled = false;

      const clearHandoffWatchers = () => {
        if (androidHandoffFallbackTimeoutRef.current) {
          clearTimeout(androidHandoffFallbackTimeoutRef.current);
          androidHandoffFallbackTimeoutRef.current = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('pagehide', handlePageHide);
      };

      // The hand-off worked — Android switched to the installed PWA and
      // this tab is now backgrounded (or being torn down). Cancel the
      // fallback timer and do nothing else: never flip autoEntering/
      // freshInstallHandoffBlocked here, so a hidden tab never paints the
      // Open App screen even if it's later brought back to the foreground.
      const markHandedOff = () => {
        if (settled) return;
        settled = true;
        clearHandoffWatchers();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') markHandedOff();
      };
      const handlePageHide = () => markHandedOff();

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('pagehide', handlePageHide);

      let intentAttempted = false;
      try {
        const tenantUrl = buildTenantUrl(normalizedAppSlug);
        const intentUrl = tenantUrl && buildAndroidIntentUrl(tenantUrl, { includeFallback: false });
        if (intentUrl) {
          intentAttempted = true;
          window.location.href = intentUrl;
        }
      } catch {
        // fall through — treated the same as "nothing to attempt" below
      }

      if (!intentAttempted) {
        // Nothing to hand off to (couldn't build a URL/intent) — no point
        // waiting out the grace period, go straight to the fallback screen.
        settled = true;
        clearHandoffWatchers();
        setAutoEntering(false);
        setFreshInstallHandoffBlocked(true);
        return undefined;
      }

      // No enterTenantTrust() anywhere in this branch — a fresh Android
      // install must never continue the tenant flow inside Chrome. The
      // installed PWA itself runs standalone and drives its own
      // enterTenantTrust() via the separate isStandaloneDisplay() effect
      // above.
      androidHandoffFallbackTimeoutRef.current = setTimeout(() => {
        androidHandoffFallbackTimeoutRef.current = null;
        if (settled) return;
        settled = true;
        clearHandoffWatchers();
        // Still here AND still visible after the grace period — the
        // hand-off didn't happen (or Chrome blocked it outright, since
        // appinstalled can fire without user activation). Surface the
        // one-tap fallback instead of leaving the loader spinning forever.
        if (document.visibilityState !== 'hidden') {
          setAutoEntering(false);
          setFreshInstallHandoffBlocked(true);
        }
      }, ANDROID_HANDOFF_FALLBACK_MS);

      return () => {
        clearHandoffWatchers();
      };
    }

    // NON-ANDROID: unchanged from today — new-context attempt at the plain
    // tenant URL, then continue the tenant flow in this tab exactly as
    // before. iOS/desktop Safari/Chrome have no intent-style OS hand-off
    // mechanism, so this behavior is intentionally left untouched.
    try {
      const tenantUrl = buildTenantUrl(normalizedAppSlug);
      if (tenantUrl) {
        window.open(tenantUrl, '_blank', 'noopener');
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
    return undefined;
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

    if (resolveAccessAllowed(tenantAccessPayload)) {
      grantTenantHome(
        tenantAccessPayload.trust?.id || tenantTrust?.id,
        tenantAccessPayload.trust?.name || tenantTrust?.name,
        tenantAccessPayload.trust,
        tenantAccessPayload.reg_member
      );
      setTenantAccessState(null);
    } else {
      setTenantAccessState('pending');
    }
  }, [tenantAccessPayload, grantTenantHome, tenantTrust]);

  // "Use another mobile number" on the profile/onboarding screen: a stale
  // SETU session saved on this device (from a different login, possibly for
  // a different Trust) must never be silently reused here without the user
  // being able to see/reject it. Clears only auth/session/selected-Trust
  // keys — never the per-slug installed_app_trust_id:<slug> / per-window
  // active_app_slug identity TenantContext/tenantNavigation own, so this
  // device's tenant PWA context is untouched — then sends the user into
  // this same tenant's login flow.
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
    if (forceInstallLanding) return;
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
  }, [resolvedOnce, tenantTrust, showTenantHome, forceInstallLanding]);

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
        isActive={resolveAccessAllowed(tenantAccessPayload)}
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

  // 'prompting': deferredPrompt.prompt() is awaiting the user's choice in
  // the native browser dialog. This must render too, not just 'launching'
  // — otherwise the Install App card is still what's sitting underneath/
  // behind that dialog, and can flash back into view the instant it closes
  // but before 'launching' is set. No countdown yet — that only starts once
  // the user actually accepts (see handleInstallClick below).
  if (installPhase === 'prompting') {
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <p style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '15px', fontWeight: 700, marginTop: '18px' }}>
          Preparing installation…
        </p>
        <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '4px' }}>
          Complete the install prompt to continue.
        </p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  // FULL-SCREEN 60-SECOND INSTALL COUNTDOWN — the single surface covering
  // the ENTIRE post-accept wait (replacing the tenant card entirely — no
  // card, no "Powered by Setu", no install instructions) across every phase
  // that can follow accepting the native prompt:
  // - 'launching': accepted; waiting on the real `appinstalled` event.
  // - 'unconfirmed': handleInstallClick's 20s safety timeout elapsed with
  //   no appinstalled yet (or a reload resumed straight into this phase) —
  //   still not confirmed installed, still never falls back to Install App.
  // - 'finalizing': appinstalled fired, waiting out the
  //   POST_APPINSTALLED_SETTLE_MS stabilization window (scheduleSettle/
  //   completeSettle above) — a fixed delay, never itself proof of success.
  // - autoEntering: settle complete, the existing Android hand-off effect
  //   (declared after enterTenantTrust above) is making its ONE best-effort
  //   attempt — same context, no new tab/window, no retry loop; this
  //   component does not drive that attempt, only displays through it.
  // - freshInstallHandoffBlocked: that hand-off attempt finished without the
  //   page going hidden — Android didn't visibly switch apps. Always
  //   reached with isInstalled already true (see that effect's own guard),
  //   so `confirmed` below is always true here too.
  // `confirmed` mirrors the ONE existing definition of "installed" used
  // everywhere else in this file (installPhase === 'installed' &&
  // isInstalled) — this screen never marks anything installed itself,
  // including when its own ring reaches 0; see InstallCountdownScreen.
  if (
    installPhase === 'launching' ||
    installPhase === 'unconfirmed' ||
    installPhase === 'finalizing' ||
    autoEntering ||
    freshInstallHandoffBlocked
  ) {
    return (
      <InstallCountdownScreen
        trustName={tenantTrust.name}
        logoUrl={logoUrl}
        backgroundColor={backgroundColor}
        palette={palette}
        accent={accent}
        accentGradient={accentGradient}
        accentGlow={accentGlow}
        countdownEndsAt={countdownEndsAt}
        confirmed={installPhase === 'installed' && isInstalled}
        onOpenApp={() => {
          const tenantUrl = buildTenantUrl(normalizedAppSlug);
          if (!tenantUrl) return;
          const intentUrl = isAndroid() ? buildAndroidIntentUrl(tenantUrl, { includeFallback: false }) : tenantUrl;
          window.location.href = intentUrl || tenantUrl;
        }}
      />
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
      logInstallFlow('userChoice', { slug: normalizedAppSlug, outcome });
      // Consumed — a BeforeInstallPromptEvent can only be prompted once, so
      // clear the shared store too, not just this component's own state.
      clearInstallPrompt();
      setInstallOutcome(outcome);
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        // This is what scopes the auto-continue-into-app-flow behavior
        // (see the effect declared after enterTenantTrust below) to THIS
        // fresh install specifically — never a tenant detected as already
        // installed from an earlier session. Persisted to sessionStorage
        // (not just this ref) so a mid-install reload — Android can
        // background/discard this tab while the WebAPK package itself is
        // installing — resumes straight into the finalizing loader on the
        // next mount instead of ever showing Install App again; see
        // INSTALL_PENDING_KEY's own comment.
        autoEnterAfterInstallRef.current = true;
        writeInstallPending(normalizedAppSlug);
        startInstallPendingHeartbeat(normalizedAppSlug);
        // Starts the 60s countdown ring's deadline — see countdownEndsAt's
        // own comment: this is the ONLY place a fresh (non-resumed) deadline
        // is ever written, exactly at the moment the user accepted.
        setCountdownEndsAt(writeInstallCountdown(normalizedAppSlug));
        setInstallPhase('launching');
        // Safety net for browser/version inconsistencies where appinstalled
        // never fires after 'accepted' at all. The user has already
        // accepted the native prompt, so this must never fall back to the
        // Install App screen (that would ask them to install something they
        // just told the OS to install) — but appinstalled NOT firing is the
        // only signal in hand at this point, which is weaker than a real
        // appinstalled event, so this must not claim confirmed "installed"
        // either. It moves to the 'unconfirmed' phase instead (manual Open
        // App fallback, no success checkmark) and simply keeps waiting —
        // installed is only ever actually persisted from a genuine (even if
        // delayed) appinstalled event still arriving (see the listener
        // above, which is registered unconditionally and stays registered
        // regardless of this timeout).
        if (acceptedTimeoutRef.current) clearTimeout(acceptedTimeoutRef.current);
        acceptedTimeoutRef.current = setTimeout(() => {
          acceptedTimeoutRef.current = null;
          if (!isInstalledRef.current) {
            setInstallPhase('unconfirmed');
          }
        }, 20000);
      } else {
        // CANCELLED INSTALL: the user dismissed the native prompt — stop and
        // reset the countdown state entirely (never leave a stale deadline
        // that could resume a countdown that never actually started) and
        // fall straight back through to the normal Install App card below.
        autoEnterAfterInstallRef.current = false;
        stopInstallPendingHeartbeat();
        clearInstallPending(normalizedAppSlug, 'dismissed');
        clearInstallCountdown(normalizedAppSlug, 'dismissed');
        setCountdownEndsAt(null);
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
    if (installPhase === 'prompting' || installPhase === 'launching' || installPhase === 'finalizing' || installPhase === 'unconfirmed' || autoEntering) return;
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

  // See MOUNT_INSTALL_CHECK_GRACE_MS/cameFromOwnInstallPage above: only ever
  // reached when this page load looks like a continuation of an install
  // just accepted on this exact tenant's own page (never for an ordinary
  // fresh visitor — initialInstallCheckPending starts false for them) —
  // every other phase already returned its own screen earlier. Worded as a
  // genuine "still finishing" state, not generic loading, since that's
  // specifically what this is waiting on: a delayed-but-already-in-flight
  // appinstalled/getInstalledRelatedApps signal moving installPhase
  // elsewhere.
  if (initialInstallCheckPending) {
    return (
      <div style={{ ...styles.page, background: backgroundColor }}>
        <div style={{ ...styles.spinner, borderTopColor: accent.from }} />
        <p style={{ ...styles.loadingText, color: palette.textPrimary, fontSize: '15px', fontWeight: 700 }}>
          Finishing installation…
        </p>
        <p style={{ ...styles.loadingText, color: palette.textSecondary, marginTop: '4px' }}>
          Please keep this screen open.
        </p>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

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
  countdownLogoWrap: {
    width: '76px',
    height: '76px',
    borderRadius: '20px',
    padding: '3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownLogo: {
    width: '100%',
    height: '100%',
    borderRadius: '17px',
    objectFit: 'cover',
    display: 'block',
  },
  countdownNumber: {
    fontSize: '32px',
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.5px',
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
