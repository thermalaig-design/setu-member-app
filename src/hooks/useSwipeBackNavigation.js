import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Swipe-back navigation hook
 *
 * - Detects left-edge → right swipe gesture
 * - Navigates to previous page (navigate(-1))
 * - Works in Android WebView + mobile browsers
 * - Keeps root screens (home/login) from going "back" incorrectly
 */
export const useSwipeBackNavigation = (options = {}) => {
  const {
    enabled = true,
    edgeWidth = 24,       // px from left edge to start gesture
    minSwipeDistance = 60 // minimum horizontal distance to trigger
  } = options;

  const navigate = useNavigate();
  const location = useLocation();
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      touchEndX.current = touch.clientX;
      touchEndY.current = touch.clientY;
    };

    const handleTouchMove = (e) => {
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      touchEndX.current = touch.clientX;
      touchEndY.current = touch.clientY;
    };

    const handleTouchEnd = () => {
      const startX = touchStartX.current;
      const startY = touchStartY.current;
      const endX = touchEndX.current;
      const endY = touchEndY.current;

      const deltaX = endX - startX; // right swipe = positive
      const deltaY = Math.abs(endY - startY);

      // Only trigger from very left edge to avoid conflicts with horizontal scroll
      if (startX > edgeWidth) return;

      // Require mostly horizontal swipe
      if (deltaX < minSwipeDistance || deltaY > 40) return;

      // Root screens where we SHOULD NOT navigate back
      const rootScreens = ['/', '/home', '/login'];
      if (rootScreens.includes(location.pathname)) {
        return;
      }

      // Navigate back in history
      navigate(-1);
    };

    // Use passive listeners to keep scroll performance smooth
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, edgeWidth, minSwipeDistance, location.pathname, navigate]);
};


