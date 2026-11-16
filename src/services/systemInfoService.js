import { Capacitor, registerPlugin } from '@capacitor/core';

export const SystemInfo = registerPlugin('SystemInfo');

// Login must never wait long on this.
const NATIVE_TIMEOUT_MS = 1500;

const BROWSER_STATUSES = new Set(['resolved', 'no_default', 'unavailable']);

const isAndroidNative = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const toText = (value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || null;
};

const toInt = (value) => {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('SystemInfo timed out')), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

/**
 * Android device + default-browser details for member_session.metadata,
 * read by the native SystemInfo plugin (Build.* + PackageManager).
 * Returns {} on web / non-Android, on an older APK without the plugin, or on
 * any failure. Never throws.
 */
export const getSystemInfoMetadata = async () => {
  if (!isAndroidNative() || !Capacitor.isPluginAvailable('SystemInfo')) return {};

  try {
    const info = await withTimeout(SystemInfo.getSystemInfo(), NATIVE_TIMEOUT_MS);
    const status = toText(info?.default_browser_status);
    const browserStatus = BROWSER_STATUSES.has(status) ? status : 'unavailable';
    const resolved = browserStatus === 'resolved';

    return {
      device_manufacturer: toText(info?.device_manufacturer),
      device_brand: toText(info?.device_brand),
      device_model: toText(info?.device_model),
      android_version: toText(info?.android_version),
      android_sdk: toInt(info?.android_sdk),
      default_browser_name: resolved ? toText(info?.default_browser_name) : null,
      default_browser_package: resolved ? toText(info?.default_browser_package) : null,
      default_browser_status: browserStatus,
      device_info_source: 'android-native'
    };
  } catch (error) {
    console.warn('[SystemInfo] unavailable:', error?.message || error);
    return {};
  }
};
