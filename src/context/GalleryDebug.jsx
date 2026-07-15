import React from 'react';
import { useGalleryContext } from './GalleryContext';

export function GalleryDebug() {
  const { folders, images, isLoading, error, lastFetchTime, cacheTimeRemaining } = useGalleryContext();
  
  if (process.env.NODE_ENV !== 'development') return null; // Only show in development
  
  const ageMinutes = lastFetchTime ? Math.floor((Date.now() - lastFetchTime) / 60000) : null;
  const remainingMinutes = cacheTimeRemaining ? Math.floor(cacheTimeRemaining / 60000) : null;
  
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      background: '#000',
      color: '#0f0',
      padding: '12px',
      borderRadius: '8px',
      fontSize: '10px',
      fontFamily: 'monospace',
      maxWidth: '250px',
      zIndex: 9999,
      maxHeight: '200px',
      overflowY: 'auto'
    }}>
      <div><strong>Gallery Debug</strong></div>
      <div>Loading: {isLoading ? '🔄' : '✅'}</div>
      <div>Folders: {folders.length}</div>
      <div>Images: {images.length}</div>
      <div>Error: {error ? '❌ ' + error : 'None'}</div>
      <div>Age: {ageMinutes !== null ? `${ageMinutes}m` : 'N/A'}</div>
      <div>Cache TTL: {remainingMinutes !== null ? `${remainingMinutes}m` : 'N/A'}</div>
      <div style={{ marginTop: '8px', fontSize: '9px', opacity: 0.7 }}>
        Check browser console for logs
      </div>
    </div>
  );
}

export default GalleryDebug;
