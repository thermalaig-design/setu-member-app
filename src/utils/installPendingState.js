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
// Two independent flags live here, deliberately not merged into one:
// - the PENDING record: "the user accepted install; has it been confirmed
//   yet?" — time-bounded (see INSTALL_PENDING_MAX_AGE_MS) UNLESS its
//   `confirmed` field is set, in which case it never goes stale purely from
//   elapsed wall-clock time. `confirmed` is set the moment a genuine
//   `appinstalled` event fires — see isConfirmed's own comment for why a
//   plain TTL alone cannot be trusted for that case.
// - the INSTALLED record: "this install was, at some point, fully verified"
//   — written only once, right when that verification succeeds, and does
//   not expire on its own. Its job is to close the gap between
//   "verification just succeeded in memory" and "the pending record has
//   been cleared" so a remount racing that exact moment always has at
//   least one persisted signal to read, never neither (see
//   writeVerifiedRecord's own comment). It is NOT permanent proof the app
//   is still installed, though — the browser itself is the source of truth
//   for that. TenantLanding.jsx clears it (clearVerifiedRecord) the moment
//   `beforeinstallprompt` fires again for this slug, since a browser only
//   fires that event for an origin/app it currently considers installable,
//   which it does not for one it still believes is installed — a refire is
//   itself strong evidence the user uninstalled since this record was
//   written. Every read/write here is scoped by normalizeSlugIdentity, so
//   this reconciliation for tenant A's slug can never touch tenant B's.
const PENDING_KEY_PREFIX = 'tenant_install_pending_v1:';
const INSTALLED_KEY_PREFIX = 'tenant_install_installed_v1:';

// How long an UNCONFIRMED pending record can go without its timestamp being
// refreshed before it's treated as stale/abandoned. Measured from the last
// refresh, not the original accept — see TenantLanding.jsx's install-pending
// heartbeat, which keeps sliding this forward for as long as an install is
// actively being waited on/verified.
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
    // A confirmed record is terminal proof for this slug (a real
    // `appinstalled` event already fired) — it must never be discarded just
    // because a lot of wall-clock time passed while this tab was
    // backgrounded/throttled/discarded and missed heartbeat writes.
    if (!parsed.confirmed && now - parsed.ts > INSTALL_PENDING_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const isInstallPending = (slug, options) => Boolean(readPendingRecord(slug, options));
export const isInstallConfirmed = (slug, options) => Boolean(readPendingRecord(slug, options)?.confirmed);

// `confirmed: true` is a one-way upgrade — once a record is confirmed,
// later calls (e.g. the periodic heartbeat, which never itself passes
// `confirmed`) must not accidentally downgrade it back to unconfirmed by
// overwriting the record without that field.
export const writePendingRecord = (slug, { confirmed = false } = {}) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return null;
  try {
    const existing = readPendingRecord(normalizedSlug);
    const value = { slug: normalizedSlug, ts: Date.now(), confirmed: confirmed || Boolean(existing?.confirmed) };
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

// Written the instant verification succeeds (a genuine
// getInstalledRelatedApps match, or the trusted appinstalled-fallback
// timeout) — BEFORE the pending record is cleared, so a remount racing
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
// reporting the app installable again, an old accepted/confirmed-but-never-
// finished record for it is equally stale and must not keep seeding a
// 'finalizing'/'unconfirmed' phase on the next mount either.
export const clearVerifiedRecord = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return;
  try {
    localStorage.removeItem(getInstalledKey(normalizedSlug));
  } catch {
    // ignore
  }
};
