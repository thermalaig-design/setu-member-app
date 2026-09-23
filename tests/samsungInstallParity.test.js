import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// HISTORY: TenantLanding.jsx originally special-cased Samsung Internet —
// UA-detected it, discarded its beforeinstallprompt event, and redirected
// to a Chrome hand-off card. That was later removed so Samsung ran the
// exact same deferredPrompt -> prompt() -> userChoice -> 60s countdown ->
// appinstalled flow as Chrome. The "Android Chrome-only guided PWA
// installation" feature deliberately REINSTATES routing Samsung Internet
// (and every other non-Chrome Android browser — Edge, Opera, etc.) to an
// "Open in Chrome" compatibility card — see
// utils/installBrowserSupport.js's isAndroidNonChromeBrowser and
// tests/installBrowserSupport.test.js, which own that classification and
// the card's own behavior now. This file's remaining job is narrower: the
// SHARED beforeinstallprompt capture/prompt-store plumbing itself must
// stay completely UA-agnostic — the compatibility card works by never
// rendering the Install App button for non-Chrome browsers, NOT by
// special-casing the prompt-capture effect, so that effect (and
// installPrompt.js, the store it reads/writes) is exactly as
// UA-independent as it was before this feature existed.
//
// There is no jsdom/React Testing Library harness in this repo (see
// tenantNavigation.test.js's own comment on this), so TenantLanding.jsx's
// render/click behavior can't be exercised directly here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantLandingSource = fs.readFileSync(
  path.join(__dirname, '../src/TenantLanding.jsx'),
  'utf8'
);

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

test('source guard: handleCardClick/handleInstallClick themselves stay browser-agnostic — the Chrome-only routing lives entirely in a separate render gate, not inside these handlers', () => {
  // The Android Chrome-only compatibility card (see
  // installBrowserSupport.test.js) is its own early return elsewhere in
  // the render — it does not touch handleCardClick/handleInstallClick, so
  // once a real Chrome (or any other still-supported) session reaches
  // these handlers, they run exactly as before, with no UA branching
  // inside them.
  const countdownIdx = tenantLandingSource.indexOf('FULL-SCREEN 60-SECOND INSTALL COUNTDOWN');
  const cardClickIdx = tenantLandingSource.indexOf('const handleCardClick = () => {');
  assert.ok(countdownIdx !== -1 && cardClickIdx !== -1);
  const between = tenantLandingSource.slice(countdownIdx, cardClickIdx);
  assert.doesNotMatch(between, /SamsungBrowser|isSamsungInternet|isAndroidNonChromeBrowser|Open in Chrome|package=com\.android\.chrome/);
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
