import { useEffect } from 'react';
import { StatusBar } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

/**
 * Android Status Bar Handler
 * Customizes status bar appearance for better UI/UX
 */
export const useAndroidStatusBar = () => {
  useEffect(() => {
    const setupAndroidUI = async () => {
      if (Capacitor.getPlatform() === 'android') {
        try {
          // Set status bar style - light content on dark background
          await StatusBar.setStyle({ style: 'LIGHT' });
          await StatusBar.setOverlaysWebView({ overlay: false });
          // Avoid white strip by matching app shell tone
          await StatusBar.setBackgroundColor({ color: '#111827' });
          
          console.log('✅ Android Status Bar configured');
        } catch (error) {
          console.error('Error configuring Android Status Bar:', error);
        }
      }
    };

    setupAndroidUI();
  }, []);

  return {
    setStatusBarStyle: async (style) => {
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setStyle({ style });
      }
    },
    setStatusBarColor: async (color) => {
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color });
      }
    }
  };
};
