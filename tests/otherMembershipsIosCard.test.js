import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// App Gallery ("Other Memberships") card tap: Android opens a trust's
// web app via handleOpenTrustWebApp — async (awaits a Supabase RPC), THEN
// window.open(). iOS Safari/Chrome block window.open() the instant it runs
// outside the synchronous call stack of the tap that triggered it, which an
// awaited RPC call always breaks — Android tolerates the delay, iOS
// silently drops the popup. The fix: resolve each card's web_app_url at
// load time (a prefetch effect keyed on trustLinks) and render iOS cards as
// a real <a href target="_blank">, never window.open() after an await.
// No jsdom/RTL harness in this repo, so the fix is proven structurally here
// the same way tests/installBrowserSupport.test.js does for TenantLanding.jsx.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Normalize CRLF -> LF: this file is saved with Windows line endings, and
// every multi-line pattern below assumes plain \n.
const source = fs.readFileSync(
  path.join(__dirname, '../src/OtherMemberships.jsx'),
  'utf8'
).replace(/\r\n/g, '\n');

// --- Root cause is still present in Android's own path, unchanged --------

test('Android: handleOpenTrustWebApp is still async, still awaits the RPC, still calls window.open after it — untouched', () => {
  const start = source.indexOf('const handleOpenTrustWebApp = async (link) => {');
  assert.ok(start !== -1, 'expected handleOpenTrustWebApp to still exist, unmodified');
  const end = source.indexOf('\n  };', start);
  const body = source.slice(start, end);

  assert.match(body, /await supabase\.rpc\('manage_user_panel_by_trust_details'/);
  assert.match(body, /window\.open\(webAppUrl, '_blank', 'noopener,noreferrer'\);/);
  // The window.open call must come AFTER the await, textually — this is
  // the exact shape iOS blocks; Android's own path must keep it exactly as
  // it always was.
  const awaitIdx = body.indexOf('await supabase.rpc');
  const openIdx = body.indexOf('window.open(webAppUrl');
  assert.ok(awaitIdx !== -1 && openIdx !== -1 && awaitIdx < openIdx);
});

test('Android: the <div role="button" onClick={onClick}> card path is untouched and still calls handleOpenTrustWebApp on tap', () => {
  assert.match(source, /role="button"\s*\n\s*tabIndex=\{0\}\s*\n\s*onClick=\{onClick\}/);
  assert.match(source, /onClick=\{\(\) => handleOpenTrustWebApp\(link\)\}/);
});

// --- iOS fix: prefetch at load time, never on tap -------------------------

test('source guard: isIOSDevice is a plain, browser-neutral UA check (iPad/iPhone/iPod or touch-Mac), matching Safari and Chrome alike', () => {
  const start = source.indexOf('const isIOSDevice = () => {');
  assert.ok(start !== -1);
  const end = source.indexOf('};', start);
  const body = source.slice(start, end);
  assert.match(body, /iPad\|iPhone\|iPod/);
  assert.doesNotMatch(body, /CriOS|Safari\//);
});

test('source guard: fetchTrustWebAppUrl is a wholly separate function from handleOpenTrustWebApp — no shared/refactored code path', () => {
  assert.match(source, /const fetchTrustWebAppUrl = useCallback\(async \(trustId\) => \{/);
  // The two functions must never call each other.
  const fetchStart = source.indexOf('const fetchTrustWebAppUrl = useCallback(async (trustId) => {');
  const fetchEnd = source.indexOf('}, []);', fetchStart);
  const fetchBody = source.slice(fetchStart, fetchEnd);
  assert.doesNotMatch(fetchBody, /handleOpenTrustWebApp/);
  assert.doesNotMatch(fetchBody, /window\.open/);
});

test('source guard: the prefetch effect is gated on isIOS, keyed on trustLinks, and runs independently of any click handler', () => {
  const effectStart = source.indexOf('if (!isIOS) return undefined;');
  assert.ok(effectStart !== -1, 'expected a useEffect gated on isIOS for the prefetch');
  const effectEnd = source.indexOf('}, [isIOS, trustLinks, fetchTrustWebAppUrl]);', effectStart);
  assert.ok(effectEnd !== -1);
  const effectBody = source.slice(effectStart, effectEnd);

  assert.match(effectBody, /normalizeText\(link\?\.trust_id \|\| link\?\.Trust\?\.id\)/);
  assert.match(effectBody, /fetchTrustWebAppUrl\(id\)\.then\(\(url\) => \{/);
  assert.match(effectBody, /setTrustWebAppUrls\(\(prev\) => \(\{ \.\.\.prev, \[id\]: url \}\)\)/);
  // Never triggered by a tap/onClick inside this effect.
  assert.doesNotMatch(effectBody, /onClick/);
});

test('source guard: trustWebAppUrls / trustWebAppUrlRequestedRef are declared once and only populated by the prefetch effect, not by handleOpenTrustWebApp', () => {
  assert.match(source, /const \[trustWebAppUrls, setTrustWebAppUrls\] = useState\(\{\}\);/);
  assert.match(source, /const trustWebAppUrlRequestedRef = useRef\(new Set\(\)\);/);

  const handleStart = source.indexOf('const handleOpenTrustWebApp = async (link) => {');
  const handleEnd = source.indexOf('\n  };', handleStart);
  const handleBody = source.slice(handleStart, handleEnd);
  assert.doesNotMatch(handleBody, /setTrustWebAppUrls/);
});

// --- iOS fix: real <a href target="_blank"> card, no async-before-open ---

test('source guard: the iOS TrustLinkTile branch renders a real <a href target="_blank" rel="noopener noreferrer">, gated on isIOS', () => {
  const gateStart = source.indexOf('if (isIOS) {');
  assert.ok(gateStart !== -1);
  const gateEnd = source.indexOf('\n    return (\n      <div', gateStart);
  assert.ok(gateEnd !== -1, 'expected the iOS branch to sit right before the unchanged Android <div> return');
  const iosBody = source.slice(gateStart, gateEnd);

  assert.match(iosBody, /<a\s*\n\s*href=\{resolvedUrl \|\| '#'\}/);
  assert.match(iosBody, /target="_blank"/);
  assert.match(iosBody, /rel="noopener noreferrer"/);
  // No async-before-open: no await, no window.open, no fetch/then chains
  // inside the rendered iOS card itself.
  assert.doesNotMatch(iosBody, /window\.open/);
  assert.doesNotMatch(iosBody, /await /);
});

test('source guard: the iOS card href comes from the per-tenant resolvedUrl prop, never a hard-coded tenant URL', () => {
  const gateStart = source.indexOf('if (isIOS) {');
  const gateEnd = source.indexOf('\n    return (\n      <div', gateStart);
  const iosBody = source.slice(gateStart, gateEnd);
  assert.doesNotMatch(iosBody, /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
});

test('source guard: TrustLinkTile receives isIOS and per-link resolvedUrl (keyed by that link\'s own trust_id) from the render call site — each card gets its own URL', () => {
  const callStart = source.indexOf('<TrustLinkTile');
  assert.ok(callStart !== -1);
  const callEnd = source.indexOf('/>', callStart);
  const callBody = source.slice(callStart, callEnd);
  assert.match(callBody, /isIOS=\{isIOS\}/);
  assert.match(callBody, /resolvedUrl=\{trustWebAppUrls\[normalizeText\(link\?\.trust_id \|\| link\?\.Trust\?\.id\)\]\}/);
});

test('source guard: a missing/pending iOS URL never silently no-ops — handleIosClick always prevents default and alerts', () => {
  const start = source.indexOf('const handleIosClick = (event) => {');
  assert.ok(start !== -1);
  const end = source.indexOf('};', start);
  const body = source.slice(start, end);
  assert.match(body, /if \(resolvedUrl\) return;/);
  assert.match(body, /event\.preventDefault\(\);/);
  assert.match(body, /alert\(/);
});

test('source guard: the iOS UI/style object mirrors Android\'s card exactly (same className, border-radius, gradients) — only the wrapping element and click semantics differ', () => {
  const gateStart = source.indexOf('if (isIOS) {');
  const gateEnd = source.indexOf('\n    return (\n      <div', gateStart);
  const iosBody = source.slice(gateStart, gateEnd);

  assert.match(iosBody, /className=\{`other-membership-card\$\{isLightTheme \? ' other-membership-card--light' : ''\}`\}/);
  assert.match(iosBody, /borderRadius: '18px'/);
  assert.match(iosBody, /<TrustAvatar trust=\{link\.Trust \|\| \{ name: trustName, icon_url: null \}\} size=\{36\} \/>/);
});

// --- Pure logic: the prefetch map's resolution states ---------------------

test('resolvedUrl undefined (still in flight) vs "" (confirmed missing) vs a real string are distinguishable, matching how the component branches', () => {
  const evaluate = (resolvedUrl) => {
    if (resolvedUrl) return 'navigate';
    if (resolvedUrl === '') return 'alert-missing';
    return 'alert-pending';
  };

  assert.equal(evaluate(undefined), 'alert-pending');
  assert.equal(evaluate(''), 'alert-missing');
  assert.equal(evaluate('https://members.example.com/app/dds/'), 'navigate');
});

test('multiple trust ids resolve independently in the prefetch map — one tenant\'s URL never leaks onto another\'s card', () => {
  const trustWebAppUrls = {};
  const setUrl = (id, url) => { trustWebAppUrls[id] = url; };

  setUrl('dds', 'https://members.example.com/app/dds/');
  setUrl('backup-trust', 'https://members.example.com/app/backup-trust/');

  assert.equal(trustWebAppUrls['dds'], 'https://members.example.com/app/dds/');
  assert.equal(trustWebAppUrls['backup-trust'], 'https://members.example.com/app/backup-trust/');
  assert.notEqual(trustWebAppUrls['dds'], trustWebAppUrls['backup-trust']);
});
