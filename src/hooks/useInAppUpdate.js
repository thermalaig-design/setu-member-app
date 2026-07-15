import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } from '@capawesome/capacitor-app-update';

const ENABLED = import.meta.env.VITE_ENABLE_IN_APP_UPDATES !== 'false';
const IMMEDIATE_PRIORITY_THRESHOLD = Number(import.meta.env.VITE_IN_APP_UPDATE_IMMEDIATE_PRIORITY || 4);

/**
 * Checks Google Play in-app updates on Android.
 * - Immediate flow for high-priority updates.
 * - Flexible flow for normal updates.
 */
export const useInAppUpdate = () => {
  useEffect(() => {
    if (!ENABLED) return undefined;
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return undefined;

    let disposed = false;
    let listenerHandle = null;

    const start = async () => {
      try {
        listenerHandle = await AppUpdate.addListener('onFlexibleUpdateStateChange', async (state) => {
          if (disposed) return;
          if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED || state.installStatus === FlexibleUpdateInstallStatus.INSTALLED) {
            const shouldRestart = window.confirm('Update downloaded. Restart app now to apply the update?');
            if (shouldRestart) {
              await AppUpdate.completeFlexibleUpdate();
            }
          }
        });

        const info = await AppUpdate.getAppUpdateInfo();
        if (disposed) return;

        if (
          info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE &&
          info.updateAvailability !== AppUpdateAvailability.UPDATE_IN_PROGRESS
        ) {
          return;
        }

        const isHighPriority = Number(info.updatePriority || 0) >= IMMEDIATE_PRIORITY_THRESHOLD;

        if (isHighPriority && info.immediateUpdateAllowed) {
          await AppUpdate.performImmediateUpdate();
          return;
        }

        if (info.flexibleUpdateAllowed) {
          await AppUpdate.startFlexibleUpdate();
          return;
        }

        if (info.immediateUpdateAllowed) {
          await AppUpdate.performImmediateUpdate();
        }
      } catch (error) {
        console.warn('[InAppUpdate] Update check failed:', error?.message || error);
      }
    };

    start();

    return () => {
      disposed = true;
      if (listenerHandle?.remove) {
        listenerHandle.remove().catch(() => {});
      }
      AppUpdate.removeAllListeners().catch(() => {});
    };
  }, []);
};

