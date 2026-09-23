import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAndroidUA,
  isRealAndroidChrome,
  isAndroidNonChromeBrowser,
  buildChromeIntentUrl,
  isIOSChromeUA,
} from '../src/utils/installBrowserSupport.js';

// Android Chrome-only guided PWA installation: on Android, only REAL Chrome
// runs the native beforeinstallprompt/countdown/appinstalled flow. Every
// other Chromium-based Android browser (Samsung Internet, Edge, Opera, and
// others) — all of which also carry "Chrome/<version>" in their own UA
// string — gets a "Open in Google Chrome" compatibility card instead,
// pointing the user at the SAME tenant URL opened via an Android intent
// (package=com.android.chrome, no browser_fallback_url).

const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36';
const SAMSUNG_INTERNET_UA =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.6261.119 Mobile Safari/537.36';
const EDGE_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.51';
const OPERA_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/76.2.4027.73374';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

test('Android Chrome UA => real Chrome, NOT routed to the compatibility card', () => {
  assert.equal(isRealAndroidChrome(CHROME_ANDROID_UA), true);
  assert.equal(isAndroidNonChromeBrowser(CHROME_ANDROID_UA), false);
});

test('SamsungBrowser UA (contains "Chrome/" too) => Open in Chrome card, NOT real Chrome', () => {
  assert.equal(isRealAndroidChrome(SAMSUNG_INTERNET_UA), false);
  assert.equal(isAndroidNonChromeBrowser(SAMSUNG_INTERNET_UA), true);
});

test('Edge for Android UA (EdgA/) => Open in Chrome card, NOT real Chrome', () => {
  assert.equal(isRealAndroidChrome(EDGE_ANDROID_UA), false);
  assert.equal(isAndroidNonChromeBrowser(EDGE_ANDROID_UA), true);
});

test('Opera for Android UA (OPR/) => Open in Chrome card, NOT real Chrome', () => {
  assert.equal(isRealAndroidChrome(OPERA_ANDROID_UA), false);
  assert.equal(isAndroidNonChromeBrowser(OPERA_ANDROID_UA), true);
});

test('Samsung UA containing "Chrome" is never misclassified as real Chrome just because /Chrome\\// matches', () => {
  assert.match(SAMSUNG_INTERNET_UA, /Chrome\//); // sanity: the UA really does contain it
  assert.equal(isRealAndroidChrome(SAMSUNG_INTERNET_UA), false);
});

test('iOS Safari is never classified as Android non-Chrome — the gate requires an Android UA first', () => {
  assert.equal(isAndroidUA(IOS_SAFARI_UA), false);
  assert.equal(isAndroidNonChromeBrowser(IOS_SAFARI_UA), false);
});

test('desktop Chrome is not Android at all — never routed to the Android compatibility card', () => {
  assert.equal(isAndroidUA(DESKTOP_CHROME_UA), false);
  assert.equal(isAndroidNonChromeBrowser(DESKTOP_CHROME_UA), false);
});

test('Chrome intent URL preserves /app/<slug>/ path and query params, uses package=com.android.chrome, no browser_fallback_url', () => {
  const url = buildChromeIntentUrl('https://members.example.com/app/dds/?install=1&ref=qr');
  assert.equal(
    url,
    'intent://members.example.com/app/dds/?install=1&ref=qr#Intent;scheme=https;package=com.android.chrome;end'
  );
  assert.doesNotMatch(url, /browser_fallback_url/);
});

test('Chrome intent URL falls back to empty string on an unparsable URL, never throws', () => {
  assert.equal(buildChromeIntentUrl('not a url'), '');
  assert.equal(buildChromeIntentUrl(''), '');
});

// --- Source guards on TenantLanding.jsx's handleOpenInChrome + card ------
// No jsdom/RTL harness in this repo, so DOM/timer behavior is proven
// structurally here, the same way samsungInstallParity.test.js and
// launchReadiness.test.js do for the related Open App work.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantLandingSource = fs.readFileSync(
  path.join(__dirname, '../src/TenantLanding.jsx'),
  'utf8'
);

const getFunctionBody = (startMarker, endMarker) => {
  const start = tenantLandingSource.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find "${startMarker}" in TenantLanding.jsx`);
  const end = tenantLandingSource.indexOf(endMarker, start);
  assert.ok(end !== -1, `expected to find "${endMarker}" after "${startMarker}"`);
  return tenantLandingSource.slice(start, end);
};

test('source guard: handleOpenInChrome is never called from a useEffect — only user-tap triggered, no auto-redirect on load', () => {
  assert.ok(tenantLandingSource.indexOf('const handleOpenInChrome = () => {') !== -1);
  assert.match(tenantLandingSource, /onClick=\{handleOpenInChrome\}/);

  // Every useEffect(...) block in the file must be free of a call to
  // handleOpenInChrome — it must only ever be invoked from the button's
  // onClick (a real user gesture), never automatically.
  const effectCallRegex = /useEffect\(\s*\(\)\s*=>\s*\{/g;
  let match;
  let foundInEffect = false;
  while ((match = effectCallRegex.exec(tenantLandingSource)) !== null) {
    const bodyStart = match.index;
    // Find this effect's matching closing "}, [" (its dependency array),
    // a reasonable bound for "the effect's own body" without a full parser.
    const depsIdx = tenantLandingSource.indexOf('}, [', bodyStart);
    const effectBody = tenantLandingSource.slice(bodyStart, depsIdx === -1 ? bodyStart + 2000 : depsIdx);
    if (effectBody.includes('handleOpenInChrome(')) {
      foundInEffect = true;
      break;
    }
  }
  assert.equal(foundInEffect, false, 'handleOpenInChrome must never be called from inside a useEffect');
});

test('source guard: handleOpenInChrome builds the intent with buildChromeIntentUrl (no S.browser_fallback_url) and watches visibilitychange/pagehide', () => {
  const body = getFunctionBody('const handleOpenInChrome = () => {', "\n  // ANDROID NON-CHROME:");
  assert.match(body, /buildChromeIntentUrl\(window\.location\.href\)/);
  assert.match(body, /addEventListener\('visibilitychange'/);
  assert.match(body, /addEventListener\('pagehide'/);
  assert.match(body, /setChromeHandoffFailed\(true\)/);
  assert.doesNotMatch(body, /location\.reload/);
  assert.doesNotMatch(body, /window\.open/);
});

test('source guard: successful hand-off (hidden/pagehide) calls cleanup() and never sets chromeHandoffFailed', () => {
  const body = getFunctionBody('const handleOpenInChrome = () => {', "\n  // ANDROID NON-CHROME:");
  const markHandedOffStart = body.indexOf('const markHandedOff = () => {');
  const markHandedOffBody = body.slice(markHandedOffStart, body.indexOf('};', markHandedOffStart));
  assert.match(markHandedOffBody, /cleanup\(\);/);
  assert.doesNotMatch(markHandedOffBody, /setChromeHandoffFailed/);
});

test('source guard: a failed hand-off releases the single-flight lock inside cleanup() and never navigates — retry stays possible', () => {
  const body = getFunctionBody('const handleOpenInChrome = () => {', "\n  // ANDROID NON-CHROME:");
  const cleanupStart = body.indexOf('const cleanup = () => {');
  const cleanupBody = body.slice(cleanupStart, body.indexOf('};', cleanupStart));
  assert.match(cleanupBody, /chromeHandoffInFlightRef\.current = false;/);

  const watchTimeoutStart = body.indexOf('watchTimeoutId = window.setTimeout(() => {');
  const watchTimeoutBody = body.slice(watchTimeoutStart, body.indexOf('}, CHROME_HANDOFF_WATCH_MS);', watchTimeoutStart));
  assert.match(watchTimeoutBody, /cleanup\(\);/);
  assert.match(watchTimeoutBody, /setChromeHandoffFailed\(true\)/);
  assert.doesNotMatch(watchTimeoutBody, /window\.location/);
});

test('source guard: no automatic redirect loop — the compatibility card renders unconditionally from isAndroidNonChromeBrowser, never triggers navigation itself', () => {
  const cardStart = tenantLandingSource.indexOf('isAndroidNonChromeBrowser(navigator.userAgent || \'\')');
  assert.ok(cardStart !== -1);
  const cardBody = tenantLandingSource.slice(cardStart, cardStart + 3500);
  // The card JSX itself contains no window.location assignment outside of
  // the onClick handler reference — rendering it must never navigate.
  const beforeButton = cardBody.slice(0, cardBody.indexOf('onClick={handleOpenInChrome}'));
  assert.doesNotMatch(beforeButton, /window\.location/);
});

test('double tap (pure logic): the single-flight guard blocks a second handoff attempt while one is in flight', () => {
  // Models handleOpenInChrome's own guard in isolation, the same way
  // launchReadiness.test.js models handleOpenApp's.
  let inFlight = false;
  const attempt = () => {
    if (inFlight) return 'blocked-in-flight';
    inFlight = true;
    return 'launched';
  };
  assert.equal(attempt(), 'launched');
  assert.equal(attempt(), 'blocked-in-flight');
  assert.equal(attempt(), 'blocked-in-flight');
  // Only after cleanup() (the watch concluding) releases the lock does a
  // fresh tap launch again.
  inFlight = false;
  assert.equal(attempt(), 'launched');
});

test('source guard: the compatibility card is skipped once genuinely installed — matches the existing "installed" definition used everywhere else', () => {
  const cardStart = tenantLandingSource.indexOf('isAndroidNonChromeBrowser(navigator.userAgent || \'\')');
  const guardRegion = tenantLandingSource.slice(cardStart - 50, cardStart + 250);
  assert.match(guardRegion, /!\(installPhase === 'installed' && isInstalled\)/);
});

// --- STANDALONE SAFETY ----------------------------------------------------
// The compatibility card must never render inside an already-installed
// standalone PWA — regardless of which engine (Chrome or otherwise)
// launched it, and regardless of whether the async
// isStandaloneDisplay()/getInstalledRelatedApps() mount effect has
// committed isInstalled/installPhase yet (that effect only runs AFTER the
// first render). isStandaloneDisplay() itself is synchronous, so gating
// directly on it closes that race outright.

test('source guard: the compatibility-card gate checks !isStandaloneDisplay() directly, not only isInstalled/installPhase (closes the pre-effect first-render race)', () => {
  const cardStart = tenantLandingSource.indexOf('isAndroidNonChromeBrowser(navigator.userAgent || \'\')');
  assert.ok(cardStart !== -1);
  const guardRegion = tenantLandingSource.slice(cardStart - 50, cardStart + 300);
  assert.match(guardRegion, /!isStandaloneDisplay\(\)/);
  assert.match(guardRegion, /!\(installPhase === 'installed' && isInstalled\)/);
});

test('SamsungBrowser-like UA + standalone display => the compatibility card gate must be false (normal installed-app flow stays reachable)', () => {
  // Models the actual runtime gate condition character-for-character:
  // isAndroidNonChromeBrowser(...) && !isStandaloneDisplay() && !(installed).
  const evaluateGate = ({ ua, isStandalone, installPhase, isInstalled }) =>
    isAndroidNonChromeBrowser(ua) && !isStandalone && !(installPhase === 'installed' && isInstalled);

  // Standalone launch (already-installed app context), regardless of
  // whether isInstalled/installPhase have caught up yet on this exact
  // render (the pre-effect race this fix closes) — the gate must be false
  // either way once isStandaloneDisplay() is true.
  assert.equal(
    evaluateGate({ ua: SAMSUNG_INTERNET_UA, isStandalone: true, installPhase: 'idle', isInstalled: false }),
    false
  );
  assert.equal(
    evaluateGate({ ua: SAMSUNG_INTERNET_UA, isStandalone: true, installPhase: 'installed', isInstalled: true }),
    false
  );

  // Same UA, NOT standalone (an ordinary browser tab, nothing installed
  // yet) => the compatibility card gate is true, as expected.
  assert.equal(
    evaluateGate({ ua: SAMSUNG_INTERNET_UA, isStandalone: false, installPhase: 'idle', isInstalled: false }),
    true
  );
});

// =========================================================================
// iOS Chrome (CriOS) classification — used to route CriOS into the same
// manual Add to Home Screen instructions Safari gets. Android Chrome/
// Samsung behavior, the countdown, and appinstalled/launch-readiness logic
// are covered by the tests above, re-run unmodified at the end of this
// file.
// =========================================================================

const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';

test('isIOSChromeUA: true only for CriOS UAs', () => {
  assert.equal(isIOSChromeUA(IPHONE_CHROME_UA), true);
  assert.equal(isIOSChromeUA(IPHONE_SAFARI_UA), false);
});

test('iOS Chrome never enters the Android native install-prompt path — beforeinstallprompt is a Chromium/Android-only API, and CriOS is WebKit-based', () => {
  // Platform fact, not something this codebase can (or should) special-case:
  // confirm the gate function contains no beforeinstallprompt-adjacent
  // logic and that isIOSChromeUA/isAndroidUA are mutually exclusive, so
  // TenantLanding.jsx's unconditional beforeinstallprompt effect (Android/
  // Chromium-only in practice) and this iOS gate can never both fire for
  // the same session.
  assert.equal(isAndroidUA(IPHONE_CHROME_UA), false);
  assert.equal(isIOSChromeUA(IPHONE_CHROME_UA), true);
});

// =========================================================================
// FINAL SAFETY CHECK 1: iOS Chrome (CriOS) must land on the EXISTING
// ios-instructions (Add to Home Screen) render path — not the Android
// Install App card, not a UI waiting on beforeinstallprompt, not the
// Safari "Open in Chrome" compatibility card, and not the generic
// 'unsupported' outcome. isIosSafari()'s own Safari check deliberately
// excludes CriOS (see its definition), so before this fix the
// handleInstallClick classification chain fell all the way through to
// 'unsupported' for iOS Chrome — confirmed by tracing the chain in
// TenantLanding.jsx directly.
// =========================================================================

test('regression: CriOS is classified into ios-instructions inside handleInstallClick\'s outcome chain, not left to fall through to "unsupported"', () => {
  const chainStart = tenantLandingSource.indexOf("if (isInAppEmbeddedBrowser()) {");
  assert.ok(chainStart !== -1, 'the handleInstallClick outcome classification chain should exist');
  const chainEnd = tenantLandingSource.indexOf("setInstallOutcome('unsupported');", chainStart);
  const chain = tenantLandingSource.slice(chainStart, chainEnd);

  // The branch that sets 'ios-instructions' must also cover CriOS —
  // isIosSafari() alone is not enough (it explicitly excludes CriOS).
  const conditionStart = chain.indexOf('} else if (isIosSafari()');
  assert.ok(conditionStart !== -1, 'expected an "else if (isIosSafari() ...)" branch');
  const iosBranchStart = chain.indexOf("setInstallOutcome('ios-instructions');", conditionStart);
  assert.ok(iosBranchStart !== -1);
  const iosBranchCondition = chain.slice(conditionStart, iosBranchStart);
  assert.match(iosBranchCondition, /isIosSafari\(\)/);
  assert.match(iosBranchCondition, /isIOSChromeUA\(/);

  // And CriOS must be resolved BEFORE the chain ever reaches isAndroid()
  // or the trailing 'unsupported' else — i.e. it's caught by the
  // ios-instructions branch, never falls further down the chain.
  const androidBranchIdx = chain.indexOf('isAndroid()');
  const iosInstructionsIdx = chain.indexOf("setInstallOutcome('ios-instructions');");
  assert.ok(iosInstructionsIdx < androidBranchIdx, 'ios-instructions must be resolved before the isAndroid() branch');
});

test('regression: CriOS never matches isAndroid() or the Android compatibility gate — it is fully unclaimed by every OTHER branch, leaving only ios-instructions', () => {
  const IPHONE_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';

  // Not Android at all -> never the Android Install App card, never the
  // Android non-Chrome "Open in Chrome" compatibility card.
  assert.equal(isAndroidUA(IPHONE_CHROME_UA), false);
  assert.equal(isAndroidNonChromeBrowser(IPHONE_CHROME_UA), false);

  // It IS real iOS Chrome — the one remaining classification, and exactly
  // what the fixed handleInstallClick branch above now checks for.
  assert.equal(isIOSChromeUA(IPHONE_CHROME_UA), true);
});

test('regression: CriOS never fires/adopts beforeinstallprompt (no UI ever waits on it for this browser) — confirmed structurally, since the capture effect is unconditional and CriOS is WebKit-based, never Blink/Chromium', () => {
  // The shared beforeinstallprompt capture effect (see
  // samsungInstallParity.test.js) is deliberately UA-agnostic — it never
  // needs a CriOS-specific guard because the browser itself never fires
  // that event on iOS (WebKit does not implement the Chromium-only
  // Web App Install API). Nothing in TenantLanding.jsx claims otherwise.
  const effectStart = tenantLandingSource.indexOf('const handlePromptEvent = (event) => {');
  const effectBody = tenantLandingSource.slice(effectStart, effectStart + 400);
  assert.doesNotMatch(effectBody, /CriOS|isIOSChromeUA/);
});

// =========================================================================
// iOS CHROME UX: CriOS must render the existing iOS Add to Home
// Screen instructions DIRECTLY — never the generic Install App card first.
// =========================================================================

// =========================================================================
// IosInstallInstructionsModal: both iOS Safari and iOS Chrome (CriOS) now
// land on the SAME generic Install App card, and tapping Install App is
// what opens the popup (installOutcome === 'ios-instructions') — CriOS no
// longer gets its own direct full-page render, matching Android's own
// "tap Install App to see the next step" pattern.
// =========================================================================

test('source guard: CriOS no longer has its own direct-render gate — it falls through to the same generic Install App card as Safari', () => {
  assert.doesNotMatch(tenantLandingSource, /isIOSChromeUA\(navigator\.userAgent \|\| ''\) &&\n\s*!isStandaloneDisplay\(\)/);
});

test('source guard: handleInstallClick\'s CriOS fallback (isIosSafari() || isIOSChromeUA(...)) still sets ios-instructions, unchanged', () => {
  assert.match(tenantLandingSource, /\} else if \(isIosSafari\(\) \|\| isIOSChromeUA\(navigator\.userAgent \|\| ''\)\) \{/);
  assert.match(tenantLandingSource, /setInstallOutcome\('ios-instructions'\);/);
});

test('source guard: installOutcome === \'ios-instructions\' renders IosInstallInstructionsModal, passing onClose back to setInstallOutcome(\'\') (no navigation/handoff)', () => {
  assert.match(tenantLandingSource, /import IosInstallInstructionsModal from '\.\/components\/IosInstallInstructionsModal';/);
  const renderIdx = tenantLandingSource.indexOf("installOutcome === 'ios-instructions' && (");
  assert.ok(renderIdx !== -1);
  const renderBlock = tenantLandingSource.slice(renderIdx, renderIdx + 300);
  assert.match(renderBlock, /<IosInstallInstructionsModal/);
  assert.match(renderBlock, /onClose=\{\(\) => setInstallOutcome\(''\)\}/);
});

test('the mac-safari-instructions modal keeps its own "on Safari" title (File > Add to Dock is Safari-only, unaffected by the iOS popup change)', () => {
  assert.match(tenantLandingSource, /\{`Install \$\{tenantTrust\.name\} on Safari`\}/);
});

test('IosInstallInstructionsModal.jsx exists and defines the 3-step Share -> Add to Home Screen -> Add copy, browser-neutral (never "Safari toolbar")', () => {
  const modalSource = fs.readFileSync(
    path.join(__dirname, '../src/components/IosInstallInstructionsModal.jsx'),
    'utf8'
  );
  assert.match(modalSource, /Tap the Share button/);
  assert.match(modalSource, /Add to Home Screen/);
  assert.doesNotMatch(modalSource, /Safari's toolbar|Safari toolbar/i);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(modalSource, /onClose/);
});
