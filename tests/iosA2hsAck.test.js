import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// iOS-only "user says they completed Add to Home Screen" acknowledgement —
// see utils/iosA2hsAck.js's own comment for why this is deliberately
// separate from installPendingState.js's Android verified/pending records.
// Same localStorage-stub approach as tests/installPendingState.test.js,
// since this module is also pure (no React/DOM beyond localStorage).
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
  readIosA2hsAck,
  hasIosA2hsAck,
  writeIosA2hsAck,
  clearIosA2hsAck,
} = await import('../src/utils/iosA2hsAck.js');

// --- Pure record behavior -------------------------------------------------

test('no ack written => readIosA2hsAck/hasIosA2hsAck report nothing', () => {
  installLocalStorageStub();
  assert.equal(readIosA2hsAck('dds'), null);
  assert.equal(hasIosA2hsAck('dds'), false);
});

test('writeIosA2hsAck persists {slug, acknowledgedAt} and hasIosA2hsAck reports true after', () => {
  installLocalStorageStub();
  const written = writeIosA2hsAck('dds');
  assert.equal(written.slug, 'dds');
  assert.equal(typeof written.acknowledgedAt, 'number');

  const read = readIosA2hsAck('dds');
  assert.deepEqual(read, written);
  assert.equal(hasIosA2hsAck('dds'), true);
});

test('clearIosA2hsAck removes the record — hasIosA2hsAck reports false again', () => {
  installLocalStorageStub();
  writeIosA2hsAck('dds');
  assert.equal(hasIosA2hsAck('dds'), true);

  clearIosA2hsAck('dds');
  assert.equal(hasIosA2hsAck('dds'), false);
  assert.equal(readIosA2hsAck('dds'), null);
});

test('acknowledgement is tenant-specific: writing it for one slug never marks a different slug acknowledged', () => {
  installLocalStorageStub();
  writeIosA2hsAck('dds');

  assert.equal(hasIosA2hsAck('dds'), true);
  assert.equal(hasIosA2hsAck('backup-trust'), false);

  // Clearing one tenant's ack must never touch another tenant's.
  writeIosA2hsAck('backup-trust');
  clearIosA2hsAck('dds');
  assert.equal(hasIosA2hsAck('dds'), false);
  assert.equal(hasIosA2hsAck('backup-trust'), true);
});

test('slug identity is normalized the same way as installPendingState.js (trailing slash / case)', () => {
  installLocalStorageStub();
  writeIosA2hsAck('DDS/');
  assert.equal(hasIosA2hsAck('dds'), true);
  assert.equal(hasIosA2hsAck('dds/'), true);
});

test('a malformed/foreign record is ignored rather than throwing', () => {
  const localStorage = installLocalStorageStub();
  localStorage.setItem('tenant_ios_a2hs_ack_v1:dds', 'not json');
  assert.equal(readIosA2hsAck('dds'), null);

  localStorage.setItem('tenant_ios_a2hs_ack_v1:dds', JSON.stringify({ slug: 'someone-else', acknowledgedAt: Date.now() }));
  assert.equal(readIosA2hsAck('dds'), null);
});

// =========================================================================
// Source guards on TenantLanding.jsx — no jsdom/RTL harness in this repo,
// so the render-gate wiring is proven structurally here, the same way
// tests/installBrowserSupport.test.js does for the neighboring compat
// cards.
// =========================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantLandingSource = fs.readFileSync(
  path.join(__dirname, '../src/TenantLanding.jsx'),
  'utf8'
);

test('source guard: iosA2hsAcknowledged is seeded from readIosA2hsAck(normalizedAppSlug), never from installUiSeed/isInstalled', () => {
  assert.match(tenantLandingSource, /useState\(\(\) => Boolean\(readIosA2hsAck\(normalizedAppSlug\)\)\)/);
});

test('source guard: acknowledgeIosA2hs (the modal\'s "I\'ve Added It" handler) calls writeIosA2hsAck, never writeInstallVerified/setIsInstalled/setInstallPhase', () => {
  const start = tenantLandingSource.indexOf('const acknowledgeIosA2hs = () => {');
  assert.ok(start !== -1);
  const end = tenantLandingSource.indexOf('};', start);
  const body = tenantLandingSource.slice(start, end);

  assert.match(body, /writeIosA2hsAck\(normalizedAppSlug\)/);
  assert.match(body, /setIosA2hsAcknowledged\(true\)/);
  assert.doesNotMatch(body, /writeInstallVerified/);
  assert.doesNotMatch(body, /setIsInstalled/);
  assert.doesNotMatch(body, /setInstallPhase/);
});

test('source guard: resetIosA2hsAck ("Show install steps again") calls clearIosA2hsAck and nothing Android-related', () => {
  const start = tenantLandingSource.indexOf('const resetIosA2hsAck = () => {');
  assert.ok(start !== -1);
  const end = tenantLandingSource.indexOf('};', start);
  const body = tenantLandingSource.slice(start, end);

  assert.match(body, /clearIosA2hsAck\(normalizedAppSlug\)/);
  assert.match(body, /setIosA2hsAcknowledged\(false\)/);
  assert.doesNotMatch(body, /clearInstallVerified|writeInstallVerified|setIsInstalled|setInstallPhase/);
});

test('source guard: the iOS post-A2HS render gate checks isIOSDeviceUA + !isStandaloneDisplay + iosA2hsAcknowledged — never Android UA helpers', () => {
  const gateStart = tenantLandingSource.indexOf('isIOSDeviceUA(navigator.userAgent || \'\') &&\n    !isStandaloneDisplay() &&\n    iosA2hsAcknowledged');
  assert.ok(gateStart !== -1, 'expected the iOS post-A2HS render gate');
  const guardRegion = tenantLandingSource.slice(gateStart - 60, gateStart + 400);
  assert.doesNotMatch(guardRegion, /isAndroidNonChromeBrowser|isRealAndroidChrome/);
});

test('source guard: the iOS post-A2HS card renders "App Added" copy and never mutates isInstalled/installPhase inside its own JSX', () => {
  const gateStart = tenantLandingSource.indexOf('isIOSDeviceUA(navigator.userAgent || \'\') &&\n    !isStandaloneDisplay() &&\n    iosA2hsAcknowledged');
  const cardEnd = tenantLandingSource.indexOf('// See MOUNT_INSTALL_CHECK_GRACE_MS/cameFromOwnInstallPage above', gateStart);
  assert.ok(gateStart !== -1 && cardEnd !== -1 && gateStart < cardEnd);
  const cardBody = tenantLandingSource.slice(gateStart, cardEnd);

  assert.match(cardBody, /App Added/);
  assert.match(cardBody, /has been added to your Home Screen/);
  assert.match(cardBody, /Open it from your Home Screen for the full app experience/);
  assert.match(cardBody, /Show install steps again/);
  assert.match(cardBody, /onClick=\{resetIosA2hsAck\}/);
  assert.doesNotMatch(cardBody, /setIsInstalled\(|setInstallPhase\(/);
});

test('source guard: handleOpenIosHomeScreenApp is best-effort only — a plain navigation, paired with a "tap the Home Screen icon" fallback in the card copy, never claimed as guaranteed', () => {
  const start = tenantLandingSource.indexOf('const handleOpenIosHomeScreenApp = () => {');
  assert.ok(start !== -1);
  const end = tenantLandingSource.indexOf('};', start);
  const body = tenantLandingSource.slice(start, end);
  assert.match(body, /buildTenantUrl\(normalizedAppSlug\)/);
  assert.match(body, /window\.location\.href = tenantUrl/);

  assert.match(tenantLandingSource, /If it does not open automatically, tap the app icon on your Home Screen\./);
});

test('source guard: the standalone "already installed" effect optionally backfills the iOS ack too, gated on isIOSDeviceUA, without altering its own Android writeInstallVerified/setIsInstalled/setInstallPhase calls', () => {
  const standaloneStart = tenantLandingSource.indexOf('if (isStandaloneDisplay()) {');
  assert.ok(standaloneStart !== -1);
  const standaloneEnd = tenantLandingSource.indexOf('\n    }\n\n    // Still in a normal browser tab', standaloneStart);
  assert.ok(standaloneEnd !== -1);
  const body = tenantLandingSource.slice(standaloneStart, standaloneEnd);

  assert.match(body, /writeInstallVerified\(normalizedAppSlug\);/);
  assert.match(body, /setIsInstalled\(true\);/);
  assert.match(body, /setInstallPhase\('installed'\);/);
  assert.match(body, /isIOSDeviceUA\(navigator\.userAgent \|\| ''\)/);
  assert.match(body, /writeIosA2hsAck\(normalizedAppSlug\);/);
});

test('source guard: IosInstallInstructionsModal receives onAcknowledge={acknowledgeIosA2hs} alongside onClose', () => {
  const renderIdx = tenantLandingSource.indexOf("installOutcome === 'ios-instructions' && (");
  assert.ok(renderIdx !== -1);
  const renderBlock = tenantLandingSource.slice(renderIdx, renderIdx + 350);
  assert.match(renderBlock, /onClose=\{\(\) => setInstallOutcome\(''\)\}/);
  assert.match(renderBlock, /onAcknowledge=\{acknowledgeIosA2hs\}/);
});

test('source guard: isIOSDeviceUA is browser-neutral (no Safari/CriOS exclusion), matching both iOS Safari and iOS Chrome UAs', () => {
  const start = tenantLandingSource.indexOf('const isIOSDeviceUA = (ua) => {');
  assert.ok(start !== -1);
  const end = tenantLandingSource.indexOf('};', start);
  const body = tenantLandingSource.slice(start, end);
  assert.match(body, /iPad\|iPhone\|iPod/);
  assert.doesNotMatch(body, /CriOS|Safari/);
});

// --- Pure logic mirrors of the runtime gates, exercised directly ---------

const isIOSDeviceUA = (ua) => {
  const value = String(ua || '');
  if (/iPad|iPhone|iPod/.test(value)) return true;
  return value.includes('Macintosh');
};

const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36';
const SAMSUNG_INTERNET_UA =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.6261.119 Mobile Safari/537.36';

const evaluatePostA2hsGate = ({ ua, isStandalone, acknowledged }) =>
  isIOSDeviceUA(ua) && !isStandalone && acknowledged;

test('iOS Safari, no acknowledgement => post-A2HS gate is false (Install App card stays reachable)', () => {
  installLocalStorageStub();
  const slug = 'dds';
  assert.equal(hasIosA2hsAck(slug), false);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_SAFARI_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    false
  );
});

test('iOS Safari, after "I\'ve Added It" => post-A2HS gate is true (App Added / Open from Home Screen state)', () => {
  installLocalStorageStub();
  const slug = 'dds';
  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_SAFARI_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    true
  );
});

test('iOS Chrome behaves identically to iOS Safari — same ack record, same gate result', () => {
  installLocalStorageStub();
  const slug = 'dds';

  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_CHROME_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    false
  );

  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_CHROME_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    true
  );
});

test('clearing the acknowledgement ("Show install steps again") restores the Install App gate', () => {
  installLocalStorageStub();
  const slug = 'dds';
  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_SAFARI_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    true
  );

  clearIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_SAFARI_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    false
  );
});

test('Android Chrome never matches the iOS post-A2HS gate, even with an (impossible in practice) ack record present', () => {
  installLocalStorageStub();
  const slug = 'dds';
  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: ANDROID_CHROME_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    false
  );
});

test('Samsung Internet / non-Chrome Android never matches the iOS post-A2HS gate either — its own "Open in Chrome" card is unaffected', () => {
  installLocalStorageStub();
  const slug = 'dds';
  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: SAMSUNG_INTERNET_UA, isStandalone: false, acknowledged: hasIosA2hsAck(slug) }),
    false
  );
});

test('standalone (already launched from Home Screen) never shows the post-A2HS card, regardless of the ack record — the existing standalone tenant/login flow owns that case', () => {
  installLocalStorageStub();
  const slug = 'dds';
  writeIosA2hsAck(slug);
  assert.equal(
    evaluatePostA2hsGate({ ua: IPHONE_SAFARI_UA, isStandalone: true, acknowledged: hasIosA2hsAck(slug) }),
    false
  );
});
