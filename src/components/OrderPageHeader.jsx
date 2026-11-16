import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { useAppTheme } from '../context/ThemeContext';
import { getNavbarThemeStyles } from '../utils/themeUtils';
import { getAppHomePath } from '../utils/tenantNavigation';

const OrderPageHeader = ({ title, subtitle, onBack }) => {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  return (
    <div
      className="theme-navbar sticky top-0 z-20"
      style={{
        background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
        backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
        WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
        borderBottom: '1px solid var(--navbar-border)',
        boxShadow: '0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)',
      }}
    >
      <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
      <div className="px-4 pt-4 pb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl transition-colors"
          style={{ color: navbarTextColor, background: 'transparent' }}
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[12px] font-medium" style={{ color: navbarTextColor, opacity: 0.8 }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => navigate(getAppHomePath())}
          className="p-2 rounded-xl transition-colors"
          style={{ color: navbarTextColor, background: 'transparent' }}
          aria-label="Go to home"
        >
          <Home className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default OrderPageHeader;
