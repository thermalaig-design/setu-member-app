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

// iOS never fires beforeinstallprompt on any browser — Safari and Chrome
// (CriOS) alike only offer the OS-level "Add to Home Screen" step via the
// Share sheet. isIOSChromeUA distinguishes CriOS so TenantLanding.jsx can
// route it into the same manual Add to Home Screen instructions Safari
// gets, instead of the generic 'unsupported' outcome.
export const isIOSChromeUA = (ua) => /CriOS\//i.test(String(ua || ''));
