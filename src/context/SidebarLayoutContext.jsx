import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * SidebarLayoutContext - shared state for the single persistent Sidebar instance
 * rendered once in App.jsx (see Sidebar.jsx `variant="persistent"`).
 *
 * - isMobileOpen: drives the overlay drawer below the `lg:` breakpoint.
 * - isCollapsed: drives the icon-rail vs full-width column at `lg:` and up,
 *   persisted so it survives navigation and reloads.
 *
 * Pages that haven't migrated to the shared instance yet (still rendering their
 * own <Sidebar variant="overlay" .../>) don't need this context at all.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebar_collapsed';

const readStoredCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const SidebarLayoutContext = createContext(null);

export const SidebarLayoutProvider = ({ children }) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);

  const value = useMemo(() => ({
    isMobileOpen,
    openMobile: () => setIsMobileOpen(true),
    closeMobile: () => setIsMobileOpen(false),
    toggleMobile: () => setIsMobileOpen((prev) => !prev),
    isCollapsed,
    toggleCollapsed: () => {
      setIsCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
        } catch {
          // ignore storage write failures
        }
        return next;
      });
    },
  }), [isMobileOpen, isCollapsed]);

  return (
    <SidebarLayoutContext.Provider value={value}>
      {children}
    </SidebarLayoutContext.Provider>
  );
};

export const useSidebarLayout = () => useContext(SidebarLayoutContext);
