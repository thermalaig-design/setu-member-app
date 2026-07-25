import { supabase } from './supabaseClient.js';
import { getUserHospitalMemberships } from '../utils/storageUtils.js';

const ORDER_HISTORY_STORAGE_KEYS = ['order_history_v1', 'order_history', 'orders_v1'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : text;
};

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readStoredUser = () => {
  if (typeof window === 'undefined') return {};

  const parsed = safeParse(window.localStorage.getItem('user') || '');
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const extractOrderRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value.orders)) return value.orders;
  if (Array.isArray(value.history)) return value.history;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.result)) return value.result;

  return [];
};

const getStoredOrderRows = () => {
  if (typeof window === 'undefined') return [];

  for (const key of ORDER_HISTORY_STORAGE_KEYS) {
    const parsed = safeParse(window.localStorage.getItem(key) || '');
    const rows = extractOrderRows(parsed);
    if (rows.length > 0) {
      return rows.filter((row) => row && typeof row === 'object');
    }
  }

  return [];
};

const normalizeTrustContext = (trustId, trustName = null) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return null;

  return {
    trustId: normalizedTrustId,
    trustName: normalizeText(trustName) || null,
  };
};

export const resolveOrderHistoryTrustContexts = (user = null) => {
  const resolvedUser = user && typeof user === 'object' ? user : {};
  const trustContexts = [];
  const seenTrustIds = new Set();

  const addTrust = (trustId, trustName = null) => {
    const context = normalizeTrustContext(trustId, trustName);
    if (!context) return;
    const key = context.trustId.toLowerCase();
    if (seenTrustIds.has(key)) return;
    seenTrustIds.add(key);
    trustContexts.push(context);
  };

  const memberships = getUserHospitalMemberships(resolvedUser);
  memberships.forEach((membership) => {
    addTrust(membership?.trust_id || membership?.trust?.id, membership?.trust_name || membership?.trust?.name);
  });

  addTrust(resolvedUser?.primary_trust?.id, resolvedUser?.primary_trust?.name);
  addTrust(resolvedUser?.trust?.id, resolvedUser?.trust?.name);

  if (typeof window !== 'undefined') {
    addTrust(window.localStorage.getItem('selected_trust_id'), window.localStorage.getItem('selected_trust_name'));
    addTrust(window.localStorage.getItem('last_selected_trust_id'), window.localStorage.getItem('selected_trust_name'));
  }

  return trustContexts;
};

export const resolveOrderHistoryMemberId = (user = null) => {
  const resolvedUser = user && typeof user === 'object' ? user : {};
  const candidates = [];

  const pushCandidate = (value) => {
    const text = normalizeText(value);
    if (text) candidates.push(text);
  };

  pushCandidate(resolvedUser?.member_uuid);
  pushCandidate(resolvedUser?.members_uuid);
  pushCandidate(resolvedUser?.members_id);
  pushCandidate(resolvedUser?.member_id);

  if (Array.isArray(resolvedUser?.member_ids)) {
    resolvedUser.member_ids.forEach(pushCandidate);
  }

  const memberships = getUserHospitalMemberships(resolvedUser);
  memberships.forEach((membership) => {
    pushCandidate(membership?.member_uuid);
    pushCandidate(membership?.members_uuid);
    pushCandidate(membership?.members_id);
    pushCandidate(membership?.member_id);
  });

  pushCandidate(resolvedUser?.id);

  return candidates.find(isUuid) || '';
};

const getOrderIdentityKey = (row = {}) => {
  const trustId = normalizeText(
    row?.trust_id
    || row?.trustId
    || row?.source_trust_id
    || row?.sourceTrustId
  );
  const orderId = normalizeText(
    row?.order_id
    || row?.orderId
    || row?.invoice_no
    || row?.invoice_number
    || row?.reference
    || row?.id
  );

  return `${trustId.toLowerCase() || 'global'}::${orderId.toLowerCase() || 'unknown'}`;
};

const dedupeOrderRows = (rows = []) => {
  const seen = new Set();
  const deduped = [];

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const key = getOrderIdentityKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });

  return deduped;
};

const extractRpcPayloadRows = (data) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  if (data.success === false) return extractOrderRows(data);

  return extractOrderRows(data);
};

export const getStoredOrderHistoryRows = () => getStoredOrderRows();

export const fetchOrdersForTrust = async ({ memberId, trustId, trustName = null }) => {
  const normalizedMemberId = normalizeText(memberId);
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedMemberId || !normalizedTrustId) return [];

  const { data, error } = await supabase.rpc('manage_purchase_by_member', {
    p_member_id: normalizedMemberId,
    p_trust_id: normalizedTrustId,
    p_action: 'get',
  });

  if (error) throw error;

  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(normalizeText(data.message) || `Failed to load order history for trust ${normalizedTrustId}`);
  }

  const rows = extractRpcPayloadRows(data);
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const resolvedTrustId = normalizeText(row?.trust_id || row?.trustId) || normalizedTrustId;
      const resolvedTrustName = normalizeText(row?.trust_name || row?.trustName || trustName) || null;

      return {
        ...row,
        trust_id: resolvedTrustId,
        trust_name: resolvedTrustName,
        source: normalizeText(row?.source || row?.sourceType || row?.source_type) || 'rpc',
        source_trust_id: normalizedTrustId,
        source_trust_name: resolvedTrustName,
      };
    });
};

export const loadOrderHistorySnapshot = async ({ user = null } = {}) => {
  const resolvedUser = user && typeof user === 'object' ? user : readStoredUser();
  const memberId = resolveOrderHistoryMemberId(resolvedUser);
  const trustContexts = resolveOrderHistoryTrustContexts(resolvedUser);
  const localRows = getStoredOrderHistoryRows();

  if (!memberId || trustContexts.length === 0) {
    return {
      rows: dedupeOrderRows(localRows),
      localRows,
      remoteRows: [],
      trustContexts,
      trustErrors: memberId ? [] : [{
        trustId: null,
        trustName: null,
        message: 'Missing member identifier for remote order history',
      }],
      memberId,
      hasRemoteOrders: false,
    };
  }

  const settledResults = await Promise.allSettled(
    trustContexts.map((trustContext) =>
      fetchOrdersForTrust({
        memberId,
        trustId: trustContext.trustId,
        trustName: trustContext.trustName,
      })
    )
  );

  const remoteRows = [];
  const trustErrors = [];

  settledResults.forEach((result, index) => {
    const trustContext = trustContexts[index] || {};
    if (result.status === 'fulfilled') {
      remoteRows.push(...result.value);
      return;
    }

    trustErrors.push({
      trustId: trustContext.trustId || null,
      trustName: trustContext.trustName || trustContext.trustId || null,
      message: normalizeText(result.reason?.message) || 'Failed to load order history for one trust',
    });
  });

  return {
    rows: dedupeOrderRows([...remoteRows, ...localRows]),
    localRows,
    remoteRows,
    trustContexts,
    trustErrors,
    memberId,
    hasRemoteOrders: remoteRows.length > 0,
  };
};

