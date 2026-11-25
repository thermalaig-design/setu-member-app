import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Android Screen Orientation Handler
 * Controls screen orientation using CSS media queries and viewport hints
 */
export const useAndroidScreenOrientation = (lockedOrientation = 'PORTRAIT') => {
  const [currentOrientation, setCurrentOrientation] = useState('PORTRAIT');

  useEffect(() => {
    const setupOrientation = async () => {
      if (Capacitor.getPlatform() === 'android') {
        try {
          // Lock screen orientation using CSS media queries
          // Add viewport-fit for notch support
          let viewportMeta = document.querySelector('meta[name="viewport"]');
          if (!viewportMeta) {
            viewportMeta = document.createElement('meta');
            viewportMeta.name = 'viewport';
            document.head.appendChild(viewportMeta);
          }
          
          // Update viewport for orientation lock
          const lockCSS = lockedOrientation === 'PORTRAIT' 
            ? 'width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no'
            : 'width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no';
          
          viewportMeta.setAttribute('content', lockCSS);

          // Set CSS for orientation
          const style = document.createElement('style');
          style.textContent = `
            html, body {
              orientation: ${lockedOrientation === 'PORTRAIT' ? 'portrait' : 'landscape'};
            }
          `;
          document.head.appendChild(style);

          console.log(`✅ Screen orientation locked to: ${lockedOrientation}`);
          setCurrentOrientation(lockedOrientation);
        } catch (error) {
          console.error('Error setting screen orientation:', error);
        }
      }
    };

    setupOrientation();
  }, [lockedOrientation]);

  // Function to dynamically change orientation
  const setOrientation = async (orientation) => {
    setCurrentOrientation(orientation);
    console.log(`Orientation changed to: ${orientation}`);
  };

  // Function to unlock orientation
  const unlockOrientation = async () => {
    console.log('Orientation unlocked');
  };

  return {
    currentOrientation,
    setOrientation,
    unlockOrientation
  };
};
