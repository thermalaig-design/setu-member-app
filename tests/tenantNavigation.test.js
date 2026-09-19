import test from 'node:test';
import assert from 'node:assert/strict';

// tenantNavigation.js reads `window.*` directly (matchMedia, sessionStorage,
// location) rather than through an injectable dependency, so these tests
// stub a minimal `window` on the Node global before importing the module —
// there is no jsdom/RTL harness in this repo, so this is the lightest way
// to exercise the real per-window tenant-isolation logic (not a rewrite of
// it) without pulling in a new test framework.
const createSessionStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
};

const installWindowStub = ({ pathname, standalone }) => {
  const sessionStorage = createSessionStorage();
  globalThis.window = {
    matchMedia: () => ({ matches: standalone }),
    navigator: {},
    sessionStorage,
    location: { pathname },
  };
  return sessionStorage;
};

const { getAppHomePath, rememberWindowTenantSlug, readWindowTenantSlug } =
  await import('../src/utils/tenantNavigation.js');

test('URL slug wins over a different slug already recorded for this window (fresh /app/<slug> load beats stale session state)', () => {
  const sessionStorage = installWindowStub({ pathname: '/app/siahh-niahh', standalone: true });
  sessionStorage.setItem('active_app_slug', 'backup');

  assert.equal(getAppHomePath(), '/app/siahh-niahh');
  // Also re-claims the window for the URL's tenant, so any later in-app
  // route that drops the slug still resolves to the correct tenant.
  assert.equal(readWindowTenantSlug(), 'siahh-niahh');
});

test('in-app navigation to a route without the slug stays inside the same tenant', () => {
  installWindowStub({ pathname: '/app/siahh-niahh', standalone: true });
  // TenantContext/TenantLanding would have called this when the tenant
  // first resolved from the URL.
  rememberWindowTenantSlug('siahh-niahh');

  // Simulate an in-app SPA route (e.g. Notices) that drops the slug.
  globalThis.window.location.pathname = '/notices';

  assert.equal(getAppHomePath(), '/app/siahh-niahh');
});

test('never falls back to a different tenant when this window has no recorded slug', () => {
  installWindowStub({ pathname: '/notices', standalone: true });
  // Deliberately nothing recorded for THIS window — even if some other
  // tenant PWA had been opened elsewhere on this device/origin, there is no
  // shared-storage fallback left to leak that identity in here.
  assert.equal(getAppHomePath(), '/');
});

test('non-standalone (ordinary browser tab) always resolves Home to "/" regardless of any recorded slug', () => {
  const sessionStorage = installWindowStub({ pathname: '/notices', standalone: false });
  sessionStorage.setItem('active_app_slug', 'siahh-niahh');

  assert.equal(getAppHomePath(), '/');
});

test('rememberWindowTenantSlug rejects invalid/empty slugs instead of clearing the recorded one', () => {
  const sessionStorage = installWindowStub({ pathname: '/notices', standalone: true });
  sessionStorage.setItem('active_app_slug', 'siahh-niahh');

  assert.equal(rememberWindowTenantSlug('not a slug!'), '');
  assert.equal(readWindowTenantSlug(), 'siahh-niahh');
});
