import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Home as HomeIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useAppTheme } from '../context/ThemeContext';
import { getNavbarThemeStyles } from '../utils/themeUtils';
import { getAppHomePath } from '../utils/tenantNavigation';
import { getUserPanelToken } from '../services/authService';
import BottomNav from './BottomNav';

const USER_PANEL_LOGIN_URL = 'https://user-test.teiltd.in/auth/login';
const USER_PANEL_SSO_URL = 'https://user-test.teiltd.in/auth/app-sso';
const USER_PANEL_ORIGIN = new URL(USER_PANEL_LOGIN_URL).origin;

// The bypass token lives only 60s, so this must be called right before the
// User Panel is opened/loaded — never cached. Falls back to the normal login page.
const createUserPanelUrl = async () => {
  let setuSessionToken = null;
  try { setuSessionToken = localStorage.getItem('setu_session_token'); } catch { /* ignore */ }
  if (!setuSessionToken) return USER_PANEL_LOGIN_URL;

  try {
    const result = await getUserPanelToken(setuSessionToken);
    if (!result?.token) return USER_PANEL_LOGIN_URL;
    return `${USER_PANEL_SSO_URL}?token=${encodeURIComponent(result.token)}`;
  } catch (error) {
    console.warn('[UserPanel] Auto-login token creation failed:', error?.message || error);
    return USER_PANEL_LOGIN_URL;
  }
};

// Identity of the currently logged-in SETU member, read from the same
// 'user' / 'isLoggedIn' localStorage keys the rest of the app uses.
// Returns '' when logged out.
const readCurrentMemberId = () => {
  try {
    if (localStorage.getItem('isLoggedIn') !== 'true') return '';
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return String(user?.members_id || user?.member_id || user?.id || '').trim();
  } catch {
    return '';
  }
};

// Resolves a fresh iframe src (new bypass token) when `enabled` turns true or
// `resetKey` changes, and clears it when disabled. Otherwise stays fixed so a
// same-user panel is never reloaded.
const useUserPanelSrc = (enabled, resetKey = 0) => {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return undefined;
    }
    let cancelled = false;
    setSrc(null);
    createUserPanelUrl().then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [enabled, resetKey]);

  return src;
};

// Calls `onReset` when the SETU member logs out or changes (A -> B). Identity
// is re-read on every render of the host (routing re-renders it on logout /
// login) and on storage events.
const useSetuIdentityReset = (onReset) => {
  const [, forceRender] = useState(0);
  const currentMemberId = readCurrentMemberId();
  const previousMemberIdRef = useRef(currentMemberId);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    const onStorage = () => forceRender((v) => v + 1);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const previous = previousMemberIdRef.current;
    if (previous && previous !== currentMemberId) onResetRef.current();
    previousMemberIdRef.current = currentMemberId;
  });
};

const postLogoutToPanel = (iframe) => {
  try {
    iframe?.contentWindow?.postMessage({ type: 'USER_PANEL_LOGOUT' }, USER_PANEL_ORIGIN);
  } catch { /* ignore */ }
};

// On native (Capacitor) only, the user-panel app is never loaded in an
// in-app iframe. Android's native WebView often never invokes
// shouldOverrideUrlLoading for navigations started inside a sub-frame/
// iframe, so any internal link the user-panel app renders (not just
// external ones) can get misrouted into a system Custom Tab, hitting that
// app's server directly with no client-side router in front of it — which
// then 404s on any route beyond its root. Opening it as its own top-level
// navigation instead of an iframe avoids the sub-frame entirely:
// shouldOverrideUrlLoading reliably fires there, so only links meant to
// leave the app actually do.
//
// On the web/PWA, the user-panel app stays embedded in an iframe as before:
// an occasional 404 seen there (e.g. landing on the parent teiltd.in domain)
// comes from that app itself breaking out to a top-level redirect at some
// broken/missing link — that happens the same way whether it's embedded or
// opened externally, so it's a bug on that app's side, not something the
// embedding method here can prevent.
const isNative = Capacitor.isNativePlatform();
const skipIframe = isNative;

const openUserPanelExternally = async (onClosed) => {
  const url = await createUserPanelUrl();

  if (isNative) {
    await Browser.open({ url });
    if (onClosed) {
      Browser.addListener('browserFinished', () => onClosed());
    }
    return;
  }

  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (onClosed && win) {
    const pollId = window.setInterval(() => {
      if (win.closed) {
        window.clearInterval(pollId);
        onClosed();
      }
    }, 500);
  }
};

// Only relevant when the user-panel app is still embedded via iframe: it
// posts a message instead of navigating directly for links that must open
// externally (e.g. Play Store), since a plain redirect inside an iframe
// would just load as a framed document and get refused by the target's
// frame-busting headers. Registered once, at module load, since the iframe
// can mount before any component-level effect would run.
if (!skipIframe) {
  window.addEventListener('message', (event) => {
    if (event.origin !== USER_PANEL_ORIGIN) return;
    if (event.data?.type !== 'OPEN_EXTERNAL_LINK' || !event.data.url) return;
    window.open(event.data.url, '_blank', 'noopener,noreferrer');
  });
}

export const UserPanelContent = () => {
  const iframeRef = useRef(null);
  const [iframeVersion, setIframeVersion] = useState(0);
  const iframeSrc = useUserPanelSrc(!skipIframe, iframeVersion);

  useSetuIdentityReset(() => {
    postLogoutToPanel(iframeRef.current);
    setIframeVersion((v) => v + 1);
  });

  if (skipIframe) {
    return (
      <section
        className="overflow-hidden rounded-3xl border"
        style={{
          background: 'var(--advertisement-card-bg)',
          borderColor: 'var(--advertisement-card-border)',
          boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 24%, transparent)'
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--app-button-bg)' }} />
        <button
          type="button"
          onClick={() => openUserPanelExternally()}
          className="w-full flex flex-col items-center justify-center gap-2 p-8"
          style={{ background: 'transparent', border: 'none' }}
        >
          <ExternalLink className="h-6 w-6" style={{ color: 'var(--app-button-bg)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--advertisement-title)' }}>Open App Gallery</span>
        </button>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-3xl border"
      style={{
        background: 'var(--advertisement-card-bg)',
        borderColor: 'var(--advertisement-card-border)',
        boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 24%, transparent)'
      }}
    >
      <div className="h-[3px]" style={{ background: 'var(--app-button-bg)' }} />
      {iframeSrc && (
        <iframe
          key={iframeVersion}
          ref={iframeRef}
          title="App Gallery"
          src={iframeSrc}
          allow="clipboard-write; web-share"
          className="w-full border-0"
          style={{ height: 'min(620px, calc(100vh - 210px))', minHeight: 460 }}
        />
      )}
    </section>
  );
};

// Rendered once, outside <Routes>, so the /user-panel iframe survives
// navigating to Home and back via the bottom nav's "+" button. A <Route>
// for /user-panel unmounts this on every navigation away, which reloads the
// iframe from USER_PANEL_URL and throws away whatever trust/login state the
// user set up inside it. Keeping it mounted and only toggling visibility
// (display:none) avoids the reload — the iframe itself is untouched by CSS.
//
// On native, or an installed PWA, this renders nothing: /user-panel instead
// opens the user-panel app as its own top-level navigation (see the
// skipIframe block above for why), outside this component's DOM.
const PersistentUserPanel = ({ isActive, onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const navbarTheme = getNavbarThemeStyles(theme);
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  // Not gated behind feature_bottom_nav: that flag only controls the bottom
  // nav's own "+" button. The top navbar's "+" links here too and must keep
  // working when the bottom nav is toggled off.
  const allowed = isActive && isLoggedIn;

  // Sticks once true so the iframe, once loaded, is never torn down again —
  // only ever hidden/shown. Guarded so it only fires the one render where
  // `allowed` first turns true, same as a derived-state pattern.
  const [mounted, setMounted] = useState(false);
  const iframeRef = useRef(null);
  const [iframeVersion, setIframeVersion] = useState(0);

  // Tracks whether the external browser/tab is already open for this
  // activation, so re-renders (e.g. from isLoggedIn checks) don't reopen it,
  // and so it opens again the next time the user navigates back to /user-panel.
  const openedRef = useRef(false);

  // Full reset on SETU logout or member change: tell the embedded panel to
  // log out, drop the iframe and its URL (a new bypass token is generated the
  // next time it opens) and re-arm the native open. Never runs for ordinary
  // navigation by the same member.
  const resetUserPanel = () => {
    postLogoutToPanel(iframeRef.current);
    openedRef.current = false;
    setMounted(false);
    setIframeVersion((v) => v + 1);
  };
  useSetuIdentityReset(resetUserPanel);

  useEffect(() => {
    if (allowed && !mounted) setMounted(true);
  }, [allowed, mounted]);

  useEffect(() => {
    if (!skipIframe) return undefined;
    if (!allowed) {
      openedRef.current = false;
      return undefined;
    }
    if (openedRef.current) return undefined;
    openedRef.current = true;

    openUserPanelExternally(() => {
      openedRef.current = false;
      navigate(-1);
    });
  }, [allowed, navigate]);

  const iframeSrc = useUserPanelSrc(mounted && !skipIframe, iframeVersion);

  if (skipIframe) return null;

  if (!mounted) return null;

  return (
    <div
      className="flex flex-col"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        margin: '0 auto',
        width: 'min(100%, 430px)',
        maxWidth: '430px',
        height: '100vh',
        background: 'var(--page-bg, var(--app-page-bg))',
        display: isActive ? 'flex' : 'none',
      }}
    >
      <div
        className="theme-navbar sticky top-0 z-20 flex-shrink-0"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="px-4 pt-4 pb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl transition-colors"
            style={{ color: navbarTheme?.textColor, background: 'transparent' }}
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-extrabold tracking-wide" style={{ color: navbarTheme?.textColor }}>User Panel</h1>
          <button
            type="button"
            onClick={() => navigate(getAppHomePath())}
            className="p-2 rounded-xl transition-colors"
            style={{ color: navbarTheme?.textColor, background: 'transparent' }}
            aria-label="Home"
          >
            <HomeIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {iframeSrc ? (
        <iframe
          key={iframeVersion}
          ref={iframeRef}
          title="User Panel"
          src={iframeSrc}
          allow="clipboard-write; web-share"
          className="flex-1 w-full border-0"
        />
      ) : (
        <div className="flex-1" />
      )}

      <BottomNav onNavigate={onNavigate} />
    </div>
  );
};

export default PersistentUserPanel;
