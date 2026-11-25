import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGalleryFoldersPaginated, fetchPhotosByFolderPaginated } from './galleryService';

const GALLERY_CONTEXT_VERSION = 6;
const GALLERY_CACHE_KEY_PREFIX = 'gallery_normalized_cache_v6';
const LEGACY_GALLERY_CACHE_KEY = null;
const ALBUMS_META_TTL_MS = 20 * 60 * 1000; // 20 mins
const ALBUM_DETAIL_TTL_MS = 12 * 60 * 1000; // 12 mins
const PAGE_TTL_MS = 12 * 60 * 1000; // 12 mins
const IMAGES_PER_PAGE = 10;
const ALBUMS_BATCH_SIZE = 12;
const ENABLE_GALLERY_TRUST_DEBUG = import.meta.env.DEV || import.meta.env.VITE_GALLERY_DEBUG === 'true';

const GalleryContext = createContext();

const getSelectedTrustId = () => {
  try {
    return localStorage.getItem('selected_trust_id') || null;
  } catch {
    return null;
  }
};

const normalizeTrustId = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized === 'null' || normalized === 'undefined') return null;
  return normalized;
};

const resolveCacheKey = (trustId) => `${GALLERY_CACHE_KEY_PREFIX}:${normalizeTrustId(trustId) || 'none'}`;

const logGalleryTrust = (...args) => {
  if (!ENABLE_GALLERY_TRUST_DEBUG) return;
  // console.log('[Gallery][Trust]', ...args);
};

const isFresh = (timestamp, ttlMs) => {
  if (!timestamp || !Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < ttlMs;
};

const dedupeImagesById = (images = []) => {
  const seen = new Set();
  const result = [];
  for (const image of images) {
    const id = String(image?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(image);
  }
  return result;
};

const pickObjectKeys = (source = {}, allowedIds = new Set()) => {
  const next = {};
  Object.entries(source || {}).forEach(([id, value]) => {
    if (allowedIds.has(String(id))) {
      next[id] = value;
    }
  });
  return next;
};

const createEmptyStore = (trustId = null) => ({
  trustId: normalizeTrustId(trustId),
  albumsById: {},
  albumOrder: [],
  albumListPages: {},
  hasMoreAlbums: true,
  nextAlbumPage: 1,
  albumDetails: {},
  cacheTimestamps: {
    albumsMeta: null,
    albumListPages: {},
    albumDetails: {},
    pages: {},
  },
  lastFetchTime: null,
});

const deserializeStore = (trustId, parsed) => {
  if (!parsed?.data) return createEmptyStore(trustId);
  const data = parsed.data;
  return {
    trustId: normalizeTrustId(trustId),
    albumsById: data.albumsById || {},
    albumOrder: Array.isArray(data.albumOrder) ? data.albumOrder : [],
    albumListPages: data.albumListPages || {},
    hasMoreAlbums: typeof data.hasMoreAlbums === 'boolean' ? data.hasMoreAlbums : true,
    nextAlbumPage: Number(data.nextAlbumPage || 1),
    albumDetails: data.albumDetails || {},
    cacheTimestamps: data.cacheTimestamps || {
      albumsMeta: null,
      albumListPages: {},
      albumDetails: {},
      pages: {},
    },
    lastFetchTime: data.lastFetchTime || data.cacheTimestamps?.albumsMeta || null,
  };
};

const readPersistedStoreForTrust = (requestedTrustId) => {
  const trustId = normalizeTrustId(requestedTrustId);
  const empty = createEmptyStore(trustId);
  try {
    const cacheKey = resolveCacheKey(trustId);
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === GALLERY_CONTEXT_VERSION && normalizeTrustId(parsed?.trustId) === trustId) {
        return deserializeStore(trustId, parsed);
      }
    }

    const legacyRaw = LEGACY_GALLERY_CACHE_KEY ? localStorage.getItem(LEGACY_GALLERY_CACHE_KEY) : null;
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (
        legacyParsed?.version === GALLERY_CONTEXT_VERSION - 1
        && normalizeTrustId(legacyParsed?.trustId) === trustId
        && legacyParsed?.data
      ) {
        const migrated = deserializeStore(trustId, legacyParsed);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            version: GALLERY_CONTEXT_VERSION,
            trustId,
            timestamp: Date.now(),
            data: migrated,
          }));
        } catch {
          // ignore migration persistence failures
        }
        return migrated;
      }
    }

    return empty;
  } catch {
    return empty;
  }
};

const readPersistedStore = () => readPersistedStoreForTrust(getSelectedTrustId());

export function GalleryProvider({ children }) {
  const bootstrap = readPersistedStore();

  const [trustId, setTrustId] = useState(bootstrap.trustId);
  const [albumsById, setAlbumsById] = useState(bootstrap.albumsById);
  const [albumOrder, setAlbumOrder] = useState(bootstrap.albumOrder);
  const [albumListPages, setAlbumListPages] = useState(bootstrap.albumListPages);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(bootstrap.hasMoreAlbums);
  const [nextAlbumPage, setNextAlbumPage] = useState(bootstrap.nextAlbumPage);
  const [albumDetails, setAlbumDetails] = useState(bootstrap.albumDetails);
  const [cacheTimestamps, setCacheTimestamps] = useState(bootstrap.cacheTimestamps);
  const [lastFetchTime, setLastFetchTime] = useState(bootstrap.lastFetchTime);
  const [isLoading, setIsLoading] = useState(bootstrap.albumOrder.length === 0);
  const [isLoadingMoreAlbums, setIsLoadingMoreAlbums] = useState(false);
  const [error, setError] = useState(null);

  const albumsPageInFlightRef = useRef(new Map());
  const pageInFlightRef = useRef(new Map());

  const ensureTrustSynced = useCallback((incomingTrustId = null) => {
    const selectedTrustId = normalizeTrustId(incomingTrustId || getSelectedTrustId());
    const previousTrustId = normalizeTrustId(trustId);
    if (selectedTrustId === previousTrustId) {
      return {
        trustId: selectedTrustId,
        previousTrustId,
        changed: false,
        cacheHit: albumOrder.length > 0,
        snapshot: {
          trustId: selectedTrustId,
          albumsById,
          albumOrder,
          albumListPages,
          hasMoreAlbums,
          nextAlbumPage,
          albumDetails,
          cacheTimestamps,
          lastFetchTime,
        },
      };
    }

    const snapshot = readPersistedStoreForTrust(selectedTrustId);
    const cacheHit = Array.isArray(snapshot.albumOrder) && snapshot.albumOrder.length > 0;

    setTrustId(snapshot.trustId);
    setAlbumsById(snapshot.albumsById);
    setAlbumOrder(snapshot.albumOrder);
    setAlbumListPages(snapshot.albumListPages);
    setHasMoreAlbums(snapshot.hasMoreAlbums);
    setNextAlbumPage(snapshot.nextAlbumPage);
    setAlbumDetails(snapshot.albumDetails);
    setCacheTimestamps(snapshot.cacheTimestamps);
    setLastFetchTime(snapshot.lastFetchTime);
    setError(null);
    setIsLoading(!cacheHit);
    setIsLoadingMoreAlbums(false);
    albumsPageInFlightRef.current.clear();
    pageInFlightRef.current.clear();

    logGalleryTrust('Trust switched', {
      previousTrustId,
      selectedTrustId,
      cacheHit,
      cachedAlbums: snapshot.albumOrder.length,
      oldTrustDataCleared: true,
    });

    return {
      trustId: selectedTrustId,
      previousTrustId,
      changed: true,
      cacheHit,
      snapshot,
    };
  }, [
    albumDetails,
    albumListPages,
    albumOrder,
    albumsById,
    cacheTimestamps,
    hasMoreAlbums,
    lastFetchTime,
    nextAlbumPage,
    trustId,
  ]);

  const persistStore = useCallback((nextStore) => {
    try {
      const targetTrustId = normalizeTrustId(nextStore?.trustId);
      if (!targetTrustId) return;
      localStorage.setItem(
        resolveCacheKey(targetTrustId),
        JSON.stringify({
          version: GALLERY_CONTEXT_VERSION,
          trustId: targetTrustId,
          timestamp: Date.now(),
          data: nextStore,
        })
      );
    } catch {
      // ignore persistence failures
    }
  }, []);

  const fetchAlbumsMetaPage = useCallback(async (activeTrustId, page) => {
    const { folders, hasMore } = await fetchGalleryFoldersPaginated(activeTrustId, page, ALBUMS_BATCH_SIZE);
    const previewResults = await Promise.allSettled(
      folders.map(async (folder) => {
        const res = await fetchPhotosByFolderPaginated(
          folder.id,
          activeTrustId,
          1,
          2,
          { includeCount: true, countMode: 'exact', disableTrustFallback: true }
        );
        return {
          folderId: String(folder.id),
          photos: res?.photos || [],
          totalCount: res?.totalCount || 0,
        };
      })
    );

    const previewsByFolder = {};
    previewResults.forEach((result, idx) => {
      const folder = folders[idx];
      if (!folder) return;
      const folderId = String(folder.id);
      if (result.status === 'fulfilled') {
        previewsByFolder[folderId] = result.value;
      } else {
        previewsByFolder[folderId] = { photos: [], totalCount: 0 };
      }
    });

    return { folders, hasMore, previewsByFolder };
  }, []);

  const loadAlbumsPage = useCallback(async (page, opts = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const trustSync = ensureTrustSynced();
    const activeTrustId = trustSync.trustId;
    if (!activeTrustId) {
      setIsLoading(false);
      setIsLoadingMoreAlbums(false);
      return { fromCache: true, page: safePage };
    }

    const sourceAlbumListPages = trustSync.changed ? (trustSync.snapshot?.albumListPages || {}) : albumListPages;
    const sourceCacheTimestamps = trustSync.changed ? (trustSync.snapshot?.cacheTimestamps || cacheTimestamps) : cacheTimestamps;
    const sourceAlbumOrder = trustSync.changed ? (trustSync.snapshot?.albumOrder || []) : albumOrder;
    const sourceAlbumsById = trustSync.changed ? (trustSync.snapshot?.albumsById || {}) : albumsById;
    const sourceAlbumDetails = trustSync.changed ? (trustSync.snapshot?.albumDetails || {}) : albumDetails;

    const force = opts?.force === true;
    const replaceFirstPage = opts?.replaceFirstPage === true;
    const cachedPageIds = sourceAlbumListPages?.[safePage];
    const pageTs = sourceCacheTimestamps.albumListPages?.[safePage];
    const pageIsFresh = Array.isArray(cachedPageIds)
      && cachedPageIds.length > 0
      && isFresh(pageTs, ALBUMS_META_TTL_MS);

    logGalleryTrust('Albums page request', {
      selectedTrustId: normalizeTrustId(getSelectedTrustId()),
      galleryTrustId: activeTrustId,
      previousTrustId: trustSync.previousTrustId,
      page: safePage,
      cacheHit: pageIsFresh,
      cacheMiss: !pageIsFresh,
    });

    if (!force && pageIsFresh) {
      return { fromCache: true, page: safePage };
    }

    if (!force && Array.isArray(cachedPageIds) && cachedPageIds.length > 0 && opts?.background === true) {
      void loadAlbumsPage(safePage, { force: true, replaceFirstPage });
      return { fromCache: true, page: safePage, stale: true };
    }

    const requestKey = `${activeTrustId || 'global'}:${safePage}`;
    if (albumsPageInFlightRef.current.has(requestKey) && !force) {
      return albumsPageInFlightRef.current.get(requestKey);
    }

    const run = (async () => {
      const shouldShowInitialLoader = safePage === 1 && sourceAlbumOrder.length === 0;
      if (shouldShowInitialLoader) setIsLoading(true);
      if (!shouldShowInitialLoader) setIsLoadingMoreAlbums(true);
      setError(null);
      try {
        const { folders, hasMore, previewsByFolder } = await fetchAlbumsMetaPage(activeTrustId, safePage);
        const pageAlbumIds = [];
        const isAuthoritativeFirstPage = safePage === 1 && replaceFirstPage;
        const nextAlbumsById = isAuthoritativeFirstPage ? {} : { ...sourceAlbumsById };

        folders.forEach((folder) => {
          const id = String(folder.id);
          pageAlbumIds.push(id);
          const preview = dedupeImagesById(previewsByFolder[id]?.photos || []).slice(0, 2);
          const count = Number(previewsByFolder[id]?.totalCount || 0);
          nextAlbumsById[id] = {
            id,
            name: folder.name || 'General',
            description: folder.description || '',
            imageCount: count,
            previewImages: preview,
          };
        });

        const nextAlbumOrder = (() => {
          const existing = [...sourceAlbumOrder];
          if (safePage === 1 && replaceFirstPage) {
            return pageAlbumIds;
          }
          const seen = new Set(existing);
          pageAlbumIds.forEach((id) => {
            if (seen.has(id)) return;
            seen.add(id);
            existing.push(id);
          });
          return existing;
        })();

        const validAlbumIds = new Set(nextAlbumOrder.map(String));

        const nextAlbumListPages = {
          ...(isAuthoritativeFirstPage ? {} : sourceAlbumListPages),
          [safePage]: pageAlbumIds,
        };
        const nextAlbumDetails = isAuthoritativeFirstPage
          ? pickObjectKeys(sourceAlbumDetails, validAlbumIds)
          : sourceAlbumDetails;

        const now = Date.now();
        const nextTimestamps = {
          albumsMeta: now,
          albumListPages: {
            ...(isAuthoritativeFirstPage ? {} : (sourceCacheTimestamps.albumListPages || {})),
            [safePage]: now,
          },
          albumDetails: isAuthoritativeFirstPage
            ? pickObjectKeys(sourceCacheTimestamps.albumDetails || {}, validAlbumIds)
            : { ...(sourceCacheTimestamps.albumDetails || {}) },
          pages: isAuthoritativeFirstPage
            ? pickObjectKeys(sourceCacheTimestamps.pages || {}, validAlbumIds)
            : { ...(sourceCacheTimestamps.pages || {}) },
        };
        const nextPage = hasMore ? (safePage + 1) : safePage;

        const nextStore = {
          trustId: activeTrustId,
          albumsById: nextAlbumsById,
          albumOrder: nextAlbumOrder,
          albumListPages: nextAlbumListPages,
          hasMoreAlbums: hasMore,
          nextAlbumPage: nextPage,
          albumDetails: nextAlbumDetails,
          cacheTimestamps: nextTimestamps,
          lastFetchTime: now,
        };

        setAlbumsById(nextAlbumsById);
        setAlbumOrder(nextAlbumOrder);
        setAlbumListPages(nextAlbumListPages);
        setHasMoreAlbums(hasMore);
        setNextAlbumPage(nextPage);
        setAlbumDetails(nextAlbumDetails);
        setCacheTimestamps(nextTimestamps);
        setLastFetchTime(now);
        setError(null);
        persistStore(nextStore);
        logGalleryTrust('Albums fetch completed', {
          trustId: activeTrustId,
          page: safePage,
          albumsReturned: pageAlbumIds.length,
          hasMore,
        });
        return { fromCache: false, page: safePage, hasMore };
      } catch (err) {
        setError(err?.message || 'Failed to load gallery');
        return { fromCache: Boolean(cachedPageIds?.length), page: safePage };
      } finally {
        setIsLoading(false);
        setIsLoadingMoreAlbums(false);
      }
    })().finally(() => {
      albumsPageInFlightRef.current.delete(requestKey);
    });

    albumsPageInFlightRef.current.set(requestKey, run);
    return run;
  }, [
    albumDetails,
    albumListPages,
    albumOrder,
    albumsById,
    cacheTimestamps,
    cacheTimestamps.albumDetails,
    cacheTimestamps.albumListPages,
    cacheTimestamps.pages,
    ensureTrustSynced,
    fetchAlbumsMetaPage,
    persistStore,
  ]);

  const ensureAlbumsLoaded = useCallback(async (opts = {}) => {
    const trustSync = ensureTrustSynced();
    const sourceAlbumListPages = trustSync.changed ? (trustSync.snapshot?.albumListPages || {}) : albumListPages;
    const sourceCacheTimestamps = trustSync.changed ? (trustSync.snapshot?.cacheTimestamps || cacheTimestamps) : cacheTimestamps;
    const force = opts?.force === true;
    const hasFirstPage = Array.isArray(sourceAlbumListPages?.[1]) && sourceAlbumListPages[1].length > 0;
    const firstPageTs = sourceCacheTimestamps.albumListPages?.[1];
    const firstPageFresh = hasFirstPage && isFresh(firstPageTs, ALBUMS_META_TTL_MS);

    logGalleryTrust('Ensure albums loaded', {
      selectedTrustId: normalizeTrustId(getSelectedTrustId()),
      galleryTrustId: trustSync.trustId,
      previousTrustId: trustSync.previousTrustId,
      cacheHit: firstPageFresh,
      cacheMiss: !firstPageFresh,
      hasFirstPage,
      force,
      changed: trustSync.changed,
    });

    if (!force && hasFirstPage && firstPageFresh) {
      return { fromCache: true, page: 1 };
    }
    if (!force && hasFirstPage && !firstPageFresh && opts?.background === true) {
      void loadAlbumsPage(1, { force: true, replaceFirstPage: true });
      return { fromCache: true, page: 1, stale: true };
    }
    return loadAlbumsPage(1, { force, replaceFirstPage: force && hasFirstPage });
  }, [albumListPages, cacheTimestamps, ensureTrustSynced, loadAlbumsPage]);

  const loadMoreAlbums = useCallback(async () => {
    if (!hasMoreAlbums) return { done: true, fromCache: true };
    const targetPage = Math.max(1, Number(nextAlbumPage || 1));
    return loadAlbumsPage(targetPage);
  }, [hasMoreAlbums, loadAlbumsPage, nextAlbumPage]);

  const isAlbumPageCached = useCallback((albumId, page = 1) => {
    const aid = String(albumId || '');
    if (!aid) return false;
    const pageTs = cacheTimestamps.pages?.[aid]?.[page];
    return Boolean(pageTs && isFresh(pageTs, PAGE_TTL_MS) && albumDetails?.[aid]?.pages?.[page]);
  }, [albumDetails, cacheTimestamps.pages]);

  const getAlbumPage = useCallback(async (albumId, page = 1, opts = {}) => {
    const aid = String(albumId || '');
    if (!aid) {
      return { photos: [], totalPages: 0, totalCount: 0, perPage: IMAGES_PER_PAGE, fromCache: true };
    }

    const trustSync = ensureTrustSynced();
    const activeTrustId = trustSync.trustId;
    const sourceAlbumDetails = trustSync.changed ? (trustSync.snapshot?.albumDetails || {}) : albumDetails;
    const sourceCacheTimestamps = trustSync.changed ? (trustSync.snapshot?.cacheTimestamps || cacheTimestamps) : cacheTimestamps;
    const sourceAlbumsById = trustSync.changed ? (trustSync.snapshot?.albumsById || {}) : albumsById;
    const sourceAlbumOrder = trustSync.changed ? (trustSync.snapshot?.albumOrder || []) : albumOrder;
    const sourceAlbumListPages = trustSync.changed ? (trustSync.snapshot?.albumListPages || {}) : albumListPages;
    const sourceHasMoreAlbums = trustSync.changed ? Boolean(trustSync.snapshot?.hasMoreAlbums) : hasMoreAlbums;
    const sourceNextAlbumPage = trustSync.changed ? Number(trustSync.snapshot?.nextAlbumPage || 1) : nextAlbumPage;
    const sourceLastFetchTime = trustSync.changed ? (trustSync.snapshot?.lastFetchTime || null) : lastFetchTime;

    const cachedPage = sourceAlbumDetails?.[aid]?.pages?.[page] || null;
    const pageTs = sourceCacheTimestamps.pages?.[aid]?.[page];
    const pageIsFresh = Boolean(cachedPage && pageTs && isFresh(pageTs, PAGE_TTL_MS));

    logGalleryTrust('Album page request', {
      selectedTrustId: normalizeTrustId(getSelectedTrustId()),
      galleryTrustId: activeTrustId,
      previousTrustId: trustSync.previousTrustId,
      albumId: aid,
      page,
      cacheHit: pageIsFresh,
      cacheMiss: !pageIsFresh,
    });

    if (!opts?.force && pageIsFresh) {
      return {
        photos: cachedPage,
        totalPages: sourceAlbumDetails?.[aid]?.totalPages || 0,
        totalCount: sourceAlbumDetails?.[aid]?.totalCount || sourceAlbumsById?.[aid]?.imageCount || 0,
        perPage: IMAGES_PER_PAGE,
        fromCache: true,
      };
    }

    if (!opts?.force && cachedPage && opts?.background === true) {
      void getAlbumPage(aid, page, { force: true });
      return {
        photos: cachedPage,
        totalPages: sourceAlbumDetails?.[aid]?.totalPages || 0,
        totalCount: sourceAlbumDetails?.[aid]?.totalCount || sourceAlbumsById?.[aid]?.imageCount || 0,
        perPage: IMAGES_PER_PAGE,
        fromCache: true,
        stale: true,
      };
    }

    const requestKey = `${activeTrustId || 'global'}:${aid}:${page}`;
    if (pageInFlightRef.current.has(requestKey)) {
      return pageInFlightRef.current.get(requestKey);
    }

    const run = (async () => {
      const res = await fetchPhotosByFolderPaginated(aid, activeTrustId, page, IMAGES_PER_PAGE);
      const previewImages = sourceAlbumsById?.[aid]?.previewImages || [];
      const pagePhotos = page === 1
        ? dedupeImagesById([...previewImages, ...(res?.photos || [])])
        : (res?.photos || []);

      const current = sourceAlbumDetails?.[aid] || { pages: {}, loadedPages: [] };
      const loadedPages = Array.from(new Set([...(current.loadedPages || []), page])).sort((a, b) => a - b);
      const now = Date.now();

      const nextAlbumDetails = {
        ...sourceAlbumDetails,
        [aid]: {
          pages: {
            ...(current.pages || {}),
            [page]: pagePhotos,
          },
          loadedPages,
          totalPages: Number(res?.totalPages || current.totalPages || 0),
          totalCount: Number(res?.totalCount || current.totalCount || 0),
          perPage: IMAGES_PER_PAGE,
          lastFetchedAt: now,
        },
      };

      const nextAlbumsById = {
        ...sourceAlbumsById,
        [aid]: {
          ...(sourceAlbumsById?.[aid] || { id: aid, name: 'Album', previewImages: [] }),
          imageCount: Number(res?.totalCount || sourceAlbumsById?.[aid]?.imageCount || 0),
          previewImages: (sourceAlbumsById?.[aid]?.previewImages || []).slice(0, 2),
        },
      };

      const nextTimestamps = {
        albumsMeta: sourceCacheTimestamps.albumsMeta,
        albumListPages: { ...(sourceCacheTimestamps.albumListPages || {}) },
        albumDetails: {
          ...(sourceCacheTimestamps.albumDetails || {}),
          [aid]: now,
        },
        pages: {
          ...(sourceCacheTimestamps.pages || {}),
          [aid]: {
            ...(sourceCacheTimestamps.pages?.[aid] || {}),
            [page]: now,
          },
        },
      };

      const nextStore = {
        trustId: activeTrustId,
        albumsById: nextAlbumsById,
        albumOrder: sourceAlbumOrder,
        albumListPages: sourceAlbumListPages,
        hasMoreAlbums: sourceHasMoreAlbums,
        nextAlbumPage: sourceNextAlbumPage,
        albumDetails: nextAlbumDetails,
        cacheTimestamps: nextTimestamps,
        lastFetchTime: sourceLastFetchTime || sourceCacheTimestamps.albumsMeta || now,
      };

      setAlbumsById(nextAlbumsById);
      setAlbumDetails(nextAlbumDetails);
      setCacheTimestamps(nextTimestamps);
      persistStore(nextStore);
      logGalleryTrust('Album images fetched', {
        trustId: activeTrustId,
        albumId: aid,
        page,
        imagesReturned: Array.isArray(pagePhotos) ? pagePhotos.length : 0,
      });

      return {
        photos: pagePhotos,
        totalPages: Number(res?.totalPages || 0),
        totalCount: Number(res?.totalCount || 0),
        perPage: IMAGES_PER_PAGE,
        fromCache: false,
      };
    })()
      .finally(() => {
        pageInFlightRef.current.delete(requestKey);
      });

    pageInFlightRef.current.set(requestKey, run);
    return run;
  }, [
    albumDetails,
    albumListPages,
    albumOrder,
    albumsById,
    cacheTimestamps,
    cacheTimestamps.albumDetails,
    cacheTimestamps.albumListPages,
    cacheTimestamps.albumsMeta,
    cacheTimestamps.pages,
    ensureTrustSynced,
    hasMoreAlbums,
    lastFetchTime,
    nextAlbumPage,
    persistStore,
  ]);

  const invalidateCache = useCallback(() => {
    const activeTrustId = normalizeTrustId(getSelectedTrustId());
    try {
      localStorage.removeItem(resolveCacheKey(activeTrustId));
    } catch {
      // ignore
    }
    setTrustId(activeTrustId);
    setAlbumsById({});
    setAlbumOrder([]);
    setAlbumListPages({});
    setHasMoreAlbums(true);
    setNextAlbumPage(1);
    setAlbumDetails({});
    setCacheTimestamps({
      albumsMeta: null,
      albumListPages: {},
      albumDetails: {},
      pages: {},
    });
    setLastFetchTime(null);
    setError(null);
    setIsLoading(false);
    setIsLoadingMoreAlbums(false);
    albumsPageInFlightRef.current.clear();
    pageInFlightRef.current.clear();
  }, []);

  const refreshGallery = useCallback(async () => {
    await ensureAlbumsLoaded({ force: true });
  }, [ensureAlbumsLoaded]);

  useEffect(() => {
    void ensureAlbumsLoaded({ background: true });
  }, [ensureAlbumsLoaded]);

  useEffect(() => {
    const syncAndLoad = () => {
      const selected = normalizeTrustId(getSelectedTrustId());
      if (!selected) return;
      const sync = ensureTrustSynced(selected);
      if (sync.trustId) {
        void ensureAlbumsLoaded({ background: true });
      }
    };

    // First-open race guard: trust can be written shortly after provider mounts.
    syncAndLoad();
    const timer = setTimeout(syncAndLoad, 220);

    window.addEventListener('focus', syncAndLoad);
    document.addEventListener('visibilitychange', syncAndLoad);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', syncAndLoad);
      document.removeEventListener('visibilitychange', syncAndLoad);
    };
  }, [ensureAlbumsLoaded, ensureTrustSynced]);

  useEffect(() => {
    const handleTrustChangeEvent = (event) => {
      const nextTrustId = normalizeTrustId(event?.detail?.trustId || getSelectedTrustId());
      const previousTrustId = normalizeTrustId(trustId);
      logGalleryTrust('Trust change event received', {
        previousTrustId,
        selectedTrustId: normalizeTrustId(getSelectedTrustId()),
        eventTrustId: nextTrustId,
      });
      const sync = ensureTrustSynced(nextTrustId);
      if (sync.trustId) {
        void ensureAlbumsLoaded({ background: true });
      }
    };

    const onStorage = (event) => {
      if (event.key === 'selected_trust_id') {
        const nextTrustId = normalizeTrustId(event?.newValue || getSelectedTrustId());
        logGalleryTrust('Storage trust change detected', {
          previousTrustId: normalizeTrustId(trustId),
          selectedTrustId: normalizeTrustId(getSelectedTrustId()),
          eventTrustId: nextTrustId,
        });
        const sync = ensureTrustSynced(nextTrustId);
        if (sync.trustId) {
          void ensureAlbumsLoaded({ background: true });
        }
      }
    };
    window.addEventListener('trust-changed', handleTrustChangeEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('trust-changed', handleTrustChangeEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, [ensureAlbumsLoaded, ensureTrustSynced, trustId]);

  const folders = useMemo(
    () => albumOrder
      .map((id) => albumsById[id])
      .filter(Boolean)
      .map((album) => ({
        id: album.id,
        name: album.name,
        description: album.description || '',
      })),
    [albumOrder, albumsById]
  );

  const images = useMemo(
    () => {
      const previews = albumOrder.flatMap((id) => albumsById[id]?.previewImages || []);
      return dedupeImagesById(previews);
    },
    [albumOrder, albumsById]
  );

  const carouselImages = useMemo(() => {
    const list = albumOrder.flatMap((id) => {
      const album = albumsById[id];
      if (!album) return [];
      const previews = (album.previewImages || []).map((img) => ({
        ...img,
        folderId: album.id,
        folderName: album.name,
      }));
      return previews;
    });
    return dedupeImagesById(list).slice(0, 6);
  }, [albumOrder, albumsById]);

  const cacheTimeRemaining = cacheTimestamps.albumsMeta
    ? Math.max(0, ALBUMS_META_TTL_MS - (Date.now() - cacheTimestamps.albumsMeta))
    : null;

  const value = {
    trustId,
    isLoading,
    isLoadingMoreAlbums,
    hasMoreAlbums,
    nextAlbumPage,
    albumBatchSize: ALBUMS_BATCH_SIZE,
    error,
    lastFetchTime,
    cacheTimeRemaining,
    albumsById,
    albumOrder,
    albumListPages,
    albumDetails,
    cacheTimestamps,
    folders,
    images,
    carouselImages,
    ensureAlbumsLoaded,
    loadMoreAlbums,
    getAlbumPage,
    isAlbumPageCached,
    refreshGallery,
    invalidateCache,
    ttlConfig: {
      albumsMetaMs: ALBUMS_META_TTL_MS,
      albumDetailMs: ALBUM_DETAIL_TTL_MS,
      pageMs: PAGE_TTL_MS,
      pageSize: IMAGES_PER_PAGE,
      albumBatchSize: ALBUMS_BATCH_SIZE,
    },
  };

  return (
    <GalleryContext.Provider value={value}>
      {children}
    </GalleryContext.Provider>
  );
}

export function useGalleryContext() {
  const context = useContext(GalleryContext);
  if (!context) {
    throw new Error('useGalleryContext must be used within GalleryProvider');
  }
  return context;
}
