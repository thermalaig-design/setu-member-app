import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, ChevronRight, Home as HomeIcon, Link as LinkIcon, Menu, X } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import Sidebar from './components/Sidebar';

const normalizeText = (value) => String(value || '').trim();

const formatDateTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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

const mergeAchievementItems = (existing, incoming) => {
  const orderedIds = [];
  const byId = new Map();

  const pushItem = (item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    if (!byId.has(id)) orderedIds.push(id);
    byId.set(id, { ...(byId.get(id) || {}), ...item, id });
  };

  (Array.isArray(existing) ? existing : []).forEach(pushItem);
  (Array.isArray(incoming) ? incoming : []).forEach(pushItem);

  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
};

const CACHE_KEY = 'achievements_cache_v1';
const CACHE_TTL_MS = 3 * 60 * 1000;
const ACHIEVEMENTS_PAGE_SIZE = 10;

const getAchievementsCacheKey = (trustId, page = 1) => {
  const normalizedTrustId = normalizeText(trustId);
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  if (!normalizedTrustId) return '';
  return `${CACHE_KEY}:${normalizedTrustId}:page:${pageNo}`;
};

const readAchievementsCache = (trustId, page = 1) => {
  const normalizedTrustId = normalizeText(trustId);
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  if (!normalizedTrustId) return null;

  const keysToTry = [getAchievementsCacheKey(normalizedTrustId, pageNo)];
  if (pageNo === 1) {
    keysToTry.push(`${CACHE_KEY}:${normalizedTrustId}`);
  }

  const parseCacheEntry = (raw) => {
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const items = parsed;
      const hasMoreAchievements = items.length >= ACHIEVEMENTS_PAGE_SIZE;
      return {
        ts: Date.now(),
        items,
        hasMoreAchievements,
        nextPage: hasMoreAchievements ? pageNo + 1 : pageNo,
        totalCount: items.length,
      };
    }
    if (!parsed?.ts || !Array.isArray(parsed?.items)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    const items = parsed.items;
    const hasMoreAchievements = items.length >= ACHIEVEMENTS_PAGE_SIZE;
    return {
      ts: parsed.ts,
      items,
      hasMoreAchievements,
      nextPage: hasMoreAchievements ? pageNo + 1 : pageNo,
      totalCount: Number(parsed.totalCount) || items.length,
    };
  };

  for (const key of keysToTry) {
    try {
      const raw = sessionStorage.getItem(key);
      const entry = parseCacheEntry(raw);
      if (entry) return entry;
    } catch {
      // ignore cache errors
    }
  }

  return null;
};

const writeAchievementsCache = (trustId, page = 1, nextState = {}) => {
  const normalizedTrustId = normalizeText(trustId);
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  if (!normalizedTrustId) return;

  const items = Array.isArray(nextState.items) ? nextState.items : [];
  const payload = {
    ts: Date.now(),
    items,
    hasMoreAchievements: Boolean(nextState.hasMoreAchievements),
    nextPage: Number(nextState.nextPage) || (nextState.hasMoreAchievements ? pageNo + 1 : pageNo),
    totalCount: Number(nextState.totalCount) || items.length,
    page: pageNo,
  };
  try {
    sessionStorage.setItem(getAchievementsCacheKey(normalizedTrustId, pageNo), JSON.stringify(payload));
    if (pageNo === 1) {
      sessionStorage.setItem(`${CACHE_KEY}:${normalizedTrustId}`, JSON.stringify(payload));
    }
  } catch {
    // ignore cache errors
  }
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

const isElementWithinViewport = (element, margin = 240) => {
  if (typeof window === 'undefined' || !element) return false;
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.top <= viewportHeight + margin && rect.bottom >= -margin;
};

const AchievementSummaryCard = ({ item, featured = false, showTimelineDot = false, onOpenDetail }) => {
  const attachments = useMemo(() => buildAchievementAttachments(item), [item]);
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image');
  const fileAttachments = attachments.filter((attachment) => attachment.type !== 'image');
  const coverImage = imageAttachments[0] || null;

  return (
    <article
      className={`relative rounded-2xl border shadow-sm ${showTimelineDot ? 'pl-4' : ''}`}
      style={{ borderColor: 'var(--advertisement-card-border)', background: 'var(--advertisement-card-bg)' }}
    >
      {showTimelineDot && (
        <div
          className="absolute -left-[22px] top-4 h-4 w-4 rounded-full border-2"
          style={{ borderColor: 'var(--app-accent-bg)', background: 'var(--surface-color)' }}
        />
      )}

      <div className={featured ? 'p-4 sm:p-5' : 'p-3.5 sm:p-4'}>
        <button
          type="button"
          onClick={() => onOpenDetail?.(item)}
          className="w-full text-left"
          aria-label={`Open achievement details for ${item.name}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
                {formatDateTime(item.updated_at || item.created_at)}
              </p>
              <h3
                className={`mt-1 line-clamp-1 ${featured ? 'text-lg font-extrabold sm:text-xl' : 'text-[15px] font-bold sm:text-base'}`}
                style={{ color: 'var(--advertisement-title)' }}
              >
                {item.name}
              </h3>
            </div>


          </div>

          <p className="mt-2 text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--advertisement-description)' }}>
            {item.description || 'No description provided.'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">

            {fileAttachments.length > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ color: 'var(--advertisement-subtitle)' }}
              >
                <LinkIcon size={11} />
                <span>
                  {fileAttachments.length} file{fileAttachments.length > 1 ? 's' : ''}
                </span>
              </span>
            )}
          </div>
        </button>

        {coverImage && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => onOpenDetail?.(item)}
              className="group w-full overflow-hidden rounded-2xl border text-left transition-transform active:scale-[0.99]"
              style={{
                borderColor: 'var(--advertisement-card-border)',
                background: 'var(--surface-color)'
              }}
              aria-label={`Open achievement details for ${item.name}`}
            >
              <div className="overflow-hidden rounded-2xl">
                <img
                  src={coverImage.url}
                  alt={coverImage.label || item.name || 'Achievement image'}
                  loading="lazy"
                  className="h-36 w-full object-cover"
                />
              </div>
              
            </button>
            
            {/* <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{
                borderColor: 'var(--advertisement-card-border)',
                color: 'var(--advertisement-title)',
                background: 'color-mix(in srgb, var(--advertisement-card-bg) 88%, var(--page-bg))'
              }}
            >
              Open details
            </span> */}
          </div>
        )}

        <button
          type="button"
          onClick={() => onOpenDetail?.(item)}
          className="w-full text-left"
          aria-label={`Open achievement details for ${item.name}`}
        >
          <div className="pt-3 mt-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
                            <div />
                            <div className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
                              Tap to view details
                              <ChevronRight className="h-3.5 w-3.5" />
                            </div>
                          </div>
        </button>
      </div>
    </article>
  );
};

const Achievements = ({ onNavigate }) => {
  const initialTrust = resolveTrustContext();
  const [selectedTrustId, setSelectedTrustId] = useState(() => initialTrust.trustId || '');
  const [currentPage, setCurrentPage] = useState(1);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMoreAchievements, setHasMoreAchievements] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const loadMoreSentinelRef = useRef(null);
  const loadMoreDebounceRef = useRef(null);
  const refreshAutoLoadTimersRef = useRef([]);

  const loadPage = useCallback(async ({
    trustId,
    page = 1,
    forceRefresh = false,
    silent = false,
    append = false,
  } = {}) => {
    const normalizedTrustId = normalizeText(trustId);
    const pageNo = Number(page) > 0 ? Number(page) : 1;
    const shouldAppend = Boolean(append || pageNo > 1);

    if (!normalizedTrustId) {
      setItems([]);
      setLoading(false);
      setIsLoadingMore(false);
      setHasMoreAchievements(false);
      setError('');
      return { success: false, items: [], hasMoreAchievements: false, nextPage: 1 };
    }

    setError('');
    const cached = forceRefresh ? null : readAchievementsCache(normalizedTrustId, pageNo);
    const cachedItems = Array.isArray(cached?.items) ? cached.items : [];
    const applyItems = (nextItems) => {
      setItems((prev) => (shouldAppend ? mergeAchievementItems(prev, nextItems) : nextItems));
    };

    if (cached && Array.isArray(cached.items)) {
      applyItems(cachedItems);
      setHasMoreAchievements(cachedItems.length >= ACHIEVEMENTS_PAGE_SIZE);
      setCurrentPage(pageNo);
      setLoading(false);
      setIsLoadingMore(false);
      return {
        success: true,
        fromCache: true,
        items: cachedItems,
        hasMoreAchievements: cachedItems.length >= ACHIEVEMENTS_PAGE_SIZE,
        nextPage: cachedItems.length >= ACHIEVEMENTS_PAGE_SIZE ? pageNo + 1 : pageNo,
        totalCount: Number(cached.totalCount) || cachedItems.length,
      };
    }

    if (pageNo === 1) {
      if (!silent) setLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const from = (pageNo - 1) * ACHIEVEMENTS_PAGE_SIZE;
    const to = from + ACHIEVEMENTS_PAGE_SIZE - 1;

    try {
      const { data, error: fetchError, count } = await supabase
        .from('achievements')
        .select('id, trust_id, name, description, attachments, status, created_at, updated_at', { count: 'exact' })
        .eq('trust_id', normalizedTrustId)
        .eq('status', 'active')
        .abortSignal(controller.signal)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (fetchError) {
        if (!silent && pageNo === 1) {
          setError(fetchError.name === 'AbortError' ? 'Loading is taking too long. Please retry.' : (fetchError.message || 'Failed to load achievements'));
          setItems(cachedItems);
        }
        return { success: false, items: cachedItems, hasMoreAchievements: false, nextPage: pageNo };
      }

      const nextItems = Array.isArray(data) ? data : [];
      const resolvedTotalCount = Number.isFinite(Number(count)) ? Number(count) : ((pageNo - 1) * ACHIEVEMENTS_PAGE_SIZE + nextItems.length);
      const nextHasMoreAchievements = nextItems.length >= ACHIEVEMENTS_PAGE_SIZE;
      const nextPage = nextHasMoreAchievements ? pageNo + 1 : pageNo;

      applyItems(nextItems);
      setHasMoreAchievements(nextHasMoreAchievements);
      setCurrentPage(pageNo);
      writeAchievementsCache(normalizedTrustId, pageNo, {
        items: nextItems,
        hasMoreAchievements: nextHasMoreAchievements,
        nextPage,
        totalCount: resolvedTotalCount,
      });

      return {
        success: true,
        items: nextItems,
        hasMoreAchievements: nextHasMoreAchievements,
        nextPage,
        totalCount: resolvedTotalCount,
      };
    } catch (err) {
      if (!silent && pageNo === 1) {
        const message = err?.name === 'AbortError' ? 'Loading is taking too long. Please retry.' : (err?.message || 'Failed to load achievements');
        setError(message);
        setItems(cachedItems);
      }
      return {
        success: false,
        items: cachedItems,
        hasMoreAchievements: false,
        nextPage: pageNo,
      };
    } finally {
      clearTimeout(timeout);
      if (pageNo === 1) {
        setLoading(false);
      } else {
        setIsLoadingMore(false);
      }
    }
  }, []);

  const loadNextPage = useCallback(async () => {
    if (!selectedTrustId || loading || isLoadingMore || !hasMoreAchievements) return;
    const nextPage = currentPage + 1;
    const result = await loadPage({
      trustId: selectedTrustId,
      page: nextPage,
      append: true,
      silent: true,
    });
    if (result?.success) {
      setCurrentPage(nextPage);
    }
  }, [currentPage, hasMoreAchievements, isLoadingMore, loadPage, loading, selectedTrustId]);

  const attemptAutoLoadMore = useCallback(() => {
    if (!selectedTrustId || loading || isLoadingMore || !hasMoreAchievements) return;

    const node = loadMoreSentinelRef.current;
    if (!isElementWithinViewport(node, 240)) return;

    void loadNextPage();
  }, [hasMoreAchievements, isLoadingMore, loadNextPage, loading, selectedTrustId]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!selectedTrustId) {
        setItems([]);
        setHasMoreAchievements(false);
        setLoading(false);
        setIsLoadingMore(false);
        setCurrentPage(1);
        return;
      }
      setCurrentPage(1);
      void loadPage({ trustId: selectedTrustId, page: 1, append: false });
    });
    return () => {
      cancelled = true;
    };
  }, [loadPage, selectedTrustId]);

  useEffect(() => {
    const syncTrust = () => {
      const trust = resolveTrustContext();
      setSelectedTrustId(trust.trustId || '');
      setCurrentPage(1);
      setItems([]);
      setHasMoreAchievements(Boolean(trust.trustId));
      setIsLoadingMore(false);
      setLoading(Boolean(trust.trustId));
      setError('');
    };

    const handleStorage = (event) => {
      if (!event || event.key === 'selected_trust_id' || event.key === 'selected_trust_name') syncTrust();
    };

    window.addEventListener('trust-changed', syncTrust);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('trust-changed', syncTrust);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!selectedTrustId || loading || isLoadingMore || !hasMoreAchievements) return undefined;

    refreshAutoLoadTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    refreshAutoLoadTimersRef.current = [0, 120, 260, 520, 900, 1300].map((delay) => window.setTimeout(() => {
      void attemptAutoLoadMore();
    }, delay));

    return () => {
      refreshAutoLoadTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      refreshAutoLoadTimersRef.current = [];
    };
  }, [attemptAutoLoadMore, hasMoreAchievements, isLoadingMore, loading, selectedTrustId, items.length]);

  useEffect(() => {
    const handleViewportChange = () => {
      void attemptAutoLoadMore();
    };

    window.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('pageshow', handleViewportChange);

    return () => {
      window.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('pageshow', handleViewportChange);
    };
  }, [attemptAutoLoadMore]);

  useEffect(() => {
    if (!selectedTrustId) return () => {};

    const channel = supabase
      .channel(`achievements-live-${selectedTrustId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'achievements', filter: `trust_id=eq.${selectedTrustId}` },
        async () => {
          await loadPage({
            trustId: selectedTrustId,
            page: currentPage,
            forceRefresh: true,
            silent: true,
            append: currentPage > 1,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => {});
    };
  }, [currentPage, loadPage, selectedTrustId]);

  useEffect(() => {
    if (!selectedTrustId || !hasMoreAchievements) return undefined;

    const node = loadMoreSentinelRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        if (loadMoreDebounceRef.current) return;

        loadMoreDebounceRef.current = window.setTimeout(() => {
          loadMoreDebounceRef.current = null;
          void attemptAutoLoadMore();
        }, 180);
      },
      {
        root: null,
        rootMargin: '240px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (loadMoreDebounceRef.current) {
        clearTimeout(loadMoreDebounceRef.current);
        loadMoreDebounceRef.current = null;
      }
    };
  }, [attemptAutoLoadMore, hasMoreAchievements, isLoadingMore, loading, selectedTrustId]);

  const spotlight = useMemo(() => items[0] || null, [items]);
  const timeline = useMemo(() => items.slice(1), [items]);

  const openDetail = (achievement) => {
    if (!achievement?.id) return;
    onNavigate?.('achievement-details', { achievementId: String(achievement.id) });
  };

  return (
    <div className={`min-h-screen pb-8 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`} style={{ background: 'var(--page-bg, var(--app-page-bg))', color: 'var(--body-text-color)' }}>
      <div className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-50 shadow-sm" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl transition-colors"
          aria-label="Toggle menu"
        >
          {isMenuOpen ? <X className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold" style={{ color: 'var(--navbar-text)' }}>Achievements</h1>
        <button
          onClick={() => onNavigate?.('home')}
          className="p-2 rounded-xl transition-colors"
          style={{ color: 'var(--navbar-text)' }}
          aria-label="Go to home"
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      {isMenuOpen && <div className="fixed inset-0 z-25" style={{ background: 'rgba(0,0,0,0.02)' }} onClick={() => setIsMenuOpen(false)} />}
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="achievements" />

      <div className="px-4 py-5">
        {loading ? (
          <div className="py-16 text-center text-sm" style={{ color: 'var(--advertisement-subtitle)' }}>Loading achievements...</div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-title)' }}>Could not load achievements</p>
            <p className="text-xs mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>{error}</p>
            <button
              type="button"
              onClick={() => loadPage({ trustId: selectedTrustId, page: currentPage, forceRefresh: true })}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--app-button-bg)', color: 'var(--app-button-text)' }}
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-full grid place-items-center" style={{ background: 'var(--advertisement-card-bg)', color: 'var(--app-accent-bg)', border: '1px solid var(--advertisement-card-border)' }}>
              <Award size={22} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-title)' }}>No achievements yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--advertisement-subtitle)' }}>New milestones will appear here automatically.</p>
          </div>
        ) : (
          <>
            {spotlight && (
              <section className="mb-7">
                <p className="text-[10px] uppercase tracking-[0.16em] mb-2" style={{ color: 'var(--advertisement-subtitle)' }}>Latest Highlight</p>
                <AchievementSummaryCard
                  item={spotlight}
                  featured
                  onOpenDetail={openDetail}
                />
              </section>
            )}

            {timeline.length > 0 ? (
              <section>
                <p className="text-[10px] uppercase tracking-[0.16em] mb-2" style={{ color: 'var(--advertisement-subtitle)' }}>Achievement Trail</p>
                <div className="relative pl-5">
                  <div className="absolute left-[7px] top-1 bottom-1 w-[2px]" style={{ background: 'var(--advertisement-card-border)' }} />
                  <div className="space-y-6">
                    {timeline.map((item) => (
                      <AchievementSummaryCard
                        key={item.id}
                        item={item}
                        showTimelineDot
                        onOpenDetail={openDetail}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            <div className="pt-3">
              <div ref={loadMoreSentinelRef} className="h-1 w-full" />
              {isLoadingMore && (
                <p className="pt-4 text-center text-xs font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
                  Loading more achievements...
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Achievements;
