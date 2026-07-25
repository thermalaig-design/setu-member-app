import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, FileText, Home as HomeIcon, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { getFacilitiesSnapshot, loadFacilityDetail } from './services/facilitiesStore';
import ImageSlider from './components/ImageSlider';

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
const LEGACY_ATTACHMENT_SEPARATOR = '||::||';

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

  const value = getAttachmentUrl(attachment);
  if (!value) return `Attachment ${idx + 1}`;
  if (isDataUrl(value)) return `Attachment ${idx + 1}`;
  if (!isLikelyUrl(value)) return value;

  try {
    const url = new URL(value);
    const last = (url.pathname || '').split('/').filter(Boolean).pop();
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

const clampIndex = (index, length) => {
  const total = Number(length) > 0 ? Number(length) : 0;
  if (total <= 0) return 0;
  const candidate = Number(index);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, Math.min(total - 1, candidate));
};

const FacilityImagePreviewModal = ({ images, initialIndex = 0, theme, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, images.length));
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragDeltaXRef = useRef(0);

  useEffect(() => {
    setActiveIndex(clampIndex(initialIndex, images.length));
    setDragX(0);
    dragDeltaXRef.current = 0;
    setIsDragging(false);
  }, [initialIndex, images.length]);

  useEffect(() => {
    if (!Array.isArray(images) || images.length === 0) return undefined;

    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.touchAction = 'none';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowRight') {
        setActiveIndex((prev) => (prev + 1) % images.length);
      } else if (event.key === 'ArrowLeft') {
        setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.removeEventListener('keydown', onKeyDown);
      window.scrollTo(0, scrollY);
    };
  }, [images, onClose]);

  const goNext = () => {
    if (!Array.isArray(images) || images.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % images.length);
  };

  const goPrev = () => {
    if (!Array.isArray(images) || images.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const startGesture = (clientX) => {
    if (!Array.isArray(images) || images.length <= 1) return;
    setIsDragging(true);
    dragStartXRef.current = clientX;
    dragDeltaXRef.current = 0;
    setDragX(0);
  };

  const moveGesture = (clientX) => {
    if (!isDragging) return;
    const delta = clientX - dragStartXRef.current;
    dragDeltaXRef.current = delta;
    setDragX(delta);
  };

  const endGesture = () => {
    if (!isDragging) return;
    const delta = dragDeltaXRef.current;
    const threshold = 60;
    if (delta <= -threshold) {
      goNext();
    } else if (delta >= threshold) {
      goPrev();
    }
    dragStartXRef.current = 0;
    dragDeltaXRef.current = 0;
    setDragX(0);
    setIsDragging(false);
  };

  if (!Array.isArray(images) || images.length === 0) return null;

  const currentImage = images[activeIndex] || images[0];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 px-3 py-4 backdrop-blur-[2px] sm:px-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl overflow-hidden rounded-3xl border shadow-2xl"
        style={{
          background: 'var(--advertisement-card-bg)',
          borderColor: 'color-mix(in srgb, var(--brand-navy) 14%, transparent)',
          boxShadow: '0 28px 80px rgba(2, 6, 23, 0.35)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
          style={{
            background: 'color-mix(in srgb, var(--advertisement-card-bg) 90%, var(--app-accent-bg))',
            borderColor: 'var(--advertisement-card-border)'
          }}
        >
          <div className="min-w-0">
            {/* <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
              Image Preview
            </p> */}
            <h3 className="truncate uppercase text-sm font-bold sm:text-base w-[9rem] sm:w-[32rem] lg:w-full" style={{ color: 'var(--advertisement-title)' }}>
              Image Preview
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-accent-bg))',
                color: 'var(--advertisement-card-bg)'
              }}
            >
              {activeIndex + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--brand-red-light) 52%, white)', color: 'var(--brand-red-dark)' }}
              aria-label="Close image preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="relative h-[78vh] max-h-[82vh] overflow-hidden bg-slate-100 sm:h-[80vh]"
          style={{ touchAction: 'pan-y' }}
          onTouchStart={(event) => startGesture(Number(event?.touches?.[0]?.clientX || 0))}
          onTouchMove={(event) => {
            if (!isDragging) return;
            event.preventDefault();
            moveGesture(Number(event?.touches?.[0]?.clientX || 0));
          }}
          onTouchEnd={endGesture}
          onTouchCancel={endGesture}
          onMouseDown={(event) => startGesture(Number(event?.clientX || 0))}
          onMouseMove={(event) => {
            if (!isDragging) return;
            moveGesture(Number(event?.clientX || 0));
          }}
          onMouseUp={endGesture}
          onMouseLeave={endGesture}
        >
          <div
            className="flex h-full transition-transform duration-300 ease-out "
            style={{
              transform: `translateX(calc(-${activeIndex * 100}% + ${dragX}px))`,
              transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)'
            }}
          >
            {images.map((image, index) => (
              <div
                key={image?.id || index}
                className="flex h-full w-full flex-shrink-0 items-center justify-center"
                style={{ 
                background: 'var(--advertisement-card-bg)', minWidth: '100%' }}
              >
                <img
                  src={image.url}
                  alt={image.label || `Image ${index + 1}`}
                  draggable={false}
                  className="max-h-[78vh] max-w-full select-none object-contain px-2 py-2 sm:max-h-[80vh]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const FacilityDetail = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const { facilityId } = useParams();
  const [facility, setFacility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewImages, setPreviewImages] = useState([]);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const selectedTrustId = useMemo(() => localStorage.getItem('selected_trust_id') || '', []);
  const currentFacilityId = String(facilityId || '').trim();

  useEffect(() => {
    const loadDetail = async () => {
      setError('');
      setLoading(true);
      const trustId = localStorage.getItem('selected_trust_id') || selectedTrustId || '';
      const trustName = localStorage.getItem('selected_trust_name') || null;
      if (!trustId || !currentFacilityId) {
        setFacility(null);
        setLoading(false);
        setError('Facility not found');
        return;
      }

      const snapshot = getFacilitiesSnapshot(trustId);
      const fromList = snapshot?.facilitiesById?.[String(currentFacilityId)] || null;
      if (fromList) setFacility(fromList);

      const detailRes = await loadFacilityDetail({
        trustId,
        trustName,
        facilityId: String(currentFacilityId),
        forceRefresh: false
      });

      if (detailRes?.error) {
        setError(detailRes.error);
      } else if (detailRes?.facility) {
        setFacility(detailRes.facility);
      } else {
        setFacility(null);
        setError('Facility not found');
      }
      setLoading(false);
    };

    loadDetail();
  }, [currentFacilityId, selectedTrustId]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/facilities', { replace: true });
  };

  const dateLabel = formatTimestamp(facility?.created_at, facility?.updated_at);
  const attachments = Array.isArray(facility?.attachments) ? facility.attachments : [];
  const normalizedAttachments = attachments
    .map((attachment, idx) => {
      const url = getAttachmentUrl(attachment);
      if (!url || (!isLikelyUrl(url) && !isDataUrl(url))) return null;
      return {
        id: `${facility?.id || 'facility'}_att_${idx}`,
        url,
        label: getAttachmentLabel(attachment, idx),
        type: getAttachmentType(url),
      };
    })
    .filter(Boolean);
  const imageAttachments = normalizedAttachments.filter((attachment) => attachment.type === 'image');

  const openImagePreview = (index = 0) => {
    if (imageAttachments.length === 0) return;
    const safeIndex = clampIndex(index, imageAttachments.length);
    setPreviewImages(imageAttachments);
    setPreviewImageIndex(safeIndex);
  };

  const closeImagePreview = () => {
    setPreviewImages([]);
    setPreviewImageIndex(0);
  };

  return (
    <div className="min-h-screen pb-8" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={handleBack}
          className="p-2 rounded-xl transition-colors"
          aria-label="Back to facilities"
        >
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Facility Details</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: 'var(--navbar-text)' }}
          aria-label="Go to home"
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 pt-6 pb-10">
        {loading && (
          <div className="rounded-2xl border p-5 shadow-sm animate-pulse" style={{ borderColor: 'var(--advertisement-card-border)', background: 'var(--advertisement-card-bg)' }}>
            <div className="h-4 w-24 rounded mb-4" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-6 w-3/4 rounded mb-3" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-1/2 rounded mb-4" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-full rounded mb-2" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-11/12 rounded" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--brand-red-light)', border: '1px solid color-mix(in srgb, var(--brand-red) 25%, transparent)' }}>
            <h3 className="font-bold" style={{ color: 'var(--brand-red-dark)' }}>Unable to load facility</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
            >
              Back to Facilities
            </button>
          </div>
        )}

        {!loading && !error && facility && (
          <div
            className="rounded-2xl border p-5 shadow-sm border-l-4"
            style={{
              borderLeftColor: theme.primary,
              borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)',
              background: 'var(--advertisement-card-bg)'
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              {dateLabel && (
                <div className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--advertisement-subtitle)' }}>
                  <Calendar className="h-3.5 w-3.5" />
                  {dateLabel}
                </div>
              )}
            </div>

            <h2 className="text-xl font-bold leading-tight" style={{ color: 'var(--advertisement-title)' }}>
              {facility.name}
            </h2>

            <p className="mt-4 text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--advertisement-description)' }}>
              {facility.description || 'No description provided.'}
            </p>

            {normalizedAttachments.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="space-y-3">
                  {/* Image Carousel */}
                  {normalizedAttachments.filter(a => a.type === 'image').length > 0 && (
                    <ImageSlider 
                      images={imageAttachments}
                      autoPlayInterval={5000}
                      onImageClick={(index) => openImagePreview(index)}
                    />
                  )}

                  {/* PDF and other attachments */}
                  {normalizedAttachments.filter(a => a.type !== 'image').map((attachment) => (
                    <div
                      key={attachment.id}
                      className="rounded-xl border overflow-hidden"
                      style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                    >
                      {attachment.type === 'pdf' && (
                        <div className="w-full h-56 bg-slate-50">
                          <iframe
                            title={attachment.label}
                            src={attachment.url}
                            className="w-full h-full border-0"
                          />
                        </div>
                      )}

                      {attachment.type === 'other' && (
                        <div className="flex items-center gap-2 p-3 bg-slate-50 text-slate-700">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate flex-1">{attachment.label}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && !facility && (
          <div className="text-center py-20">
            <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
              <FileText className="h-8 w-8" style={{ color: 'var(--advertisement-subtitle)' }} />
            </div>
            <h3 className="font-bold" style={{ color: 'var(--advertisement-title)' }}>Facility not found</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>This facility may no longer be available for your access.</p>
          </div>
        )}
      </div>

      {previewImages.length > 0 && (
        <FacilityImagePreviewModal
          images={previewImages}
          initialIndex={previewImageIndex}
          theme={theme}
          onClose={closeImagePreview}
        />
      )}
    </div>
  );
};

export default FacilityDetail;
