import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TenantLanding.jsx used to special-case Samsung Internet: it detected the
// UA, discarded any beforeinstallprompt event it fired/had already
// captured, and redirected the user to a Chrome hand-off card instead of
// the normal Install App flow. That whole branch has been removed —
// Samsung now goes through the exact same deferredPrompt -> prompt() ->
// userChoice -> 60s countdown -> appinstalled flow as Chrome.
//
// There is no jsdom/React Testing Library harness in this repo (see
// tenantNavigation.test.js's own comment on this), so TenantLanding.jsx's
// render/click behavior can't be exercised directly here. This file proves
// the fix two ways instead:
//  1. A source-level regression guard: the Samsung-specific branching is
//     gone from TenantLanding.jsx, and the shared install-prompt effect/
//     handler is no longer gated behind any UA check.
//  2. Behavioral tests against src/utils/installPrompt.js — the shared
//     store TenantLanding.jsx's prompt effect reads/writes — proving it is
//     (and always was) completely UA-agnostic: capturing, subscribing to,
//     and clearing a prompt behaves identically regardless of
//     navigator.userAgent. Combined with (1), this shows Chrome and
//     Samsung now take the exact same path through the component.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantLandingSource = fs.readFileSync(
  path.join(__dirname, '../src/TenantLanding.jsx'),
  'utf8'
);

test('source guard: no Samsung-specific UA detection, Chrome hand-off, or forced-Chrome UI remain in TenantLanding.jsx', () => {
  assert.doesNotMatch(tenantLandingSource, /SamsungBrowser/);
  assert.doesNotMatch(tenantLandingSource, /isSamsungInternet/);
  assert.doesNotMatch(tenantLandingSource, /buildChromeIntentUrl/);
  assert.doesNotMatch(tenantLandingSource, /handleOpenInChrome/);
  assert.doesNotMatch(tenantLandingSource, /chromeOpenFailed/);
  assert.doesNotMatch(tenantLandingSource, /Open in Chrome/);
  assert.doesNotMatch(tenantLandingSource, /package=com\.android\.chrome/);
});

test('source guard: the beforeinstallprompt capture effect adopts every event unconditionally (no UA branch before setDeferredPrompt)', () => {
  const effectStart = tenantLandingSource.indexOf('const handlePromptEvent = (event) => {');
  assert.ok(effectStart !== -1, 'handlePromptEvent should still exist');
  const effectBody = tenantLandingSource.slice(effectStart, effectStart + 400);
  // preventDefault() then setDeferredPrompt(event) with nothing UA-specific
  // in between — the same two lines run for every browser now.
  assert.match(effectBody, /event\.preventDefault\(\);\s*setDeferredPrompt\(event\);/);
});

test('source guard: the already-captured getInstallPrompt() pickup adopts it unconditionally (no UA branch)', () => {
  const pickupStart = tenantLandingSource.indexOf('const existingPrompt = getInstallPrompt();');
  assert.ok(pickupStart !== -1, 'the existingPrompt pickup should still exist');
  const pickupBody = tenantLandingSource.slice(pickupStart, pickupStart + 200);
  assert.match(pickupBody, /if \(existingPrompt\) handlePromptEvent\(existingPrompt\);/);
});

test('source guard: the normal Install App card (handleCardClick/handleInstallClick) is reachable unconditionally — no early return before it browser-branches away', () => {
  // The Samsung early-return used to sit between the countdown screen and
  // this normal card's `return (` — confirming it's gone means every
  // browser, Samsung included, now falls through to the same card.
  const countdownIdx = tenantLandingSource.indexOf('FULL-SCREEN 60-SECOND INSTALL COUNTDOWN');
  const cardClickIdx = tenantLandingSource.indexOf('const handleCardClick = () => {');
  assert.ok(countdownIdx !== -1 && cardClickIdx !== -1);
  const between = tenantLandingSource.slice(countdownIdx, cardClickIdx);
  assert.doesNotMatch(between, /SamsungBrowser|isSamsungInternet|Open in Chrome|package=com\.android\.chrome/);
});

// --- installPrompt.js: the shared store is UA-agnostic -------------------

const installWindowStub = (userAgent) => {
  let notify = null;
  globalThis.window = {
    navigator: { userAgent },
    __setuDeferredInstallPrompt: null,
    get __setuNotifyInstallPrompt() { return notify; },
    set __setuNotifyInstallPrompt(fn) { notify = fn; }
  };
};

const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36';
const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';

for (const [label, ua] of [['Chrome', CHROME_UA], ['Samsung Internet', SAMSUNG_UA]]) {
  test(`${label} UA: a captured beforeinstallprompt is retained by getInstallPrompt(), never auto-cleared`, async () => {
    installWindowStub(ua);
    const { getInstallPrompt, clearInstallPrompt } = await import(`../src/utils/installPrompt.js?ua=${encodeURIComponent(ua)}`);

    const fakeEvent = { prompt: () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    // Mirrors index.html's inline bootstrap script capturing the real
    // browser event before any module (including this test's import) runs.
    globalThis.window.__setuDeferredInstallPrompt = fakeEvent;

    // installPrompt.js never reads navigator.userAgent anywhere — the
    // captured event comes back exactly as stored, regardless of UA.
    assert.equal(getInstallPrompt(), fakeEvent);

    // Only an explicit clearInstallPrompt() (called after .prompt() is
    // actually consumed, or on a genuine cancel) removes it — never a
    // UA check.
    clearInstallPrompt();
    assert.equal(getInstallPrompt(), null);
  });

  test(`${label} UA: a subscriber registered before the event fires still receives it (normal Install App flow)`, async () => {
    installWindowStub(ua);
    const { subscribeInstallPrompt } = await import(`../src/utils/installPrompt.js?ua2=${encodeURIComponent(ua)}`);

    let received = null;
    const unsubscribe = subscribeInstallPrompt((event) => { received = event; });

    const fakeEvent = { prompt: () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    // index.html's inline script calls window.__setuNotifyInstallPrompt
    // directly when a beforeinstallprompt fires after this module loaded.
    globalThis.window.__setuNotifyInstallPrompt(fakeEvent);

    assert.equal(received, fakeEvent);
    unsubscribe();
  });
}
