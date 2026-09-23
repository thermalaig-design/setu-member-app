// Pure, UA-based browser classification behind the "Android Chrome-only
// guided PWA installation" feature — see TenantLanding.jsx's Chrome
// compatibility card. Kept dependency-free (no React, no DOM beyond the UA
// string passed in) so it's unit-testable under plain `node --test`, the
// same way utils/installPendingState.js and utils/launchReadiness.js are.

export const isAndroidUA = (ua) => /Android/i.test(String(ua || ''));

// REAL Android Chrome only. Every other Chromium-based Android browser
// (Samsung Internet, Edge, Opera, and a handful of others) ALSO carries
// "Chrome/<version>" in its own UA string — a naive /Chrome/.test(ua)
// check would misclassify all of them as Chrome. Each is excluded by its
// own distinguishing UA token instead, checked BEFORE the bare Chrome/
// check passes.
export const isRealAndroidChrome = (ua) => {
  const value = String(ua || '');
  if (!isAndroidUA(value)) return false;
  if (!/Chrome\//.test(value)) return false;

  // Known non-Chrome Android browsers that also carry "Chrome/" in UA.
  if (/SamsungBrowser\//i.test(value)) return false; // Samsung Internet
  if (/EdgA\//.test(value)) return false; // Microsoft Edge (Android)
  if (/OPR\//.test(value) || /\bOPT\//.test(value) || /Opera/i.test(value)) return false; // Opera / Opera Touch
  if (/HeyTapBrowser|MiuiBrowser|VivoBrowser|OppoBrowser|UCBrowser|YaBrowser|DuckDuckGo|Brave|Puffin|QQBrowser|Quark/i.test(value)) return false;
  // In-app embedded browsers (Facebook/Instagram/WhatsApp in-app webviews)
  // also carry a real Chrome UA underneath — never real, user-facing Chrome.
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp/i.test(value)) return false;
  // A bare Android WebView (an app embedding Chromium, not the Chrome app
  // itself) carries a "; wv)" token.
  if (/;\s*wv\)/i.test(value)) return false;

  return true;
};

// Android + NOT real Chrome — the exact population this feature guides
// into Chrome instead of running the native install flow for.
export const isAndroidNonChromeBrowser = (ua) => isAndroidUA(ua) && !isRealAndroidChrome(ua);

// Requirement 5: preserves the exact current tenant URL — host, pathname
// (the /app/<slug>/ path) and query string — with no
// S.browser_fallback_url back to the tenant page. A failed intent must
// surface TenantLanding.jsx's own "Google Chrome is required" UI, never
// silently reload this same page back in the non-Chrome browser.
export const buildChromeIntentUrl = (httpsUrl) => {
  try {
    const parsed = new URL(httpsUrl);
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;package=com.android.chrome;end`;
  } catch {
    return '';
  }
};

// --- iOS / iPadOS Safari-only guided install --------------------------
// Extends the same "guide the user into Chrome instead of running the
// native install flow" idea to iOS, where Safari (not Chrome) is the only
// browser this app's install UI is meaningfully served in today. iOS
// Chrome (CriOS) is WebKit-based like Safari and structurally can never
// fire beforeinstallprompt regardless of any code here — it's excluded
// from isSafariUA() below purely so it falls through to whatever the
// existing (unchanged) iOS install-instructions fallback already does for
// it, never this new Safari-specific card.

// iPadOS 13+ reports its UA as a plain "Macintosh" one, indistinguishable
// from a real Mac purely by UA string — `isTouchDevice` (the caller's own
// `'ontouchend' in document` check, exactly like TenantLanding.jsx's
// existing isIosSafari()/isMacSafari() split) is what tells them apart. A
// real (non-touch) Mac must never match this — it keeps its own separate
// "mac-safari-instructions" (File > Add to Dock) flow, untouched by this
// feature.
export const isIOSUA = (ua, { isTouchDevice = false } = {}) => {
  const value = String(ua || '');
  if (/iPad|iPhone|iPod/.test(value)) return true;
  return value.includes('Macintosh') && Boolean(isTouchDevice);
};

// REAL Safari only. Every iOS browser embeds WebKit and therefore also
// carries "Safari" in its own UA — each known non-Safari iOS browser (and
// common in-app embedded browsers) is excluded by its own distinguishing
// token, the same shape as isRealAndroidChrome() above.
export const isSafariUA = (ua) => {
  const value = String(ua || '');
  if (!/Safari/i.test(value)) return false;
  if (/CriOS\//i.test(value)) return false; // Chrome for iOS
  if (/FxiOS\//i.test(value)) return false; // Firefox for iOS
  if (/EdgiOS\//i.test(value)) return false; // Edge for iOS
  if (/OPiOS\//i.test(value)) return false; // Opera for iOS
  if (/DuckDuckGo/i.test(value)) return false;
  if (/YaBrowser/i.test(value)) return false;
  if (/GSA\//i.test(value)) return false; // Google app's in-app browser
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp/i.test(value)) return false;
  return true;
};

export const isIOSChromeUA = (ua) => /CriOS\//i.test(String(ua || ''));

// THE gate for the iOS "Open in Google Chrome" compatibility card
// (requirement 2): iOS + real Safari + not already running standalone
// (an already-installed Home Screen launch). `isStandalone` is passed in
// rather than read here (this module stays DOM-free/pure) — the caller
// (TenantLanding.jsx) supplies its own existing isStandaloneDisplay().
export const shouldShowIosSafariCompatCard = ({ ua, isTouchDevice, isStandalone }) =>
  isIOSUA(ua, { isTouchDevice }) && isSafariUA(ua) && !isStandalone;

// Chrome for iOS's documented custom URL scheme for opening an HTTPS link:
// the scheme is swapped from "https:" to "googlechromes:" and everything
// else — host, pathname (the /app/<slug>/ path), query string, and hash —
// is preserved exactly (requirement 1's "preserving pathname +
// search/hash if applicable"). No fallback parameter exists for this
// scheme (unlike Android's intent:// S.browser_fallback_url) — a failed
// hand-off is detected purely via the visibilitychange/pagehide watch in
// TenantLanding.jsx, never a second navigation from this function.
export const buildIOSChromeUrl = (httpsUrl) => {
  try {
    const parsed = new URL(httpsUrl);
    if (parsed.protocol !== 'https:') return '';
    return `googlechromes://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
};
