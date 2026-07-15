import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

const WEB_FALLBACK_VERSION = String(
  import.meta.env.VITE_APP_VERSION ||
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev')
).trim() || 'dev';

export const useAppVersion = () => {
  const [version, setVersion] = useState(WEB_FALLBACK_VERSION);
  const [build, setBuild] = useState('');

  useEffect(() => {
    let active = true;

    const loadVersion = async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const info = await App.getInfo();
          if (!active) return;
          setVersion(String(info?.version || WEB_FALLBACK_VERSION));
          setBuild(String(info?.build || ''));
          return;
        }
      } catch (error) {
        console.warn('[useAppVersion] failed to read native app info:', error?.message || error);
      }

      if (active) {
        setVersion(WEB_FALLBACK_VERSION);
        setBuild('');
      }
    };

    loadVersion();
    return () => {
      active = false;
    };
  }, []);

  return {
    version,
    build,
    displayVersion: build ? `v${version} (${build})` : `v${version}`,
  };
};
