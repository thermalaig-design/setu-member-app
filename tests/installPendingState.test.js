import test from 'node:test';
import assert from 'node:assert/strict';

// installPendingState.js is the persisted record behind TenantLanding.jsx's
// fresh-install flow (accept -> appinstalled -> verified). It only touches
// localStorage, so — like tests/tenantNavigation.test.js — this stubs a
// minimal `localStorage` on the Node global instead of pulling in a
// jsdom/RTL harness this repo doesn't otherwise have.
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
  INSTALL_PENDING_MAX_AGE_MS,
  normalizeSlugIdentity,
  readPendingRecord,
  isInstallPending,
  writePendingRecord,
  clearPendingRecord,
  isInstallVerified,
  writeVerifiedRecord,
  clearVerifiedRecord,
  resolveInstallUiState,
} = await import('../src/utils/installPendingState.js');

// --- Fresh-install success UI must be gated by the real `appinstalled`
// event, never by a timeout/heartbeat/early getInstalledRelatedApps match. ---

test('accepted + no appinstalled => loader only, never success', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);

  // No matter how long verification would have polled in the old design,
  // or how many heartbeat writes happen, an accepted-but-unverified record
  // must never resolve to the success phase.
  const state = resolveInstallUiState(slug);
  assert.equal(state.phase, 'unconfirmed');
  assert.equal(state.isInstalled, false);
  assert.equal(state.isResumingAcceptedInstall, true);

  // Even a heartbeat rewrite (writePendingRecord called again, exactly what
  // TenantLanding.jsx's startInstallPendingHeartbeat does) never verifies
  // the install by itself.
  writePendingRecord(slug);
  assert.equal(isInstallVerified(slug), false);
  assert.equal(resolveInstallUiState(slug).phase, 'unconfirmed');
});

test('accepted + appinstalled => settling loader immediately, success only once the settle window elapses', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();

  writePendingRecord(slug);
  assert.equal(resolveInstallUiState(slug, { now: t0 }).phase, 'unconfirmed');

  // Mirrors handleAppInstalled's own required order: write verified+readyAt
  // FIRST (never itself proof of success — see the settle-window tests
  // further down), then (in the component) keep installPhase off
  // 'installed', then clear pending.
  const readyAt = t0 + 20000;
  writeVerifiedRecord(slug, { readyAt });
  assert.equal(resolveInstallUiState(slug, { now: t0 }).phase, 'finalizing');
  clearPendingRecord(slug);

  const state = resolveInstallUiState(slug, { now: t0 });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.isInstalled, false);
});

test('remount after a persisted, already-settled appinstalled => success', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);
  // No explicit readyAt => already settled (see writeVerifiedRecord's own
  // comment) — models the independent "already installed on an earlier
  // visit" detection, which has nothing left to stabilize, as opposed to a
  // just-fired appinstalled event (see the settle-window tests below for
  // that case, which always passes an explicit future readyAt).
  writeVerifiedRecord(slug);
  clearPendingRecord(slug);

  // Simulates a brand new mount (a fresh TenantLanding render, or a real
  // page reload) reading only from persisted storage.
  const state = resolveInstallUiState(slug);
  assert.equal(state.phase, 'installed');
  assert.equal(state.isInstalled, true);
  assert.equal(state.isResumingAcceptedInstall, false);
});

test('pending without verified => loader', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);

  const state = resolveInstallUiState(slug);
  assert.equal(state.phase, 'unconfirmed');
  assert.equal(state.isInstalled, false);
});

test('no pending and no verified => Install App', () => {
  installLocalStorageStub();
  const slug = 'never-installed-app';

  const state = resolveInstallUiState(slug);
  assert.equal(state.phase, 'idle');
  assert.equal(state.isInstalled, false);
  assert.equal(state.isResumingAcceptedInstall, false);
});

// --- Post-appinstalled 20s stabilization window (mirrors TenantLanding.jsx's
// POST_APPINSTALLED_SETTLE_MS) — a delay, never itself proof of success. ---
const SETTLE_MS = 20000;

test('appinstalled at T0 => settling loader, not success', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();

  writePendingRecord(slug);
  // Mirrors handleAppInstalled's exact order: verified+readyAt written
  // first, phase kept off 'installed'.
  writeVerifiedRecord(slug, { readyAt: t0 + SETTLE_MS });
  clearPendingRecord(slug);

  const state = resolveInstallUiState(slug, { now: t0 });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.isInstalled, false);
  assert.equal(state.isSettling, true);
  assert.equal(state.readyAt, t0 + SETTLE_MS);
});

test('T0 + 19,999ms => still the settling loader, not success', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();

  writeVerifiedRecord(slug, { readyAt: t0 + SETTLE_MS });

  const state = resolveInstallUiState(slug, { now: t0 + SETTLE_MS - 1 });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.isInstalled, false);
});

test('T0 + 20,000ms => installed/success', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();

  writeVerifiedRecord(slug, { readyAt: t0 + SETTLE_MS });

  const state = resolveInstallUiState(slug, { now: t0 + SETTLE_MS });
  assert.equal(state.phase, 'installed');
  assert.equal(state.isInstalled, true);
});

test('remount at T0 + 8s sees ~12s remaining, never a fresh 20s window', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();
  const readyAt = t0 + SETTLE_MS;

  writeVerifiedRecord(slug, { readyAt });

  // Simulates a remount (tab discard/reload) 8s into the settle window —
  // the persisted readyAt does not move, so only ~12s remain, not 20s.
  const remountNow = t0 + 8000;
  const state = resolveInstallUiState(slug, { now: remountNow });
  assert.equal(state.phase, 'finalizing');
  assert.equal(state.readyAt, readyAt);
  const remainingMs = state.readyAt - remountNow;
  assert.equal(remainingMs, 12000);
});

test('remount after T0 + 20s => success immediately, no loader replay', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();
  const readyAt = t0 + SETTLE_MS;

  writeVerifiedRecord(slug, { readyAt });

  // Remount well past the deadline (e.g. the tab was discarded for a
  // minute and only reopened afterwards).
  const state = resolveInstallUiState(slug, { now: readyAt + 5000 });
  assert.equal(state.phase, 'installed');
  assert.equal(state.isInstalled, true);
});

test('beforeinstallprompt refire clears both verified and the settle deadline', () => {
  installLocalStorageStub();
  const slug = 'business-app';
  const t0 = Date.now();

  writeVerifiedRecord(slug, { readyAt: t0 + SETTLE_MS });
  assert.equal(resolveInstallUiState(slug, { now: t0 }).phase, 'finalizing');

  // Browser reports installable again for this slug (uninstalled) —
  // TenantLanding.jsx's beforeinstallprompt subscription reconciles by
  // clearing the verified record, which carries readyAt as part of the
  // same blob, so the settle deadline is gone too — nothing survives to
  // still claim "settling" or "installed" afterwards.
  clearVerifiedRecord(slug);

  const state = resolveInstallUiState(slug, { now: t0 + 1 });
  assert.equal(state.phase, 'idle');
  assert.equal(state.isInstalled, false);
  assert.equal(state.isSettling, false);
  assert.equal(state.readyAt, null);
});

test('tenant A\'s settle deadline never affects tenant B, even mid-window', () => {
  installLocalStorageStub();
  const t0 = Date.now();

  // Tenant A is 8s into its settle window (12s remaining).
  writeVerifiedRecord('tenant-a', { readyAt: t0 + SETTLE_MS });
  // Tenant B has never even accepted an install.
  const now = t0 + 8000;

  const stateA = resolveInstallUiState('tenant-a', { now });
  const stateB = resolveInstallUiState('tenant-b', { now });

  assert.equal(stateA.phase, 'finalizing');
  assert.equal(stateB.phase, 'idle');
  assert.equal(stateB.readyAt, null);
});

// The live "did the appinstalled handler promote state before Chrome's own
// event fired" concern (the [install-flow:appinstalled-fired]
// `alreadyInstalled: true` bug report) is a React-timing question that
// needs a DOM/React harness this repo doesn't have to exercise directly.
// What IS verifiable here, and is the actual fix, is the invariant that
// made that bug possible in the first place: verified state must never
// come from anything but an explicit writeVerifiedRecord call — never
// implied by a pending record's age, a heartbeat write, or elapsed time.
test('accepting alone (and any number of heartbeat rewrites) never implies verified, at any elapsed time', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);
  for (let i = 0; i < 5; i += 1) {
    writePendingRecord(slug); // heartbeat-style rewrite
  }
  assert.equal(isInstallVerified(slug), false);

  // Even once the pending record itself would be considered stale, that is
  // still never treated as verified — it simply stops being "pending" too
  // (see the staleness test below), it does not flip to "installed".
  const farFuture = Date.now() + INSTALL_PENDING_MAX_AGE_MS * 10;
  assert.equal(isInstallVerified(slug), false);
  assert.equal(resolveInstallUiState(slug, { now: farFuture }).phase, 'idle');
});

test('a pending record goes stale after INSTALL_PENDING_MAX_AGE_MS with no heartbeat', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);
  const justPastMaxAge = Date.now() + INSTALL_PENDING_MAX_AGE_MS + 1;

  assert.equal(isInstallPending(slug, { now: justPastMaxAge }), false);
  assert.equal(readPendingRecord(slug, { now: justPastMaxAge }), null);
});

test('/app/<slug> and /app/<slug>/ resolve to the same install identity', () => {
  installLocalStorageStub();

  writePendingRecord('business-app/');

  assert.equal(isInstallPending('business-app'), true);
  assert.equal(normalizeSlugIdentity('Business-App/'), 'business-app');
});

test('the verified record is independent of and outlives the pending record', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug);
  writeVerifiedRecord(slug);
  clearPendingRecord(slug);

  assert.equal(isInstallPending(slug), false);
  assert.equal(isInstallVerified(slug), true);
});

test('an absent record reads as not-pending/not-verified/idle without throwing', () => {
  installLocalStorageStub();
  const slug = 'never-installed-app';

  assert.equal(isInstallPending(slug), false);
  assert.equal(isInstallVerified(slug), false);
  assert.equal(readPendingRecord(slug), null);
  assert.equal(resolveInstallUiState(slug).phase, 'idle');
});

test('a record written for one slug is never read back for a different slug', () => {
  installLocalStorageStub();

  writePendingRecord('tenant-a');
  writeVerifiedRecord('tenant-a');

  assert.equal(isInstallPending('tenant-b'), false);
  assert.equal(isInstallVerified('tenant-b'), false);
  assert.equal(resolveInstallUiState('tenant-b').phase, 'idle');
});

// --- Non-expiring verified state must still be reversible on uninstall. ---

// Regression test for: verified -> user uninstalls the PWA -> the browser
// later reports it installable again (beforeinstallprompt refires) -> the
// stale verified record must not permanently suppress reinstall UI.
// TenantLanding.jsx's beforeinstallprompt subscription is the caller that
// invokes clearVerifiedRecord in this exact situation (a refire is, by
// itself, the browser telling us it no longer considers the app installed)
// — this test exercises the persisted-state half of that reconciliation.
test('verified -> later browser becomes installable again -> reinstall UI can appear safely', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  // Full happy-path install completed earlier.
  writePendingRecord(slug);
  writeVerifiedRecord(slug);
  clearPendingRecord(slug);
  assert.equal(isInstallVerified(slug), true);

  // User later uninstalls the PWA from Android. Some time after that, the
  // browser fires beforeinstallprompt again for this same origin/tenant —
  // TenantLanding.jsx's subscription treats that refire as proof the
  // verified record is stale and invalidates it.
  clearVerifiedRecord(slug);
  clearPendingRecord(slug); // also stale, per clearVerifiedRecord's own doc

  // Reinstall UI is safe to show again: neither record claims this slug is
  // installed or mid-install any more.
  const state = resolveInstallUiState(slug);
  assert.equal(state.phase, 'idle');
  assert.equal(state.isInstalled, false);

  // A fresh accept afterwards works exactly like a first-time install.
  writePendingRecord(slug);
  assert.equal(resolveInstallUiState(slug).phase, 'unconfirmed');
  assert.equal(isInstallVerified(slug), false);
});

test('clearVerifiedRecord for tenant A never affects tenant B\'s verified/pending state', () => {
  installLocalStorageStub();

  writePendingRecord('tenant-a');
  writeVerifiedRecord('tenant-a');
  writePendingRecord('tenant-b');
  writeVerifiedRecord('tenant-b');

  clearVerifiedRecord('tenant-a');
  clearPendingRecord('tenant-a');

  assert.equal(isInstallVerified('tenant-a'), false);
  assert.equal(isInstallPending('tenant-a'), false);
  assert.equal(isInstallVerified('tenant-b'), true);
  assert.equal(isInstallPending('tenant-b'), true);
});
