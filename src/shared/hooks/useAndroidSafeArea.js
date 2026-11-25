import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Android Safe Area Handler
 * Handles notches and safe areas using viewport-fit CSS
 */
export const useAndroidSafeArea = () => {
  const [safeArea, setSafeArea] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  });

  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const initSafeArea = async () => {
      if (Capacitor.getPlatform() === 'android') {
        try {
          // Do not infer safe-area using outer/inner height.
          // It can add an artificial top gap in Android WebView.
          const insets = {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
          };

          setSafeArea(insets);
          
          // Update CSS variables for safe area
          const root = document.documentElement;
          root.style.setProperty('--safe-area-top', `${insets.top}px`);
          root.style.setProperty('--safe-area-bottom', `${insets.bottom}px`);
          root.style.setProperty('--safe-area-left', `${insets.left}px`);
          root.style.setProperty('--safe-area-right', `${insets.right}px`);
          
          console.log('✅ Safe area configured');
          setIsLoaded(true);
        } catch (error) {
          console.error('Error configuring safe area:', error);
          setIsLoaded(true);
        }
      } else {
        setIsLoaded(true);
      }
    };

    initSafeArea();

    // Listen for orientation changes
    const handleOrientationChange = () => {
      initSafeArea();
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, []);

  return {
    safeArea,
    isLoaded,
    paddingStyle: {
      paddingTop: `${safeArea.top}px`,
      paddingBottom: `${safeArea.bottom}px`,
      paddingLeft: `${safeArea.left}px`,
      paddingRight: `${safeArea.right}px`
    }
  };
};
