import React from 'react';
import { ArrowLeft, Home as HomeIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import BottomNav from './components/BottomNav';

const USER_PANEL_URL = 'https://user-test.teiltd.in/auth/login';

// Loads the user panel inside an iframe so members never leave the app shell
// (no external tab / system browser) — this is what the bottom nav's "+"
// quick action opens.
const UserPanel = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const navbarTheme = getNavbarThemeStyles(theme);

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: 'var(--page-bg, var(--app-page-bg))' }}>
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

export default UserPanel;
