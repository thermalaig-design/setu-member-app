import { fetchFacilitiesPage, fetchFacilityById } from '../member/communityService';

const FACILITIES_TTL_MS = 5 * 60 * 1000;
const FACILITIES_CTX_TTL_MS = 5 * 60 * 1000;
const KEY_BY_ID = (scopeKey) => `fc_by_id_v1_${scopeKey}`;
const KEY_ORDER = (scopeKey) => `fc_order_v1_${scopeKey}`;
const KEY_PAGES = (scopeKey) => `fc_pages_v1_${scopeKey}`;
const KEY_STATE = (scopeKey) => `fc_state_v1_${scopeKey}`;
const KEY_DETAIL = (scopeKey) => `fc_detail_v1_${scopeKey}`;
const KEY_CONTEXT = (trustId, memberId) => `fc_ctx_v1_${trustId}_${memberId || 'anon'}`;
const KEY_ACTIVE_SCOPE = (trustId, memberId) => `fc_active_scope_v1_${trustId}_${memberId || 'anon'}`;

export const facilitiesConfig = {
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

const readActiveScope = (trustId, memberId) => {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return null;

  // Primary key format (normalized trust id).
  const normalizedKey = KEY_ACTIVE_SCOPE(normalizedTrustId, memberId);
  const normalizedScope = readJson(normalizedKey, null);
  if (normalizedScope) return normalizedScope;

  // Backward compatibility for any legacy/raw trust-id key writes.
  const rawTrustId = String(trustId || '');
  if (rawTrustId && rawTrustId !== normalizedTrustId) {
    return readJson(KEY_ACTIVE_SCOPE(rawTrustId, memberId), null);
  }
  return null;
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
const isFresh = (ts) => Number(ts) > 0 && now() - Number(ts) < FACILITIES_TTL_MS;
const isCtxFresh = (ts) => Number(ts) > 0 && now() - Number(ts) < FACILITIES_CTX_TTL_MS;

const readState = (scopeKey) => {
  const fallback = { hasMoreFacilities: true, isFacilitiesLoading: false, nextPage: 1, pageTs: {}, loadedPages: [] };
  const state = { ...fallback, ...(readJson(KEY_STATE(scopeKey), fallback) || {}) };
  state.loadedPages = Array.isArray(state.loadedPages) ? state.loadedPages.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
  return state;
};

const writeState = (scopeKey, partial) => {
  const next = { ...readState(scopeKey), ...(partial || {}) };
  writeJson(KEY_STATE(scopeKey), next);
  return next;
};

export function readFacilitiesById(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readActiveScope(trustId, memberId);
  if (!activeScope) return {};
  return readJson(KEY_BY_ID(activeScope), {});
}

export function readFacilityOrder(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readActiveScope(trustId, memberId);
  if (!activeScope) return [];
  return readJson(KEY_ORDER(activeScope), []);
}

export function readFacilityPages(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readActiveScope(trustId, memberId);
  if (!activeScope) return {};
  return readJson(KEY_PAGES(activeScope), {});
}

export function readFacilitiesProgress(trustId) {
  const memberId = resolveCurrentMemberId();
  const activeScope = readActiveScope(trustId, memberId);
  if (!activeScope) {
    return { hasMoreFacilities: true, isFacilitiesLoading: false, nextPage: 1, pageTs: {}, loadedPages: [] };
  }
  return readState(activeScope);
}

export function getFacilitiesSnapshot(trustId) {
  const byId = readFacilitiesById(trustId);
  const order = readFacilityOrder(trustId);
  const state = readFacilitiesProgress(trustId);
  return {
    facilitiesById: byId,
    facilityOrder: order,
    facilities: order.map((id) => byId[id]).filter(Boolean),
    hasMoreFacilities: Boolean(state.hasMoreFacilities),
    isFacilitiesLoading: Boolean(state.isFacilitiesLoading),
    nextPage: Number(state.nextPage) || 1
  };
}

function mergeFacilityPage(scopeKey, page, facilities, hasMore) {
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  const order = readJson(KEY_ORDER(scopeKey), []);
  const orderSet = new Set(order.map((id) => String(id)));

  const pageIds = [];
  for (const item of Array.isArray(facilities) ? facilities : []) {
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
    hasMoreFacilities: Boolean(hasMore),
    isFacilitiesLoading: false,
    nextPage: Number(page) + 1,
    loadedPages,
    pageTs: { ...(previous.pageTs || {}), [String(page)]: now() }
  });
}

const hasCompleteFacilityFields = (facility) => {
  if (!facility || typeof facility !== 'object') return false;
  if (!facility.id || !facility.name) return false;
  const requiredKeys = ['type', 'description', 'attachments', 'status', 'created_at', 'updated_at'];
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(facility, key));
};

const mergeFacilityIntoCache = (scopeKey, facility) => {
  const id = normalizeId(facility?.id);
  if (!id) return null;
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  byId[id] = { ...(byId[id] || {}), ...facility, id };
  writeJson(KEY_BY_ID(scopeKey), byId);
  return byId[id];
};

const readFacilityDetailCache = (scopeKey) => {
  const raw = readJson(KEY_DETAIL(scopeKey), {});
  return raw && typeof raw === 'object' ? raw : {};
};

const writeFacilityDetailCache = (scopeKey, facility) => {
  const id = normalizeId(facility?.id);
  if (!id) return;
  const current = readFacilityDetailCache(scopeKey);
  current[id] = { facility, ts: now() };
  writeJson(KEY_DETAIL(scopeKey), current);
};

function getCachedPage(scopeKey, page) {
  const pages = readJson(KEY_PAGES(scopeKey), {});
  const entry = pages[String(page)];
  if (!entry) return { facilities: [], isFresh: false };
  const ids = Array.isArray(entry.ids) ? entry.ids : [];
  const byId = readJson(KEY_BY_ID(scopeKey), {});
  return {
    facilities: ids.map((id) => byId[id]).filter(Boolean),
    isFresh: isFresh(entry.ts)
  };
}

async function resolveFacilitiesContext(trustId, _trustName = null, forceRefresh = false) {
  const normalizedTrustId = normalizeId(trustId);
  const memberId = resolveCurrentMemberId();
  if (!normalizedTrustId) {
    return { trustId: null, memberId, scopeKey: null };
  }

  const ctxKey = KEY_CONTEXT(normalizedTrustId, memberId);
  const cached = readJson(ctxKey, null);
  if (!forceRefresh && cached && isCtxFresh(cached.ts)) {
    const scopeKey = buildScopeKey({
      trustId: normalizedTrustId,
      memberId
    });
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

export async function loadFacilitiesPage({ trustId, trustName = null, page = 1, pageSize = facilitiesConfig.PAGE_SIZE, forceRefresh = false }) {
  const normalizedTrustId = normalizeId(trustId);
  const rawTrustId = String(trustId || '');
  const pageNo = Number(page) > 0 ? Number(page) : 1;
  const limit = Number(pageSize) > 0 ? Number(pageSize) : facilitiesConfig.PAGE_SIZE;
  if (!normalizedTrustId) return { facilities: [], hasMore: false, fromCache: true };

  const context = await resolveFacilitiesContext(normalizedTrustId, trustName, forceRefresh);
  const scopeKey = context?.scopeKey;
  if (!scopeKey) return { facilities: [], hasMore: false, fromCache: true };
  if (rawTrustId && rawTrustId !== normalizedTrustId) {
    // Keep active scope mirrored for any non-normalized caller keys.
    writeJson(KEY_ACTIVE_SCOPE(rawTrustId, context.memberId), scopeKey);
  }

  const cache = getCachedPage(scopeKey, pageNo);
  if (!forceRefresh && cache.isFresh && cache.facilities.length > 0) {
    console.log('[Facilities][Cache] hit trust=', normalizedTrustId, 'member=', context.memberId, 'page=', pageNo, 'count=', cache.facilities.length);
    return { facilities: cache.facilities, hasMore: readState(scopeKey).hasMoreFacilities, fromCache: true };
  }

  const inflightKey = `${scopeKey}:${pageNo}:${limit}`;
  if (inflight[inflightKey]) return inflight[inflightKey];

  writeState(scopeKey, { isFacilitiesLoading: true });
  console.log('[Facilities][Cache] miss trust=', normalizedTrustId, 'member=', context.memberId, 'page=', pageNo, 'fetch=api');
  inflight[inflightKey] = (async () => {
    try {
      const res = await fetchFacilitiesPage({
        trustId: normalizedTrustId,
        trustName,
        page: pageNo,
        pageSize: limit
      });
      if (!res?.success) {
        writeState(scopeKey, { isFacilitiesLoading: false });
        return { facilities: [], hasMore: false, fromCache: false, error: res?.message || 'Failed to fetch facilities' };
      }
      const facilities = Array.isArray(res?.data) ? res.data : [];
      const hasMore = typeof res?.hasMore === 'boolean' ? res.hasMore : facilities.length === limit;
      mergeFacilityPage(scopeKey, pageNo, facilities, hasMore);
      return { facilities, hasMore, fromCache: false, debug: res?.debug || null };
    } finally {
      writeState(scopeKey, { isFacilitiesLoading: false });
      delete inflight[inflightKey];
    }
  })();

  return inflight[inflightKey];
}

export async function loadFacilityDetail({ trustId, trustName = null, facilityId, forceRefresh = false }) {
  const normalizedTrustId = normalizeId(trustId);
  const normalizedFacilityId = normalizeId(facilityId);
  if (!normalizedTrustId || !normalizedFacilityId) {
    return { facility: null, fromCache: true, error: 'Missing trust or facility id' };
  }

  const context = await resolveFacilitiesContext(normalizedTrustId, trustName, false);
  const scopeKey = context?.scopeKey;
  if (!scopeKey) return { facility: null, fromCache: true, error: 'Missing facilities context' };

  const byId = readJson(KEY_BY_ID(scopeKey), {});
  const existingFacility = byId[normalizedFacilityId];
  if (!forceRefresh && hasCompleteFacilityFields(existingFacility)) {
    console.log('[Facilities][DetailCache] hit source=list trust=', normalizedTrustId, 'id=', normalizedFacilityId);
    writeFacilityDetailCache(scopeKey, existingFacility);
    return { facility: existingFacility, fromCache: true };
  }

  const detailCache = readFacilityDetailCache(scopeKey);
  const detailEntry = detailCache[normalizedFacilityId];
  if (!forceRefresh && detailEntry?.facility && isFresh(detailEntry.ts)) {
    console.log('[Facilities][DetailCache] hit source=detail trust=', normalizedTrustId, 'id=', normalizedFacilityId);
    const merged = mergeFacilityIntoCache(scopeKey, detailEntry.facility) || detailEntry.facility;
    return { facility: merged, fromCache: true };
  }

  console.log('[Facilities][DetailCache] miss trust=', normalizedTrustId, 'id=', normalizedFacilityId, 'fetch=api');
  const res = await fetchFacilityById({
    facilityId: normalizedFacilityId,
    trustId: normalizedTrustId,
    trustName
  });

  if (!res?.success) {
    return { facility: null, fromCache: false, error: res?.message || 'Failed to fetch facility details' };
  }

  const fetched = res?.data || null;
  if (!fetched) return { facility: null, fromCache: false };
  const mergedFacility = mergeFacilityIntoCache(scopeKey, fetched) || fetched;
  writeFacilityDetailCache(scopeKey, mergedFacility);
  return { facility: mergedFacility, fromCache: false };
}

export function clearFacilitiesCache(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return;
  const rawTrustId = String(trustId || '');
  const memberId = resolveCurrentMemberId();
  try {
    const cachedScope = readActiveScope(normalizedTrustId, memberId) || readActiveScope(rawTrustId, memberId);
    if (cachedScope) {
      localStorage.removeItem(KEY_BY_ID(cachedScope));
      localStorage.removeItem(KEY_ORDER(cachedScope));
      localStorage.removeItem(KEY_PAGES(cachedScope));
      localStorage.removeItem(KEY_STATE(cachedScope));
      localStorage.removeItem(KEY_DETAIL(cachedScope));
    }
    localStorage.removeItem(KEY_CONTEXT(normalizedTrustId, memberId));
    localStorage.removeItem(KEY_ACTIVE_SCOPE(normalizedTrustId, memberId));
    if (rawTrustId && rawTrustId !== normalizedTrustId) {
      localStorage.removeItem(KEY_ACTIVE_SCOPE(rawTrustId, memberId));
    }
  } catch {
    // ignore
  }
}
