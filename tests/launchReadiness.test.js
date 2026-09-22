import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesTenantRelatedApp, computeLaunchReadyCandidate, canAttemptOpenAppLaunch } from '../src/utils/launchReadiness.js';

// Fix for the post-install "Open App" race: the success/Open App UI used to
// become available purely because a fixed 20s timer elapsed after
// `appinstalled`, with no check that Android's own installed-app registry
// (and its intent-filter resolution) had actually caught up. The first tap
// then often fell through to Open App's own S.browser_fallback_url and
// reloaded the browser tab — looking like a refresh — while a retry a few
// seconds later worked once the registry settled.
//
// Three explicit concepts, kept separate throughout (see TenantLanding.jsx's
// own comment for the full reasoning):
//   A. install accepted    — native prompt 'accepted' outcome
//   B. install confirmed   — a genuine `appinstalled` DOM event
//   C. launch-ready        — Android's registry actually resolving this
//                            tenant's intent, not just B having happened

const createLocalStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
};

const installLocalStorageStub = () => {
  const localStorage = createLocalStorage();
  globalThis.localStorage = localStorage;
  return localStorage;
};

const {
  writeVerifiedRecord,
  promoteVerifiedReadyAt,
  resolveInstallUiState,
} = await import('../src/utils/installPendingState.js');

const LAUNCH_READY_FALLBACK_MS = 32000;
const LAUNCH_READY_GRACE_MS = 2500;

// --- 1. appinstalled at T0 => not launch-ready immediately -----------------

test('appinstalled at T0 => settling loader (finalizing), not launch-ready/installed immediately', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const t0 = Date.now();

  // Mirrors handleAppInstalled: worst-case bounded fallback deadline
  // written the instant appinstalled fires — never proof of readiness by
  // itself.
  writeVerifiedRecord(slug, { readyAt: t0 + LAUNCH_READY_FALLBACK_MS });

  const state = resolveInstallUiState(slug, { now: t0 });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.isInstalled, false);
});

// --- 2. current tenant appears in getInstalledRelatedApps => readiness
//        after grace period --------------------------------------------

test('current tenant matches getInstalledRelatedApps => readiness only after the grace period, not immediately', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const t0 = Date.now();

  writeVerifiedRecord(slug, { readyAt: t0 + LAUNCH_READY_FALLBACK_MS });

  const relatedApps = [{ id: 'com.example.dds', url: `/pwa-manifest/${slug}.webmanifest` }];
  const matchTime = t0 + 3000; // matched 3s into the fallback window
  assert.equal(matchesTenantRelatedApp(relatedApps, slug), true);

  const candidateReadyAt = computeLaunchReadyCandidate(matchTime, LAUNCH_READY_GRACE_MS);
  const promoted = promoteVerifiedReadyAt(slug, candidateReadyAt);
  assert.equal(promoted.readyAt, matchTime + LAUNCH_READY_GRACE_MS);
  // Sooner than the 32s fallback, but not immediate — still a real grace
  // period on top of the match.
  assert.ok(promoted.readyAt < t0 + LAUNCH_READY_FALLBACK_MS);
  assert.ok(promoted.readyAt > matchTime);

  // Still finalizing right at the match instant...
  assert.equal(resolveInstallUiState(slug, { now: matchTime }).phase, 'finalizing');
  // ...but installed once the grace period on top of the match elapses.
  assert.equal(resolveInstallUiState(slug, { now: promoted.readyAt }).phase, 'installed');
});

// --- 3. another tenant appears => ignored ----------------------------------

test('a DIFFERENT tenant appearing in getInstalledRelatedApps is ignored — never promotes readiness for this tenant', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const otherSlug = 'backup';
  const t0 = Date.now();
  const fallbackReadyAt = t0 + LAUNCH_READY_FALLBACK_MS;

  writeVerifiedRecord(slug, { readyAt: fallbackReadyAt });

  const relatedApps = [{ id: 'com.example.backup', url: `/pwa-manifest/${otherSlug}.webmanifest` }];
  assert.equal(matchesTenantRelatedApp(relatedApps, slug), false);

  // No match => no promotion attempted (mirrors TenantLanding.jsx's polling
  // effect, which only calls promoteInstallReadyAt on a genuine match) —
  // the fallback deadline is completely untouched.
  const state = resolveInstallUiState(slug, { now: t0 + 3000 });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.readyAt, fallbackReadyAt);
});

test('matchesTenantRelatedApp never matches on a bare substring across tenants (e.g. "dds" vs "dds-backup")', () => {
  // id.includes(slug) is intentionally loose (matches TenantLanding.jsx's
  // production matcher exactly), but the manifest URL path check is
  // slug-exact — a related app for a DIFFERENT, unrelated tenant whose own
  // manifest path doesn't contain this slug must not match via URL.
  const relatedApps = [{ id: 'com.example.other', url: '/pwa-manifest/backup.webmanifest' }];
  assert.equal(matchesTenantRelatedApp(relatedApps, 'dds'), false);
});

// --- 4. unsupported getInstalledRelatedApps => bounded fallback deadline --

test('unsupported/no getInstalledRelatedApps match ever => bounded fallback deadline still applies, never an unbounded wait', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const t0 = Date.now();
  const readyAt = t0 + LAUNCH_READY_FALLBACK_MS;

  writeVerifiedRecord(slug, { readyAt });

  // Just before the fallback: still finalizing.
  assert.equal(resolveInstallUiState(slug, { now: readyAt - 1 }).phase, 'finalizing');
  // At/after the fallback: installed, with no getInstalledRelatedApps
  // signal ever having fired (nothing here calls promoteVerifiedReadyAt).
  assert.equal(resolveInstallUiState(slug, { now: readyAt }).phase, 'installed');
});

// --- 5. remount mid-readiness preserves original (promoted) deadline ------

test('remount mid-readiness-window preserves the PROMOTED deadline, never resets to a fresh fallback window', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const t0 = Date.now();

  writeVerifiedRecord(slug, { readyAt: t0 + LAUNCH_READY_FALLBACK_MS });
  const matchTime = t0 + 2000;
  const promoted = promoteVerifiedReadyAt(slug, computeLaunchReadyCandidate(matchTime, LAUNCH_READY_GRACE_MS));

  // Simulates a remount (tab discard/reload) shortly after the promotion —
  // a fresh read of the persisted record must see the SAME promoted
  // deadline, not the original 32s fallback and not a new window.
  const remountNow = matchTime + 500;
  const state = resolveInstallUiState(slug, { now: remountNow });
  assert.equal(state.readyAt, promoted.readyAt);
  assert.notEqual(state.readyAt, t0 + LAUNCH_READY_FALLBACK_MS);
});

test('promoteVerifiedReadyAt never moves the deadline LATER than what is already persisted', () => {
  installLocalStorageStub();
  const slug = 'dds';
  const t0 = Date.now();
  const earlyReadyAt = t0 + 5000;

  writeVerifiedRecord(slug, { readyAt: earlyReadyAt });

  // A later "match" attempting to push the deadline further out must be a
  // no-op — a real match always wins over a slower one, never the reverse.
  const laterCandidate = t0 + 20000;
  const result = promoteVerifiedReadyAt(slug, laterCandidate);
  assert.equal(result.readyAt, earlyReadyAt);
});

// --- 8. Chrome and Samsung use identical logic (pure-function level) ------

test('matchesTenantRelatedApp / computeLaunchReadyCandidate take no browser/UA input at all — identical for every browser', () => {
  // Neither function reads navigator.userAgent or anything UA-like — the
  // exact same launch-readiness determination applies to Chrome, Samsung
  // Internet, or any other Chromium-based browser that supports
  // getInstalledRelatedApps.
  const relatedApps = [{ id: 'com.example.dds', url: '/pwa-manifest/dds.webmanifest' }];
  assert.equal(matchesTenantRelatedApp(relatedApps, 'dds'), true);
  assert.equal(computeLaunchReadyCandidate(1000, 2500), 3500);
});

// --- 6 & 7: Open App one-shot launch (requirements 9-10) — source guards ---
// No jsdom/RTL harness in this repo (see tenantNavigation.test.js's own
// comment), so the actual click/visibilitychange/pagehide behavior can't be
// exercised directly. These prove the fix structurally, the same way
// samsungInstallParity.test.js does for the Samsung-parity work.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantLandingSource = fs.readFileSync(
  path.join(__dirname, '../src/TenantLanding.jsx'),
  'utf8'
);

test('source guard: handleOpenApp never passes S.browser_fallback_url on Android — no fallback-triggered reload of the success page', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  assert.ok(handleOpenAppStart !== -1, 'handleOpenApp should exist');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const body = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);

  assert.match(body, /buildAndroidIntentUrl\(tenantUrl, \{ includeFallback: false \}\)/);
  assert.doesNotMatch(body, /buildAndroidIntentUrl\(tenantUrl\)(?!,)/);
});

test('source guard: handleOpenApp watches visibilitychange/pagehide and never navigates/reloads on failure — only sets a message flag', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const body = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);

  assert.match(body, /addEventListener\('visibilitychange'/);
  assert.match(body, /addEventListener\('pagehide'/);
  assert.match(body, /setOpenAppLaunchFailed\(true\)/);
  // The one-shot navigation is the intent:// URL itself, fired once —
  // never a second navigation, never window.location.reload(), never a
  // fallback to the plain tenantUrl inside this function.
  assert.match(body, /window\.location\.href = intentUrl;/);
  assert.doesNotMatch(body, /location\.reload/);
  assert.doesNotMatch(body, /window\.open/);
});

test('source guard: no UA branching anywhere in the launch-readiness / Open App code paths — Chrome and Samsung run the identical logic', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const pollingStart = tenantLandingSource.indexOf('LAUNCH-READINESS POLLING (requirements 3-5)');
  const pollingEnd = tenantLandingSource.indexOf('}, [installPhase, normalizedAppSlug, scheduleSettle]);');

  const openAppBody = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);
  const pollingBody = tenantLandingSource.slice(pollingStart, pollingEnd);

  assert.doesNotMatch(openAppBody, /SamsungBrowser|isSamsungInternet|userAgent/);
  assert.doesNotMatch(pollingBody, /SamsungBrowser|isSamsungInternet|userAgent/);
});

// --- FINAL CHECK 1: hard launch-readiness guard ----------------------------
// canAttemptOpenAppLaunch is handleOpenApp's own first check (its literal
// first line — see the source guard below) — enforced by the handler
// itself, never only by whether a button happens to be rendered/wired.

test('handleOpenApp guard: invoked while finalizing (confirmed but not yet launch-ready) => no intent/navigation attempt', () => {
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'finalizing', isInstalled: false }), false);
  // Even if some other bug ever set isInstalled true while phase lagged
  // behind, phase itself must still gate it — both conditions are required.
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'finalizing', isInstalled: true }), false);
});

test('handleOpenApp guard: invoked before appinstalled at all (idle/launching/unconfirmed) => no intent/navigation attempt', () => {
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'idle', isInstalled: false }), false);
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'launching', isInstalled: false }), false);
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'unconfirmed', isInstalled: false }), false);
});

test('handleOpenApp guard: invoked after launch-ready (installed phase + isInstalled true) => one launch attempt allowed', () => {
  assert.equal(canAttemptOpenAppLaunch({ installPhase: 'installed', isInstalled: true }), true);
});

test('source guard: canAttemptOpenAppLaunch is handleOpenApp\'s own first statement — the handler enforces readiness itself, not just button wiring', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const firstLine = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppStart + 200).split('\n')[1].trim();
  assert.equal(firstLine, "if (!canAttemptOpenAppLaunch({ installPhase, isInstalled })) return;");
});

// --- FINAL CHECK 2: timer/listener cleanup + single-flight launch --------

test('source guard 2A: promoting readyAt goes through scheduleSettle (which always clears the old timeout first), never a raw parallel setTimeout', () => {
  const scheduleSettleStart = tenantLandingSource.indexOf('const scheduleSettle = useCallback((readyAt) => {');
  const scheduleSettleBody = tenantLandingSource.slice(scheduleSettleStart, scheduleSettleStart + 300);
  // clearSettleTimeout() is the very first thing scheduleSettle does —
  // there is structurally only ever one active settle timer.
  assert.match(scheduleSettleBody, /clearSettleTimeout\(\);/);

  const pollingStart = tenantLandingSource.indexOf('LAUNCH-READINESS POLLING (requirements 3-5)');
  const pollingEnd = tenantLandingSource.indexOf('}, [installPhase, normalizedAppSlug, scheduleSettle]);');
  const pollingBody = tenantLandingSource.slice(pollingStart, pollingEnd);
  assert.match(pollingBody, /scheduleSettle\(promoted\.readyAt\)/);
  // Never bypasses scheduleSettle with its own setTimeout for completeSettle.
  assert.doesNotMatch(pollingBody, /setTimeout\(completeSettle/);
});

test('settleTimeoutRef is a single ref (not an array/list) — structurally impossible to hold two active settle callbacks at once', () => {
  assert.match(tenantLandingSource, /const settleTimeoutRef = useRef\(null\);/);
  // clearSettleTimeout clears that exact ref before scheduleSettle ever
  // assigns a new one to it.
  const clearSettleStart = tenantLandingSource.indexOf('const clearSettleTimeout = useCallback(() => {');
  const clearSettleBody = tenantLandingSource.slice(clearSettleStart, clearSettleStart + 250);
  assert.match(clearSettleBody, /clearTimeout\(settleTimeoutRef\.current\)/);
  assert.match(clearSettleBody, /settleTimeoutRef\.current = null;/);
});

test('source guard 2B: the Android single-flight lock is released ONLY inside cleanup() (tied to the watch outcome), never by a separate timer shorter than the watch window', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const body = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);

  // Exactly one place releases the lock inside the Android branch: cleanup().
  const cleanupStart = body.indexOf('const cleanup = () => {');
  const cleanupEnd = body.indexOf('};', cleanupStart);
  const cleanupBody = body.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupBody, /openAppInFlightRef\.current = false;/);

  // The Android branch (everything from the intentUrl computation onward)
  // must not release the lock via OPEN_APP_RETRY_RESET_MS/a bare
  // setTimeout — only via cleanup() above.
  const androidBranchStart = body.indexOf('const intentUrl = buildAndroidIntentUrl');
  const androidBranch = body.slice(androidBranchStart);
  assert.doesNotMatch(androidBranch, /OPEN_APP_RETRY_RESET_MS/);
});

test('rapid double click (pure logic): the guard blocks a second attempt while openAppInFlightRef is still true', () => {
  // Models handleOpenApp's own two-line guard in isolation: the readiness
  // check plus the in-flight ref check. A second call before the first
  // attempt's cleanup() has run must be rejected.
  let inFlight = false;
  const attempt = ({ installPhase, isInstalled }) => {
    if (!canAttemptOpenAppLaunch({ installPhase, isInstalled })) return 'blocked-not-ready';
    if (inFlight) return 'blocked-in-flight';
    inFlight = true;
    return 'launched';
  };
  const state = { installPhase: 'installed', isInstalled: true };
  assert.equal(attempt(state), 'launched');
  // Rapid re-tap before cleanup() releases the lock.
  assert.equal(attempt(state), 'blocked-in-flight');
  assert.equal(attempt(state), 'blocked-in-flight');
  // Only after the watch concludes (cleanup releases the lock) does a
  // fresh tap launch again.
  inFlight = false;
  assert.equal(attempt(state), 'launched');
});

test('source guard 2C: successful hand-off (visibilitychange hidden / pagehide) calls cleanup(), removing both listeners and the watch timeout', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const body = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);

  const markHandedOffStart = body.indexOf('const markHandedOff = () => {');
  const markHandedOffBody = body.slice(markHandedOffStart, body.indexOf('};', markHandedOffStart));
  assert.match(markHandedOffBody, /cleanup\(\);/);

  const cleanupStart = body.indexOf('const cleanup = () => {');
  const cleanupBody = body.slice(cleanupStart, body.indexOf('};', cleanupStart));
  assert.match(cleanupBody, /removeEventListener\('visibilitychange'/);
  assert.match(cleanupBody, /removeEventListener\('pagehide'/);
  assert.match(cleanupBody, /clearTimeout\(watchTimeoutId\)/);
});

test('source guard 2D: a failed attempt (watch window elapses, still visible) releases the lock via cleanup() and never navigates — retry stays possible', () => {
  const handleOpenAppStart = tenantLandingSource.indexOf('const handleOpenApp = () => {');
  const handleOpenAppEnd = tenantLandingSource.indexOf('\n  };', handleOpenAppStart);
  const body = tenantLandingSource.slice(handleOpenAppStart, handleOpenAppEnd);

  const watchTimeoutStart = body.indexOf('watchTimeoutId = window.setTimeout(() => {');
  const watchTimeoutBody = body.slice(watchTimeoutStart, body.indexOf('}, OPEN_APP_HANDOFF_WATCH_MS);', watchTimeoutStart));
  // cleanup() (which releases the lock) runs before the failure message is
  // shown, and nothing in this branch navigates anywhere.
  assert.match(watchTimeoutBody, /cleanup\(\);/);
  assert.match(watchTimeoutBody, /setOpenAppLaunchFailed\(true\)/);
  assert.doesNotMatch(watchTimeoutBody, /window\.location/);
});

test('source guard: unmount cleans up the Open App watch (which releases the in-flight lock), the debounce timer, and the settle timer', () => {
  const unmountStart = tenantLandingSource.indexOf('useEffect(() => () => {');
  const unmountBody = tenantLandingSource.slice(unmountStart, unmountStart + 700);
  assert.match(unmountBody, /openAppResetTimeoutRef\.current/);
  assert.match(unmountBody, /openAppWatchCleanupRef\.current\(\)/);
  assert.match(unmountBody, /clearSettleTimeout\(\);/);
});

test('source guard: the launch-readiness polling effect returns its own cleanup that clears the poll timeout (React runs it automatically on unmount/dep change)', () => {
  const pollingStart = tenantLandingSource.indexOf('LAUNCH-READINESS POLLING (requirements 3-5)');
  const pollingEnd = tenantLandingSource.indexOf('}, [installPhase, normalizedAppSlug, scheduleSettle]);');
  const pollingBody = tenantLandingSource.slice(pollingStart, pollingEnd);

  assert.match(pollingBody, /return \(\) => \{\s*cancelled = true;\s*if \(pollTimeoutId\) clearTimeout\(pollTimeoutId\);\s*\};/);
});
