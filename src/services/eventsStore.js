import { classifyEvent, fetchAllEventsForTrust, fetchEventById, sortEventsByCategory } from './eventsService';

const TTL_MS = 30 * 60 * 1000;
export const CATEGORIES = ['current', 'upcoming', 'past'];
export const eventsConfig = { PAGE_SIZE: 10 };

const KEY_ALL = (trustId) => `ev_all_v3_${trustId}`;
const KEY_BY_ID = (trustId) => `ev_by_id_v3_${trustId}`;
const KEY_ORDER = (trustId, category) => `ev_order_v3_${trustId}_${category}`;
const KEY_PAGES = (trustId, category) => `ev_pages_v3_${trustId}_${category}`;
const KEY_STATE = (trustId, category) => `ev_state_v3_${trustId}_${category}`;
const KEY_DETAIL = (trustId) => `ev_detail_v3_${trustId}`;

const inflight = {};

const now = () => Date.now();
const isFresh = (ts) => Number(ts) > 0 && now() - Number(ts) < TTL_MS;

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore cache write errors
  }
};

const normalizeId = (value) => {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
};

const normalizeMaybeIdObject = (value) => {
  if (value && typeof value === 'object') {
    return normalizeId(value.id || value.eventId || value.value || null);
  }
  return normalizeId(value);
};

const normalizeCategory = (value) => {
  const category = String(value || '').trim().toLowerCase();
  return CATEGORIES.includes(category) ? category : 'current';
};

const readState = (trustId, category) => {
  const fallback = {
    hasMore: false,
    nextPage: 1,
    loadedPages: [],
    pageTs: {},
    totalCount: 0,
    isLoading: false
  };
  const state = { ...fallback, ...(readJson(KEY_STATE(trustId, category), fallback) || {}) };
  state.loadedPages = Array.isArray(state.loadedPages)
    ? state.loadedPages.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  return state;
};

const writeState = (trustId, category, partial) => {
  const next = { ...readState(trustId, category), ...(partial || {}) };
  writeJson(KEY_STATE(trustId, category), next);
  return next;
};

const readById = (trustId) => readJson(KEY_BY_ID(trustId), {});
const writeById = (trustId, byId) => writeJson(KEY_BY_ID(trustId), byId);
const readOrder = (trustId, category) => readJson(KEY_ORDER(trustId, category), []);
const writeOrder = (trustId, category, order) => writeJson(KEY_ORDER(trustId, category), order);

const writeCategoryPages = (trustId, category, ids, pageSize) => {
  const safeSize = Number(pageSize) > 0 ? Number(pageSize) : eventsConfig.PAGE_SIZE;
  const normalizedIds = (Array.isArray(ids) ? ids : [])
    .map((id) => normalizeMaybeIdObject(id))
    .filter(Boolean);
  const pages = {};
  for (let start = 0, pageNo = 1; start < normalizedIds.length; start += safeSize, pageNo += 1) {
    pages[String(pageNo)] = {
      ids: normalizedIds.slice(start, start + safeSize),
      ts: now()
    };
  }
  writeJson(KEY_PAGES(trustId, category), pages);

  const totalCount = normalizedIds.length;
  const hasMore = totalCount > safeSize;
  writeState(trustId, category, {
    hasMore,
    nextPage: hasMore ? 2 : 1,
    loadedPages: totalCount > 0 ? [1] : [],
    pageTs: totalCount > 0 ? { '1': now() } : {},
    totalCount,
    isLoading: false
  });
};

const readAllList = (trustId) => {
  const allCached = readJson(KEY_ALL(trustId), null);
  return Array.isArray(allCached?.data) ? allCached.data : [];
};

const resolveEventsForIds = (trustId, ids) => {
  const byId = readById(trustId);
  const fallbackAll = readAllList(trustId);
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const normalizedIds = ids.map((id) => normalizeMaybeIdObject(id)).filter(Boolean);
  if (normalizedIds.length === 0) return [];

  const resolved = normalizedIds
    .map((id) => {
      if (byId[id]) return byId[id];
      const fallback = fallbackAll.find((item) => String(item?.id) === String(id)) || null;
      if (fallback) {
        byId[id] = { ...(byId[id] || {}), ...fallback, id: String(id) };
      }
      return byId[id] || null;
    })
    .filter(Boolean);
  writeById(trustId, byId);
  return resolved;
};

const fallbackCategorySliceFromAll = (trustId, category, pageNo, pageSize) => {
  const list = readAllList(trustId);
  if (list.length === 0) return { events: [], totalCount: 0 };
  const grouped = list.filter((item) => classifyEvent(item) === category);
  const sorted = sortEventsByCategory(category, grouped);
  const safePage = Number(pageNo) > 0 ? Number(pageNo) : 1;
  const safeSize = Number(pageSize) > 0 ? Number(pageSize) : eventsConfig.PAGE_SIZE;
  return {
    events: sorted.slice(0, safePage * safeSize),
    totalCount: sorted.length
  };
};

function buildAndCacheCategories(trustId, events) {
  const byId = {};
  const buckets = { current: [], upcoming: [], past: [] };

  for (const raw of Array.isArray(events) ? events : []) {
    const id = normalizeId(raw?.id);
    if (!id) continue;
    const normalized = { ...raw, id };
    byId[id] = { ...(byId[id] || {}), ...normalized };

    const category = classifyEvent(normalized);
    if (buckets[category]) buckets[category].push(normalized);
  }

  writeById(trustId, byId);

  for (const category of CATEGORIES) {
    const sorted = sortEventsByCategory(category, buckets[category]);
    const ids = sorted.map((item) => item.id).filter(Boolean);
    writeOrder(trustId, category, ids);
    writeCategoryPages(trustId, category, ids, eventsConfig.PAGE_SIZE);
  }

  console.log('[Events][Debug] trust=', trustId, 'classification_counts=', JSON.stringify({
    current: buckets.current.length,
    upcoming: buckets.upcoming.length,
    past: buckets.past.length
  }));

  return buckets;
}

async function ensureAllEventsLoaded(trustId, { forceRefresh = false } = {}) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return { current: [], upcoming: [], past: [] };

  const allCached = readJson(KEY_ALL(normalizedTrustId), null);
  const hasFreshAll = !forceRefresh && allCached && isFresh(allCached.ts) && Array.isArray(allCached.data);
  if (hasFreshAll) {
    return buildAndCacheCategories(normalizedTrustId, allCached.data);
  }

  const key = `all:${normalizedTrustId}`;
  if (inflight[key]) return inflight[key];

  inflight[key] = (async () => {
    try {
      const res = await fetchAllEventsForTrust({ trustId: normalizedTrustId });
      const list = res?.success && Array.isArray(res.data) ? res.data : [];
      writeJson(KEY_ALL(normalizedTrustId), { ts: now(), data: list });
      return buildAndCacheCategories(normalizedTrustId, list);
    } finally {
      delete inflight[key];
    }
  })();

  return inflight[key];
}

const getCachedPage = (trustId, category, page, pageSize = eventsConfig.PAGE_SIZE) => {
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  const safeSize = Number(pageSize) > 0 ? Number(pageSize) : eventsConfig.PAGE_SIZE;
  const state = readState(trustId, category);
  const order = readOrder(trustId, category);
  const normalizedOrder = order
    .map((id) => normalizeMaybeIdObject(id))
    .filter(Boolean);
  const effectiveTotalCount = Math.max(
    Number(state.totalCount) > 0 ? Number(state.totalCount) : 0,
    normalizedOrder.length
  );
  const expectedCount = Math.min(
    pageNo * safeSize,
    effectiveTotalCount
  );

  const pages = readJson(KEY_PAGES(trustId, category), {});
  const entry = pages[String(pageNo)] || null;

  if (entry && Array.isArray(entry.ids)) {
    const events = resolveEventsForIds(trustId, entry.ids);
    const idsCount = entry.ids.map((id) => normalizeMaybeIdObject(id)).filter(Boolean).length;
    const shouldFallbackToOrder = expectedCount > 0 && events.length < expectedCount;
    if (shouldFallbackToOrder || events.length < idsCount || (events.length === 0 && Number(state.totalCount) > 0)) {
      const orderedEvents = resolveEventsForIds(trustId, normalizedOrder.slice(0, pageNo * safeSize));
      if (orderedEvents.length >= expectedCount && orderedEvents.length > 0) {
        return {
          events: orderedEvents,
          hasMore: orderedEvents.length < normalizedOrder.length,
          totalCount: effectiveTotalCount,
          isFresh: isFresh(entry.ts),
          pageNo,
          pageSize: safeSize
        };
      }
      const fallback = fallbackCategorySliceFromAll(trustId, category, pageNo, safeSize);
      if (fallback.events.length > 0) {
        return {
          events: fallback.events,
          hasMore: fallback.events.length < fallback.totalCount,
          totalCount: fallback.totalCount,
          isFresh: isFresh(entry.ts),
          pageNo,
          pageSize: safeSize
        };
      }
    }
    return {
      events,
      hasMore: events.length < normalizedOrder.length,
      totalCount: effectiveTotalCount,
      isFresh: isFresh(entry.ts),
      pageNo,
      pageSize: safeSize
    };
  }

  const slicedIds = normalizedOrder.slice(0, pageNo * safeSize);
  const resolvedFromOrder = resolveEventsForIds(trustId, slicedIds);
  if (resolvedFromOrder.length === 0 && (slicedIds.length > 0 || Number(state.totalCount) > 0)) {
    const fallback = fallbackCategorySliceFromAll(trustId, category, pageNo, safeSize);
    return {
      events: fallback.events,
      hasMore: fallback.events.length < fallback.totalCount,
      totalCount: fallback.totalCount,
      isFresh: false,
      pageNo,
      pageSize: safeSize
    };
  }
  return {
    events: resolvedFromOrder,
    hasMore: slicedIds.length < normalizedOrder.length,
    totalCount: effectiveTotalCount,
    isFresh: false,
    pageNo,
    pageSize: safeSize
  };
};

export async function loadEventsPage({
  trustId,
  category = 'current',
  page = 1,
  pageSize = eventsConfig.PAGE_SIZE,
  forceRefresh = false
} = {}) {
  const normalizedTrustId = normalizeId(trustId);
  const normalizedCategory = normalizeCategory(category);
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  const safeSize = Number(pageSize) > 0 ? Number(pageSize) : eventsConfig.PAGE_SIZE;

  if (!normalizedTrustId) {
    return { events: [], hasMore: false, totalCount: 0, fromCache: true };
  }

  const cached = getCachedPage(normalizedTrustId, normalizedCategory, pageNo, safeSize);
  if (!forceRefresh && cached.isFresh) {
    console.log('[Events][Cache] hit trust=', normalizedTrustId, 'category=', normalizedCategory, 'page=', pageNo, 'ids=', cached.events.map((e) => e.id));
    return { ...cached, fromCache: true };
  }

  const inflightKey = `page:${normalizedTrustId}:${normalizedCategory}:${pageNo}:${safeSize}:${forceRefresh ? 'f' : 'n'}`;
  if (inflight[inflightKey]) return inflight[inflightKey];

  console.log('[Events][Cache] miss trust=', normalizedTrustId, 'category=', normalizedCategory, 'page=', pageNo, 'fetch=api');

  inflight[inflightKey] = (async () => {
    try {
      const categorized = await ensureAllEventsLoaded(normalizedTrustId, { forceRefresh });
      let snap = getCachedPage(normalizedTrustId, normalizedCategory, pageNo, safeSize);
      if (snap.events.length === 0) {
        const direct = Array.isArray(categorized?.[normalizedCategory]) ? categorized[normalizedCategory] : [];
        if (direct.length > 0) {
          const sortedDirect = sortEventsByCategory(normalizedCategory, direct);
          const sliced = sortedDirect.slice(0, pageNo * safeSize);
          snap = {
            ...snap,
            events: sliced,
            totalCount: sortedDirect.length,
            hasMore: sliced.length < sortedDirect.length
          };
        }
      }
      if (snap.totalCount > 0 && snap.events.length === 0) {
        console.warn('[Events][Cache] inconsistent snapshot detected. Rebuilding cache.', {
          trustId: normalizedTrustId,
          category: normalizedCategory,
          page: pageNo,
          totalCount: snap.totalCount
        });
        clearEventsCache(normalizedTrustId);
        const rebuilt = await ensureAllEventsLoaded(normalizedTrustId, { forceRefresh: true });
        snap = getCachedPage(normalizedTrustId, normalizedCategory, pageNo, safeSize);
        if (snap.events.length === 0) {
          const direct = Array.isArray(rebuilt?.[normalizedCategory]) ? rebuilt[normalizedCategory] : [];
          if (direct.length > 0) {
            const sortedDirect = sortEventsByCategory(normalizedCategory, direct);
            const sliced = sortedDirect.slice(0, pageNo * safeSize);
            snap = {
              ...snap,
              events: sliced,
              totalCount: sortedDirect.length,
              hasMore: sliced.length < sortedDirect.length
            };
          }
        }
      }

      const state = readState(normalizedTrustId, normalizedCategory);
      const loadedPagesSet = new Set([...(state.loadedPages || []), pageNo]);
      writeState(normalizedTrustId, normalizedCategory, {
        loadedPages: [...loadedPagesSet].sort((a, b) => a - b),
        nextPage: snap.hasMore ? pageNo + 1 : pageNo,
        hasMore: snap.hasMore,
        pageTs: { ...(state.pageTs || {}), [String(pageNo)]: now() },
        totalCount: snap.totalCount,
        isLoading: false
      });

      console.log('[Events][Debug] trust=', normalizedTrustId, 'category=', normalizedCategory, 'page=', pageNo, 'returned_ids=', snap.events.map((e) => e.id));
      console.log('[Events][Debug] returned_dates_times=', snap.events.map((e) => ({
        id: e.id,
        startEventDate: e.startEventDate || null,
        endEventDate: e.endEventDate || null,
        startTime: e.startTime || null,
        endTime: e.endTime || null
      })));

      return { ...snap, fromCache: false };
    } finally {
      delete inflight[inflightKey];
    }
  })();

  return inflight[inflightKey];
}

export async function loadAllEvents({ trustId, forceRefresh = false } = {}) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return { current: [], upcoming: [], past: [] };
  return ensureAllEventsLoaded(normalizedTrustId, { forceRefresh });
}

export function getEventsSnapshot(trustId, category, page = 1) {
  const normalizedTrustId = normalizeId(trustId);
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedTrustId) {
    return { events: [], hasMore: false, totalCount: 0, isFresh: false };
  }

  const state = readState(normalizedTrustId, normalizedCategory);
  const safePage = Number(page) > 0 ? Number(page) : 1;
  const order = readOrder(normalizedTrustId, normalizedCategory);
  const slicedIds = order.slice(0, safePage * eventsConfig.PAGE_SIZE);

  return {
    events: resolveEventsForIds(normalizedTrustId, slicedIds),
    hasMore: slicedIds.length < order.length,
    totalCount: Number(state.totalCount) || order.length,
    isFresh: isFresh((state.pageTs || {})[String(Math.min(safePage, Math.max(1, state.loadedPages?.length || 1)))] || 0)
  };
}

export function getEventsCounts(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return { current: 0, upcoming: 0, past: 0 };

  const counts = {};
  for (const category of CATEGORIES) {
    counts[category] = readOrder(normalizedTrustId, category).length;
  }
  return counts;
}

export async function loadEventDetail({ eventId, trustId, forceRefresh = false } = {}) {
  const normalizedTrustId = normalizeId(trustId) || normalizeId(localStorage.getItem('selected_trust_id'));
  const normalizedEventId = normalizeId(eventId);
  if (!normalizedTrustId || !normalizedEventId) return null;

  const detailMap = readJson(KEY_DETAIL(normalizedTrustId), {});
  const detailEntry = detailMap[normalizedEventId];
  if (!forceRefresh && detailEntry?.event && isFresh(detailEntry.ts)) {
    console.log('[Events][DetailCache] hit source=detail trust=', normalizedTrustId, 'id=', normalizedEventId);
    return detailEntry.event;
  }

  const byId = readById(normalizedTrustId);
  const listCached = byId[normalizedEventId];
  if (!forceRefresh && listCached) {
    console.log('[Events][DetailCache] hit source=list trust=', normalizedTrustId, 'id=', normalizedEventId);
    detailMap[normalizedEventId] = { event: listCached, ts: now() };
    writeJson(KEY_DETAIL(normalizedTrustId), detailMap);
    return listCached;
  }

  console.log('[Events][DetailCache] miss trust=', normalizedTrustId, 'id=', normalizedEventId, 'fetch=api');
  const res = await fetchEventById({ eventId: normalizedEventId, trustId: normalizedTrustId });
  if (!res?.success || !res?.data) return null;

  const mergedById = { ...byId, [normalizedEventId]: { ...(byId[normalizedEventId] || {}), ...res.data, id: normalizedEventId } };
  writeById(normalizedTrustId, mergedById);

  detailMap[normalizedEventId] = { event: mergedById[normalizedEventId], ts: now() };
  writeJson(KEY_DETAIL(normalizedTrustId), detailMap);
  return mergedById[normalizedEventId];
}

export function clearEventsCache(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return;

  try {
    localStorage.removeItem(KEY_ALL(normalizedTrustId));
    localStorage.removeItem(KEY_BY_ID(normalizedTrustId));
    localStorage.removeItem(KEY_DETAIL(normalizedTrustId));

    for (const category of CATEGORIES) {
      localStorage.removeItem(KEY_ORDER(normalizedTrustId, category));
      localStorage.removeItem(KEY_PAGES(normalizedTrustId, category));
      localStorage.removeItem(KEY_STATE(normalizedTrustId, category));
    }
  } catch {
    // ignore
  }

  console.log('[EventsStore] cache cleared trust=', normalizedTrustId);
}
