import { useEffect, useState } from 'react';
import { registerSidebarState } from './useAndroidBackHandler';

/**
 * Hook that manages sidebar state and handles Android back button to close sidebar
 * Also prevents body scroll when sidebar is open
 */
export const useSidebarWithBack = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Register sidebar state with global back handler
  useEffect(() => {
    registerSidebarState(isMenuOpen, () => setIsMenuOpen(false));
  }, [isMenuOpen]);

  // Disable scrolling when sidebar is open
  useEffect(() => {
    if (isMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';
    } else {
      const scrollY = parseInt(document.body.style.top || '0') * -1;
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.scrollTo(0, scrollY);
    }

    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
    };
  }, [isMenuOpen]);

  return {
    isMenuOpen,
    setIsMenuOpen,
    toggleMenu: () => setIsMenuOpen(!isMenuOpen),
    closeMenu: () => setIsMenuOpen(false),
    openMenu: () => setIsMenuOpen(true)
  };
};

