import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { api } from './api';

// Safety default: keep FCM registration OFF unless explicitly enabled.
// This avoids a native crash when the Firebase config files are missing.
const isFcmPushEnabled = () => import.meta.env.VITE_ENABLE_FCM_PUSH === 'true';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const PUSH_TOKEN_KEY = 'push_fcm_token';
const UNREGISTER_TIMEOUT_MS = 3000;

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: push still works, only token-rotation tracking is lost
  }
};

const getCurrentUserContext = () => {
  try {
    const userStr = readStorage('user');
    if (!userStr) return { userId: null, membersId: null };
    const user = JSON.parse(userStr);
    return {
      userId: String(user.Mobile || user.mobile || user.phone || user.id || '').trim() || null,
      membersId: String(user.members_id || user.member_id || user.id || '').trim() || null,
    };
  } catch {
    return { userId: null, membersId: null };
  }
};

const isLoggedIn = () => readStorage('isLoggedIn') === 'true';

const dispatch = (name, detail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(detail === undefined ? new CustomEvent(name) : new CustomEvent(name, { detail }));
};

const registerTokenWithBackend = async (tokenValue, platform) => {
  const { userId, membersId } = getCurrentUserContext();
  if (!tokenValue || (!userId && !membersId)) return;

  const previousToken = readStorage(PUSH_TOKEN_KEY);
  try {
    await api.post('/notifications/device-token', {
      userId,
      members_id: membersId,
      token: tokenValue,
      platform,
      ...(previousToken && previousToken !== tokenValue ? { previousToken } : {}),
    });
    writeStorage(PUSH_TOKEN_KEY, tokenValue);
  } catch (error) {
    console.error('Failed to save push token:', error?.message || error);
  }
};

// One set of native listeners for the whole app run. Re-running init after another login
// only asks for a fresh token; it never stacks duplicate listeners.
let listenersReady = false;
let resumeListenerReady = false;
let initInFlight = null;
// Identity push was last initialised for in this app run (init is called on every route change).
let initializedFor = null;

const attachResumeListener = async () => {
  if (resumeListenerReady) return;
  resumeListenerReady = true;
  try {
    // Lets screens refetch notifications when the app comes back to the foreground.
    await App.addListener('appStateChange', (state) => {
      if (state.isActive) dispatch('appResumed');
    });
  } catch (error) {
    resumeListenerReady = false;
    console.warn('App resume listener skipped:', error?.message || error);
  }
};

const attachPushListeners = async (PushNotifications, platform) => {
  if (listenersReady) return;
  listenersReady = true;

  await PushNotifications.addListener('registration', (token) => {
    registerTokenWithBackend(token?.value, platform);
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error:', err);
  });

  // Push arriving while the app is open: tell Home / Notifications to refetch.
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    const data = notification?.data || notification?.notification?.data || {};
    dispatch('pushNotificationArrived', {
      notificationId: data?.notificationId || data?.notification_id || null,
      trustId: data?.trustId || data?.trust_id || null,
      clickAction: data?.clickAction || data?.click_action || data?.type || null,
      title: notification?.title || notification?.notification?.title,
      body: notification?.body || notification?.notification?.body,
    });
  });

  // Tap on a system pop-up: App.jsx opens /notifications (see openNotificationsFromPush).
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = action?.notification?.data || {};
    const notificationId = data?.notificationId || data?.notification_id || action?.notification?.id || null;
    const trustId = data?.trustId || data?.trust_id || null;
    const clickAction = data?.clickAction || data?.click_action || data?.type || null;

    if (trustId) {
      writeStorage('selected_trust_id', String(trustId));
      writeStorage(LAST_SELECTED_TRUST_ID_KEY, String(trustId));
      dispatch('trust-changed', { trustId: String(trustId) });
      try {
        sessionStorage.setItem('openNotificationTrustId', String(trustId));
      } catch {
        // ignore
      }
    }

    try {
      if (notificationId) sessionStorage.setItem('openNotificationId', String(notificationId));
      if (clickAction) sessionStorage.setItem('openNotificationClickAction', String(clickAction));
    } catch {
      // ignore
    }
    writeStorage('openNotificationsFromPush', '1');
    dispatch('pushNotificationClicked');
  });
};

// Call after login and on app start while a user is logged in. Safe to call repeatedly.
export const initPushNotifications = async () => {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android' && platform !== 'ios') return null;

  // Resume refresh has nothing to do with FCM, so it works even while push is switched off.
  await attachResumeListener();

  if (!isFcmPushEnabled()) {
    console.warn('FCM push is disabled. Set VITE_ENABLE_FCM_PUSH=true after Firebase setup.');
    return null;
  }
  if (!isLoggedIn()) return null;
  if (initInFlight) return initInFlight;

  const { userId, membersId } = getCurrentUserContext();
  const identity = membersId || userId;
  if (!identity) return null;
  // Already asked for this user in this run (granted or denied): do not re-prompt or re-post.
  if (initializedFor === identity) return null;
  initializedFor = identity;

  initInFlight = (async () => {
    try {
      // Loaded on demand so the push plugin stays out of the main bundle.
      const { PushNotifications } = await import('@capacitor/push-notifications');

      const permissionStatus = await PushNotifications.requestPermissions();
      if (permissionStatus.receive !== 'granted') return null;

      // Listeners first, then register(), so the first token event is never missed.
      await attachPushListeners(PushNotifications, platform);
      await PushNotifications.register();
      return true;
    } catch (error) {
      console.error('Push init skipped due to native/Firebase setup issue:', error?.message || error);
      initializedFor = null;
      return null;
    } finally {
      initInFlight = null;
    }
  })();

  return initInFlight;
};

// Call right before the logout/autologout session event is written. Removes this phone's
// token from the login row(s) and returns it, so the caller can also store it on the
// logout row (the sender ignores a token that shows up in a later logout row, which covers
// a logout that happened offline).
export const unregisterPushToken = async () => {
  const token = readStorage(PUSH_TOKEN_KEY);
  initializedFor = null;
  if (!token) return null;

  try {
    await Promise.race([
      api.delete('/notifications/device-token', { data: { token } }),
      new Promise((resolve) => setTimeout(resolve, UNREGISTER_TIMEOUT_MS)),
    ]);
  } catch (error) {
    console.warn('Push token unregister failed:', error?.message || error);
  }

  writeStorage(PUSH_TOKEN_KEY, null);
  initializedFor = null;
  return token;
};
