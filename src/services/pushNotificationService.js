import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';

// Safety default: keep FCM registration OFF unless explicitly enabled.
// This avoids native crash when Firebase config (google-services.json) is missing.
const isFcmPushEnabled = () => import.meta.env.VITE_ENABLE_FCM_PUSH === 'true';

const getCurrentUserId = () => {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return String(user.Mobile || user.mobile || user.phone || user.id || '').trim() || null;
  } catch {
    return null;
  }
};

export const initPushNotifications = async () => {
  // Default OFF. Enable only after native push is configured for the target platform.
  if (!isFcmPushEnabled()) {
    console.warn('FCM push is disabled. Set VITE_ENABLE_FCM_PUSH=true after Firebase setup.');
    return null;
  }

  const platform = Capacitor.getPlatform();
  if (platform !== 'android' && platform !== 'ios') {
    return null;
  }

  try {
    const permissionStatus = await PushNotifications.requestPermissions();
    if (permissionStatus.receive !== 'granted') {
      return null;
    }

    await PushNotifications.register();

    const registration = await PushNotifications.addListener('registration', async (token) => {
      const userId = getCurrentUserId();
      if (!userId || !token?.value) return;

      try {
        await api.post('/notifications/device-token', {
          userId,
          token: token.value,
          platform,
        });
      } catch (error) {
        console.error('Failed to save push token:', error?.message || error);
      }
    });

    const registrationError = await PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });

    // Listen for push notifications arriving while the app is in the foreground
    const foregroundListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      // Emit a custom event to notify Home.jsx (and other components) to refetch notifications
      const event = new CustomEvent('pushNotificationArrived', {
        detail: {
          notificationId: notification?.notification?.data?.notificationId || null,
          title: notification?.notification?.title,
          body: notification?.notification?.body,
        }
      });
      window.dispatchEvent(event);
    });

    const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const notificationId =
        action?.notification?.data?.notificationId ||
        action?.notification?.data?.notification_id ||
        action?.notification?.id ||
        null;

      if (notificationId) {
        sessionStorage.setItem('openNotificationId', String(notificationId));
      }
      localStorage.setItem('openNotificationsFromPush', '1');
      window.dispatchEvent(new CustomEvent('pushNotificationClicked'));
    });

    // ✅ NEW: Listen for app resume/focus
    // This ensures notifications are fetched when user opens the app after receiving a push
    const resumeListener = await App.addListener('appStateChange', (state) => {
      if (state.isActive) {
        // App is now in foreground - refetch notifications to sync with database
        window.dispatchEvent(new CustomEvent('appResumed'));
      }
    });

    return () => {
      registration.remove();
      registrationError.remove();
      actionListener.remove();
      foregroundListener.remove();
      resumeListener.remove();
    };
  } catch (error) {
    console.error('Push init skipped due to native/Firebase setup issue:', error?.message || error);
    return null;
  }
};
