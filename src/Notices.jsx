import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronRight, Download, Eye, FileText, Home as HomeIcon, Loader2, Menu, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Sidebar from './components/Sidebar';
import { useAppTheme } from './context/ThemeContext';
import {
  getNoticeboardCacheStatus,
  getNoticeboardSnapshot,
  loadNoticeboardPage,
  noticeboardConfig,
  readNoticeboardProgress,
  clearAllNoticeboardCache
} from './services/noticeboardStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const LEGACY_ATTACHMENT_SEPARATOR = '||::||';
const MIN_PDF_SCALE = 0.75;
const MAX_PDF_SCALE = 2.25;
const PDF_SCALE_STEP = 0.15;

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

const getDayStart = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getNoticePriority = (notice, todayStartTs) => {
  const startTs = getDayStart(notice?.start_date);
  const endTs = getDayStart(notice?.end_date);
  const effectiveStart = startTs ?? endTs;
  const effectiveEnd = endTs ?? startTs;

  if (effectiveStart != null && todayStartTs < effectiveStart) return 'upcoming';
  if (effectiveEnd != null && todayStartTs > effectiveEnd) return 'past';
  if (effectiveStart != null || effectiveEnd != null) return 'live';
  return 'unknown';
};

const sortNoticesByTimeline = (input) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStartTs = today.getTime();
  const priorityWeight = { live: 0, upcoming: 1, past: 2, unknown: 3 };
  const list = Array.isArray(input) ? [...input] : [];

  return list.sort((a, b) => {
    const aPriority = getNoticePriority(a, todayStartTs);
    const bPriority = getNoticePriority(b, todayStartTs);
    const weightDiff = (priorityWeight[aPriority] ?? 99) - (priorityWeight[bPriority] ?? 99);
    if (weightDiff !== 0) return weightDiff;

    const aStart = getDayStart(a?.start_date);
    const bStart = getDayStart(b?.start_date);
    const aEnd = getDayStart(a?.end_date);
    const bEnd = getDayStart(b?.end_date);

    // For upcoming, nearest start date first so users can see what's coming next.
    if (aPriority === 'upcoming') {
      const byStartAsc = (aStart ?? Number.MAX_SAFE_INTEGER) - (bStart ?? Number.MAX_SAFE_INTEGER);
      if (byStartAsc !== 0) return byStartAsc;
    }

    // For live and past, latest notice first.
    const byStartDesc = (bStart ?? Number.MIN_SAFE_INTEGER) - (aStart ?? Number.MIN_SAFE_INTEGER);
    if (byStartDesc !== 0) return byStartDesc;
    const byEndDesc = (bEnd ?? Number.MIN_SAFE_INTEGER) - (aEnd ?? Number.MIN_SAFE_INTEGER);
    if (byEndDesc !== 0) return byEndDesc;

    const byUpdatedDesc = new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime();
    if (byUpdatedDesc !== 0) return byUpdatedDesc;

    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
};

const resolveTrustContextForNotices = () => {
  const selectedTrustId = String(localStorage.getItem('selected_trust_id') || '').trim();
  const selectedTrustName = String(localStorage.getItem('selected_trust_name') || '').trim();
  if (selectedTrustId) {
    return { trustId: selectedTrustId, trustName: selectedTrustName || null };
  }

  try {
    const rawUser = localStorage.getItem('user');
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    const memberships = Array.isArray(parsedUser?.hospital_memberships) ? parsedUser.hospital_memberships : [];
    const preferredMembership =
      memberships.find((m) => m?.is_active && m?.trust_id) ||
      memberships.find((m) => m?.trust_id) ||
      null;

    const fallbackTrustId = String(
      preferredMembership?.trust_id ||
      parsedUser?.primary_trust?.id ||
      parsedUser?.trust?.id ||
      ''
    ).trim();
    const fallbackTrustName = String(
      preferredMembership?.trust_name ||
      parsedUser?.primary_trust?.name ||
      parsedUser?.trust?.name ||
      ''
    ).trim();

    if (fallbackTrustId) {
      localStorage.setItem('selected_trust_id', fallbackTrustId);
      if (fallbackTrustName) localStorage.setItem('selected_trust_name', fallbackTrustName);
      return { trustId: fallbackTrustId, trustName: fallbackTrustName || null };
    }
  } catch {
    // ignore malformed user cache
  }

  return { trustId: null, trustName: null };
};

const getInitialNoticeboardState = () => {
  const { trustId } = resolveTrustContextForNotices();
  if (!trustId) {
    return {
      notices: [],
      loading: true,
      hasMoreNotices: true,
      selectedTrustId: ''
    };
  }

  const snapshot = getNoticeboardSnapshot(trustId);
  const cachedNotices = Array.isArray(snapshot?.notices) ? snapshot.notices : [];

  return {
    notices: cachedNotices,
    loading: cachedNotices.length === 0,
    hasMoreNotices: cachedNotices.length > 0 ? Boolean(snapshot.hasMoreNotices) : true,
    selectedTrustId: trustId
  };
};

const Notices = ({ onNavigate }) => {
  const navigate = useNavigate();
  const theme = useAppTheme();
  const NOTICE_SCROLL_KEY = 'noticeboard_scroll_y';
  const initialNoticeboardState = useMemo(() => getInitialNoticeboardState(), []);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [notices, setNotices] = useState(initialNoticeboardState.notices);
  const [loading, setLoading] = useState(initialNoticeboardState.loading);
  const [error, setError] = useState('');
  const [selectedTrustId, setSelectedTrustId] = useState(initialNoticeboardState.selectedTrustId);
  const [hasMoreNotices, setHasMoreNotices] = useState(initialNoticeboardState.hasMoreNotices);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewPdf, setPreviewPdf] = useState(null);
  const latestLoadRequestRef = useRef(0);
  const missingTrustRetryRef = useRef(0);
  const missingTrustTimerRef = useRef(null);
  const sortedNotices = useMemo(() => sortNoticesByTimeline(notices), [notices]);

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

  const syncFromStore = (trustId) => {
    const snapshot = getNoticeboardSnapshot(trustId);
    setNotices(Array.isArray(snapshot.notices) ? snapshot.notices : []);
    setHasMoreNotices(Boolean(snapshot.hasMoreNotices));
  };

  const loadPage = async ({ trustId, page, forceRefresh = false, trustName = null, canApplyState = () => true }) => {
    if (!trustId) {
      setNotices([]);
      setHasMoreNotices(false);
      return;
    }
    const res = await loadNoticeboardPage({
      trustId,
      trustName,
      page,
      pageSize: noticeboardConfig.PAGE_SIZE,
      forceRefresh
    });
    if (canApplyState()) syncFromStore(trustId);
    const progress = readNoticeboardProgress(trustId);
    console.log(
      '[Noticeboard][Debug] page=',
      page,
      'hasMoreNotices=',
      Boolean(progress.hasMoreNotices),
      'returned_ids=',
      Array.isArray(res?.notices) ? res.notices.map((n) => n?.id).filter(Boolean) : [],
      'returned_types=',
      Array.isArray(res?.notices) ? res.notices.map((n) => n?.type).filter(Boolean) : []
    );
    if (res?.debug) {
      console.log(
        '[Noticeboard][Debug] trust=',
        res.debug.trustId,
        'member=',
        res.debug.memberId || null
      );
    }
    if (res?.error && canApplyState()) setError(res.error);
    return res;
  };

  const openPdfPreview = (attachment) => {
    if (!attachment?.url) return;
    setPreviewPdf(attachment);
  };

  const closePdfPreview = () => {
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

  const loadNotices = async ({ forceRefresh = false } = {}) => {
    const requestId = Date.now();
    latestLoadRequestRef.current = requestId;
    const isStale = () => latestLoadRequestRef.current !== requestId;
    try {
      if (!isStale()) setError('');
      const { trustId, trustName } = resolveTrustContextForNotices();
      if (!isStale()) setSelectedTrustId(trustId || '');

      if (!trustId) {
        if (missingTrustTimerRef.current) {
          clearTimeout(missingTrustTimerRef.current);
          missingTrustTimerRef.current = null;
        }
        // selected_trust_id can arrive a bit late after route mount; auto-retry a few times.
        if (!forceRefresh && missingTrustRetryRef.current < 4) {
          missingTrustRetryRef.current += 1;
          if (!isStale()) setLoading(true);
          missingTrustTimerRef.current = setTimeout(() => {
            loadNotices({ forceRefresh: false });
          }, 450);
        }
        const isRetryScheduled = !forceRefresh && missingTrustRetryRef.current > 0 && missingTrustRetryRef.current <= 4;
        if (!isStale() && notices.length === 0 && !isRetryScheduled) {
          setNotices([]);
          setHasMoreNotices(false);
          setLoading(false);
        }
        return;
      }
      missingTrustRetryRef.current = 0;
      if (missingTrustTimerRef.current) {
        clearTimeout(missingTrustTimerRef.current);
        missingTrustTimerRef.current = null;
      }

      // Show cached notices immediately if available (avoids blank flash)
      const snapshot = getNoticeboardSnapshot(trustId);
      const cacheStatus = getNoticeboardCacheStatus(trustId, 1);
      const hasCachedNotices = snapshot.hasCachedData && Array.isArray(snapshot.notices) && snapshot.notices.length > 0;
      if (!forceRefresh && hasCachedNotices) {
        if (!isStale()) {
          setNotices(snapshot.notices);
          setHasMoreNotices(Boolean(snapshot.hasMoreNotices));
          setLoading(false);
        }
        if (cacheStatus.isPageFresh) {
          return;
        }
      } else {
        // No valid cache or forceRefresh → show spinner
        if (!isStale()) setLoading(true);
      }

      const pageRes = await loadPage({ trustId, trustName, page: 1, forceRefresh, canApplyState: () => !isStale() });
      if (isStale()) return;

      // Always sync from store after fetch to pick up latest data
      syncFromStore(trustId);
      const postSyncSnapshot = getNoticeboardSnapshot(trustId);
      const postSyncNotices = Array.isArray(postSyncSnapshot?.notices) ? postSyncSnapshot.notices : [];
      if (postSyncNotices.length === 0 && Array.isArray(pageRes?.notices) && pageRes.notices.length > 0) {
        // Fallback: if cache/store is unavailable, hydrate UI directly from API response.
        setNotices(pageRes.notices);
        setHasMoreNotices(Boolean(pageRes.hasMore));
      }

      // If still empty after first fetch, bust cache and retry once
      if (!forceRefresh) {
        const afterSnapshot = getNoticeboardSnapshot(trustId);
        if (!Array.isArray(afterSnapshot.notices) || afterSnapshot.notices.length === 0) {
          console.log('[Noticeboard] Empty result after first fetch, retrying with forceRefresh=true');
          const retryRes = await loadPage({ trustId, trustName, page: 1, forceRefresh: true, canApplyState: () => !isStale() });
          if (isStale()) return;
          syncFromStore(trustId);
          const retrySnapshot = getNoticeboardSnapshot(trustId);
          const retryNotices = Array.isArray(retrySnapshot?.notices) ? retrySnapshot.notices : [];
          if (retryNotices.length === 0 && Array.isArray(retryRes?.notices) && retryRes.notices.length > 0) {
            setNotices(retryRes.notices);
            setHasMoreNotices(Boolean(retryRes.hasMore));
          }
        }
      }
    } catch (err) {
      if (!isStale()) {
        setError(err?.message || 'Failed to fetch notices');
        setNotices([]);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  useEffect(() => {
    const savedScrollY = Number(sessionStorage.getItem(NOTICE_SCROLL_KEY) || 0);
    if (savedScrollY > 0) {
      window.requestAnimationFrame(() => {
        window.scrollTo(0, savedScrollY);
      });
    }
    loadNotices({ forceRefresh: false });
    const handleTrustChanged = () => {
      sessionStorage.removeItem(NOTICE_SCROLL_KEY);
      loadNotices({ forceRefresh: false });
    };
    const handleStorage = (event) => {
      if (event?.key === 'selected_trust_id') {
        sessionStorage.removeItem(NOTICE_SCROLL_KEY);
        loadNotices({ forceRefresh: false });
      }
    };
    window.addEventListener('trust-changed', handleTrustChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      if (missingTrustTimerRef.current) {
        clearTimeout(missingTrustTimerRef.current);
        missingTrustTimerRef.current = null;
      }
      window.removeEventListener('trust-changed', handleTrustChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const handleLoadMore = async () => {
    if (loadingMore || loading || !hasMoreNotices || !selectedTrustId) return;
    try {
      setLoadingMore(true);
      const progress = readNoticeboardProgress(selectedTrustId);
      const nextPage = Number(progress?.nextPage) > 0 ? Number(progress.nextPage) : 2;
      const moreRes = await loadPage({ trustId: selectedTrustId, page: nextPage, forceRefresh: false, trustName: localStorage.getItem('selected_trust_name') || null });
      const snapshot = getNoticeboardSnapshot(selectedTrustId);
      const snapshotNotices = Array.isArray(snapshot?.notices) ? snapshot.notices : [];
      if (snapshotNotices.length === 0 && Array.isArray(moreRes?.notices) && moreRes.notices.length > 0) {
        setNotices((prev) => {
          const prevList = Array.isArray(prev) ? prev : [];
          const byId = new Map(prevList.map((n) => [String(n?.id || ''), n]));
          for (const n of moreRes.notices) byId.set(String(n?.id || ''), n);
          return [...byId.values()].filter(Boolean);
        });
        setHasMoreNotices(Boolean(moreRes.hasMore));
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const openNoticeDetail = (noticeId) => {
    const id = String(noticeId || '').trim();
    if (!id) return;
    sessionStorage.setItem(NOTICE_SCROLL_KEY, String(window.scrollY || 0));
    navigate(`/notices/${encodeURIComponent(id)}`);
  };

  return (
    <div className={`min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`} style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-50 shadow-sm pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl transition-colors pointer-events-auto"
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Notice Board</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: 'var(--navbar-text)' }}
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
        currentPage="notices"
      />

      {!loading && !error && sortedNotices.length > 0 && (
        <div className="px-6 pb-2">
          <p className="text-[11px] font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
            {sortedNotices.length} notice{sortedNotices.length === 1 ? '' : 's'}
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
            <h3 className="font-bold text-red-800">Unable to load notices</h3>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button
              onClick={() => loadNotices({ forceRefresh: true })}
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
          {sortedNotices.map((notice) => {
            const dateLabel = formatDateRange(notice.start_date, notice.end_date);
            const rawAttachments = Array.isArray(notice.attachments) ? notice.attachments : [];
            const normalizedAttachments = rawAttachments
              .map((attachment, idx) => {
                const url = getAttachmentUrl(attachment);
                if (!url || (!isLikelyUrl(url) && !isDataUrl(url))) return null;
                return {
                  index: idx,
                  id: `${notice.id}_att_${idx}`,
                  url,
                  label: getAttachmentLabel(attachment, idx),
                  downloadName: getAttachmentDownloadName(attachment, idx),
                  type: getAttachmentType(url),
                };
              })
              .filter(Boolean);
            const attachCount = normalizedAttachments.length;
            const firstAttachment = attachCount > 0 ? normalizedAttachments[0] : null;
            return (
            <article
              key={notice.id}
              role="button"
              tabIndex={0}
              onClick={() => openNoticeDetail(notice.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openNoticeDetail(notice.id);
                }
              }}
              className="w-full text-left rounded-2xl p-4 sm:p-5 border transition-all hover:shadow-md active:scale-[0.995] border-l-4 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent"
              style={{
                borderLeftColor: theme.primary,
                borderColor: 'var(--advertisement-card-border)',
                background: 'var(--advertisement-card-bg)'
              }}
              aria-label={`Open notice ${notice.name}`}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                {/* <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full inline-flex items-center gap-1"
                  style={{ color: theme.primary, background: `color-mix(in srgb, ${theme.primary} 12%, white)` }}
              >
                  NOTICE
                </span> */}
                {dateLabel && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold whitespace-nowrap" style={{ color: 'var(--advertisement-subtitle)' }}>
                    <Calendar className="h-3 w-3" />
                    {dateLabel}
                  </div>
                )}
              </div>

              <h3 className="font-bold text-lg mb-2 leading-tight" style={{ color: 'var(--advertisement-title)' }}>
                {notice.name}
              </h3>

              {notice.description && (
                <div className="mb-4">
                  <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--advertisement-description)' }}>
                    {notice.description}
                  </p>
                </div>
              )}

              {firstAttachment && (
                <div
                  className="mb-3 rounded-xl border px-3 py-3"
                  style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)' }}
                >
                  {firstAttachment.type === 'image' ? (
                    <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-[color:var(--advertisement-card-bg)] flex items-center justify-center" >
                      <img
                        src={firstAttachment.url}
                        alt={firstAttachment.label}
                        loading="lazy"
                        className="block h-full w-full object-contain shadow-sm"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                      <div
                        className="hidden absolute inset-0 min-h-32 w-full items-center justify-center rounded-xl px-3 py-6 text-xs font-semibold text-slate-600"
                        style={{ background: 'color-mix(in srgb, var(--surface-color) 74%, var(--app-accent-bg))' }}
                      >
                        Image unavailable
                      </div>
                    </div>
                  ) : firstAttachment.type === 'pdf' ? (
                    <div className="p-4 sm:p-5" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--surface-color)', borderRadius: '12px' }}>
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${theme.primary} 12%, var(--surface-color))` }}>
                          <FileText className="h-5 w-5" style={{ color: theme.primary }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold" style={{ color: 'var(--advertisement-title)' }}>
                            {firstAttachment.label}
                          </p>
                          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--advertisement-subtitle)' }}>
                            PDF document
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPdfPreview(firstAttachment);
                          }}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                          style={{ background: theme.primary, color: '#fff' }}
                          aria-label={`Open ${firstAttachment.label}`}
                        >
                          <Eye className="h-4 w-4" />
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadAttachment(firstAttachment, firstAttachment.index);
                          }}
                          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-[0.98]"
                          style={{ background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))', color: 'var(--advertisement-title)' }}
                          aria-label={`Download ${firstAttachment.label}`}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="h-16 px-3 flex items-center gap-2 text-xs font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--surface-color) 70%, var(--app-accent-bg))', color: 'var(--body-text-color)' }}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span>File Attachment</span>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: theme.primary }}>
                  Tap to view details
                  <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </article>
            );
          })}

          {sortedNotices.length === 0 && (
            <div className="text-center py-20">
              <div className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border shadow-sm" style={{ background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}>
                <FileText className="h-8 w-8" style={{ color: 'var(--advertisement-subtitle)' }} />
              </div>
              <h3 className="font-bold" style={{ color: 'var(--advertisement-title)' }}>No active notices right now</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>You're all caught up.</p>
              <button
                onClick={() => {
                  clearAllNoticeboardCache();
                  loadNotices({ forceRefresh: true });
                }}
                className="mt-5 px-5 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
                style={{ background: 'var(--app-accent-bg)', color: 'var(--brand-navy, #1e3a5f)' }}
              >
                🔄 Refresh Notices
              </button>
            </div>
          )}

          {sortedNotices.length > 0 && hasMoreNotices && (
            <div className="pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-3 rounded-xl border text-sm font-semibold disabled:opacity-60"
                style={{ color: theme.primary, background: 'var(--advertisement-card-bg)', borderColor: 'var(--advertisement-card-border)' }}
              >
                {loadingMore ? 'Loading more notices...' : 'Load more notices'}
              </button>
            </div>
          )}
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

export default Notices;

