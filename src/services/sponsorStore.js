import { getSponsorById, getSponsors } from './sponsorApiBackend';
import { isFresh, isRowActive } from './sponsorRules.js';

/**
 * Centralized Sponsor Store (ID normalized)
 *
 * Per trust:
 * - sponsorsById: { [id]: sponsorObject }
 * - sponsorOrder: [id1, id2, ...]
 * - sponsorBatchesLoaded: [0,1,2,...]
 * - sponsorListPages: { [pageNo]: { ids, ts } }
 * - carouselBatches: { [batchNo]: [id, ...] }
 * - hasMoreSponsors: boolean
 * - isLoadingBatch: boolean
 * - nextBatchIndex: number
 *
 * Global:
 * - sponsorDetailsCache: { [id]: { data, ts } }
 */

const TTL_CAROUSEL_MS = 15 * 60 * 1000;
const TTL_LIST_PAGE_MS = 15 * 60 * 1000;
const TTL_DETAIL_MS = 12 * 60 * 1000;
const SPONSOR_REVALIDATE_MS = 15 * 60 * 1000;

export const sponsorConfig = {
  CAROUSEL_BATCH_SIZE: 6,
  LIST_PAGE_SIZE: 10,
  CAROUSEL_SLIDE_SECONDS: 5
};

const STORAGE_VERSION = 'v5';
const SPONSOR_TIMEZONE = 'Asia/Kolkata';
const KEY_BY_ID_PREFIX = `sp_by_id_${STORAGE_VERSION}_`;
const KEY_ORDER_PREFIX = `sp_order_${STORAGE_VERSION}_`;
const KEY_LIST_PAGES_PREFIX = `sp_list_pages_${STORAGE_VERSION}_`;
const KEY_CAROUSEL_BATCHES_PREFIX = `sp_carousel_batches_${STORAGE_VERSION}_`;
const KEY_CAROUSEL_STATE_PREFIX = `sp_carousel_state_${STORAGE_VERSION}_`;
const KEY_PINNED_ID_PREFIX = `sp_pinned_id_${STORAGE_VERSION}_`;
const KEY_REFRESH_AT_PREFIX = `sp_refresh_at_${STORAGE_VERSION}_`;
const KEY_DETAIL_CACHE = 'sp_detail_cache_v3';
const sponsorDebugByTrust = {};
const memorySponsorsById = {};
const memorySponsorOrder = {};
const inFlightCarouselRequests = new Map();
const inFlightListRequests = new Map();
const inFlightTrustHydration = new Map();

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
    // ignore localStorage failures
  }
};

const now = () => Date.now();
const normalizeId = (value) => {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
};

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

// get_active_sponsors(p_trust_id) is the single source of truth for which
// sponsors are active and date-valid. The store must not re-derive that
// status from a sponsor.is_active field on the frontend.
const isSponsorActive = () => true;

const readLoggedInUserSponsorContext = (trustId = null) => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return { mobile: '', isTrustLinked: false };
    const parsed = JSON.parse(raw);
    const mobile = normalizeDigits(parsed?.Mobile || parsed?.mobile || parsed?.phone || '');
    const normalizedTrustId = normalizeId(trustId);

    if (!normalizedTrustId) {
      return { mobile, isTrustLinked: Boolean(mobile) };
    }

    const memberships = Array.isArray(parsed?.hospital_memberships) ? parsed.hospital_memberships : [];
    const hasActiveMembership = memberships.some((membership) => {
      const membershipTrustId = normalizeId(membership?.trust_id || membership?.id);
      if (membershipTrustId !== normalizedTrustId) return false;
      return membership?.is_active !== false;
    });

    const primaryTrustId = normalizeId(parsed?.primary_trust?.id || parsed?.trust?.id);
    const isTrustLinked = hasActiveMembership || primaryTrustId === normalizedTrustId;

    return { mobile, isTrustLinked };
  } catch {
    return { mobile: '', isTrustLinked: false };
  }
};

const matchesSponsorToLoggedInUser = (sponsor, userMobile) => {
  const sponsorRef = normalizeDigits(sponsor?.ref_no);
  if (!sponsorRef || !userMobile) return false;
  return sponsorRef === userMobile || sponsorRef === userMobile.slice(-10);
};

const getTodayCacheTag = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SPONSOR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
};

const getScopedTrustKey = (trustId) => {
  const normalizedTrustId = normalizeId(trustId) || 'none';
  return `${normalizedTrustId}_${getTodayCacheTag()}`;
};

const KEY_BY_ID = (trustId) => `${KEY_BY_ID_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_ORDER = (trustId) => `${KEY_ORDER_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_LIST_PAGES = (trustId) => `${KEY_LIST_PAGES_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_CAROUSEL_BATCHES = (trustId) => `${KEY_CAROUSEL_BATCHES_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_CAROUSEL_STATE = (trustId) => `${KEY_CAROUSEL_STATE_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_PINNED_ID = (trustId) => `${KEY_PINNED_ID_PREFIX}${getScopedTrustKey(trustId)}`;
const KEY_REFRESH_AT = (trustId) => `${KEY_REFRESH_AT_PREFIX}${getScopedTrustKey(trustId)}`;

const getTrustScopedPrefix = (prefix, trustId) => `${prefix}${normalizeId(trustId) || 'none'}_`;

const listScopedKeysNewestFirst = (prefix, trustId) => {
  const scopedPrefix = getTrustScopedPrefix(prefix, trustId);
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(scopedPrefix)) continue;
      keys.push(key);
    }
  } catch {
    return [];
  }
  keys.sort((a, b) => b.localeCompare(a));
  return keys;
};

const clearStaleKeysByPrefix = (prefix, trustId, keepLimit = 2) => {
  const keys = listScopedKeysNewestFirst(prefix, trustId);
  if (keys.length <= keepLimit) return;
  try {
    for (const key of keys.slice(keepLimit)) localStorage.removeItem(key);
  } catch {
    // ignore storage iteration errors
  }
};

const readMostRecentScopedJson = (prefix, trustId, fallback) => {
  const keys = listScopedKeysNewestFirst(prefix, trustId);
  for (const key of keys) {
    const parsed = readJson(key, fallback);
    if (parsed !== undefined && parsed !== null) return parsed;
  }
  return fallback;
};

const pruneStaleTrustStorage = (trustId) => {
  clearStaleKeysByPrefix(KEY_BY_ID_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_ORDER_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_LIST_PAGES_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_CAROUSEL_BATCHES_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_CAROUSEL_STATE_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_PINNED_ID_PREFIX, trustId);
  clearStaleKeysByPrefix(KEY_REFRESH_AT_PREFIX, trustId);
};

const readLastSponsorRefreshAt = (trustId) => {
  pruneStaleTrustStorage(trustId);
  try {
    return Number(localStorage.getItem(KEY_REFRESH_AT(trustId)) || 0);
  } catch {
    return 0;
  }
};

const writeLastSponsorRefreshAt = (trustId) => {
  try {
    localStorage.setItem(KEY_REFRESH_AT(trustId), String(now()));
  } catch {
    // ignore storage failures
  }
};

export function getSponsorDebugInfo(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return null;
  return sponsorDebugByTrust[normalizedTrustId] || null;
}

export function shouldRevalidateSponsors(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return false;
  const lastRefreshAt = readLastSponsorRefreshAt(normalizedTrustId);
  return !isFresh(lastRefreshAt, SPONSOR_REVALIDATE_MS);
}

const normalizeSponsor = (value) => {
  const id = normalizeId(value?.id);
  if (!id) return null;
  return { ...(value || {}), id };
};

const toUniqueSortedBatchNos = (arr) => {
  const set = new Set();
  for (const value of Array.isArray(arr) ? arr : []) {
    const batchNo = Number(value);
    if (!Number.isFinite(batchNo) || batchNo < 0) continue;
    set.add(batchNo);
  }
  return [...set].sort((a, b) => a - b);
};

function readSponsorsByIdMap(trustId) {
  pruneStaleTrustStorage(trustId);
  const persisted = readJson(KEY_BY_ID(trustId), {});
  const persistedKeys = persisted && typeof persisted === 'object' ? Object.keys(persisted) : [];
  if (persistedKeys.length > 0) {
    memorySponsorsById[trustId] = persisted;
    return persisted;
  }

  const previousSnapshot = readMostRecentScopedJson(KEY_BY_ID_PREFIX, trustId, {});
  const previousKeys = previousSnapshot && typeof previousSnapshot === 'object' ? Object.keys(previousSnapshot) : [];
  if (previousKeys.length > 0) {
    writeJson(KEY_BY_ID(trustId), previousSnapshot);
    memorySponsorsById[trustId] = previousSnapshot;
    return previousSnapshot;
  }

  return memorySponsorsById[trustId] || {};
}

function readSponsorOrderIds(trustId) {
  pruneStaleTrustStorage(trustId);
  const persisted = readJson(KEY_ORDER(trustId), []);
  if (Array.isArray(persisted) && persisted.length > 0) {
    memorySponsorOrder[trustId] = persisted;
    return persisted;
  }

  const previousOrder = readMostRecentScopedJson(KEY_ORDER_PREFIX, trustId, []);
  if (Array.isArray(previousOrder) && previousOrder.length > 0) {
    writeJson(KEY_ORDER(trustId), previousOrder);
    memorySponsorOrder[trustId] = previousOrder;
    return previousOrder;
  }

  return Array.isArray(memorySponsorOrder[trustId]) ? memorySponsorOrder[trustId] : [];
}

function reorderSponsorsForLoggedInUser(trustId, orderInput = null, byIdInput = null) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return Array.isArray(orderInput) ? orderInput : [];

  const byId = byIdInput || readSponsorsByIdMap(normalizedTrustId);
  const order = Array.isArray(orderInput) ? [...orderInput] : [...readSponsorOrderIds(normalizedTrustId)];
  if (order.length === 0) return order;

  const sponsorContext = readLoggedInUserSponsorContext(normalizedTrustId);
  if (!sponsorContext.isTrustLinked || !sponsorContext.mobile) return order;

  const matchIndex = order.findIndex((id) => matchesSponsorToLoggedInUser(byId[id], sponsorContext.mobile));
  if (matchIndex <= 0) return order;

  const [matchedId] = order.splice(matchIndex, 1);
  order.unshift(matchedId);

  writeJson(KEY_ORDER(normalizedTrustId), order);
  memorySponsorOrder[normalizedTrustId] = order;
  return order;
}

function readListPagesMap(trustId) {
  pruneStaleTrustStorage(trustId);
  return readJson(KEY_LIST_PAGES(trustId), {});
}

function readCarouselBatchesMap(trustId) {
  pruneStaleTrustStorage(trustId);
  return readJson(KEY_CAROUSEL_BATCHES(trustId), {});
}

function getDefaultCarouselState() {
  return {
    sponsorBatchesLoaded: [],
    hasMoreSponsors: true,
    isLoadingBatch: false,
    nextBatchIndex: 0,
    batchTs: {}
  };
}

function readCarouselState(trustId) {
  pruneStaleTrustStorage(trustId);
  const raw = readJson(KEY_CAROUSEL_STATE(trustId), getDefaultCarouselState());
  const merged = { ...getDefaultCarouselState(), ...(raw || {}) };
  merged.sponsorBatchesLoaded = toUniqueSortedBatchNos(merged.sponsorBatchesLoaded);
  merged.nextBatchIndex =
    Number.isFinite(Number(merged.nextBatchIndex)) && Number(merged.nextBatchIndex) >= 0
      ? Number(merged.nextBatchIndex)
      : (merged.sponsorBatchesLoaded.length ? Math.max(...merged.sponsorBatchesLoaded) + 1 : 0);
  merged.batchTs = merged.batchTs && typeof merged.batchTs === 'object' ? merged.batchTs : {};
  merged.hasMoreSponsors = Boolean(merged.hasMoreSponsors);
  merged.isLoadingBatch = Boolean(merged.isLoadingBatch);
  return merged;
}

function writeCarouselState(trustId, partial) {
  const current = readCarouselState(trustId);
  const next = { ...current, ...(partial || {}) };
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'sponsorBatchesLoaded')) {
    next.sponsorBatchesLoaded = toUniqueSortedBatchNos(partial.sponsorBatchesLoaded);
  } else {
    next.sponsorBatchesLoaded = toUniqueSortedBatchNos(next.sponsorBatchesLoaded);
  }
  next.nextBatchIndex =
    next.sponsorBatchesLoaded.length > 0
      ? Math.max(...next.sponsorBatchesLoaded) + 1
      : 0;
  writeJson(KEY_CAROUSEL_STATE(trustId), next);
  return next;
}

function readSponsorObjectsForIds(trustId, ids) {
  const byId = readSponsorsByIdMap(trustId);
  return (ids || [])
    .map((id) => byId[String(id)])
    .filter((sponsor) => Boolean(sponsor) && isSponsorActive(sponsor));
}

export function mergeByIdAndAppendOrder(trustId, sponsorList) {
  pruneStaleTrustStorage(trustId);
  const byId = readSponsorsByIdMap(trustId);
  const order = readSponsorOrderIds(trustId);
  const orderSet = new Set(order.map(String));
  const newIds = [];

  for (const item of Array.isArray(sponsorList) ? sponsorList : []) {
    const normalized = normalizeSponsor(item);
    if (!normalized) continue;
    const id = normalized.id;
    byId[id] = { ...byId[id], ...normalized };

    if (!orderSet.has(id)) {
      orderSet.add(id);
      order.push(id);
      newIds.push(id);
    }
  }

  writeJson(KEY_BY_ID(trustId), byId);
  const finalOrder = reorderSponsorsForLoggedInUser(trustId, order, byId)
    .filter((id) => {
      const sponsor = byId[id];
      return Boolean(sponsor) && isSponsorActive(sponsor);
    });
  writeJson(KEY_ORDER(trustId), finalOrder);
  memorySponsorsById[trustId] = byId;
  memorySponsorOrder[trustId] = finalOrder;

  return { byId, order: finalOrder, newIds };
}

function replaceSponsorSnapshot(trustId, sponsorList) {
  pruneStaleTrustStorage(trustId);
  const nextById = {};
  const nextOrder = [];
  const seen = new Set();

  for (const item of Array.isArray(sponsorList) ? sponsorList : []) {
    const normalized = normalizeSponsor(item);
    if (!normalized) continue;
    if (!isSponsorActive(normalized)) continue;
    const id = normalized.id;
    if (seen.has(id)) continue;
    seen.add(id);
    nextById[id] = normalized;
    nextOrder.push(id);
  }

  const finalOrder = reorderSponsorsForLoggedInUser(trustId, nextOrder, nextById)
    .filter((id) => Boolean(nextById[id]) && isSponsorActive(nextById[id]));

  writeJson(KEY_BY_ID(trustId), nextById);
  writeJson(KEY_ORDER(trustId), finalOrder);
  memorySponsorsById[trustId] = nextById;
  memorySponsorOrder[trustId] = finalOrder;

  return { byId: nextById, order: finalOrder };
}

function warmImageCache(sponsors) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  for (const sponsor of Array.isArray(sponsors) ? sponsors : []) {
    const src = sponsor?.photo_thumb_url || sponsor?.photo_url;
    if (!src) continue;
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
    } catch {
      // ignore image preload errors
    }
  }
}

export function readSponsorsById(trustId) {
  return readSponsorsByIdMap(trustId);
}

export function readSponsorOrder(trustId) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return [];
  const byId = readSponsorsByIdMap(normalizedTrustId);
  const order = reorderSponsorsForLoggedInUser(normalizedTrustId, null, byId);
  const activeOrder = order.filter((id) => {
    const sponsor = byId[id];
    return Boolean(sponsor) && isSponsorActive(sponsor);
  });

  if (activeOrder.length !== order.length) {
    writeJson(KEY_ORDER(normalizedTrustId), activeOrder);
    memorySponsorOrder[normalizedTrustId] = activeOrder;
  }

  if (activeOrder.length === 0 && Object.keys(byId).length > 0) {
    const fallbackOrder = Object.keys(byId).filter((id) => isSponsorActive(byId[id]));
    if (fallbackOrder.length > 0) {
      writeJson(KEY_ORDER(normalizedTrustId), fallbackOrder);
      memorySponsorOrder[normalizedTrustId] = fallbackOrder;
      return fallbackOrder;
    }
  }

  return activeOrder;
}

export function readCarouselProgress(trustId) {
  const state = readCarouselState(trustId);
  return {
    sponsorBatchesLoaded: state.sponsorBatchesLoaded,
    hasMoreSponsors: state.hasMoreSponsors,
    isLoadingBatch: state.isLoadingBatch,
    nextBatchIndex: state.nextBatchIndex
  };
}

export function getSponsorFromCache(trustId, sponsorId) {
  const id = normalizeId(sponsorId);
  if (!trustId || !id) return null;
  return readSponsorsByIdMap(trustId)[id] || null;
}

export function readDetailCache(sponsorId) {
  const id = normalizeId(sponsorId);
  if (!id) return { detail: null, isFresh: false };
  const cache = readJson(KEY_DETAIL_CACHE, {});
  const entry = cache[id];
  if (!entry) return { detail: null, isFresh: false };
  return { detail: entry.data || null, isFresh: isFresh(entry.ts, TTL_DETAIL_MS) };
}

export function mergeSponsorBatch(trustId, batchNo, sponsorList, options = {}) {
  if (!trustId) return { newIds: [], allOrder: [] };

  const normalizedBatchNo = Number(batchNo);
  if (!Number.isFinite(normalizedBatchNo) || normalizedBatchNo < 0) {
    return { newIds: [], allOrder: readSponsorOrderIds(trustId) };
  }

  const list = Array.isArray(sponsorList) ? sponsorList : [];
  const merged = mergeByIdAndAppendOrder(trustId, list);
  const batchIds = list.map((item) => normalizeId(item?.id)).filter(Boolean);

  const batches = readCarouselBatchesMap(trustId);
  batches[String(normalizedBatchNo)] = batchIds;
  writeJson(KEY_CAROUSEL_BATCHES(trustId), batches);

  const previousState = readCarouselState(trustId);
  const nextLoaded = toUniqueSortedBatchNos([
    ...previousState.sponsorBatchesLoaded,
    normalizedBatchNo
  ]);
  const nextBatchTs = { ...(previousState.batchTs || {}), [String(normalizedBatchNo)]: now() };
  const nextHasMore =
    typeof options.hasMore === 'boolean'
      ? options.hasMore
      : previousState.hasMoreSponsors;

  writeCarouselState(trustId, {
    sponsorBatchesLoaded: nextLoaded,
    hasMoreSponsors: nextHasMore,
    isLoadingBatch: false,
    batchTs: nextBatchTs
  });

  return { newIds: merged.newIds, allOrder: merged.order };
}

export function saveListPage(trustId, page, sponsorList) {
  if (!trustId) return;
  pruneStaleTrustStorage(trustId);
  const pageNo = Number(page);
  if (!Number.isFinite(pageNo) || pageNo <= 0) return;

  const list = Array.isArray(sponsorList) ? sponsorList : [];
  mergeByIdAndAppendOrder(trustId, list);

  const pages = readListPagesMap(trustId);
  pages[pageNo] = {
    ids: list.map((item) => normalizeId(item?.id)).filter(Boolean),
    ts: now()
  };
  writeJson(KEY_LIST_PAGES(trustId), pages);
}

export function saveDetailCache(sponsorId, detail) {
  const id = normalizeId(sponsorId);
  if (!id || !detail) return;
  const cache = readJson(KEY_DETAIL_CACHE, {});
  cache[id] = { data: { ...detail, id }, ts: now() };
  writeJson(KEY_DETAIL_CACHE, cache);
}

export function buildOrderedSponsors(trustId) {
  const order = reorderSponsorsForLoggedInUser(trustId);
  const ordered = readSponsorObjectsForIds(trustId, order);
  if (ordered.length === 0) {
    const byId = readSponsorsByIdMap(trustId);
    return Object.keys(byId)
      .map((id) => byId[id])
      .filter((sponsor) => Boolean(sponsor) && isSponsorActive(sponsor));
  }
  return ordered;
}

export function clearSponsorCache(trustId) {
  if (!trustId) return;
  try {
    localStorage.removeItem(KEY_BY_ID(trustId));
    localStorage.removeItem(KEY_ORDER(trustId));
    localStorage.removeItem(KEY_LIST_PAGES(trustId));
    localStorage.removeItem(KEY_CAROUSEL_BATCHES(trustId));
    localStorage.removeItem(KEY_CAROUSEL_STATE(trustId));
  } catch {
    // ignore
  }
  delete memorySponsorsById[trustId];
  delete memorySponsorOrder[trustId];
}

export function setPinnedSponsor(trustId, sponsor) {
  const candidateId = sponsor && typeof sponsor === 'object' ? sponsor.id : sponsor;
  const id = normalizeId(candidateId);
  if (!id) return;
  if (trustId) {
    writeJson(KEY_PINNED_ID(trustId), id);
  }
  setSelectedSponsorId(id);
}

export function readPinnedSponsorId(trustId) {
  if (!trustId) return null;
  return normalizeId(readJson(KEY_PINNED_ID(trustId), null));
}

export function clearPinnedSponsor(trustId) {
  if (!trustId) return;
  try {
    localStorage.removeItem(KEY_PINNED_ID(trustId));
  } catch {
    // ignore
  }
}

export function readSelectedSponsorId() {
  try {
    return normalizeId(sessionStorage.getItem('selectedSponsorId'));
  } catch {
    return null;
  }
}

export function setSelectedSponsorId(id) {
  const normalized = normalizeId(id);
  if (!normalized) return;
  try {
    sessionStorage.setItem('selectedSponsorId', normalized);
  } catch {
    // ignore
  }
}

export function getCachedCarouselBatch(trustId, batchIndex) {
  const batchNo = String(Number(batchIndex));
  const batches = readCarouselBatchesMap(trustId);
  const ids = Array.isArray(batches[batchNo]) ? batches[batchNo] : [];
  const state = readCarouselState(trustId);
  const ts = state.batchTs?.[batchNo] || 0;

  return {
    ids,
    sponsors: readSponsorObjectsForIds(trustId, ids),
    isFresh: isFresh(ts, TTL_CAROUSEL_MS)
  };
}

const hydrateAllSponsorPages = (trustId, sponsorList) => {
  const list = Array.isArray(sponsorList) ? sponsorList : [];
  const batches = {};
  for (let i = 0; i < list.length; i += sponsorConfig.CAROUSEL_BATCH_SIZE) {
    const batchNo = Math.floor(i / sponsorConfig.CAROUSEL_BATCH_SIZE);
    batches[String(batchNo)] = list
      .slice(i, i + sponsorConfig.CAROUSEL_BATCH_SIZE)
      .map((item) => normalizeId(item?.id))
      .filter(Boolean);
  }
  writeJson(KEY_CAROUSEL_BATCHES(trustId), batches);

  const pages = {};
  for (let i = 0; i < list.length; i += sponsorConfig.LIST_PAGE_SIZE) {
    const pageNo = Math.floor(i / sponsorConfig.LIST_PAGE_SIZE) + 1;
    pages[pageNo] = {
      ids: list.slice(i, i + sponsorConfig.LIST_PAGE_SIZE).map((item) => normalizeId(item?.id)).filter(Boolean),
      ts: now()
    };
  }
  writeJson(KEY_LIST_PAGES(trustId), pages);

  const loadedBatchNos = Object.keys(batches).map((key) => Number(key)).filter((n) => Number.isFinite(n));
  writeCarouselState(trustId, {
    sponsorBatchesLoaded: loadedBatchNos,
    hasMoreSponsors: false,
    isLoadingBatch: false,
    nextBatchIndex: loadedBatchNos.length,
    batchTs: loadedBatchNos.reduce((acc, batchNo) => {
      acc[String(batchNo)] = now();
      return acc;
    }, {})
  });
};

export async function ensureAllSponsorsLoaded(trustId, options = {}) {
  const normalizedTrustId = normalizeId(trustId);
  if (!normalizedTrustId) return [];
  const forceRefresh = Boolean(options?.force);

  const existingOrder = readSponsorOrderIds(normalizedTrustId);
  const existingById = readSponsorsByIdMap(normalizedTrustId);
  if (existingOrder.length > 0 && Object.keys(existingById || {}).length > 0) {
    const existingSponsors = readSponsorObjectsForIds(normalizedTrustId, existingOrder);
    const existingBatchZero = getCachedCarouselBatch(normalizedTrustId, 0);
    const existingPages = readListPagesMap(normalizedTrustId);
    const hasDerivedCaches =
      existingBatchZero.sponsors.length > 0 ||
      Object.keys(existingPages || {}).length > 0;
    if (!hasDerivedCaches) {
      hydrateAllSponsorPages(normalizedTrustId, existingSponsors);
    }
    const lastRefreshAt = readLastSponsorRefreshAt(normalizedTrustId);
    if (!forceRefresh && isFresh(lastRefreshAt, SPONSOR_REVALIDATE_MS)) {
      return existingSponsors;
    }
  }

  const existing = inFlightTrustHydration.get(normalizedTrustId);
  if (existing) return existing;

  const request = (async () => {
    const res = await getSponsors(normalizedTrustId, { force: forceRefresh });
    sponsorDebugByTrust[normalizedTrustId] = res?.debug || null;
    const sponsors = Array.isArray(res?.data) ? res.data : [];
    const replaced = replaceSponsorSnapshot(normalizedTrustId, sponsors);
    hydrateAllSponsorPages(normalizedTrustId, replaced.order.map((id) => replaced.byId[id]).filter(Boolean));
    writeLastSponsorRefreshAt(normalizedTrustId);
    warmImageCache(replaced.order.map((id) => replaced.byId[id]).filter(Boolean));
    return replaced.order.map((id) => replaced.byId[id]).filter(Boolean);
  })().finally(() => {
    inFlightTrustHydration.delete(normalizedTrustId);
  });

  inFlightTrustHydration.set(normalizedTrustId, request);
  return request;
}

export async function getCarouselBatch({ trustId, batchIndex, batchSize = sponsorConfig.CAROUSEL_BATCH_SIZE }) {
  const normalizedBatch = Number(batchIndex);
  const limit = Number(batchSize) || sponsorConfig.CAROUSEL_BATCH_SIZE;
  if (!trustId || !Number.isFinite(normalizedBatch) || normalizedBatch < 0) {
    return { sponsors: [], hasMore: false };
  }

  const cached = getCachedCarouselBatch(trustId, normalizedBatch);
  const state = readCarouselState(trustId);
  if (cached.sponsors.length > 0 && cached.isFresh) {
    const loaded = state.sponsorBatchesLoaded.includes(normalizedBatch)
      ? state.sponsorBatchesLoaded
      : [...state.sponsorBatchesLoaded, normalizedBatch];
    writeCarouselState(trustId, {
      sponsorBatchesLoaded: loaded,
      isLoadingBatch: false
    });
    return { sponsors: cached.sponsors, hasMore: state.hasMoreSponsors };
  }

  const requestKey = `${trustId}|${normalizedBatch}|${limit}`;
  const existing = inFlightCarouselRequests.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    writeCarouselState(trustId, { isLoadingBatch: true });
    await ensureAllSponsorsLoaded(trustId);
    const refreshed = getCachedCarouselBatch(trustId, normalizedBatch);
    const ordered = buildOrderedSponsors(trustId);
    const maxBatchIndex = Math.max(0, Math.ceil(ordered.length / limit) - 1);
    return {
      sponsors: refreshed.sponsors,
      hasMore: normalizedBatch < maxBatchIndex
    };
  })().finally(() => {
    inFlightCarouselRequests.delete(requestKey);
  });

  inFlightCarouselRequests.set(requestKey, request);
  return request;
}

export async function preloadCarouselBatchImages({ trustId, batchIndex }) {
  const cached = getCachedCarouselBatch(trustId, batchIndex);
  if (cached.sponsors.length > 0) {
    warmImageCache(cached.sponsors);
    if (cached.isFresh) {
      const progress = readCarouselProgress(trustId);
      return { sponsors: cached.sponsors, hasMore: progress.hasMoreSponsors };
    }
  }
  return getCarouselBatch({ trustId, batchIndex, batchSize: sponsorConfig.CAROUSEL_BATCH_SIZE });
}

export async function prefetchCarouselBatch({ trustId, batchIndex }) {
  return getCarouselBatch({ trustId, batchIndex, batchSize: sponsorConfig.CAROUSEL_BATCH_SIZE });
}

export function getCachedListPage(trustId, page) {
  const pageNo = Number(page);
  const entry = readListPagesMap(trustId)[pageNo];
  if (!entry) return { sponsors: [], ids: [], isFresh: false };
  const ids = Array.isArray(entry.ids) ? entry.ids : [];
  return {
    ids,
    sponsors: readSponsorObjectsForIds(trustId, ids),
    isFresh: isFresh(entry.ts, TTL_LIST_PAGE_MS)
  };
}

export async function getListPage({ trustId, page = 1, pageSize = sponsorConfig.LIST_PAGE_SIZE }) {
  const pageNo = Number(page) || 1;
  const limit = Number(pageSize) || sponsorConfig.LIST_PAGE_SIZE;
  const cached = getCachedListPage(trustId, pageNo);

  if (cached.isFresh) {
    return { sponsors: cached.sponsors, hasMore: cached.sponsors.length === limit };
  }

  const requestKey = `${trustId}|${pageNo}|${limit}`;
  const existing = inFlightListRequests.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    await ensureAllSponsorsLoaded(trustId);
    const refreshed = getCachedListPage(trustId, pageNo);
    const sponsors = Array.isArray(refreshed?.sponsors) ? refreshed.sponsors : [];
    const total = buildOrderedSponsors(trustId).length;
    const hasMore = pageNo * limit < total;
    return { sponsors, hasMore };
  })().finally(() => {
    inFlightListRequests.delete(requestKey);
  });

  inFlightListRequests.set(requestKey, request);
  return request;
}
export function flattenListPages(trustId, pages, includePinned = false) {
  const byId = readSponsorsByIdMap(trustId);
  const listPages = readListPagesMap(trustId);
  const mergedIds = [];
  const seen = new Set();

  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNo = Number(page);
    const ids = listPages[pageNo]?.ids || [];
    for (const id of ids) {
      const normalized = normalizeId(id);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      mergedIds.push(normalized);
    }
  }

  if (includePinned) {
    const pinnedId = readPinnedSponsorId(trustId) || readSelectedSponsorId();
    if (pinnedId && byId[pinnedId]) {
      const rest = mergedIds.filter((id) => id !== pinnedId);
      mergedIds.length = 0;
      mergedIds.push(pinnedId, ...rest);
    }
  }

  return mergedIds
    .map((id) => byId[id])
    .filter((sponsor) => Boolean(sponsor) && isSponsorActive(sponsor));
}

export async function preloadSponsorListFirstPage(trustId) {
  if (!trustId) return;
  const cached = getCachedListPage(trustId, 1);
  if (cached.sponsors.length > 0 && cached.isFresh) return;
  await ensureAllSponsorsLoaded(trustId);
}

export async function getSponsorListTotalCount(trustId) {
  if (!trustId) return 0;
  await ensureAllSponsorsLoaded(trustId);
  return buildOrderedSponsors(trustId).length;
}

export function getCachedSponsorById(sponsorId, trustId = null) {
  const id = normalizeId(sponsorId);
  if (!id) return null;

  if (trustId) {
    const direct = readSponsorsByIdMap(trustId)[id];
    if (direct) return direct;
  }

  const trustKeyPrefix = KEY_BY_ID_PREFIX;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(trustKeyPrefix)) continue;
      const byId = readJson(key, {});
      if (byId[id]) return byId[id];
    }
  } catch {
    // ignore storage iteration errors
  }
  return null;
}

export function getCachedSponsorDetail(sponsorId) {
  return readDetailCache(sponsorId);
}

export async function getSponsorDetail({ sponsorId, trustId = null }) {
  const id = normalizeId(sponsorId);
  if (!id) return null;

  const cachedDetail = readDetailCache(id);
  if (cachedDetail.detail && cachedDetail.isFresh) {
    return cachedDetail.detail;
  }

  const sponsorMeta = getCachedSponsorById(id, trustId);
  if (sponsorMeta && !cachedDetail.detail) {
    saveDetailCache(id, sponsorMeta);
  }

  const res = await getSponsorById(id, trustId);
  const detail = Array.isArray(res?.data) ? res.data[0] : null;
  if (!detail) return sponsorMeta || cachedDetail.detail || null;

  saveDetailCache(id, detail);
  if (trustId) {
    mergeByIdAndAppendOrder(trustId, [detail]);
  }

  return detail;
}