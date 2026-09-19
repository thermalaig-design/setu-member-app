// Persisted (localStorage) record of a tenant PWA install that the user has
// accepted but this tab may not have lived long enough to see through to
// completion — Android can background/discard the tab's renderer for
// several seconds to 30+ seconds while the WebAPK package itself installs,
// which is long enough to wipe every piece of in-memory React state
// (TenantLanding.jsx's own installPhase, refs, etc.). This module is the
// one place that record is read/written/cleared, kept dependency-free (no
// React, no DOM beyond localStorage) so it can be unit tested directly
// under plain `node --test`, the same way utils/tenantNavigation.js is.
//
// Two independent records live here, deliberately not merged into one:
// - the PENDING record: "the user accepted install; has the real
//   `appinstalled` event fired yet?" — always time-bounded (see
//   INSTALL_PENDING_MAX_AGE_MS): if it isn't refreshed by TenantLanding.jsx's
//   heartbeat for that long, it's treated as abandoned rather than resuming
//   a loader forever.
// - the VERIFIED record: "a genuine `appinstalled` event fired for this
//   slug" — written ONLY from that real event (see TenantLanding.jsx's
//   markInstalled/handleAppInstalled), never from a timeout, a heartbeat, or
//   an early getInstalledRelatedApps() match. It does not expire on its own
//   once written. Its job is twofold:
//   1. close the gap between "the appinstalled handler just ran" and "the
//      pending record has been cleared" so a remount racing that exact
//      moment always has at least one persisted signal to read, never
//      neither (see writeVerifiedRecord's own comment);
//   2. let a later remount go straight back to the success/Open-App screen
//      (resolveInstallUiState below) without re-showing any loader.
//   It is NOT permanent proof the app is still installed, though — the
//   browser itself is the source of truth for that. TenantLanding.jsx
//   clears it (clearVerifiedRecord) the moment `beforeinstallprompt` fires
//   again for this slug, since a browser only fires that event for an
//   origin/app it currently considers installable, which it does not for
//   one it still believes is installed — a refire is itself strong evidence
//   the user uninstalled since this record was written. Every read/write
//   here is scoped by normalizeSlugIdentity, so this reconciliation for
//   tenant A's slug can never touch tenant B's.
const PENDING_KEY_PREFIX = 'tenant_install_pending_v1:';
const INSTALLED_KEY_PREFIX = 'tenant_install_installed_v1:';

// How long the pending record can go without its timestamp being refreshed
// before it's treated as stale/abandoned. Measured from the last refresh,
// not the original accept — see TenantLanding.jsx's install-pending
// heartbeat, which keeps sliding this forward for as long as an install is
// actively being waited on.
export const INSTALL_PENDING_MAX_AGE_MS = 120000;

// Strips a trailing slash (and normalizes case/whitespace) so `/app/<slug>`
// and `/app/<slug>/` are always treated as the same install identity —
// Chrome can navigate a tab to its canonical start_url (often adding a
// trailing slash) once a WebAPK finishes installing, and that navigation
// must never look like a different tenant to this module.
export const normalizeSlugIdentity = (slug) => String(slug || '').trim().toLowerCase().replace(/\/+$/, '');

const getPendingKey = (slug) => `${PENDING_KEY_PREFIX}${slug}`;
const getInstalledKey = (slug) => `${INSTALLED_KEY_PREFIX}${slug}`;

// `now` is injectable purely for tests — production callers never pass it.
export const readPendingRecord = (slug, { now = Date.now() } = {}) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return null;
  try {
    const raw = localStorage.getItem(getPendingKey(normalizedSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.slug !== normalizedSlug || !parsed.ts) return null;
    if (now - parsed.ts > INSTALL_PENDING_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const isInstallPending = (slug, options) => Boolean(readPendingRecord(slug, options));

export const writePendingRecord = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return null;
  try {
    const value = { slug: normalizedSlug, ts: Date.now() };
    localStorage.setItem(getPendingKey(normalizedSlug), JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
};

export const clearPendingRecord = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return;
  try {
    localStorage.removeItem(getPendingKey(normalizedSlug));
  } catch {
    // ignore
  }
};

export const isInstallVerified = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return false;
  try {
    return localStorage.getItem(getInstalledKey(normalizedSlug)) === '1';
  } catch {
    return false;
  }
};

// Written the instant a genuine `appinstalled` event is handled — BEFORE
// the pending record is cleared and BEFORE isInstalled/installPhase are set
// in React state (see markInstalled's own comment) — so a remount racing
// that exact instant sees the install record already in place rather than
// a brief window with no persisted evidence of the install at all, which
// would otherwise be indistinguishable from "never accepted".
export const writeVerifiedRecord = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return;
  try {
    localStorage.setItem(getInstalledKey(normalizedSlug), '1');
  } catch {
    // ignore
  }
};

// Invalidates a stale verified record — see this module's own comment for
// why `beforeinstallprompt` firing again for the same slug is the signal
// that triggers this (TenantLanding.jsx's deferredPrompt subscription).
// Also clears any pending record for the same slug: if the browser is
// reporting the app installable again, an old accepted-but-never-finished
// record for it is equally stale and must not keep seeding a loader on the
// next mount either.
export const clearVerifiedRecord = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return;
  try {
    localStorage.removeItem(getInstalledKey(normalizedSlug));
  } catch {
    // ignore
  }
};

// Resolves the mount-time install UI state purely from these two persisted
// records, in the exact priority a fresh install's success UI must respect:
// verified -> pending -> idle (a genuinely completed install always wins,
// a merely-accepted-but-unconfirmed one always renders a loader, never
// Install App or success, and only the total absence of either shows
// Install App). Exported and unit-tested on its own here, separately from
// TenantLanding.jsx, so this priority rule is verifiable without a
// DOM/React harness. TenantLanding.jsx seeds its isInstalled/installPhase
// state from this on every mount, and — critically — only ever moves OFF
// this seed via a genuine `appinstalled` DOM event (markInstalled/
// handleAppInstalled there); never from a timeout, a heartbeat tick, or an
// early getInstalledRelatedApps() match.
export const resolveInstallUiState = (slug, options) => {
  const verified = isInstallVerified(slug);
  const pending = !verified && isInstallPending(slug, options);
  return {
    isInstalled: verified,
    isResumingAcceptedInstall: pending,
    // 'unconfirmed': accepted, not yet verified — always a loader/fallback
    // screen, never Install App and never the success screen.
    phase: verified ? 'installed' : pending ? 'unconfirmed' : 'idle',
  };
};
