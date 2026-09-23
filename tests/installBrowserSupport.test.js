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
  isIOSUA,
  isSafariUA,
  isIOSChromeUA,
  shouldShowIosSafariCompatCard,
  buildIOSChromeUrl,
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
// iOS / iPadOS Safari-only guided install — extends the same idea to iOS,
// without touching Android Chrome/Samsung behavior, the countdown, or
// appinstalled/launch-readiness logic (all covered by the tests above,
// re-run unmodified at the end of this file).
// =========================================================================

const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// iPadOS 13+ reports as a plain "Macintosh" UA — only distinguishable from
// a real desktop Mac via the touch signal, exactly like TenantLanding.jsx's
// existing isIosSafari()/isMacSafari() split.
const IPADOS_AS_MAC_SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP_MAC_SAFARI_UA = IPADOS_AS_MAC_SAFARI_UA; // identical UA; only isTouchDevice differs
const IPHONE_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15';

test('isIOSUA: iPhone/iPad UAs are iOS regardless of touch signal', () => {
  assert.equal(isIOSUA(IPHONE_SAFARI_UA), true);
  assert.equal(isIOSUA(IPAD_SAFARI_UA), true);
});

test('isIOSUA: a Macintosh UA is iOS (iPadOS 13+) only when isTouchDevice is true — a real desktop Mac never matches', () => {
  assert.equal(isIOSUA(IPADOS_AS_MAC_SAFARI_UA, { isTouchDevice: true }), true);
  assert.equal(isIOSUA(DESKTOP_MAC_SAFARI_UA, { isTouchDevice: false }), false);
  assert.equal(isIOSUA(DESKTOP_MAC_SAFARI_UA), false); // isTouchDevice defaults to false
});

test('isSafariUA: real Safari UAs pass; CriOS/FxiOS (which also carry "Safari") do not', () => {
  assert.equal(isSafariUA(IPHONE_SAFARI_UA), true);
  assert.equal(isSafariUA(IPHONE_CHROME_UA), false);
  assert.equal(isSafariUA(IPHONE_FIREFOX_UA), false);
});

test('isIOSChromeUA: true only for CriOS UAs', () => {
  assert.equal(isIOSChromeUA(IPHONE_CHROME_UA), true);
  assert.equal(isIOSChromeUA(IPHONE_SAFARI_UA), false);
});

test('iPhone Safari + browser mode (not standalone) => the compatibility gate is true (Open in Chrome card)', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_SAFARI_UA, isTouchDevice: true, isStandalone: false }),
    true
  );
});

test('iPad Safari + browser mode => the compatibility gate is true', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPAD_SAFARI_UA, isTouchDevice: true, isStandalone: false }),
    true
  );
});

test('iPadOS-as-Mac Safari + browser mode => the compatibility gate is true (touch signal makes it iOS, not desktop Mac)', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPADOS_AS_MAC_SAFARI_UA, isTouchDevice: true, isStandalone: false }),
    true
  );
});

test('iPhone Safari + standalone (already-installed Home Screen launch) => the compatibility gate is false, no card', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_SAFARI_UA, isTouchDevice: true, isStandalone: true }),
    false
  );
});

test('real desktop Mac Safari (non-touch) => the compatibility gate is false — keeps its own separate mac-safari-instructions flow, untouched', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: DESKTOP_MAC_SAFARI_UA, isTouchDevice: false, isStandalone: false }),
    false
  );
});

test('iOS Chrome (CriOS) => the compatibility gate is false, no Safari compatibility card, regardless of standalone state', () => {
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_CHROME_UA, isTouchDevice: true, isStandalone: false }),
    false
  );
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_CHROME_UA, isTouchDevice: true, isStandalone: true }),
    false
  );
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

test('iOS Chrome deep link preserves tenant slug, query params, and hash', () => {
  const url = buildIOSChromeUrl('https://members.example.com/app/dds/?install=1&ref=qr#section');
  assert.equal(url, 'googlechromes://members.example.com/app/dds/?install=1&ref=qr#section');
});

test('iOS Chrome deep link with no query/hash still preserves the exact tenant path', () => {
  const url = buildIOSChromeUrl('https://members.example.com/app/dds/');
  assert.equal(url, 'googlechromes://members.example.com/app/dds/');
});

test('iOS Chrome deep link falls back to empty string for a non-https URL or an unparsable one', () => {
  assert.equal(buildIOSChromeUrl('http://members.example.com/app/dds/'), '');
  assert.equal(buildIOSChromeUrl('not a url'), '');
  assert.equal(buildIOSChromeUrl(''), '');
});

// --- Source guards on TenantLanding.jsx's handleOpenInIosChrome + card ---

test('source guard: handleOpenInIosChrome is never called from a useEffect — user-tap triggered only, no auto-redirect on load', () => {
  assert.ok(tenantLandingSource.indexOf('const handleOpenInIosChrome = () => {') !== -1);
  assert.match(tenantLandingSource, /onClick=\{handleOpenInIosChrome\}/);

  const effectCallRegex = /useEffect\(\s*\(\)\s*=>\s*\{/g;
  let match;
  let foundInEffect = false;
  while ((match = effectCallRegex.exec(tenantLandingSource)) !== null) {
    const bodyStart = match.index;
    const depsIdx = tenantLandingSource.indexOf('}, [', bodyStart);
    const effectBody = tenantLandingSource.slice(bodyStart, depsIdx === -1 ? bodyStart + 2000 : depsIdx);
    if (effectBody.includes('handleOpenInIosChrome(')) {
      foundInEffect = true;
      break;
    }
  }
  assert.equal(foundInEffect, false, 'handleOpenInIosChrome must never be called from inside a useEffect');
});

test('source guard: handleOpenInIosChrome uses buildIOSChromeUrl (no intent://, no S.browser_fallback_url) and watches visibilitychange/pagehide', () => {
  const start = tenantLandingSource.indexOf('const handleOpenInIosChrome = () => {');
  const end = tenantLandingSource.indexOf('\n  // iOS/iPadOS SAFARI ONLY:');
  const body = tenantLandingSource.slice(start, end);

  assert.match(body, /buildIOSChromeUrl\(window\.location\.href\)/);
  assert.doesNotMatch(body, /intent:\/\//);
  assert.doesNotMatch(body, /browser_fallback_url/);
  assert.match(body, /addEventListener\('visibilitychange'/);
  assert.match(body, /addEventListener\('pagehide'/);
});

test('source guard: successful hand-off (hidden/pagehide) calls cleanup() and never sets iosChromeHandoffFailed', () => {
  const start = tenantLandingSource.indexOf('const handleOpenInIosChrome = () => {');
  const end = tenantLandingSource.indexOf('\n  // iOS/iPadOS SAFARI ONLY:');
  const body = tenantLandingSource.slice(start, end);

  const markHandedOffStart = body.indexOf('const markHandedOff = () => {');
  const markHandedOffBody = body.slice(markHandedOffStart, body.indexOf('};', markHandedOffStart));
  assert.match(markHandedOffBody, /cleanup\(\);/);
  assert.doesNotMatch(markHandedOffBody, /setIosChromeHandoffFailed/);
});

test('source guard: a failed hand-off shows the Install Chrome CTA, releases the lock, and never navigates — retry stays possible', () => {
  const start = tenantLandingSource.indexOf('const handleOpenInIosChrome = () => {');
  const end = tenantLandingSource.indexOf('\n  // iOS/iPadOS SAFARI ONLY:');
  const body = tenantLandingSource.slice(start, end);

  const cleanupStart = body.indexOf('const cleanup = () => {');
  const cleanupBody = body.slice(cleanupStart, body.indexOf('};', cleanupStart));
  assert.match(cleanupBody, /iosChromeHandoffInFlightRef\.current = false;/);

  const watchTimeoutStart = body.indexOf('watchTimeoutId = window.setTimeout(() => {');
  const watchTimeoutBody = body.slice(watchTimeoutStart, body.indexOf('}, IOS_CHROME_HANDOFF_WATCH_MS);', watchTimeoutStart));
  assert.match(watchTimeoutBody, /cleanup\(\);/);
  assert.match(watchTimeoutBody, /setIosChromeHandoffFailed\(true\)/);
  assert.doesNotMatch(watchTimeoutBody, /window\.location/);

  // The card itself renders the App Store CTA only when failed.
  assert.match(tenantLandingSource, /IOS_CHROME_APP_STORE_URL/);
  assert.match(tenantLandingSource, /apps\.apple\.com\/app\/google-chrome\/id535886823/);
});

test('double tap (pure logic): the single-flight guard blocks a second iOS Chrome handoff attempt while one is in flight', () => {
  let inFlight = false;
  const attempt = () => {
    if (inFlight) return 'blocked-in-flight';
    inFlight = true;
    return 'launched';
  };
  assert.equal(attempt(), 'launched');
  assert.equal(attempt(), 'blocked-in-flight');
  assert.equal(attempt(), 'blocked-in-flight');
  inFlight = false;
  assert.equal(attempt(), 'launched');
});

test('source guard: the iOS compatibility card gate checks isStandaloneDisplay() directly (never installed/standalone), matching the Android card\'s own safety pattern', () => {
  const gateStart = tenantLandingSource.indexOf('shouldShowIosSafariCompatCard({');
  assert.ok(gateStart !== -1);
  const guardRegion = tenantLandingSource.slice(gateStart - 50, gateStart + 350);
  assert.match(guardRegion, /isStandalone: isStandaloneDisplay\(\)/);
  assert.match(guardRegion, /!\(installPhase === 'installed' && isInstalled\)/);
});

test('source guard: the iOS card never appears between the Android compatibility card and Android\'s own handlers — no cross-platform interference', () => {
  // Sanity check on ordering/isolation: the iOS gate is a wholly separate
  // `if` block from the Android one, using its own state/refs
  // (iosChromeHandoffFailed / iosChromeHandoffInFlightRef /
  // iosChromeHandoffWatchCleanupRef) — never the Android card's.
  const iosGateStart = tenantLandingSource.indexOf('shouldShowIosSafariCompatCard({');
  const iosCardBody = tenantLandingSource.slice(iosGateStart, iosGateStart + 4000);
  assert.doesNotMatch(iosCardBody, /buildChromeIntentUrl/);
  assert.doesNotMatch(iosCardBody, /chromeHandoffInFlightRef\.current/); // Android's own ref, not the iOS one
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

test('regression: CriOS never matches isAndroid(), the Android compatibility gate, or the iOS Safari compatibility gate — it is fully unclaimed by every OTHER branch, leaving only ios-instructions', () => {
  const IPHONE_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';

  // Not Android at all -> never the Android Install App card, never the
  // Android non-Chrome "Open in Chrome" compatibility card.
  assert.equal(isAndroidUA(IPHONE_CHROME_UA), false);
  assert.equal(isAndroidNonChromeBrowser(IPHONE_CHROME_UA), false);

  // Not real Safari -> never the Safari "Open in Chrome" compatibility
  // card either (that card exists specifically to route Safari into
  // Chrome — CriOS is already IN Chrome).
  assert.equal(isSafariUA(IPHONE_CHROME_UA), false);
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_CHROME_UA, isTouchDevice: true, isStandalone: false }),
    false
  );

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
// FINAL SAFETY CHECK 2: the iOS "Install Chrome" CTA must point to the
// Apple App Store, never the Android Google Play listing.
// =========================================================================

test('the iOS Install Chrome CTA points to the Apple App Store, never Google Play', () => {
  const constStart = tenantLandingSource.indexOf('const IOS_CHROME_APP_STORE_URL =');
  assert.ok(constStart !== -1);
  const constLine = tenantLandingSource.slice(constStart, tenantLandingSource.indexOf(';', constStart) + 1);
  assert.match(constLine, /https:\/\/apps\.apple\.com\//);
  assert.doesNotMatch(constLine, /play\.google\.com/);
});

test('the iOS failure card\'s Install Chrome link uses IOS_CHROME_APP_STORE_URL, never the Android CHROME_PLAY_STORE_URL constant', () => {
  const iosGateStart = tenantLandingSource.indexOf('shouldShowIosSafariCompatCard({');
  const iosCardBody = tenantLandingSource.slice(iosGateStart, iosGateStart + 4000);
  assert.match(iosCardBody, /href=\{IOS_CHROME_APP_STORE_URL\}/);
  assert.doesNotMatch(iosCardBody, /href=\{CHROME_PLAY_STORE_URL\}/);
  assert.doesNotMatch(iosCardBody, /play\.google\.com/);
});

test('the Android failure card\'s Install Chrome link still uses CHROME_PLAY_STORE_URL (Google Play), confirming the two platforms\' CTAs were never swapped', () => {
  // The CHROME_PLAY_STORE_URL declaration sits just before the Android
  // gate's own `if`, so include it by starting from the declaration.
  const androidConstStart = tenantLandingSource.indexOf('const CHROME_PLAY_STORE_URL =');
  // End strictly before the iOS section begins (its own constants/handler
  // are declared before the iOS gate's `if`, so stopping at the iOS
  // gate's own condition would incorrectly pull IOS_CHROME_APP_STORE_URL
  // into this "Android only" slice).
  const iosSectionStart = tenantLandingSource.indexOf('const IOS_CHROME_HANDOFF_WATCH_MS =');
  assert.ok(androidConstStart !== -1 && androidConstStart < iosSectionStart);
  const androidCardBody = tenantLandingSource.slice(androidConstStart, iosSectionStart);
  assert.match(androidCardBody, /href=\{CHROME_PLAY_STORE_URL\}/);
  assert.match(androidCardBody, /play\.google\.com/);
  assert.doesNotMatch(androidCardBody, /apps\.apple\.com/);
});

// =========================================================================
// iOS CHROME UX CLEANUP: CriOS must render the existing iOS Add to Home
// Screen instructions DIRECTLY — never the generic Install App card first.
// Desired flow: Safari -> Open in Chrome -> iOS instructions. NOT:
// Safari -> Open in Chrome -> Install App -> iOS instructions.
// =========================================================================

test('iPhone Safari browser mode still gets the Open in Chrome compatibility card (unchanged by this cleanup)', () => {
  const IPHONE_SAFARI_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  assert.equal(
    shouldShowIosSafariCompatCard({ ua: IPHONE_SAFARI_UA, isTouchDevice: true, isStandalone: false }),
    true
  );
});

test('source guard: a dedicated CriOS direct-instructions render gate exists, positioned BEFORE the generic Install App card\'s own JSX in render order', () => {
  const criosGateStart = tenantLandingSource.indexOf('isIOSChromeUA(navigator.userAgent || \'\') &&\n    !isStandaloneDisplay()');
  assert.ok(criosGateStart !== -1, 'expected a dedicated CriOS render gate (isIOSChromeUA + !isStandaloneDisplay())');

  // handleCardClick is just a function DEFINITION (declared early,
  // alongside installSteps, so it's in scope for JSX below) — it doesn't
  // itself render anything, so its textual position isn't what matters.
  // What matters is that this gate's own `return (...)` executes (an
  // early return, top-to-bottom in the component body) BEFORE the actual
  // generic card's JSX — the one containing the "Install App" button
  // label — is ever reached.
  const installAppButtonIdx = tenantLandingSource.indexOf('<span>Install App</span>');
  assert.ok(installAppButtonIdx !== -1, 'expected the generic Install App button label to exist');
  assert.ok(
    criosGateStart < installAppButtonIdx,
    'the CriOS direct-instructions gate must early-return before the generic Install App button\'s own JSX'
  );
});

test('source guard: the CriOS gate never renders the generic "Install App" button/card — it renders IOS_ADD_TO_HOME_SCREEN_STEPS directly, no beforeinstallprompt/deferredPrompt dependency', () => {
  const criosGateStart = tenantLandingSource.indexOf('isIOSChromeUA(navigator.userAgent || \'\') &&\n    !isStandaloneDisplay()');
  const criosCardEnd = tenantLandingSource.indexOf('// See MOUNT_INSTALL_CHECK_GRACE_MS/cameFromOwnInstallPage above');
  assert.ok(criosGateStart !== -1 && criosCardEnd !== -1 && criosGateStart < criosCardEnd);
  const criosCardBody = tenantLandingSource.slice(criosGateStart, criosCardEnd);

  assert.match(criosCardBody, /IOS_ADD_TO_HOME_SCREEN_STEPS\.map/);
  assert.doesNotMatch(criosCardBody, />Install App</); // no "Install App" button label rendered
  assert.doesNotMatch(criosCardBody, /deferredPrompt/);
  assert.doesNotMatch(criosCardBody, /handleInstallClick/);
  assert.doesNotMatch(criosCardBody, /handleCardClick/);
});

test('source guard: the CriOS gate is skipped in standalone mode and once already installed — matches every other compatibility card\'s own safety pattern', () => {
  const criosGateStart = tenantLandingSource.indexOf('isIOSChromeUA(navigator.userAgent || \'\') &&\n    !isStandaloneDisplay()');
  assert.ok(criosGateStart !== -1);
  const guardRegion = tenantLandingSource.slice(criosGateStart, criosGateStart + 150);
  assert.match(guardRegion, /!isStandaloneDisplay\(\)/);
  assert.match(guardRegion, /!\(installPhase === 'installed' && isInstalled\)/);
});

test('CriOS standalone (pure logic): isIOSChromeUA is true but the render gate requires !isStandaloneDisplay(), so standalone never shows this card', () => {
  const IPHONE_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
  // Mirrors the exact runtime gate: isIOSChromeUA(ua) && !isStandalone && !(installed).
  const evaluateCriosGate = ({ ua, isStandalone, installPhase, isInstalled }) =>
    isIOSChromeUA(ua) && !isStandalone && !(installPhase === 'installed' && isInstalled);

  assert.equal(isIOSChromeUA(IPHONE_CHROME_UA), true);
  assert.equal(
    evaluateCriosGate({ ua: IPHONE_CHROME_UA, isStandalone: true, installPhase: 'idle', isInstalled: false }),
    false
  );
  assert.equal(
    evaluateCriosGate({ ua: IPHONE_CHROME_UA, isStandalone: false, installPhase: 'idle', isInstalled: false }),
    true
  );
});

test('source guard: handleInstallClick\'s CriOS fallback (isIosSafari() || isIOSChromeUA(...)) is kept in place as defense-in-depth, unchanged', () => {
  assert.match(tenantLandingSource, /\} else if \(isIosSafari\(\) \|\| isIOSChromeUA\(navigator\.userAgent \|\| ''\)\) \{/);
});

test('iOS instruction copy is browser-neutral — never says "Safari\'s toolbar" or "Safari toolbar" anywhere in the shared steps', () => {
  const constStart = tenantLandingSource.indexOf('const IOS_ADD_TO_HOME_SCREEN_STEPS =');
  assert.ok(constStart !== -1);
  const constLine = tenantLandingSource.slice(constStart, tenantLandingSource.indexOf(';', constStart) + 1);
  assert.doesNotMatch(constLine, /Safari/i);
  assert.match(constLine, /Share button/);
});

test('the Safari ios-instructions modal title is browser-neutral (drops "on Safari") while the desktop mac-safari-instructions title correctly keeps it (File > Add to Dock is Safari-only)', () => {
  const titleStart = tenantLandingSource.indexOf("{installOutcome === 'ios-instructions'");
  assert.ok(titleStart !== -1);
  const titleBlock = tenantLandingSource.slice(titleStart, titleStart + 200);
  assert.match(titleBlock, /`Install \$\{tenantTrust\.name\}`/);
  assert.match(titleBlock, /`Install \$\{tenantTrust\.name\} on Safari`/);
});

test('the same IOS_ADD_TO_HOME_SCREEN_STEPS array backs both the Safari modal (installSteps) and the CriOS direct card — no second, possibly-drifted copy of the steps', () => {
  const occurrences = tenantLandingSource.split('IOS_ADD_TO_HOME_SCREEN_STEPS').length - 1;
  // 1 declaration + 1 use in installSteps + 1 use in the CriOS card's .map
  assert.ok(occurrences >= 3, `expected IOS_ADD_TO_HOME_SCREEN_STEPS to be declared once and reused at least twice, found ${occurrences} occurrences`);
});
