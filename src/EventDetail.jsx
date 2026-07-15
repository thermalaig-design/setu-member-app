import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Calendar, Clock3, Download, Eye, FileText, Loader2, MapPin, Paperclip, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useAppTheme } from './context/ThemeContext';
import { loadEventDetail } from './services/eventsStore';
import { formatEventDate, formatTimeRange } from './services/eventsService';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const LEGACY_ATTACHMENT_SEPARATOR = '||::||';

const Section = ({ icon, label, children, theme }) => {
  const IconComponent = icon;
  return (
    <div className="rounded-2xl p-4 shadow-sm border" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <IconComponent className="h-4 w-4 shrink-0" style={{ color: theme.primary }} />
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: theme.primary }}>{label}</p>
      </div>
      <div className="text-sm leading-relaxed" style={{ color: 'var(--advertisement-description)' }}>{children}</div>
    </div>
  );
};

const sanitizeFileName = (value) => String(value || '')
  .trim()
  .replace(/[<>:"/\\|?*]/g, '_')
  .replace(/\s+/g, ' ')
  .replace(/\.+$/g, '')
  .slice(0, 120) || 'attachment';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getTouchDistance = (touches) => {
  if (!touches || touches.length < 2) return 0;
  const [first, second] = touches;
  const dx = Number(second?.clientX || 0) - Number(first?.clientX || 0);
  const dy = Number(second?.clientY || 0) - Number(first?.clientY || 0);
  return Math.hypot(dx, dy);
};

const isLikelyUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());
const isDataUrl = (value) => /^data:/i.test(String(value || '').trim());

const MIN_PDF_SCALE = 0.75;
const MAX_PDF_SCALE = 2.25;
const PDF_SCALE_STEP = 0.15;

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
  const value = String(url || '').toLowerCase();
  const clean = value.split('?')[0].split('#')[0];
  if (value.startsWith('data:image/')) return 'image';
  if (value.startsWith('data:application/pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(clean)) return 'image';
  if (/\.(pdf)$/.test(clean)) return 'pdf';
  return 'other';
};

const getFileExtensionFromUrl = (url) => {
  const clean = String(url || '').split('?')[0].split('#')[0].trim();
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  return match ? `.${match[1].toLowerCase()}` : '';
};

const getAttachmentDownloadName = (attachment, idx) => {
  const label = sanitizeFileName(getAttachmentLabel(attachment, idx));
  const url = getAttachmentUrl(attachment);
  const type = getAttachmentType(url);
  const hasExtension = /\.[a-z0-9]{1,5}$/i.test(label);
  if (hasExtension) return label;

  const extension = getFileExtensionFromUrl(url) || (type === 'pdf' ? '.pdf' : '');
  return extension ? `${label}${extension}` : label;
};

const buildPdfFallbackSrc = (url, scale) => {
  const zoom = Math.round(clamp(scale, MIN_PDF_SCALE, MAX_PDF_SCALE) * 100);
  const joiner = String(url || '').includes('#') ? '&' : '#';
  return `${url}${joiner}toolbar=0&navpanes=0&view=FitH&zoom=${zoom}`;
};

const PdfPage = ({ pdfDocument, pageNumber, scale }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;

    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current) return;

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        const outputScale = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale });
        const renderViewport = page.getViewport({ scale: scale * outputScale });

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport: renderViewport
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled) {
          console.error('Error rendering PDF page:', error);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfDocument, pageNumber, scale]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto block max-w-full rounded-2xl bg-white shadow-lg"
      style={{ boxShadow: '0 16px 40px rgba(15, 23, 42, 0.12)' }}
    />
  );
};

const PdfPreviewModal = ({ attachment, theme, onClose, onDownload }) => {
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [scale, setScale] = useState(1);
  const pinchStartRef = useRef({ distance: 0, scale: 1 });
  const scaleRef = useRef(1);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    if (!attachment?.url) return undefined;

    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.touchAction = 'none';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
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
  }, [attachment?.url, onClose]);

  useEffect(() => {
    if (!attachment?.url) return undefined;

    let active = true;

    const loadingTask = pdfjsLib.getDocument({ url: attachment.url });

    loadingTask.promise
      .then((doc) => {
        if (!active) {
          doc.destroy?.();
          return;
        }
        setPdfDocument(doc);
        setPageCount(doc.numPages || 0);
        setLoadingPdf(false);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load PDF preview:', error);
        setLoadError(error?.message || 'Failed to load PDF preview');
        setLoadingPdf(false);
      });

    return () => {
      active = false;
      loadingTask.destroy?.();
    };
  }, [attachment?.url]);

  useEffect(() => {
    return () => {
      pdfDocument?.destroy?.();
    };
  }, [pdfDocument]);

  const adjustScale = (nextScale) => {
    setScale((current) => {
      const value = typeof nextScale === 'function' ? nextScale(current) : nextScale;
      return clamp(value, MIN_PDF_SCALE, MAX_PDF_SCALE);
    });
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -PDF_SCALE_STEP : PDF_SCALE_STEP;
    adjustScale((current) => current + delta);
  };

  const handleTouchStart = (event) => {
    if (event.touches?.length !== 2) return;
    pinchStartRef.current = {
      distance: getTouchDistance(event.touches),
      scale: scaleRef.current
    };
  };

  const handleTouchMove = (event) => {
    if (event.touches?.length !== 2 || !pinchStartRef.current.distance) return;
    event.preventDefault();
    const currentDistance = getTouchDistance(event.touches);
    if (!currentDistance) return;
    const nextScale = pinchStartRef.current.scale * (currentDistance / pinchStartRef.current.distance);
    setScale(clamp(nextScale, MIN_PDF_SCALE, MAX_PDF_SCALE));
  };

  const handleTouchEnd = (event) => {
    if ((event.touches?.length || 0) < 2) {
      pinchStartRef.current = { distance: 0, scale: scaleRef.current };
    }
  };

  const pdfSrc = loadError ? buildPdfFallbackSrc(attachment?.url, scale) : attachment?.url;

  return (
    <div className="fixed inset-0 z-[999] flex items-stretch justify-center px-0 py-0 backdrop-blur-[2px] sm:items-center sm:px-3 sm:py-4" style={{ background: 'color-mix(in srgb, var(--brand-navy-dark) 82%, transparent)' }} onClick={onClose}>
      <div
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-none border shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-3xl"
        style={{
          background: 'var(--advertisement-card-bg)',
          borderColor: 'var(--advertisement-card-border)',
          boxShadow: '0 28px 80px rgba(2, 6, 23, 0.35)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          style={{
            background: 'color-mix(in srgb, var(--advertisement-card-bg) 90%, var(--app-accent-bg))',
            borderColor: 'var(--advertisement-card-border)'
          }}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
              PDF Preview
            </p>
            <h3 className="truncate text-sm font-bold sm:text-base" style={{ color: 'var(--advertisement-title)' }}>
              {attachment?.label || 'Document'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(attachment)}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
              aria-label={`Download ${attachment?.label}`}
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-accent-bg))', color: 'var(--advertisement-title)' }}
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </div>

        <div
          className="max-h-[82vh] overflow-y-auto overscroll-contain bg-slate-100 px-3 py-4 sm:px-5"
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={{ touchAction: 'pan-y' }}
        >
          {loadingPdf && !loadError && (
            <div className="flex min-h-[42vh] items-center justify-center rounded-2xl border border-dashed bg-white/70" style={{ borderColor: 'var(--advertisement-card-border)' }}>
              <div className="flex items-center gap-3 text-sm font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading PDF
              </div>
            </div>
          )}

          {!loadingPdf && loadError && (
            <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: 'var(--advertisement-card-border)' }}>
              <iframe
                title={attachment?.label || 'PDF preview'}
                src={pdfSrc}
                className="h-[70vh] w-full border-0"
              />
            </div>
          )}

          {!loadingPdf && !loadError && pdfDocument && (
            <div className="space-y-5">
              {Array.from({ length: pageCount }, (_, index) => (
                <div key={`${attachment?.id || 'pdf'}_page_${index + 1}`} className="rounded-2xl bg-white p-3 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
                      Page {index + 1}
                    </span>
                  </div>
                  <PdfPage pdfDocument={pdfDocument} pageNumber={index + 1} scale={scale} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AttachmentPreviewModal = (props) => {
  if (props?.attachment?.type === 'pdf') {
    return <PdfPreviewModal key={props?.attachment?.url || props?.attachment?.id || 'pdf'} {...props} />;
  }
  return null;
};

const ImagePreviewModal = ({ attachment, onClose }) => {
  useEffect(() => {
    if (!attachment?.url) return undefined;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.documentElement.style.overscrollBehavior = '';
      document.body.style.overscrollBehavior = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [attachment?.url, onClose]);

  if (!attachment?.url) return null;

  return (
    <div
      className="fixed inset-0 z-[998] flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(0, 0, 0, 0.85)' }}
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full p-2 shadow-lg"
        style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
        onClick={onClose}
        aria-label="Close image preview"
      >
        <X className="h-6 w-6" />
      </button>

      <div
        className="flex max-h-full w-full max-w-5xl items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={attachment.url}
          alt={attachment.label}
          className="max-h-[88vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
          style={{ background: 'var(--surface-color)' }}
        />
      </div>
    </div>
  );
};

const EventDetail = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const theme = useAppTheme();

  const trustId = localStorage.getItem('selected_trust_id') || '';

  const hasRouteEventId = Boolean(eventId);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(() => hasRouteEventId);
  const [error, setError] = useState(() => (hasRouteEventId ? '' : 'Event not found.'));
  const [previewImage, setPreviewImage] = useState(null);
  const [previewAttachment, setPreviewAttachment] = useState(null);

  useEffect(() => {
    if (!eventId) return;

    let active = true;
    Promise.resolve().then(() => {
      if (active) setLoading(true);
    });

    loadEventDetail({ eventId: decodeURIComponent(eventId), trustId, forceRefresh: false })
      .then((ev) => {
        if (!active) return;
        if (ev) { setEvent(ev); }
        else { setError('Event details not available.'); }
      })
      .catch((err) => { if (active) setError(err?.message || 'Failed to load event.'); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [eventId, trustId]);

  useEffect(() => {
    if (!previewAttachment?.url) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPreviewAttachment(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewAttachment?.url]);

  const openImagePreview = (attachment) => {
    if (!attachment?.url) return;
    setPreviewAttachment(null);
    setPreviewImage(attachment);
  };

  const closeImagePreview = () => {
    setPreviewImage(null);
  };

  const dateLabel = event ? formatEventDate(event.startEventDate, event.endEventDate) : '';
  const timeLabel = event ? formatTimeRange(event.startTime, event.endTime) : '';
  const attachments = Array.isArray(event?.attachments) ? event.attachments : [];
  const normalizedAttachments = attachments
    .map((att, idx) => {
      const url = getAttachmentUrl(att);
      if (!url || (!isLikelyUrl(url) && !isDataUrl(url))) return null;
      return {
        id: `${idx}-${url}`,
        url,
        label: getAttachmentLabel(att, idx),
        downloadName: getAttachmentDownloadName(att, idx),
        type: getAttachmentType(url),
        index: idx
      };
    })
    .filter(Boolean);

  const openAttachmentPreview = (attachment) => {
    if (!attachment?.url) return;
    setPreviewImage(null);
    setPreviewAttachment(attachment);
  };

  const closeAttachmentPreview = () => {
    setPreviewAttachment(null);
  };

  const downloadAttachment = async (attachment) => {
    const url = attachment?.url;
    if (!url) return;

    const fileName = attachment?.downloadName || getAttachmentDownloadName(attachment, attachment?.index || 0);

    try {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  return (
    <div className="min-h-screen pb-10" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      {/* Navbar */}
      <div className="theme-navbar border-b px-5 py-4 flex items-center gap-3 sticky top-0 z-50 shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}>
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl transition-colors" style={{ background: 'color-mix(in srgb, var(--app-accent-bg) 40%, transparent)' }}>
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold truncate" style={{ color: 'var(--navbar-text)' }}>
            {loading ? 'Event Details' : (event?.title || 'Event Details')}
          </h1>
          {dateLabel && <p className="text-[11px] font-medium truncate" style={{ color: 'var(--advertisement-subtitle)' }}>{dateLabel}</p>}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="px-6 py-4 space-y-4 animate-pulse">
          <div className="rounded-2xl p-5 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
            <div className="h-3 rounded w-1/4 mb-3" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-5 rounded w-3/4 mb-2" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-3 rounded w-full mb-1" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            <div className="h-3 rounded w-5/6" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl p-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
              <div className="h-3 rounded w-1/3 mb-2" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
              <div className="h-4 rounded w-2/3" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 62%, var(--app-accent-bg))' }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="px-6 py-10">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <h3 className="font-bold text-red-800">Unable to load event</h3>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}>Go Back</button>
          </div>
        </div>
      )}

      {/* Content */}
      {!loading && !error && event && (
        <div className="px-6 pt-6 space-y-4">
          {/* Hero card */}
          <div className="rounded-2xl p-5 shadow-sm border-l-4" style={{ background: 'var(--advertisement-card-bg)', borderLeftColor: theme.primary, borderColor: 'var(--advertisement-card-border)' }}>
            <h2 className="text-xl font-extrabold leading-tight mb-2" style={{ color: 'var(--advertisement-title)' }}>{event.title}</h2>
            {event.description && (
              <p className="text-sm leading-relaxed" style={{ color: 'var(--advertisement-description)' }}>{event.description}</p>
            )}
          </div>

          {/* Date */}
          {dateLabel && (
            <Section icon={Calendar} label="Date" theme={theme}>
              <span className="font-semibold">{dateLabel}</span>
            </Section>
          )}

          {/* Time */}
          {timeLabel && (
            <Section icon={Clock3} label="Time" theme={theme}>
              <span className="font-semibold">{timeLabel}</span>
            </Section>
          )}

          {/* Location */}
          {event.location && (
            <Section icon={MapPin} label="Location" theme={theme}>
              {event.location}
            </Section>
          )}

          {/* Attachments */}
          {normalizedAttachments.length > 0 && (
            <Section icon={Paperclip} label={`Attachments (${normalizedAttachments.length})`} theme={theme} >
              <div className="space-y-3">
                {normalizedAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                    
                  >
                    {attachment.type === 'image' && (
                      <button
                        type="button"
                        className="relative flex w-full items-center justify-center overflow-hidden bg-[color:var(--advertisement-card-bg)] px-3 py-3"
                        onClick={() => openImagePreview(attachment)}
                        aria-label={`Open ${attachment.label}`}
                      >
                        <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-[color:var(--advertisement-card-bg)]">
                          <img
                            src={attachment.url}
                            alt={attachment.label}
                            loading="lazy"
                            className="block h-full w-full object-contain shadow-sm"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.nextElementSibling;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div
                            className="hidden absolute inset-0 min-h-44 w-full items-center justify-center rounded-xl px-3 py-6 text-xs font-semibold"
                            style={{ background: 'color-mix(in srgb, var(--surface-color) 74%, var(--app-accent-bg))', color: 'var(--advertisement-subtitle)' }}
                          >
                            Image unavailable
                          </div>
                          <div className="absolute bottom-0 right-3 rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm" style={{ background: 'rgba(15, 23, 42, 0.72)', color: '#fff' }}>
                            Tap to open
                          </div>
                        </div>
                        
                      </button>
                    )}

                    {attachment.type === 'pdf' && (
                      <div className=" p-4 sm:p-5" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--surface-color)', borderRadius: '12px' }}>
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                            style={{ background: 'color-mix(in srgb, var(--app-button-bg) 16%, var(--surface-color))' }}
                          >
                            <FileText className="h-5 w-5" style={{ color: 'var(--app-button-icon)' }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold" style={{ color: 'var(--advertisement-title)' }}>
                              {attachment.label}
                            </p>
                            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--advertisement-subtitle)' }}>
                              PDF document
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openAttachmentPreview(attachment)}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                            style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
                            aria-label={`Open ${attachment.label}`}
                          >
                            <Eye className="h-4 w-4" />
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadAttachment(attachment)}
                            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                            style={{
                              background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))',
                              color: 'var(--advertisement-title)',
                              borderColor: 'var(--advertisement-card-border)'
                            }}
                            aria-label={`Download ${attachment.label}`}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </button>
                        </div>
                      </div>
                    )}

                    {attachment.type === 'other' && (
                      <div className="p-4 sm:p-5" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--surface-color)', borderRadius: '12px' }}>
                        <div className="flex items-start gap-3">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                            style={{ background: 'color-mix(in srgb, var(--app-button-bg) 16%, var(--surface-color))' }}
                          >
                            <FileText className="h-5 w-5" style={{ color: 'var(--app-button-icon)' }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold" style={{ color: 'var(--advertisement-title)' }}>
                              {attachment.label}
                            </p>
                            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--advertisement-subtitle)' }}>
                              Document file
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => downloadAttachment(attachment)}
                            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                            // style={{
                            //   background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))',
                            //   color: 'var(--advertisement-title)',
                            //   borderColor: 'var(--advertisement-card-border)'
                            // }}
                            style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
                            aria-label={`Download ${attachment.label}`}
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          theme={theme}
          onClose={closeAttachmentPreview}
          onDownload={downloadAttachment}
        />
      )}

      {previewImage && (
        <ImagePreviewModal
          attachment={previewImage}
          theme={theme}
          onClose={closeImagePreview}
        />
      )}
    </div>
  );
};

export default EventDetail;
