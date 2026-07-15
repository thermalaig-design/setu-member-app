import React, { useEffect, useState } from 'react';
import { Calendar, Home as HomeIcon, Menu, X, ChevronRight, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { useAppTheme } from './context/ThemeContext';
import {
  facilitiesConfig,
  getFacilitiesSnapshot,
  loadFacilitiesPage
} from './services/facilitiesStore';

const LEGACY_ATTACHMENT_SEPARATOR = '||::||';

const formatTimestamp = (createdAt, updatedAt) => {
  const value = updatedAt || createdAt;
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
};

const isLikelyUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isDataUrl = (value) => /^data:/i.test(String(value || '').trim());

const getAttachmentUrl = (attachment) => {
  if (typeof attachment === 'string') {
    const value = attachment.trim();
    if (!value) return '';
    if (value.includes(LEGACY_ATTACHMENT_SEPARATOR)) {
      const [, payload = ''] = value.split(LEGACY_ATTACHMENT_SEPARATOR);
      return String(payload || '').trim();
    }
    return value;
  }
  if (!attachment || typeof attachment !== 'object') return '';
  const value = String(attachment.url || attachment.path || attachment.href || '').trim();
  if (!value) return '';
  if (value.includes(LEGACY_ATTACHMENT_SEPARATOR)) {
    const [, payload = ''] = value.split(LEGACY_ATTACHMENT_SEPARATOR);
    return String(payload || '').trim();
  }
  return value;
};

const getAttachmentLabel = (attachment, idx) => {
  if (typeof attachment === 'object' && attachment) {
    const label = String(attachment.name || attachment.title || '').trim();
    if (label) return label;
  }

  if (typeof attachment === 'string' && attachment.includes(LEGACY_ATTACHMENT_SEPARATOR)) {
    const [name = ''] = attachment.split(LEGACY_ATTACHMENT_SEPARATOR);
    const cleanName = String(name || '').trim();
    if (cleanName) return cleanName;
  }

  const url = getAttachmentUrl(attachment);
  if (!url) return `Attachment ${idx + 1}`;
  if (isDataUrl(url)) return `Attachment ${idx + 1}`;

  try {
    const parsed = new URL(url);
    const last = (parsed.pathname || '').split('/').filter(Boolean).pop();
    return decodeURIComponent(last || `Attachment ${idx + 1}`);
  } catch {
    return `Attachment ${idx + 1}`;
  }
};

const getAttachmentType = (url) => {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return 'other';
  if (value.startsWith('data:image/')) return 'image';
  if (value.startsWith('data:application/pdf')) return 'pdf';

  const clean = value.split('?')[0].split('#')[0];
  if (/\.(png|jpe?g|jfif|gif|webp|bmp|svg)$/.test(clean)) return 'image';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'other';
};

const getOptimizedImageUrl = (url, width = 900) => {
  const source = String(url || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('supabase')) {
      const marker = '/storage/v1/object/public/';
      if (parsed.pathname.includes(marker)) {
        parsed.pathname = parsed.pathname.replace(marker, '/storage/v1/render/image/public/');
      }
      if (!parsed.searchParams.has('width')) parsed.searchParams.set('width', String(width));
      if (!parsed.searchParams.has('quality')) parsed.searchParams.set('quality', '72');
      if (!parsed.searchParams.has('resize')) parsed.searchParams.set('resize', 'cover');
      return parsed.toString();
    }

    if (host.includes('cloudinary.com') || host.includes('res.cloudinary.com')) {
      parsed.searchParams.set('w', String(width));
      parsed.searchParams.set('q', 'auto');
      parsed.searchParams.set('f', 'auto');
      return parsed.toString();
    }
  } catch {
    return source;
  }
  return source;
};

const Facilities = ({ onNavigate }) => {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const FACILITIES_SCROLL_KEY = 'facilities_scroll_y';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const syncFromStore = (trustId) => {
    const snapshot = getFacilitiesSnapshot(trustId);
    setFacilities(Array.isArray(snapshot.facilities) ? snapshot.facilities : []);
  };

  const loadPage = async ({ trustId, page, forceRefresh = false, trustName = null }) => {
    if (!trustId) {
      setFacilities([]);
      return;
    }
    const res = await loadFacilitiesPage({
      trustId,
      trustName,
      page,
      pageSize: facilitiesConfig.PAGE_SIZE,
      forceRefresh
    });
    syncFromStore(trustId);
    // Defensive fallback: if scoped cache read misses for any transient key mismatch,
    // still render the API payload so UI never appears blank.
    if (Array.isArray(res?.facilities) && res.facilities.length > 0) {
      const latestSnapshot = getFacilitiesSnapshot(trustId);
      const snapshotRows = Array.isArray(latestSnapshot?.facilities) ? latestSnapshot.facilities : [];
      if (snapshotRows.length === 0) {
        setFacilities(res.facilities);
      }
    }
    console.log(
      '[Facilities][Debug] page=',
      page,
      'returned_ids=',
      Array.isArray(res?.facilities) ? res.facilities.map((n) => n?.id).filter(Boolean) : []
    );
    if (res?.debug) {
      console.log('[Facilities][Debug] trust=', res.debug.trustId, 'page=', res.debug.page, 'pageSize=', res.debug.pageSize);
    }
    if (res?.error) setError(res.error);
  };

  useEffect(() => {
    if (isMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';
    } else {
      const scrollY = parseInt(document.body.style.top || '0', 10) * -1;
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.scrollTo(0, scrollY);
    }

    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
    };
  }, [isMenuOpen]);

  const loadFacilities = async ({ forceRefresh = false } = {}) => {
    try {
      setError('');
      const trustId = localStorage.getItem('selected_trust_id') || null;
      const trustName = localStorage.getItem('selected_trust_name') || null;
      if (!trustId) {
        setFacilities([]);
        setLoading(false);
        return;
      }

      const snapshot = getFacilitiesSnapshot(trustId);
      if (!forceRefresh && Array.isArray(snapshot.facilities) && snapshot.facilities.length > 0) {
        setFacilities(snapshot.facilities);
        setLoading(false);
      } else {
        setLoading(true);
      }

      await loadPage({ trustId, trustName, page: 1, forceRefresh });
    } catch (err) {
      setError(err?.message || 'Failed to fetch facilities');
      setFacilities([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedScrollY = Number(sessionStorage.getItem(FACILITIES_SCROLL_KEY) || 0);
    if (savedScrollY > 0) {
      window.requestAnimationFrame(() => {
        window.scrollTo(0, savedScrollY);
      });
    }
    loadFacilities({ forceRefresh: false });
    const handleTrustChanged = () => {
      sessionStorage.removeItem(FACILITIES_SCROLL_KEY);
      window.scrollTo(0, 0);
      loadFacilities({ forceRefresh: false });
    };
    window.addEventListener('trust-changed', handleTrustChanged);
    return () => {
      window.removeEventListener('trust-changed', handleTrustChanged);
    };
  }, []);

  const openFacilityDetail = (facilityId) => {
    const id = String(facilityId || '').trim();
    if (!id) return;
    sessionStorage.setItem(FACILITIES_SCROLL_KEY, String(window.scrollY || 0));
    navigate(`/facilities/${encodeURIComponent(id)}`);
  };

  return (
    <div className={`min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`} style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-50 shadow-sm pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl transition-colors pointer-events-auto"
          style={{ background: 'transparent' }}
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Facilities</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: 'var(--navbar-text)', background: 'transparent' }}
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      {isMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-0 z-25 lg:hidden"
          onClick={() => setIsMenuOpen(false)}
          style={{ pointerEvents: 'auto' }}
        />
      )}

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="facilities"
      />

      {!loading && !error && facilities.length > 0 && (
        <div className="px-6 pb-2">
          <p className="text-[11px] font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
            {facilities.length} active facilit{facilities.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
      )}

      {loading && (
        <div className="px-6 py-4 space-y-4 animate-pulse">
          {[1, 2, 3].map((item) => (
            <div key={item} className="rounded-2xl p-5 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
              <div className="h-3 rounded w-1/3 mb-3" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
              <div className="h-4 rounded w-2/3 mb-2" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
              <div className="h-3 rounded w-full" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="px-6 py-10">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <h3 className="font-bold text-red-800">Unable to load facilities</h3>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button
              onClick={() => loadFacilities({ forceRefresh: true })}
              className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="px-6 py-4 space-y-4">
          {facilities.map((facility, index) => {
            const dateLabel = formatTimestamp(facility.created_at, facility.updated_at);
            const rawAttachments = Array.isArray(facility.attachments) ? facility.attachments : [];
            const normalizedAttachments = rawAttachments
              .map((attachment, idx) => {
                const url = getAttachmentUrl(attachment);
                if (!url || (!isLikelyUrl(url) && !isDataUrl(url))) return null;
                return {
                  id: `${facility.id}_att_${idx}`,
                  url,
                  label: getAttachmentLabel(attachment, idx),
                  type: getAttachmentType(url),
                };
              })
              .filter(Boolean);
            const attachCount = normalizedAttachments.length;
            const firstAttachment = attachCount > 0 ? normalizedAttachments[0] : null;
            const optimizedImageUrl = firstAttachment?.type === 'image'
              ? getOptimizedImageUrl(firstAttachment.url)
              : '';
            const shouldPrioritizeImage = index < 2;
            return (
                <button
                  key={facility.id}
                  onClick={() => openFacilityDetail(facility.id)}
                  className="w-full text-left rounded-2xl p-4 sm:p-5 border transition-all hover:shadow-md active:scale-[0.995] border-l-4 shadow-sm"
                  style={{
                  borderLeftColor: theme.primary,
                  borderColor: 'var(--advertisement-card-border)',
                  background: 'var(--advertisement-card-bg)'
                }}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    
                  {dateLabel && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold whitespace-nowrap" style={{ color: 'var(--advertisement-subtitle)' }}>
                      <Calendar className="h-3 w-3" />
                      {dateLabel}
                    </div>
                  )}
                </div>

                <h3 className="font-bold text-lg mb-2 leading-tight" style={{ color: 'var(--advertisement-title)' }}>
                  {facility.name}
                </h3>

                {facility.description && (
                  <div className="mb-4">
                    <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--advertisement-description)' }}>
                      {facility.description}
                    </p>
                  </div>
                )}

                {firstAttachment && (
                  <div
                    className="mb-3 rounded-xl overflow-hidden border"
                    style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                  >
                    {firstAttachment.type === 'image' ? (
                      <img
                        src={optimizedImageUrl || firstAttachment.url}
                        alt={firstAttachment.label}
                        loading={shouldPrioritizeImage ? 'eager' : 'lazy'}
                        fetchPriority={shouldPrioritizeImage ? 'high' : 'auto'}
                        decoding="async"
                        className="w-full h-36 object-cover bg-slate-100"
                      />
                    ) : (
                      <div
                        className="h-16 px-3 flex items-center gap-2 text-xs font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--surface-color) 70%, var(--app-accent-bg))', color: 'var(--body-text-color)' }}
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span>{firstAttachment.type === 'pdf' ? 'PDF Preview Available' : 'File Attachment'}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div />
                  <div className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: theme.primary }}>
                    Tap to view details
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </button>
            );
          })}

          {facilities.length === 0 && (
            <div className="text-center py-20">
              <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
                <FileText className="h-8 w-8" style={{ color: 'var(--advertisement-subtitle)' }} />
              </div>
              <h3 className="font-bold" style={{ color: 'var(--advertisement-title)' }}>No facilities available right now.</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>Please check again later.</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default Facilities;
