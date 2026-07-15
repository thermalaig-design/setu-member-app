export const getShareAppTargetLink = (shareAppLinks = {}, platform = '', fallbackUrl = '') => {
  const androidLink = String(shareAppLinks?.play_store_link || '').trim();
  const iosLink = String(shareAppLinks?.app_store_link || '').trim();
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const fallback = String(fallbackUrl || '').trim();

  if (normalizedPlatform === 'ios') return iosLink || androidLink || fallback;
  if (normalizedPlatform === 'android') return androidLink || iosLink || fallback;
  return androidLink || iosLink || fallback;
};
