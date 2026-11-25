import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const sanitizeFileName = (value) => String(value || '')
  .trim()
  .replace(/[<>:"/\\|?*]/g, '_')
  .replace(/\s+/g, ' ')
  .replace(/\.+$/g, '')
  .slice(0, 120) || 'attachment';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Failed to read attachment data'));
  reader.onload = () => {
    const result = String(reader.result || '');
    const base64 = result.includes(',') ? result.split(',')[1] : '';
    if (!base64) {
      reject(new Error('Attachment data is empty'));
      return;
    }
    resolve(base64);
  };
  reader.readAsDataURL(blob);
});

const triggerBrowserDownload = async (url, fileName) => {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    link.rel = 'noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    return true;
  } catch (error) {
    console.warn('Browser blob download failed, falling back to direct URL:', error);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
    } catch (fallbackError) {
      console.error('Direct attachment download fallback failed:', fallbackError);
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        window.location.href = url;
      }
      return false;
    }
  }
};

const isNativePlatform = () => Capacitor.isNativePlatform();

const isUserCancelError = (error) => {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name === 'aborterror' || message.includes('cancel');
};

const nativeShareAttachment = async ({ url, fileName, shareTitle, shareText }) => {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);

  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  const storedName = `${Date.now()}_${sanitizeFileName(fileName)}`;

  await Filesystem.writeFile({
    path: storedName,
    data: base64,
    directory: Directory.Cache,
  });

  const { uri } = await Filesystem.getUri({
    path: storedName,
    directory: Directory.Cache,
  });

  await Share.share({
    title: shareTitle || sanitizeFileName(fileName),
    text: shareText || fileName || 'Attachment',
    url: uri,
    files: [uri],
    dialogTitle: 'Share attachment',
  });

  return true;
};

export const downloadAttachmentFile = async ({
  url,
  fileName,
  shareTitle,
  shareText,
} = {}) => {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) return false;

  const resolvedFileName = sanitizeFileName(fileName || 'attachment');

  if (!isNativePlatform()) {
    return triggerBrowserDownload(targetUrl, resolvedFileName);
  }

  try {
    return await nativeShareAttachment({
      url: targetUrl,
      fileName: resolvedFileName,
      shareTitle,
      shareText,
    });
  } catch (error) {
    if (isUserCancelError(error)) return true;
    console.error('Native attachment download failed:', error);
    return triggerBrowserDownload(targetUrl, resolvedFileName);
  }
};
