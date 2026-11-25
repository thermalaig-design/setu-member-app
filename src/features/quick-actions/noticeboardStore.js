import { fetchNoticeboardById, fetchNoticeboardPage } from '../member/communityService';

const NOTICEBOARD_TTL_MS = 5 * 60 * 1000;
const NOTICEBOARD_CTX_TTL_MS = 5 * 60 * 1000;
const KEY_BY_ID = (scopeKey) => `nb_by_id_v2_${scopeKey}`;
const KEY_ORDER = (scopeKey) => `nb_order_v2_${scopeKey}`;
const KEY_PAGES = (scopeKey) => `nb_pages_v2_${scopeKey}`;
const KEY_STATE = (scopeKey) => `nb_state_v2_${scopeKey}`;
const KEY_DETAIL = (scopeKey) => `nb_detail_v1_${scopeKey}`;
const KEY_CONTEXT = (trustId, memberId) => `nb_ctx_v2_${trustId}_${memberId || 'anon'}`;
const KEY_ACTIVE_SCOPE = (trustId, memberId) => `nb_active_scope_v2_${trustId}_${memberId || 'anon'}`;

export const noticeboardConfig = {
  PAGE_SIZE: 10
};

const inflight = {};

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
    // ignore cache writes
  }
};

const normalizeId = (value) => {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
};

const resolveCurrentMemberId = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const candidate = parsed?.members_id || parsed?.member_id || parsed?.id || null;
    const id = candidate ? String(candidate).trim() : '';
    return id || null;
  } catch {
    return null;
  }
};

const buildScopeKey = ({ trustId, memberId }) => {
  const normalizedTrustId = normalizeId(trustId) || 'unknown-trust';
  const normalizedMemberId = normalizeId(memberId) || 'anon';
  return `${normalizedTrustId}__${normalizedMemberId}`;
};

const now = () => Date.now();
const isFresh = (ts) => Number(ts) > 0 && now() - Number(ts) < NOTICEBOARD_TTL_MS;

const readState = (scopeKey) => {
  const fallback = { hasMoreNotices: true, isNoticeboardLoading: false, nextPage: 1, pageTs: {}, loadedPages: [] };
  const state = { ...fallback, ...(readJson(KEY_STATE(scopeKey), fallback) || {}) };
  state.loadedPages = Array.isArray(state.loadedPages) ? state.loadedPages.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
  return state;
};

const writeState = (scopeKey, partial) => {
  const next = { ...readState(scopeKey), ...(partial || {}) };
  writeJson(KEY_STATE(scopeKey), next);
  return next;
};

export function readNoticesById(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  if (!trustId || !activeScope) return {};
  return readJson(KEY_BY_ID(activeScope), {});
}

export function readNoticeOrder(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  if (!trustId || !activeScope) return [];
  return readJson(KEY_ORDER(activeScope), []);
}

export function readNoticeboardPages(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  if (!trustId || !activeScope) return {};
  return readJson(KEY_PAGES(activeScope), {});
}

export function readNoticeboardProgress(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  if (!activeScope) {
    return { hasMoreNotices: true, isNoticeboardLoading: false, nextPage: 1, pageTs: {}, loadedPages: [] };
  }
  return readState(activeScope);
}

export function getNoticeboardSnapshot(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  const hasCachedData = Boolean(activeScope);
  const byId = readNoticesById(trustId);
  const order = readNoticeOrder(trustId);
  const state = readNoticeboardProgress(trustId);
  const notices = order.map((id) => byId[id]).filter(Boolean);
  return {
    noticesById: byId,
    noticeOrder: order,
    notices,
    hasCachedData,          // true = scope exists in cache, false = never fetched
    hasMoreNotices: Boolean(state.hasMoreNotices),
    isNoticeboardLoading: Boolean(state.isNoticeboardLoading),
    nextPage: Number(state.nextPage) || 1
  };
}

export function getNoticeboardCacheStatus(trustId, page = 1) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readJson(KEY_ACTIVE_SCOPE(trustId, memberId), null);
  if (!trustId || !activeScope) {
    return {
      hasCachedScope: false,
      hasCachedNotices: false,
      isPageFresh: false,
      lastPageTs: 0
    };
  }

  const cache = getCachedPage(activeScope, page);
  return {
    hasCachedScope: true,
    hasCachedNotices: Array.isArray(cache.notices) && cache.notices.length > 0,
    isPageFresh: Boolean(cache.isFresh),
    lastPageTs: readJson(KEY_PAGES(activeScope), {})?.[String(page)]?.ts || 0
  };
}

function mergeNoticePage(scopeKey, page, notices, hasMore) {
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  const order = readJson(KEY_ORDER(scopeKey), []);
  const orderSet = new Set(order.map((id) => String(id)));

  const pageIds = [];
  for (const item of Array.isArray(notices) ? notices : []) {
    const id = normalizeId(item?.id);
    if (!id) continue;
    byId[id] = { ...(byId[id] || {}), ...item, id };
    pageIds.push(id);
    if (!orderSet.has(id)) {
      orderSet.add(id);
      order.push(id);
    }
  }

  const pages = readJson(KEY_PAGES(scopeKey), {});
  pages[String(page)] = { ids: pageIds, ts: now() };

  writeJson(KEY_BY_ID(scopeKey), byId);
  writeJson(KEY_ORDER(scopeKey), order);
  writeJson(KEY_PAGES(scopeKey), pages);

  const previous = readState(scopeKey);
  const loadedPagesSet = new Set([...(previous.loadedPages || []), Number(page)]);
  const loadedPages = [...loadedPagesSet].sort((a, b) => a - b);
  writeState(scopeKey, {
    hasMoreNotices: Boolean(hasMore),
    isNoticeboardLoading: false,
    nextPage: Number(page) + 1,
    loadedPages,
    pageTs: { ...(previous.pageTs || {}), [String(page)]: now() }
  });
}

const hasCompleteNoticeFields = (notice) => {
  if (!notice || typeof notice !== 'object') return false;
  if (!notice.id || !notice.name) return false;
  const requiredKeys = ['type', 'description', 'attachments', 'start_date', 'end_date'];
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(notice, key));
};

const mergeNoticeIntoCache = (scopeKey, notice) => {
  const id = normalizeId(notice?.id);
  if (!id) return null;
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  byId[id] = { ...(byId[id] || {}), ...notice, id };
  writeJson(KEY_BY_ID(scopeKey), byId);
  return byId[id];
};

const readNoticeDetailCache = (scopeKey) => {
  const raw = readJson(KEY_DETAIL(scopeKey), {});
  return raw && typeof raw === 'object' ? raw : {};
};

const writeNoticeDetailCache = (scopeKey, notice) => {
  const id = normalizeId(notice?.id);
  if (!id) return;
  const current = readNoticeDetailCache(scopeKey);
  current[id] = { notice, ts: now() };
  writeJson(KEY_DETAIL(scopeKey), current);
};

function getCachedPage(scopeKey, page) {
  const pages = readJson(KEY_PAGES(scopeKey), {});
  const entry = pages[String(page)];
  if (!entry) return { notices: [], isFresh: false };
  const ids = Array.isArray(entry.ids) ? entry.ids : [];
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  return {
    notices: ids.map((id) => byId[id]).filter(Boolean),
    isFresh: isFresh(entry.ts)
  };
}

async function resolveNoticeboardContext(trustId, trustName = null, forceRefresh = false) {
  const normalizedTrustId = normalizeId(trustId);
  const memberId = resolveCurrentMemberId();
  if (!normalizedTrustId) {
    return { trustId: null, memberId, scopeKey: null };
  }

  const ctxKey = KEY_CONTEXT(normalizedTrustId, memberId);
  const cached = readJson(ctxKey, null);
  if (!forceRefresh && cached && isFresh(cached.ts)) {
    const scopeKey = buildScopeKey({ trustId: normalizedTrustId, memberId });
    writeJson(KEY_ACTIVE_SCOPE(normalizedTrustId, memberId), scopeKey);
    return {
      trustId: normalizedTrustId,
      memberId,
      scopeKey,
      fromCache: true
    };
  }

  const scopeKey = buildScopeKey({ trustId: normalizedTrustId, memberId });
  writeJson(ctxKey, { ts: now() });
  writeJson(KEY_ACTIVE_SCOPE(normalizedTrustId, memberId), scopeKey);
  return { trustId: normalizedTrustId, memberId, scopeKey, fromCache: false };
}

export async function loadNoticeboardPage({ trustId, trustName = null, page = 1, pageSize = noticeboardConfig.PAGE_SIZE, forceRefresh = false }) {
  const normalizedTrustId = normalizeId(trustId);
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  const limit = Number(pageSize) > 0 ? Number(pageSize) : noticeboardConfig.PAGE_SIZE;
  if (!normalizedTrustId) return { notices: [], hasMore: false, fromCache: true };

  const context = await resolveNoticeboardContext(normalizedTrustId, trustName, forceRefresh);
  const scopeKey = context?.scopeKey;
  if (!scopeKey) return { notices: [], hasMore: false, fromCache: true };

  const cache = getCachedPage(scopeKey, pageNo);
  if (!forceRefresh && cache.isFresh && cache.notices.length > 0) {
    console.log('[Noticeboard][Cache] hit trust=', normalizedTrustId, 'member=', context.memberId, 'page=', pageNo, 'count=', cache.notices.length);
    return { notices: cache.notices, hasMore: readState(scopeKey).hasMoreNotices, fromCache: true };
  }

  const inflightKey = `${scopeKey}:${pageNo}:${limit}`;
  if (inflight[inflightKey]) return inflight[inflightKey];

  writeState(scopeKey, { isNoticeboardLoading: true });
  console.log('[Noticeboard][Cache] miss trust=', normalizedTrustId, 'member=', context.memberId, 'page=', pageNo, 'fetch=api');
  inflight[inflightKey] = (async () => {
    try {
      const res = await fetchNoticeboardPage({
        trustId: normalizedTrustId,
        trustName,
        page: pageNo,
        pageSize: limit
      });
      if (!res?.success) {
        writeState(scopeKey, { isNoticeboardLoading: false });
        return { notices: [], hasMore: false, fromCache: false, error: res?.message || 'Failed to fetch notices' };
      }
      const notices = Array.isArray(res?.data) ? res.data : [];
      const hasMore = typeof res?.hasMore === 'boolean' ? res.hasMore : notices.length === limit;
      mergeNoticePage(scopeKey, pageNo, notices, hasMore);
      return { notices, hasMore, fromCache: false, debug: res?.debug || null };
    } finally {
      writeState(scopeKey, { isNoticeboardLoading: false });
      delete inflight[inflightKey];
    }
  })();

  return inflight[inflightKey];
}

export async function loadNoticeDetail({ trustId, trustName = null, noticeId, forceRefresh = false }) {
  const normalizedTrustId = normalizeId(trustId);
  const normalizedNoticeId = normalizeId(noticeId);
  if (!normalizedTrustId || !normalizedNoticeId) {
    return { notice: null, fromCache: true, error: 'Missing trust or notice id' };
  }

  const context = await resolveNoticeboardContext(normalizedTrustId, trustName, false);
  const scopeKey = context?.scopeKey;
  if (!scopeKey) return { notice: null, fromCache: true, error: 'Missing noticeboard context' };

  const byId = readJson(KEY_BY_ID(scopeKey), {});
  const existingNotice = byId[normalizedNoticeId];
  if (!forceRefresh && hasCompleteNoticeFields(existingNotice)) {
    writeNoticeDetailCache(scopeKey, existingNotice);
    return { notice: existingNotice, fromCache: true };
  }

  const detailCache = readNoticeDetailCache(scopeKey);
  const detailEntry = detailCache[normalizedNoticeId];
  if (!forceRefresh && detailEntry?.notice && isFresh(detailEntry.ts)) {
    const merged = mergeNoticeIntoCache(scopeKey, detailEntry.notice) || detailEntry.notice;
    return { notice: merged, fromCache: true };
  }

  const res = await fetchNoticeboardById({
    noticeId: normalizedNoticeId,
    trustId: normalizedTrustId,
    trustName,
  });

  if (!res?.success) {
    return { notice: null, fromCache: false, error: res?.message || 'Failed to fetch notice details' };
  }

  const fetched = res?.data || null;
  if (!fetched) return { notice: null, fromCache: false };
  const mergedNotice = mergeNoticeIntoCache(scopeKey, fetched) || fetched;
  writeNoticeDetailCache(scopeKey, mergedNotice);
  return { notice: mergedNotice, fromCache: false };
}

export function clearNoticeboardCache(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return;
  const memberId = resolveCurrentMemberId();
  try {
    const cachedScope = readJson(KEY_ACTIVE_SCOPE(normalizedTrustId, memberId), null);
    if (cachedScope) {
      localStorage.removeItem(KEY_BY_ID(cachedScope));
      localStorage.removeItem(KEY_ORDER(cachedScope));
      localStorage.removeItem(KEY_PAGES(cachedScope));
      localStorage.removeItem(KEY_STATE(cachedScope));
      localStorage.removeItem(KEY_DETAIL(cachedScope));
    }
    localStorage.removeItem(KEY_CONTEXT(normalizedTrustId, memberId));
    localStorage.removeItem(KEY_ACTIVE_SCOPE(normalizedTrustId, memberId));
  } catch {
    // ignore
  }
}

/** Wipes ALL noticeboard-related keys from localStorage (for debugging / hard reset) */
export function clearAllNoticeboardCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('nb_') || k.startsWith('noticeboard'))) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    console.log('[Noticeboard] Cleared', keysToRemove.length, 'cache keys');
  } catch {
    // ignore
  }
}
