import { api } from '../../shared/services/api';
import { supabase } from '../../shared/services/supabaseClient.js';
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

// Single source of truth for the sponsor listing/carousel flow: the
// get_active_sponsors(p_trust_id) RPC already applies trust_id, active
// status, and start/end date validity — no backend API call and no
// fallback query are made here.
export const getSponsors = async (trustId = null, { force = false } = {}) => {
  const normalizedTrustId = normalizeTrustId(trustId);
  const normalizedForce = Boolean(force);

  if (!normalizedTrustId) {
    return {
      success: true,
      data: [],
      hasMore: false,
      debug: { trustId: null, reason: 'No trust_id resolved from app context.' }
    };
  }

  const requestKey = `sponsors|${normalizedTrustId}|${normalizedForce ? 'force' : 'cache'}`;

  return runDedupe(requestKey, async () => {
    const { data, error } = await supabase.rpc('get_active_sponsors', {
      p_trust_id: normalizedTrustId
    });

    if (error) {
      console.error('[Sponsor] get_active_sponsors RPC failed:', error);
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const mapped = rows
      .filter((row) => row?.sponsor_id)
      .map((row) => ({
        id: String(row.sponsor_id),
        sponsor_id: String(row.sponsor_id),
        flash_id: row.flash_id || null,
        trust_id: normalizedTrustId,
        priority: row.priority ?? null,
        duration_seconds: Number(row.duration_seconds) > 0 ? Number(row.duration_seconds) : 5,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        name: row.name || null,
        position: row.position || null,
        about: row.about || null,
        photo_url: row.photo_url || null,
        company_name: row.company_name || null,
        badge_label: row.badge_label || null,
        whatsapp_number: row.whatsapp_number || null,
        website_url: row.website_url || null,
        catalog_url: row.catalog_url || null,
        coPartner: row.coPartner || null,
        facebook: row.facebook || null,
        instagram: row.instagram || null,
        linkedin: row.linkedin || null,
        X: row.X || null
      }));

    return {
      success: true,
      data: mapped,
      hasMore: false,
      debug: {
        trustId: normalizedTrustId,
        reason: mapped.length === 0 ? 'get_active_sponsors returned no rows for this trust_id.' : '',
        counts: { finalRows: mapped.length }
      }
    };
  });
};

export const getAllSponsorsForTrust = async (trustId) => {
  const normalizedTrustId = normalizeTrustId(trustId);
  if (!normalizedTrustId) return { success: true, data: [], total: 0 };

  const response = await getSponsors(normalizedTrustId);

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
