import { Capacitor, registerPlugin } from '@capacitor/core';

export const MetaEvents = registerPlugin('MetaEvents');

const isAndroidNative = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const toText = (value) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Logs any Meta App Event by name. No-op on web. Never throws; failures are only logged.
 * Do not pass personal data (phone, OTP, name, email) in params.
 */
export async function trackMetaEvent(eventName, params = {}) {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    await MetaEvents.logEvent({ eventName, params });
    return true;
  } catch (error) {
    console.warn(`[MetaEvents] Failed to log ${eventName}:`, error?.message || error);
    return false;
  }
}

/**
 * Logs Meta's standard ViewContent (fb_mobile_content_view) event.
 * No-op outside the native Android app. Never throws; failures are only logged.
 */
export const logMetaViewContent = async ({ contentId, contentType, contentName }) => {
  if (!isAndroidNative()) return false;

  const payload = {
    contentId: toText(contentId),
    contentType: toText(contentType),
    contentName: toText(contentName),
  };

  if (!payload.contentId || !payload.contentType || !payload.contentName) {
    console.warn('[MetaEvents] Skipping ViewContent: missing required content data', payload);
    return false;
  }

  try {
    await MetaEvents.logViewContent(payload);
    return true;
  } catch (error) {
    console.warn('[MetaEvents] Failed to log ViewContent:', error?.message || error);
    return false;
  }
};
