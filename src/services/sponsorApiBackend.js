import {
  api,
  getSponsors as getSponsorsDirect
} from './api';
import { supabase } from './supabaseClient.js';
import { isDateValidForToday, isRowActive, toYmdOnly } from './sponsorRules.js';

const inFlight = new Map();

const normalizeTrustId = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const runDedupe = async (key, factory) => {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await factory();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
};

const shouldFallbackToDirectFetch = (error) => {
  const status = Number(error?.response?.status || 0);
  if ([500, 502, 503, 504].includes(status)) return true;
  return !error?.response;
};

const getSponsorByIdDirect = async (id, trustId = null) => {
  const sponsorId = String(id || '').trim();
  const normalizedTrustId = normalizeTrustId(trustId);
  if (!sponsorId) return { success: true, data: [] };

  const { data: sponsor, error: sponsorError } = await supabase
    .from('sponsors')
    .select('*')
    .eq('id', sponsorId)
    .maybeSingle();

  if (sponsorError) throw sponsorError;
  if (!sponsor) return { success: true, data: [] };
  if (!isRowActive(sponsor)) return { success: true, data: [] };

  if (normalizedTrustId) {
    const { data: flashRows, error: flashError } = await supabase
      .from('sponsor_flash')
      .select('*')
      .eq('trust_id', normalizedTrustId)
      .eq('sponsor_id', sponsorId);

    if (flashError) throw flashError;

    const today = toYmdOnly(new Date()) || '';
    const validRows = (Array.isArray(flashRows) ? flashRows : []).filter((row) => isRowActive(row) && isDateValidForToday(row, today));
    if (!validRows.length) return { success: true, data: [] };

    const flash = validRows[0];
    return {
      success: true,
      data: [{
        ...sponsor,
        flash_id: flash.id,
        sponsor_id: sponsorId,
        trust_id: flash.trust_id,
        duration_seconds: Number(flash.duration_seconds) > 0 ? Number(flash.duration_seconds) : 5,
        start_date: flash.start_date || null,
        end_date: flash.end_date || null,
        flash_created_at: flash.created_at || null
      }]
    };
  }

  return { success: true, data: [sponsor] };
};

export const getSponsors = async (
  trustId = null,
  trustName = null,
  { page = 1, limit = null, offset = null, view = 'carousel', all = false, force = false } = {}
) => {
  const normalizedTrustId = normalizeTrustId(trustId);
  const normalizedTrustName = String(trustName || '').trim() || null;
  const pageNo = Number(page) > 0 ? Math.floor(Number(page)) : 1;
  const limitNo = Number(limit) > 0 ? Math.floor(Number(limit)) : null;
  const offsetNo = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : null;
  const normalizedView = String(view || 'carousel').toLowerCase() === 'list' ? 'list' : 'carousel';
  const normalizedAll = Boolean(all);
  const normalizedForce = Boolean(force);

  const requestKey = [
    'sponsors',
    normalizedTrustId || 'none',
    normalizedTrustName || 'none',
    normalizedView,
    pageNo,
    limitNo === null ? 'auto' : limitNo,
    offsetNo === null ? 'auto' : offsetNo,
    normalizedAll ? 'all' : 'paged',
    normalizedForce ? 'force' : 'cache'
  ].join('|');

  return runDedupe(requestKey, async () => {
    const params = { view: normalizedView, page: pageNo };
    if (normalizedTrustId) params.trust_id = normalizedTrustId;
    if (normalizedTrustName) params.trust_name = normalizedTrustName;
    if (limitNo !== null) params.limit = limitNo;
    if (offsetNo !== null) params.offset = offsetNo;
    if (normalizedAll) params.all = 'true';
    if (normalizedForce) params.force = 'true';

    try {
      const response = await api.get('/sponsors/active', { params });
      return response?.data || { success: true, data: [], hasMore: false };
    } catch (error) {
      if (!shouldFallbackToDirectFetch(error)) throw error;
      console.warn('[SponsorAPI] Backend sponsor feed failed, falling back to direct fetch.', {
        status: error?.response?.status || null,
        trustId: normalizedTrustId,
        trustName: normalizedTrustName,
        view: normalizedView
      });
      return getSponsorsDirect(normalizedTrustId, normalizedTrustName, {
        page: pageNo,
        limit: limitNo,
        offset: offsetNo,
        view: normalizedView
      });
    }
  });
};

export const getAllSponsorsForTrust = async (trustId) => {
  const normalizedTrustId = normalizeTrustId(trustId);
  if (!normalizedTrustId) return { success: true, data: [], total: 0 };

  const response = await getSponsors(normalizedTrustId, null, {
    view: 'list',
    page: 1,
    limit: 100,
    offset: 0,
    all: true
  });

  const data = Array.isArray(response?.data) ? response.data : [];
  return {
    success: true,
    data,
    total: data.length,
    debug: response?.debug || null
  };
};

export const getSponsorById = async (id, trustId = null) => {
  const params = {};
  const normalizedTrustId = normalizeTrustId(trustId);
  if (normalizedTrustId) params.trust_id = normalizedTrustId;
  try {
    const response = await api.get(`/sponsors/${id}`, { params });
    const payload = response?.data || {};
    const sponsor = payload?.data || null;
    return { success: true, data: sponsor ? [sponsor] : [] };
  } catch (error) {
    if (!shouldFallbackToDirectFetch(error)) throw error;
    console.warn('[SponsorAPI] Backend sponsor detail failed, falling back to direct fetch.', {
      status: error?.response?.status || null,
      sponsorId: id,
      trustId: normalizedTrustId
    });
    return getSponsorByIdDirect(id, normalizedTrustId);
  }
};
