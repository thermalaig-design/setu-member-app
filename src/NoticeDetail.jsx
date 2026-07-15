import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, Download, Eye, FileText, Home as HomeIcon, Loader2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useAppTheme } from './context/ThemeContext';
import { getNoticeboardSnapshot, loadNoticeDetail } from './services/noticeboardStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SWIPE_THRESHOLD_PX = 44;
const MAX_DRAG_TRANSLATE_PX = 72;
const MIN_PDF_SCALE = 0.75;
const MAX_PDF_SCALE = 2.25;
const PDF_SCALE_STEP = 0.15;
const getCurrentTimestamp = () => Date.now();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getTouchDistance = (touches) => {
  if (!touches || touches.length < 2) return 0;
  const [first, second] = touches;
  const dx = Number(second?.clientX || 0) - Number(first?.clientX || 0);
  const dy = Number(second?.clientY || 0) - Number(first?.clientY || 0);
  return Math.hypot(dx, dy);
};

const sanitizeFileName = (value) => String(value || '')
  .trim()
  .replace(/[<>:"/\\|?*]/g, '_')
  .replace(/\s+/g, ' ')
  .replace(/\.+$/g, '')
  .slice(0, 120) || 'attachment';

const formatDateRange = (startDate, endDate) => {
  const toLabel = (value) => {
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

  const start = toLabel(startDate);
  const end = toLabel(endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Till ${end}`;
  return '';
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
    if (!(event.ctrlKey || event.metaKey)) return;
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
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-[2px] sm:px-5" onClick={onClose}>
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
          className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
          style={{
            background: 'color-mix(in srgb, var(--advertisement-card-bg) 90%, var(--app-accent-bg))',
            borderColor: 'var(--advertisement-card-border)'
          }}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>PDF Preview</p>
            <h3 className="truncate text-sm font-bold sm:text-base" style={{ color: 'var(--advertisement-title)' }}>
              {attachment?.label || 'Document'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(attachment)}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-accent-bg))', color: 'var(--advertisement-title)' }}
              aria-label="Download PDF"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--brand-red-light) 52%, white)', color: 'var(--brand-red-dark)' }}
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
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

const NoticeDetail = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const { noticeId } = useParams();
  const [notice, setNotice] = useState(null);
  const [noticeList, setNoticeList] = useState([]);
  const [currentNoticeIndex, setCurrentNoticeIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPdf, setPreviewPdf] = useState(null);
  const [dragTranslateX, setDragTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartXRef = useRef(null);
  const touchEndXRef = useRef(null);
  const lastInteractionTsRef = useRef(0);
  const isTouchHoldingRef = useRef(false);
  const selectedTrustId = useMemo(() => localStorage.getItem('selected_trust_id') || '', []);

  useEffect(() => {
    if (!previewPdf) return undefined;

    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.touchAction = 'none';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreviewPdf(null);
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
  }, [previewPdf]);

  useEffect(() => {
    const loadDetail = async () => {
      setError('');
      setLoading(true);
      const trustId = localStorage.getItem('selected_trust_id') || selectedTrustId || '';
      const trustName = localStorage.getItem('selected_trust_name') || null;
      if (!trustId || !noticeId) {
        setNotice(null);
        setLoading(false);
        setError('Notice not found');
        return;
      }

      const snapshot = getNoticeboardSnapshot(trustId);
      const listFromSnapshot = Array.isArray(snapshot?.notices) ? snapshot.notices : [];
      setNoticeList(listFromSnapshot);
      const idxFromSnapshot = listFromSnapshot.findIndex((item) => String(item?.id || '') === String(noticeId));
      if (idxFromSnapshot >= 0) setCurrentNoticeIndex(idxFromSnapshot);
      const fromList = snapshot?.noticesById?.[String(noticeId)] || null;
      if (fromList) setNotice(fromList);

      const detailRes = await loadNoticeDetail({
        trustId,
        trustName,
        noticeId: String(noticeId),
        forceRefresh: false
      });

      if (detailRes?.error) {
        setError(detailRes.error);
      } else if (detailRes?.notice) {
        setNotice(detailRes.notice);
        setNoticeList((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          const targetId = String(detailRes.notice?.id || '');
          const idx = prev.findIndex((item) => String(item?.id || '') === targetId);
          if (idx < 0) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], ...detailRes.notice };
          return next;
        });
      } else if (!fromList) {
        setError('Notice not found');
      }
      setPreviewImage(null);
      setLoading(false);
    };

    loadDetail();
  }, [noticeId, selectedTrustId]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/notices', { replace: true });
  };

  const onCardTouchStart = (event) => {
    if (!Array.isArray(noticeList) || noticeList.length <= 1) return;
    isTouchHoldingRef.current = true;
    lastInteractionTsRef.current = getCurrentTimestamp();
    touchStartXRef.current = event.touches?.[0]?.clientX ?? null;
    touchEndXRef.current = touchStartXRef.current;
    setIsDragging(true);
    setDragTranslateX(0);
  };

  const onCardTouchMove = (event) => {
    if (!isDragging) return;
    const currentX = event.touches?.[0]?.clientX ?? null;
    touchEndXRef.current = currentX;
    const start = touchStartXRef.current;
    if (start == null || currentX == null) return;
    const rawDelta = currentX - start;
    const boundedDelta = Math.max(-MAX_DRAG_TRANSLATE_PX, Math.min(MAX_DRAG_TRANSLATE_PX, rawDelta));
    setDragTranslateX(boundedDelta);
  };

  const onCardTouchEnd = () => {
    if (!Array.isArray(noticeList) || noticeList.length <= 1) return;
    isTouchHoldingRef.current = false;
    lastInteractionTsRef.current = getCurrentTimestamp();
    setIsDragging(false);
    const start = touchStartXRef.current;
    const end = touchEndXRef.current;
    setDragTranslateX(0);
    if (start == null || end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta < 0) setCurrentNoticeIndex((prev) => (prev + 1) % noticeList.length);
    else setCurrentNoticeIndex((prev) => (prev - 1 + noticeList.length) % noticeList.length);
  };

  const onCardPointerDown = () => {
    if (!Array.isArray(noticeList) || noticeList.length <= 1) return;
    isTouchHoldingRef.current = true;
    lastInteractionTsRef.current = getCurrentTimestamp();
  };

  const onCardPointerUp = () => {
    if (!Array.isArray(noticeList) || noticeList.length <= 1) return;
    isTouchHoldingRef.current = false;
    lastInteractionTsRef.current = getCurrentTimestamp();
  };

  const openImagePreview = (attachment) => {
    if (!attachment?.url) return;
    lastInteractionTsRef.current = getCurrentTimestamp();
    setPreviewImage(attachment);
  };

  const closeImagePreview = () => {
    lastInteractionTsRef.current = getCurrentTimestamp();
    setPreviewImage(null);
  };

  const openPdfPreview = (attachment) => {
    if (!attachment?.url) return;
    lastInteractionTsRef.current = getCurrentTimestamp();
    setPreviewPdf(attachment);
  };

  const closePdfPreview = () => {
    lastInteractionTsRef.current = getCurrentTimestamp();
    setPreviewPdf(null);
  };

  const downloadAttachment = async (attachment, idx = 0) => {
    const url = getAttachmentUrl(attachment);
    if (!url) return;

    const fileName = attachment?.downloadName || getAttachmentDownloadName(attachment, idx);

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

  const hasCarousel = Array.isArray(noticeList) && noticeList.length > 0;
  const boundedNoticeIndex = hasCarousel
    ? ((currentNoticeIndex % noticeList.length) + noticeList.length) % noticeList.length
    : 0;
  const activeNotice = hasCarousel ? (noticeList[boundedNoticeIndex] || notice) : notice;

  const dateLabel = formatDateRange(activeNotice?.start_date, activeNotice?.end_date);
  const attachments = Array.isArray(activeNotice?.attachments) ? activeNotice.attachments : [];
  const normalizedAttachments = attachments
    .map((attachment, idx) => {
      const url = getAttachmentUrl(attachment);
      if (!url || (!isLikelyUrl(url) && !isDataUrl(url))) return null;
      return {
        index: idx,
        id: `${activeNotice?.id || 'notice'}_att_${idx}`,
        url,
        label: getAttachmentLabel(attachment, idx),
        downloadName: getAttachmentDownloadName(attachment, idx),
        type: getAttachmentType(url),
      };
    })
    .filter(Boolean);

  return (
    <div className="min-h-screen pb-8" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={handleBack}
          className="p-2 rounded-xl transition-colors"
          aria-label="Back to notice board"
        >
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Notice Details</h1>
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
            <h3 className="font-bold" style={{ color: 'var(--brand-red-dark)' }}>Unable to load notice</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
            >
              Back to Notice Board
            </button>
          </div>
        )}

        {!loading && !error && activeNotice && (
          <div
            className="rounded-2xl border p-5 shadow-sm border-l-4"
            style={{
              borderLeftColor: theme.primary,
              borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)',
              background: 'var(--advertisement-card-bg)',
              transform: `translate3d(${dragTranslateX}px, 0, 0)`,
              opacity: Math.max(0.9, 1 - Math.abs(dragTranslateX) / 280),
              transition: isDragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 220ms ease'
            }}
            onTouchStart={onCardTouchStart}
            onTouchMove={onCardTouchMove}
            onTouchEnd={onCardTouchEnd}
            onTouchCancel={onCardTouchEnd}
            onPointerDown={onCardPointerDown}
            onPointerUp={onCardPointerUp}
            onPointerCancel={onCardPointerUp}
            onPointerLeave={onCardPointerUp}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              {/* <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full inline-flex items-center gap-1"
                style={{ color: theme.primary, background: `color-mix(in srgb, ${theme.primary} 12%, white)` }}
              >
                NOTICE
              </span> */}
              {dateLabel && (
                <div className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--advertisement-subtitle)' }}>
                  <Calendar className="h-3.5 w-3.5" />
                  {dateLabel}
                </div>
              )}
            </div>

            <h2 className="text-xl font-bold leading-tight" style={{ color: 'var(--advertisement-title)' }}>
              {activeNotice.name}
            </h2>

            <p className="mt-4 text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--advertisement-description)' }}>
              {activeNotice.description || 'No description provided.'}
            </p>

            {normalizedAttachments.length > 0 && (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--advertisement-title)' }}>Attachments ({normalizedAttachments.length})</h3>
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
                              className="hidden absolute inset-0 min-h-44 w-full items-center justify-center rounded-xl px-3 py-6 text-xs font-semibold text-slate-600"
                              style={{ background: 'color-mix(in srgb, var(--surface-color) 74%, var(--app-accent-bg))' }}
                            >
                              Image unavailable
                            </div>
                          </div>
                          <div className="absolute bottom-3 right-3 rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm" style={{ background: 'rgba(15, 23, 42, 0.72)', color: '#fff' }}>
                            Tap to open
                          </div>
                        </button>
                      )}

                      {attachment.type === 'pdf' && (
                        <div className="p-4 sm:p-5" style={{background: 'var(--advertisement-card-bg)', border: '1px solid var(--surface-color)', borderRadius: '12px' }}>
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${theme.primary} 12%, var(--surface-color))` }}>
                              <FileText className="h-5 w-5" style={{ color: theme.primary }} />
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
                              onClick={() => openPdfPreview(attachment)}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                              style={{ background: theme.primary, color: '#fff' }}
                              aria-label={`Open ${attachment.label}`}
                            >
                              <Eye className="h-4 w-4" />
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadAttachment(attachment, attachment.index)}
                              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                              style={{ background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))', color: 'var(--advertisement-title)' }}
                              aria-label={`Download ${attachment.label}`}
                            >
                              <Download className="h-4 w-4" />
                              Download
                            </button>
                          </div>
                        </div>
                      )}

                      {attachment.type === 'other' && (
                        <div className="flex items-center gap-2 p-3 bg-slate-50 text-slate-700">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate flex-1">File attachment</span>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
              </div>
            )}
            {noticeList.length > 1 && (
              <div className="pt-4 flex items-center justify-center gap-2">
                {noticeList.map((item, idx) => {
                  const active = idx === currentNoticeIndex;
                  return (
                    <button
                      key={item?.id || idx}
                      onClick={() => {
                        lastInteractionTsRef.current = getCurrentTimestamp();
                        setCurrentNoticeIndex(idx);
                      }}
                      className="rounded-full transition-all"
                      style={{
                        width: active ? 16 : 6,
                        height: 6,
                        background: active ? theme.primary : 'color-mix(in srgb, var(--body-text-color) 25%, transparent)',
                      }}
                      aria-label={`Go to notice ${idx + 1}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!loading && !error && !notice && (
          <div className="text-center py-20">
            <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
              <FileText className="h-8 w-8" style={{ color: 'var(--advertisement-subtitle)' }} />
            </div>
            <h3 className="font-bold" style={{ color: 'var(--advertisement-title)' }}>Notice not found</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>This notice may no longer be available.</p>
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 px-4 py-6"
          onClick={closeImagePreview}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full p-2 text-white"
            onClick={closeImagePreview}
            aria-label="Close image preview"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            className="flex max-h-full w-full max-w-5xl items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={previewImage.url}
              alt={previewImage.label}
              className="max-h-[88vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}

      {previewPdf && (
        <PdfPreviewModal
          key={previewPdf?.url || previewPdf?.id || 'notice-pdf-preview'}
          attachment={previewPdf}
          theme={theme}
          onClose={closePdfPreview}
          onDownload={downloadAttachment}
        />
      )}
    </div>
  );
};

export default NoticeDetail;
