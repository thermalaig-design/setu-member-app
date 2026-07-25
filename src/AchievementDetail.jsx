import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, FileText, Home as HomeIcon, Link as LinkIcon, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { supabase } from './services/supabaseClient';
import ImageSlider from './components/ImageSlider';

const normalizeText = (value) => String(value || '').trim();

const formatDateTime = (value) => {
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

const getAttachmentUrl = (attachment) => {
  if (typeof attachment === 'string') return attachment.trim();
  if (!attachment || typeof attachment !== 'object') return '';
  return String(attachment.url || attachment.path || attachment.href || '').trim();
};

const getAttachmentLabel = (attachment, idx) => {
  if (typeof attachment === 'object' && attachment) {
    const name = normalizeText(attachment.name || attachment.title);
    if (name) return name;
  }
  const url = getAttachmentUrl(attachment);
  if (!url) return `Attachment ${idx + 1}`;
  try {
    const parsed = new URL(url);
    const part = parsed.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(part || `Attachment ${idx + 1}`);
  } catch {
    return `Attachment ${idx + 1}`;
  }
};

const isImageUrl = (url) => {
  const clean = String(url || '').trim().toLowerCase().split('?')[0].split('#')[0];
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(clean);
};

const buildAchievementAttachments = (item) => {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  return attachments
    .map((attachment, idx) => {
      const url = getAttachmentUrl(attachment);
      if (!url) return null;
      return {
        id: `${item?.id || 'achievement'}-attachment-${idx}`,
        url,
        label: getAttachmentLabel(attachment, idx),
        type: isImageUrl(url) ? 'image' : 'file',
      };
    })
    .filter(Boolean);
};

const resolveTrustContext = () => {
  const selectedTrustId = normalizeText(localStorage.getItem('selected_trust_id'));
  const selectedTrustName = normalizeText(localStorage.getItem('selected_trust_name'));
  if (selectedTrustId) return { trustId: selectedTrustId, trustName: selectedTrustName || null };

  try {
    const parsed = JSON.parse(localStorage.getItem('user') || '{}');
    const memberships = Array.isArray(parsed?.hospital_memberships) ? parsed.hospital_memberships : [];
    const preferred = memberships.find((m) => m?.is_active && m?.trust_id) || memberships.find((m) => m?.trust_id) || null;
    const trustId = normalizeText(preferred?.trust_id || parsed?.primary_trust?.id || parsed?.trust?.id);
    const trustName = normalizeText(preferred?.trust_name || parsed?.primary_trust?.name || parsed?.trust?.name);
    if (!trustId) return { trustId: null, trustName: null };
    localStorage.setItem('selected_trust_id', trustId);
    if (trustName) localStorage.setItem('selected_trust_name', trustName);
    return { trustId, trustName: trustName || null };
  } catch {
    return { trustId: null, trustName: null };
  }
};

const clampIndex = (index, length) => {
  const total = Number(length) > 0 ? Number(length) : 0;
  if (total <= 0) return 0;
  const candidate = Number(index);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, Math.min(total - 1, candidate));
};

const PAGE_SCROLL_LOCK_STATE = {
  count: 0,
  snapshot: null,
};

const lockPageScroll = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const html = document.documentElement;
  const body = document.body;

  if (PAGE_SCROLL_LOCK_STATE.count === 0) {
    PAGE_SCROLL_LOCK_STATE.snapshot = {
      scrollY: window.scrollY,
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyTop: body.style.top,
      bodyTouchAction: body.style.touchAction,
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.top = `-${window.scrollY}px`;
    body.style.touchAction = 'none';
  }

  PAGE_SCROLL_LOCK_STATE.count += 1;

  return () => {
    PAGE_SCROLL_LOCK_STATE.count = Math.max(0, PAGE_SCROLL_LOCK_STATE.count - 1);
    if (PAGE_SCROLL_LOCK_STATE.count > 0) return;

    const snapshot = PAGE_SCROLL_LOCK_STATE.snapshot;
    PAGE_SCROLL_LOCK_STATE.snapshot = null;
    if (!snapshot) return;

    html.style.overflow = snapshot.htmlOverflow;
    body.style.overflow = snapshot.bodyOverflow;
    body.style.position = snapshot.bodyPosition;
    body.style.width = snapshot.bodyWidth;
    body.style.top = snapshot.bodyTop;
    body.style.touchAction = snapshot.bodyTouchAction;
    window.scrollTo(0, snapshot.scrollY);
  };
};

const AchievementImagePreviewModal = ({ images, initialIndex = 0, achievementName, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, images.length));
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragDeltaXRef = useRef(0);

  useEffect(() => {
    if (!Array.isArray(images) || images.length === 0) return undefined;

    const releaseScroll = lockPageScroll();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key === 'ArrowRight' && images.length > 1) {
        setActiveIndex((prev) => (prev + 1) % images.length);
      } else if (event.key === 'ArrowLeft' && images.length > 1) {
        setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      releaseScroll();
    };
  }, [images, onClose]);

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
      setActiveIndex((prev) => (prev + 1) % images.length);
    } else if (delta >= threshold) {
      setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
    }
    dragStartXRef.current = 0;
    dragDeltaXRef.current = 0;
    setDragX(0);
    setIsDragging(false);
  };

  if (!Array.isArray(images) || images.length === 0) return null;

  const currentImage = images[activeIndex] || images[0];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 px-3 py-4 backdrop-blur-[2px] sm:px-5" onClick={onClose}>
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
            {/* <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--advertisement-subtitle)' }}>
              
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
          className="relative h-[78vh] max-h-[82vh] overflow-hidden bg-black sm:h-[80vh]"
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
          {/* <button
            type="button"
            onClick={() => setActiveIndex((prev) => (prev - 1 + images.length) % images.length)}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border p-2.5 text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: 'rgba(15, 23, 42, 0.35)', borderColor: 'rgba(255,255,255,0.18)' }}
            disabled={images.length <= 1}
            aria-label="Previous image"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setActiveIndex((prev) => (prev + 1) % images.length)}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border p-2.5 text-white transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ background: 'rgba(15, 23, 42, 0.35)', borderColor: 'rgba(255,255,255,0.18)' }}
            disabled={images.length <= 1}
            aria-label="Next image"
          >
            <ChevronRight className="h-5 w-5" />
          </button> */}

          <div
            className="flex h-full transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(calc(-${activeIndex * 100}% + ${dragX}px))`,
              transition: isDragging ? 'none' : 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)'
            }}
          >
            {images.map((image, index) => (
              <div
                key={image?.id || index}
                className="flex h-full w-full flex-shrink-0 items-center justify-center"
                style={{ background: 'var(--advertisement-card-bg)', minWidth: '100%' }}
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

const AchievementDetail = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const { achievementId } = useParams();
  const initialTrust = resolveTrustContext();
  const [selectedTrustId, setSelectedTrustId] = useState(() => initialTrust.trustId || '');
  const [achievement, setAchievement] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(initialTrust.trustId && String(achievementId || '').trim()));
  const [error, setError] = useState('');
  const [previewImages, setPreviewImages] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const currentAchievementId = String(achievementId || '').trim();
  const hasQueryContext = Boolean(selectedTrustId && currentAchievementId);
  const showLoading = loading && hasQueryContext;

  useEffect(() => {
    const syncTrust = () => {
      const trust = resolveTrustContext();
      setSelectedTrustId(trust.trustId || '');
    };

    syncTrust();
    window.addEventListener('trust-changed', syncTrust);
    window.addEventListener('storage', syncTrust);
    return () => {
      window.removeEventListener('trust-changed', syncTrust);
      window.removeEventListener('storage', syncTrust);
    };
  }, []);

  useEffect(() => {
    if (!selectedTrustId || !currentAchievementId) return undefined;

    let cancelled = false;

    const loadAchievement = async () => {
      setLoading(true);
      setError('');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const { data, error: fetchError } = await supabase
        .from('achievements')
        .select('id, trust_id, name, description, attachments, status, created_at, updated_at')
        .eq('trust_id', selectedTrustId)
        .eq('status', 'active')
        .eq('id', currentAchievementId)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeout);

      if (cancelled) return;

      if (fetchError) {
        setAchievement(null);
        setError(fetchError.name === 'AbortError' ? 'Loading is taking too long. Please retry.' : (fetchError.message || 'Failed to load achievement'));
        setLoading(false);
        return;
      }

      if (!data) {
        setAchievement(null);
        setError('Achievement not found');
        setLoading(false);
        return;
      }

      setAchievement(data);
      setLoading(false);
    };

    loadAchievement();

    return () => {
      cancelled = true;
    };
  }, [currentAchievementId, selectedTrustId]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/achievements', { replace: true });
  };

  const attachments = useMemo(() => buildAchievementAttachments(achievement), [achievement]);
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image');
  const fileAttachments = attachments.filter((attachment) => attachment.type !== 'image');
  const dateLabel = formatDateTime(achievement?.created_at || achievement?.updated_at);

  const openImagePreview = (index = 0) => {
    if (imageAttachments.length === 0) return;
    const safeIndex = clampIndex(index, imageAttachments.length);
    setPreviewImages(imageAttachments);
    setPreviewIndex(safeIndex);
  };

  const closeImagePreview = () => {
    setPreviewImages([]);
    setPreviewIndex(0);
  };

  return (
    <div className="min-h-screen pb-8" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={handleBack}
          className="p-2 rounded-xl transition-colors"
          aria-label="Back to achievements"
        >
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Achievement Details</h1>
        <button
          onClick={() => onNavigate?.('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: 'var(--navbar-text)' }}
          aria-label="Go to home"
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 pt-6 pb-10">
        {showLoading && (
          <div className="rounded-2xl border p-5 shadow-sm animate-pulse" style={{ borderColor: 'var(--advertisement-card-border)', background: 'var(--advertisement-card-bg)' }}>
            <div className="h-4 w-24 rounded mb-4" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-6 w-3/4 rounded mb-3" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-1/2 rounded mb-4" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-full rounded mb-2" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-4 w-11/12 rounded" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
          </div>
        )}

        {!showLoading && error && (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--brand-red-light)', border: '1px solid color-mix(in srgb, var(--brand-red) 25%, transparent)' }}>
            <h3 className="font-bold" style={{ color: 'var(--brand-red-dark)' }}>Unable to load achievement</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
            >
              Back to Achievements
            </button>
          </div>
        )}

        {!showLoading && !error && achievement && (
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
              {achievement.name}
            </h2>

            <p className="mt-4 text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--advertisement-description)' }}>
              {achievement.description || 'No description provided.'}
            </p>

            {imageAttachments.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="space-y-3">
                  <ImageSlider
                    images={imageAttachments}
                    autoPlayInterval={5000}
                    onNavigate={() => openImagePreview(0)}
                  />

                  
                </div>
              </div>
            )}

            {fileAttachments.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <p className="text-[10px] uppercase tracking-[0.16em] mb-2" style={{ color: 'var(--advertisement-subtitle)' }}>
                  Attachments
                </p>
                <div className="space-y-2">
                  {fileAttachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors"
                      style={{
                        borderColor: 'var(--advertisement-card-border)',
                        color: 'var(--advertisement-title)',
                        background: 'color-mix(in srgb, var(--advertisement-card-bg) 88%, var(--page-bg))'
                      }}
                    >
                      <LinkIcon size={12} />
                      <span>{attachment.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {!imageAttachments.length && !fileAttachments.length && (
              <div className="mt-6 rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--advertisement-card-border)', color: 'var(--advertisement-subtitle)', background: 'color-mix(in srgb, var(--advertisement-card-bg) 88%, var(--page-bg))' }}>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>No attachments available.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {!showLoading && !error && !achievement && (
          <div className="text-center py-20">
            <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
              <FileText className="h-8 w-8" style={{ color: 'var(--advertisement-subtitle)' }} />
            </div>
            <h3 className="font-bold" style={{ color: 'var(--advertisement-title)' }}>Achievement not found</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>This achievement may no longer be available for your access.</p>
          </div>
        )}
      </div>

      {previewImages.length > 0 && (
        <AchievementImagePreviewModal
          key={`${previewIndex}-${previewImages[0]?.id || 'preview'}-${previewImages.length}`}
          images={previewImages}
          initialIndex={previewIndex}
          achievementName={achievement?.name}
          onClose={closeImagePreview}
        />
      )}
    </div>
  );
};

export default AchievementDetail;
