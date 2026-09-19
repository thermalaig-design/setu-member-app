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
  isInstallConfirmed,
  writePendingRecord,
  clearPendingRecord,
  isInstallVerified,
  writeVerifiedRecord,
  clearVerifiedRecord,
} = await import('../src/utils/installPendingState.js');

test('accept -> appinstalled -> many empty polls never looks abandoned (the install-state race this module fixes)', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  // 1. user accepts the native prompt.
  writePendingRecord(slug);
  assert.equal(isInstallPending(slug), true);
  assert.equal(isInstallConfirmed(slug), false);

  // 2. a real `appinstalled` event fires — terminal confirmation.
  writePendingRecord(slug, { confirmed: true });
  assert.equal(isInstallConfirmed(slug), true);

  // 3. verification polls getInstalledRelatedApps repeatedly and keeps
  // coming back empty (device hasn't caught up yet) for well past the old
  // fixed TTL, while the tab is backgrounded/throttled and the heartbeat
  // that used to refresh `ts` never runs. A confirmed record must survive
  // this regardless of elapsed time.
  const farFuture = Date.now() + INSTALL_PENDING_MAX_AGE_MS * 10;
  assert.equal(isInstallPending(slug, { now: farFuture }), true);
  assert.equal(isInstallConfirmed(slug, { now: farFuture }), true);

  // 4. verification eventually gets two consecutive matches and the app
  // marks the install fully verified, in the order the fix requires:
  // write the terminal "verified" record before clearing "pending".
  writeVerifiedRecord(slug);
  clearPendingRecord(slug);

  assert.equal(isInstallVerified(slug), true);
  assert.equal(isInstallPending(slug), false);
});

test('an unconfirmed pending record does go stale after INSTALL_PENDING_MAX_AGE_MS with no heartbeat', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug); // confirmed: false
  const justPastMaxAge = Date.now() + INSTALL_PENDING_MAX_AGE_MS + 1;

  assert.equal(isInstallPending(slug, { now: justPastMaxAge }), false);
  assert.equal(readPendingRecord(slug, { now: justPastMaxAge }), null);
});

test('the heartbeat rewriting the record without `confirmed` never downgrades an already-confirmed record', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug, { confirmed: true });
  // Simulates startInstallPendingHeartbeat's periodic writeInstallPending(slug)
  // call, which never itself passes `confirmed`.
  writePendingRecord(slug);

  assert.equal(isInstallConfirmed(slug), true);
});

test('/app/<slug> and /app/<slug>/ resolve to the same install identity', () => {
  installLocalStorageStub();

  writePendingRecord('business-app/', { confirmed: true });

  assert.equal(isInstallPending('business-app'), true);
  assert.equal(isInstallConfirmed('business-app'), true);
  assert.equal(normalizeSlugIdentity('Business-App/'), 'business-app');
});

test('the verified record is independent of and outlives the pending record', () => {
  installLocalStorageStub();
  const slug = 'business-app';

  writePendingRecord(slug, { confirmed: true });
  writeVerifiedRecord(slug);
  clearPendingRecord(slug);

  assert.equal(isInstallPending(slug), false);
  assert.equal(isInstallVerified(slug), true);
});

test('an absent record reads as not-pending/not-confirmed/not-verified without throwing', () => {
  installLocalStorageStub();
  const slug = 'never-installed-app';

  assert.equal(isInstallPending(slug), false);
  assert.equal(isInstallConfirmed(slug), false);
  assert.equal(isInstallVerified(slug), false);
  assert.equal(readPendingRecord(slug), null);
});

test('a record written for one slug is never read back for a different slug', () => {
  installLocalStorageStub();

  writePendingRecord('tenant-a', { confirmed: true });
  writeVerifiedRecord('tenant-a');

  assert.equal(isInstallPending('tenant-b'), false);
  assert.equal(isInstallConfirmed('tenant-b'), false);
  assert.equal(isInstallVerified('tenant-b'), false);
});

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
  writePendingRecord(slug, { confirmed: true });
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
  assert.equal(isInstallVerified(slug), false);
  assert.equal(isInstallPending(slug), false);
  assert.equal(isInstallConfirmed(slug), false);

  // A fresh accept afterwards works exactly like a first-time install.
  writePendingRecord(slug);
  assert.equal(isInstallPending(slug), true);
  assert.equal(isInstallVerified(slug), false);
});

test('clearVerifiedRecord for tenant A never affects tenant B\'s verified/pending state', () => {
  installLocalStorageStub();

  writePendingRecord('tenant-a', { confirmed: true });
  writeVerifiedRecord('tenant-a');
  writePendingRecord('tenant-b', { confirmed: true });
  writeVerifiedRecord('tenant-b');

  clearVerifiedRecord('tenant-a');
  clearPendingRecord('tenant-a');

  assert.equal(isInstallVerified('tenant-a'), false);
  assert.equal(isInstallPending('tenant-a'), false);
  assert.equal(isInstallVerified('tenant-b'), true);
  assert.equal(isInstallPending('tenant-b'), true);
  assert.equal(isInstallConfirmed('tenant-b'), true);
});
