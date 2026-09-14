import React, { useEffect, useMemo, useState } from 'react';
import { Home as HomeIcon, Plus, HelpCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useAppTheme } from '../context/ThemeContext';
import { getNavbarThemeStyles } from '../utils/themeUtils';
import { applyOpacity } from '../utils/colorUtils';
import { fetchFeatureFlags, isFeatureVisible } from '../services/featureFlags';
import { fetchTrustHelpUrl } from '../services/trustService';

// Fixed bottom nav (Home / quick action / Help) — gated by the
// feature_bottom_nav flag and shown on any page that renders it, not just
// Home. Self-contained: fetches its own flags + this trust's help_url so
// pages don't need to wire that state themselves.
const BottomNav = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navbarTheme = useMemo(() => getNavbarThemeStyles(theme), [theme]);
  const [featureFlags, setFeatureFlags] = useState({});
  const [helpUrl, setHelpUrl] = useState(null);

  useEffect(() => {
    let active = true;
    const trustId = localStorage.getItem('selected_trust_id') || null;
    fetchFeatureFlags(trustId, { force: false }).then((result) => {
      if (active && result?.success) setFeatureFlags(result.flags || {});
    });
    fetchTrustHelpUrl(trustId).then((url) => {
      if (active) setHelpUrl(url);
    });
    return () => { active = false; };
  }, []);

  const ff = (key) => isFeatureVisible(featureFlags, key);
  if (!ff('feature_bottom_nav')) return null;

  const handleHelpClick = () => {
    if (!helpUrl) {
      onNavigate('contact-us');
      return;
    }
    if (Capacitor.isNativePlatform()) {
      window.location.href = helpUrl;
      return;
    }
    window.open(helpUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      {/* Spacer so the fixed bottom nav never covers page content below it */}
      <div aria-hidden="true" style={{ height: '92px', flexShrink: 0 }} />

      <nav
        aria-label="Primary"
        className="fixed z-30 flex items-center justify-between"
        style={{
          left: '50%',
          bottom: '18px',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 24px)',
          maxWidth: '440px',
          padding: '10px 26px',
          paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
          borderRadius: '20px',
          background: 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: `1px solid ${applyOpacity(navbarTheme.textColor, 0.22)}`,
          boxShadow: `0 18px 38px ${applyOpacity(theme.secondary, 0.4)}, inset 0 1px 0 ${applyOpacity(navbarTheme.textColor, 0.14)}`,
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate('home')}
          aria-label="Home"
          className="flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{
            width: '42px',
            height: '42px',
            background: applyOpacity(navbarTheme.textColor, 0.18),
            border: 'none',
            cursor: 'pointer',
            color: navbarTheme.textColor,
          }}
        >
          <HomeIcon size={20} strokeWidth={2.2} />
        </button>

        <div className="relative flex items-center justify-center" style={{ width: '48px', height: '42px' }}>
          <div
            aria-hidden="true"
            className="bottom-nav-fab-ring absolute rounded-full"
            style={{
              top: '50%',
              left: '50%',
              width: '46px',
              height: '46px',
              transform: 'translate(-50%, -50%)',
              background: `radial-gradient(circle, ${applyOpacity(theme.primary, 0.4)} 0%, transparent 70%)`,
            }}
          />
          <button
            type="button"
            onClick={() => onNavigate('user-panel')}
            aria-label="User Panel"
            className="relative flex items-center justify-center rounded-full transition-transform active:scale-90"
            style={{
              width: '42px',
              height: '42px',
              background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
              boxShadow: `0 6px 14px ${applyOpacity(theme.secondary, 0.5)}`,
              border: 'none',
              cursor: 'pointer',
              color: navbarTheme.textColor,
            }}
          >
            <Plus size={22} strokeWidth={2.6} />
          </button>
        </div>

        <button
          type="button"
          onClick={handleHelpClick}
          aria-label="Help"
          className="flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{
            width: '42px',
            height: '42px',
            background: applyOpacity(navbarTheme.textColor, 0.1),
            border: 'none',
            cursor: 'pointer',
            color: navbarTheme.textColor,
          }}
        >
          <HelpCircle size={20} strokeWidth={2.2} />
        </button>
      </nav>

      <style>{`
        .bottom-nav-fab-ring {
          animation: bottomNavFabPulse 2.2s ease-out infinite;
        }
        @keyframes bottomNavFabPulse {
          0%   { opacity: 0.55; transform: translate(-50%, -50%) scale(0.75); }
          70%  { opacity: 0;    transform: translate(-50%, -50%) scale(1.55); }
          100% { opacity: 0;    transform: translate(-50%, -50%) scale(1.55); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bottom-nav-fab-ring { animation: none; }
        }
      `}</style>
    </>
  );
};

export default BottomNav;
