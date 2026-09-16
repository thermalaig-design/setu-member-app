import React, { useState } from 'react';
import { ArrowLeft, Home as HomeIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from '../context/ThemeContext';
import { getNavbarThemeStyles } from '../utils/themeUtils';
import { getAppHomePath } from '../utils/tenantNavigation';
import BottomNav from './BottomNav';

const USER_PANEL_URL = 'https://user-test.teiltd.in/auth/login';

export const UserPanelContent = () => (
  <section
    className="overflow-hidden rounded-3xl border"
    style={{
      background: 'var(--advertisement-card-bg)',
      borderColor: 'var(--advertisement-card-border)',
      boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 24%, transparent)'
    }}
  >
    <div className="h-[3px]" style={{ background: 'var(--app-button-bg)' }} />
    <iframe
      title="App Gallery"
      src={USER_PANEL_URL}
      className="w-full border-0"
      style={{ height: 'min(620px, calc(100vh - 210px))', minHeight: 460 }}
    />
  </section>
);

// Rendered once, outside <Routes>, so the /user-panel iframe survives
// navigating to Home and back via the bottom nav's "+" button. A <Route>
// for /user-panel unmounts this on every navigation away, which reloads the
// iframe from USER_PANEL_URL and throws away whatever trust/login state the
// user set up inside it. Keeping it mounted and only toggling visibility
// (display:none) avoids the reload — the iframe itself is untouched by CSS.
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
  if (allowed && !mounted) setMounted(true);

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

      <iframe
        title="User Panel"
        src={USER_PANEL_URL}
        className="flex-1 w-full border-0"
      />

      <BottomNav onNavigate={onNavigate} />
    </div>
  );
};

export default PersistentUserPanel;
