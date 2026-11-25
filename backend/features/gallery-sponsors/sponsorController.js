import { supabase } from '../../shared/config/supabase.js';
import { isDateValidForToday, isFresh, isRowActive } from '../../../src/features/gallery-sponsors/sponsorRules.js';

const CACHE_TTL_MS = 120 * 1000;
const DEFAULT_CAROUSEL_LIMIT = 6;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIMIT = 100;
const SPONSOR_DATE_TIMEZONE = process.env.SPONSOR_DATE_TIMEZONE || 'Asia/Kolkata';

const sponsorCache = new Map();
const sponsorInFlight = new Map();

const sanitizeId = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const getTodayLocalYmd = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SPONSOR_DATE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
};

const makeCacheKey = ({ trustId, today, view, page, limit, offset, all }) =>
  `${trustId || 'none'}|${today || 'no-date'}|${view}|${page}|${limit}|${offset}|${all ? 'all' : 'paged'}`;

const readCache = (key) => {
  const entry = sponsorCache.get(key);
  if (!entry) return null;
  if (!isFresh(entry.ts, CACHE_TTL_MS)) {
    sponsorCache.delete(key);
    return null;
  }
  return entry.data;
};

const writeCache = (key, data) => {
  sponsorCache.set(key, { ts: Date.now(), data });
};

const getOrCompute = async (key, compute) => {
  const cached = readCache(key);
  if (cached) return { ...cached, _cached: true };

  const running = sponsorInFlight.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const result = await compute();
      writeCache(key, result);
      return { ...result, _cached: false };
    } finally {
      sponsorInFlight.delete(key);
    }
  })();

  sponsorInFlight.set(key, promise);
  return promise;
};

const clearSponsorCaches = () => {
  sponsorCache.clear();
  sponsorInFlight.clear();
};

const pruneStaleSponsorCaches = (today) => {
  const todayMarker = `|${today || 'no-date'}|`;
  for (const key of sponsorCache.keys()) {
    if (!key.includes(todayMarker)) {
      sponsorCache.delete(key);
    }
  }
  for (const key of sponsorInFlight.keys()) {
    if (!key.includes(todayMarker)) {
      sponsorInFlight.delete(key);
    }
  }
};

const fetchSponsorFlashRowsForTrust = async (trustId) => {
  const { data, error } = await supabase
    .from('sponsor_flash')
    // Select all columns to stay compatible with mixed schemas.
    .select('*')
    .eq('trust_id', trustId)
    .order('start_date', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const resolveTrustId = async (trustIdInput, trustNameInput) => {
  const trustId = sanitizeId(trustIdInput);
  if (trustId) return trustId;
  const trustName = String(trustNameInput || '').trim();
  if (!trustName) return null;

  const { data, error } = await supabase
    .from('Trust')
    .select('id')
    .ilike('name', trustName)
    .limit(1);

  if (error) throw error;
  return sanitizeId(Array.isArray(data) ? data[0]?.id : data?.id);
};

const buildSponsorPayload = async ({ trustId, today, view, page, limit, offset, all }) => {
  const allTrustRows = await fetchSponsorFlashRowsForTrust(trustId);
  const validRows = allTrustRows.filter((row) => isRowActive(row) && isDateValidForToday(row, today));

  const uniqueSponsorIds = [];
  const seen = new Set();
  for (const row of validRows) {
    const sid = sanitizeId(row?.sponsor_id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    uniqueSponsorIds.push(sid);
  }

  const pageNo = toPositiveInt(page, 1);
  const safeLimit = Math.min(toPositiveInt(limit, view === 'carousel' ? DEFAULT_CAROUSEL_LIMIT : DEFAULT_LIST_LIMIT), MAX_LIMIT);
  const rangeFrom = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : (pageNo - 1) * safeLimit;
  const rangeTo = rangeFrom + safeLimit;
  const pagedSponsorIds = all ? uniqueSponsorIds : uniqueSponsorIds.slice(rangeFrom, rangeTo);

  let sponsorsById = {};
  if (pagedSponsorIds.length > 0) {
    const { data: sponsorRows, error: sponsorError } = await supabase
      .from('sponsors')
      // Schema-safe read to avoid 500 when optional columns differ across environments.
      .select('*')
      .in('id', pagedSponsorIds);

    if (sponsorError) throw sponsorError;

    sponsorsById = (Array.isArray(sponsorRows) ? sponsorRows : []).reduce((acc, sponsor) => {
      const sid = sanitizeId(sponsor?.id);
      if (sid) acc[sid] = sponsor;
      return acc;
    }, {});
  }

  const flashBySponsorId = {};
  for (const row of validRows) {
    const sid = sanitizeId(row?.sponsor_id);
    if (sid && !flashBySponsorId[sid]) flashBySponsorId[sid] = row;
  }

  const data = pagedSponsorIds
    .map((sid) => {
      const sponsor = sponsorsById[sid];
      const flash = flashBySponsorId[sid];
      if (!sponsor || !flash) return null;
      return {
        ...sponsor,
        flash_id: flash.id,
        sponsor_id: sid,
        trust_id: flash.trust_id,
        duration_seconds: Number(flash.duration_seconds) > 0 ? Number(flash.duration_seconds) : 5,
        start_date: flash.start_date ?? null,
        end_date: flash.end_date ?? null,
        flash_created_at: flash.created_at ?? null
      };
    })
    .filter(Boolean);

  return {
    data,
    hasMore: all ? false : uniqueSponsorIds.length > rangeTo,
    debug: {
      trustId,
      today,
      counts: {
        trustRows: allTrustRows.length,
        validDateRows: validRows.length,
        uniqueSponsorIds: uniqueSponsorIds.length,
        pagedSponsorIds: pagedSponsorIds.length,
        joinedSponsors: Object.keys(sponsorsById).length,
        finalRows: data.length
      },
      filters: {
        byTrust: true,
        activeOnly: true,
        dateWindowOnly: true
      }
    }
  };
};

// Public sponsor feed (strict trust + date-window logic)
export const getSponsors = async (req, res) => {
  try {
    const {
      trust_id: trustIdInput,
      trust_name: trustNameInput,
      view: rawView,
      page,
      limit,
      offset,
      all: allRaw
    } = req.query;

    const trustId = await resolveTrustId(trustIdInput, trustNameInput);
    if (!trustId) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0,
        hasMore: false,
        debug: { reason: 'No trust_id resolved' }
      });
    }

    const view = String(rawView || 'carousel').toLowerCase() === 'list' ? 'list' : 'carousel';
    const all = String(allRaw || '').toLowerCase() === 'true';
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const pageNo = toPositiveInt(page, 1);
    const pageLimit = toPositiveInt(limit, view === 'carousel' ? DEFAULT_CAROUSEL_LIMIT : DEFAULT_LIST_LIMIT);
    const offsetNo = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : null;
    const today = getTodayLocalYmd();
    pruneStaleSponsorCaches(today);
    const cacheKey = makeCacheKey({
      trustId,
      today,
      view,
      page: pageNo,
      limit: pageLimit,
      offset: offsetNo === null ? 'auto' : offsetNo,
      all
    });

    const result = force
      ? await buildSponsorPayload({
          trustId,
          today,
          view,
          page: pageNo,
          limit: pageLimit,
          offset: offsetNo,
          all
        })
      : await getOrCompute(cacheKey, async () =>
          buildSponsorPayload({
            trustId,
            today,
            view,
            page: pageNo,
            limit: pageLimit,
            offset: offsetNo,
            all
          })
        );

    return res.status(200).json({
      success: true,
      data: result.data || [],
      count: Array.isArray(result.data) ? result.data.length : 0,
      hasMore: Boolean(result.hasMore),
      cached: Boolean(result._cached),
      debug: result.debug || null
    });
  } catch (error) {
    console.error('Error in getSponsors:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch sponsors',
      error: error.message
    });
  }
};

// Get all sponsors (including inactive) - Admin only
export const getAllSponsors = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sponsors')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching all sponsors:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch sponsors',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });
  } catch (error) {
    console.error('Error in getAllSponsors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get sponsor by ID
export const getSponsorById = async (req, res) => {
  try {
    const { id } = req.params;
    const { trust_id: trustIdInput, trust_name: trustNameInput } = req.query;
    const trustId = await resolveTrustId(trustIdInput, trustNameInput);

    const { data, error } = await supabase
      .from('sponsors')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    if (trustId) {
      const { data: flashRows, error: flashError } = await supabase
        .from('sponsor_flash')
        .select('*')
        .eq('trust_id', trustId)
        .eq('sponsor_id', id);

      if (flashError) throw flashError;

      const today = getTodayLocalYmd();
      const validRows = (Array.isArray(flashRows) ? flashRows : []).filter((row) => isRowActive(row) && isDateValidForToday(row, today));
      if (validRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Sponsor not found for current trust/date'
        });
      }
    }

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Error in getSponsorById:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Add new sponsor (Admin only)
export const addSponsor = async (req, res) => {
  try {
    const { name, position, positions = [], about, photo_url, priority = 0, created_by = 'admin' } = req.body;

    if (!name || !position) {
      return res.status(400).json({
        success: false,
        message: 'Name and position are required'
      });
    }

    const { data, error } = await supabase
      .from('sponsors')
      .insert([
        {
          name: name.trim(),
          position: position.trim(),
          positions: positions,
          about: about ? about.trim() : null,
          photo_url: photo_url ? photo_url.trim() : null,
          priority: parseInt(priority) || 0,
          created_by: created_by,
          updated_by: created_by
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error adding sponsor:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to add sponsor',
        error: error.message
      });
    }

    clearSponsorCaches();
    return res.status(201).json({
      success: true,
      message: 'Sponsor added successfully',
      data: data
    });
  } catch (error) {
    console.error('Error in addSponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update sponsor (Admin only)
export const updateSponsor = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, position, positions, about, photo_url, priority, is_active, updated_by = 'admin' } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = String(name || '').trim();
    if (position !== undefined) updateData.position = String(position || '').trim();
    if (positions !== undefined) updateData.positions = positions;
    if (about !== undefined) updateData.about = about ? String(about).trim() : null;
    if (photo_url !== undefined) updateData.photo_url = photo_url ? String(photo_url).trim() : null;
    if (priority !== undefined) updateData.priority = parseInt(priority);
    if (is_active !== undefined) updateData.is_active = Boolean(is_active);
    updateData.updated_by = updated_by;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('sponsors')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating sponsor:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update sponsor',
        error: error.message
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Sponsor not found'
      });
    }

    clearSponsorCaches();
    return res.json({
      success: true,
      message: 'Sponsor updated successfully',
      data: data
    });
  } catch (error) {
    console.error('Error in updateSponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Delete sponsor (Admin only)
export const deleteSponsor = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('sponsors')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting sponsor:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete sponsor',
        error: error.message
      });
    }

    clearSponsorCaches();
    return res.json({
      success: true,
      message: 'Sponsor deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteSponsor:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};
