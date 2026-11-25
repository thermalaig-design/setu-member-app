import { supabase } from '../../shared/services/supabaseClient';

const resolveTrustId = async (trustId = null, trustName = null) => {
  if (trustId) return trustId;

  const localTrustId = localStorage.getItem('selected_trust_id');
  if (localTrustId) return localTrustId;

  const nameCandidate = trustName || localStorage.getItem('selected_trust_name');
  if (!nameCandidate) return null;

  const { data, error } = await supabase
    .from('Trust')
    .select('id')
    .ilike('name', String(nameCandidate).trim())
    .limit(1);

  if (error) throw error;
  return data?.[0]?.id || null;
};

const todayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const resolveCurrentMemberId = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.members_id ||
      parsed?.member_id ||
      parsed?.id ||
      null;
    return candidate ? String(candidate).trim() : null;
  } catch {
    return null;
  }
};

const toYmdOnly = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeAttachments = (attachments) => {
  if (Array.isArray(attachments)) {
    return attachments.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof attachments === 'string') {
    const value = attachments.trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      // not JSON, treat as one attachment value
    }
    return [value];
  }
  return [];
};

const isDateValidForToday = (row, todayYmd) => {
  const startYmd = toYmdOnly(row?.start_date);
  const endYmd = toYmdOnly(row?.end_date);
  const startOk = !startYmd || startYmd <= todayYmd;
  const endOk = !endYmd || endYmd >= todayYmd;
  return startOk && endOk;
};

const isActiveLikeStatus = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'active' || raw === '1' || raw === 'true' || raw === 'enabled' || raw === 'published';
};

const byStartDateDescCreatedAtDescIdAsc = (a, b) => {
  const startA = toYmdOnly(a?.start_date);
  const startB = toYmdOnly(b?.start_date);
  if (startA && startB && startA !== startB) return startA < startB ? 1 : -1;
  if (startA && !startB) return -1;
  if (!startA && startB) return 1;

  const createdA = String(a?.created_at || '');
  const createdB = String(b?.created_at || '');
  if (createdA !== createdB) return createdA < createdB ? 1 : -1;

  const idA = String(a?.id || '');
  const idB = String(b?.id || '');
  return idA.localeCompare(idB);
};

const byCreatedAtDescUpdatedAtDescIdAsc = (a, b) => {
  const createdA = String(a?.created_at || '');
  const createdB = String(b?.created_at || '');
  if (createdA !== createdB) return createdA < createdB ? 1 : -1;

  const updatedA = String(a?.updated_at || '');
  const updatedB = String(b?.updated_at || '');
  if (updatedA !== updatedB) return updatedA < updatedB ? 1 : -1;

  const idA = String(a?.id || '');
  const idB = String(b?.id || '');
  return idA.localeCompare(idB);
};

export const checkVipNoticeEligibility = async ({ trustId = null, trustName = null, memberId = null } = {}) => {
  const resolvedTrustId = await resolveTrustId(trustId, trustName);
  const resolvedMemberId = memberId ? String(memberId).trim() : resolveCurrentMemberId();

  if (!resolvedTrustId) {
    return {
      success: true,
      trustId: null,
      memberId: resolvedMemberId || null,
      vipEligible: false,
      regMemberMatch: null,
      reason: 'No trust_id resolved'
    };
  }

  if (!resolvedMemberId) {
    return {
      success: true,
      trustId: String(resolvedTrustId),
      memberId: null,
      vipEligible: false,
      regMemberMatch: null,
      reason: 'No member_id available'
    };
  }

  const { data, error } = await supabase
    .from('reg_members')
    .select('id, trust_id, members_id, is_active')
    .eq('trust_id', resolvedTrustId)
    .eq('members_id', resolvedMemberId)
    .eq('is_active', true)
    .limit(1);

  if (error) throw error;

  const match = Array.isArray(data) ? data[0] : null;
  return {
    success: true,
    trustId: String(resolvedTrustId),
    memberId: resolvedMemberId,
    vipEligible: Boolean(match?.id),
    regMemberMatch: match || null,
    reason: match?.id ? '' : 'No active reg_members mapping for trust + member'
  };
};

export const fetchNoticeboardPage = async ({
  trustId = null,
  trustName = null,
  page = 1,
  pageSize = 10
} = {}) => {
  try {
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    if (!resolvedTrustId) return { success: true, data: [], debug: { reason: 'No trust_id resolved' } };

    const today = todayIsoDate();
    const pageNo = Number(page) > 0 ? Number(page) : 1;
    const limit = Number(pageSize) > 0 ? Number(pageSize) : 10;
    const rangeFrom = (pageNo - 1) * limit;
    const rangeTo = rangeFrom + limit - 1;
    const shouldDebug = Boolean(import.meta.env.DEV) || String(import.meta.env.VITE_NOTICEBOARD_DEBUG || '').toLowerCase() === 'true';
    const shouldVerboseDebug = String(import.meta.env.VITE_NOTICEBOARD_VERBOSE_DEBUG || '').toLowerCase() === 'true';
    const debug = {
      trustId: String(resolvedTrustId),
      statusFilter: 'active',
      typeFilter: 'all',
      today,
      page: pageNo,
      pageSize: limit,
      counts: {
        trustRows: null,
        activeRows: null,
        beforeDateFilterRows: 0,
        afterDateFilterRows: 0
      },
      finalNoticeIds: []
    };

    // Main query: trust + active + type.
    const { data, error } = await supabase
      .from('noticeboard')
      .select('id, trust_id, type, name, description, attachments, start_date, end_date, status, created_at, updated_at')
      .eq('trust_id', resolvedTrustId)
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });

    if (error) throw error;

    const rowsBeforeDate = Array.isArray(data) ? data : [];
    const rowsAfterStatus = rowsBeforeDate.filter((row) => isActiveLikeStatus(row?.status));
    debug.counts.beforeDateFilterRows = rowsAfterStatus.length;

    // Client-side date filter removed — we trust DB's status='active' as source of truth.
    // Notices with expired end_date should be deactivated at DB level by admin.
    const rowsAfterDate = rowsAfterStatus.filter((row) => isDateValidForToday(row, today));
    debug.counts.afterDateFilterRows = rowsAfterDate.length;
    const effectiveRows = rowsAfterDate.length > 0 ? rowsAfterDate : rowsAfterStatus;
    if (rowsAfterDate.length === 0 && rowsAfterStatus.length > 0) {
      debug.dateFilterFallbackApplied = true;
    }

    const pagedRows = effectiveRows.slice(rangeFrom, rangeTo + 1);
    const finalRows = pagedRows
      .map((item) => ({
        id: item.id,
        trust_id: item.trust_id,
        type: item.type,
        name: item.name || '',
        description: item.description || null,
        attachments: normalizeAttachments(item.attachments),
        start_date: item.start_date || null,
        end_date: item.end_date || null,
        status: item.status,
        created_at: item.created_at || null,
        updated_at: item.updated_at || null
      }))
      .sort(byStartDateDescCreatedAtDescIdAsc);
    debug.finalNoticeIds = finalRows.map((item) => item.id).filter(Boolean);

    if (shouldVerboseDebug) {
      const { count: trustRowsCount } = await supabase
        .from('noticeboard')
        .select('id', { count: 'exact', head: true })
        .eq('trust_id', resolvedTrustId);
      const { count: activeRowsCount } = await supabase
        .from('noticeboard')
        .select('id', { count: 'exact', head: true })
        .eq('trust_id', resolvedTrustId)
        .eq('status', 'active');
      debug.counts.trustRows = Number.isFinite(Number(trustRowsCount)) ? Number(trustRowsCount) : null;
      debug.counts.activeRows = Number.isFinite(Number(activeRowsCount)) ? Number(activeRowsCount) : null;
    }

    if (shouldDebug) {
      console.log('[Noticeboard][Debug] selected_trust_id=', debug.trustId);
      console.log('[Noticeboard][Debug] page=', pageNo, 'pageSize=', limit);
      console.log('[Noticeboard][Debug] trust_rows=', debug.counts.trustRows);
      console.log('[Noticeboard][Debug] active_rows=', debug.counts.activeRows);
      console.log('[Noticeboard][Debug] rows_before_date_filter=', debug.counts.beforeDateFilterRows);
      console.log('[Noticeboard][Debug] rows_after_date_filter=', debug.counts.afterDateFilterRows);
      if (debug.dateFilterFallbackApplied) {
        console.log('[Noticeboard][Debug] date_filter_fallback_applied=true');
      }
      console.log('[Noticeboard][Debug] final_notice_ids=', debug.finalNoticeIds);
      console.log('[Noticeboard][Debug] final_notice_types=', finalRows.map((item) => item.type));
    }

    return {
      success: true,
      data: finalRows,
      hasMore: effectiveRows.length > rangeTo + 1,
      debug
    };
  } catch (error) {
    console.error('Error fetching noticeboard items:', error);
    return { success: false, data: [], message: error.message || 'Failed to fetch noticeboard items' };
  }
};

export const fetchNoticeboardItems = async ({ trustId = null, trustName = null } = {}) => {
  const pageRes = await fetchNoticeboardPage({ trustId, trustName, page: 1, pageSize: 10 });
  return {
    success: Boolean(pageRes?.success),
    data: Array.isArray(pageRes?.data) ? pageRes.data : [],
    message: pageRes?.message || null,
    debug: pageRes?.debug || null
  };
};

export const fetchNoticeboardById = async ({
  noticeId,
  trustId = null,
  trustName = null,
} = {}) => {
  try {
    const normalizedNoticeId = String(noticeId || '').trim();
    if (!normalizedNoticeId) {
      return { success: false, data: null, message: 'Invalid notice id' };
    }

    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    if (!resolvedTrustId) return { success: true, data: null };

    const { data, error } = await supabase
      .from('noticeboard')
      .select('id, trust_id, type, name, description, attachments, start_date, end_date, status, created_at, updated_at')
      .eq('id', normalizedNoticeId)
      .eq('trust_id', resolvedTrustId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const statusOk = isActiveLikeStatus(data?.status);
    if (!data || !statusOk || !isDateValidForToday(data, todayIsoDate())) {
      return {
        success: true,
        data: null,
        debug: {
          trustId: String(resolvedTrustId)
        }
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        trust_id: data.trust_id,
        type: data.type,
        name: data.name || '',
        description: data.description || null,
        attachments: normalizeAttachments(data.attachments),
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        status: data.status,
        created_at: data.created_at || null,
        updated_at: data.updated_at || null
      }
    };
  } catch (error) {
    console.error('Error fetching noticeboard item by id:', error);
    return { success: false, data: null, message: error.message || 'Failed to fetch notice detail' };
  }
};

export const checkVipFacilityEligibility = async ({ trustId = null, trustName = null, memberId = null } = {}) =>
  checkVipNoticeEligibility({ trustId, trustName, memberId });

export const fetchFacilitiesPage = async ({
  trustId = null,
  trustName = null,
  page = 1,
  pageSize = 10
} = {}) => {
  try {
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    if (!resolvedTrustId) return { success: true, data: [], debug: { reason: 'No trust_id resolved' } };

    const pageNo = Number(page) > 0 ? Number(page) : 1;
    const limit = Number(pageSize) > 0 ? Number(pageSize) : 10;
    const rangeFrom = (pageNo - 1) * limit;
    const rangeTo = rangeFrom + limit - 1;
    const shouldDebug = Boolean(import.meta.env.DEV) || String(import.meta.env.VITE_FACILITIES_DEBUG || '').toLowerCase() === 'true';
    const shouldVerboseDebug = String(import.meta.env.VITE_FACILITIES_VERBOSE_DEBUG || '').toLowerCase() === 'true';

    const debug = {
      trustId: String(resolvedTrustId),
      statusFilter: 'active',
      typeFilter: 'all',
      page: pageNo,
      pageSize: limit,
      counts: {
        trustRows: null,
        activeRows: null
      },
      finalFacilityIds: []
    };

    const { data, error } = await supabase
      .from('facilities')
      .select('id, trust_id, type, name, description, attachments, status, created_by, created_at, updated_at')
      .eq('trust_id', resolvedTrustId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(rangeFrom, rangeTo);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const finalRows = rows
      .map((item) => ({
        id: item.id,
        trust_id: item.trust_id,
        type: item.type,
        name: item.name || '',
        description: item.description || null,
        attachments: normalizeAttachments(item.attachments),
        status: item.status,
        created_by: item.created_by || null,
        created_at: item.created_at || null,
        updated_at: item.updated_at || null
      }))
      .sort(byCreatedAtDescUpdatedAtDescIdAsc);
    debug.finalFacilityIds = finalRows.map((item) => item.id).filter(Boolean);

    if (shouldVerboseDebug) {
      const { count: trustRowsCount } = await supabase
        .from('facilities')
        .select('id', { count: 'exact', head: true })
        .eq('trust_id', resolvedTrustId);
      const { count: activeRowsCount } = await supabase
        .from('facilities')
        .select('id', { count: 'exact', head: true })
        .eq('trust_id', resolvedTrustId)
        .eq('status', 'active');
      debug.counts.trustRows = Number.isFinite(Number(trustRowsCount)) ? Number(trustRowsCount) : null;
      debug.counts.activeRows = Number.isFinite(Number(activeRowsCount)) ? Number(activeRowsCount) : null;
    }

    if (shouldDebug) {
      console.log('[Facilities][Debug] selected_trust_id=', debug.trustId);
      console.log('[Facilities][Debug] page=', pageNo, 'pageSize=', limit);
      console.log('[Facilities][Debug] trust_rows=', debug.counts.trustRows);
      console.log('[Facilities][Debug] active_rows=', debug.counts.activeRows);
      console.log('[Facilities][Debug] final_facility_ids=', debug.finalFacilityIds);
      console.log('[Facilities][Debug] final_facility_types=', finalRows.map((item) => item.type));
    }

    return {
      success: true,
      data: finalRows,
      hasMore: rows.length === limit,
      debug
    };
  } catch (error) {
    console.error('Error fetching facilities:', error);
    return { success: false, data: [], message: error.message || 'Failed to fetch facilities' };
  }
};

export const fetchFacilityById = async ({
  facilityId,
  trustId = null,
  trustName = null,
} = {}) => {
  try {
    const normalizedFacilityId = String(facilityId || '').trim();
    if (!normalizedFacilityId) {
      return { success: false, data: null, message: 'Invalid facility id' };
    }

    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    if (!resolvedTrustId) return { success: true, data: null };

    const { data, error } = await supabase
      .from('facilities')
      .select('id, trust_id, type, name, description, attachments, status, created_by, created_at, updated_at')
      .eq('id', normalizedFacilityId)
      .eq('trust_id', resolvedTrustId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return {
        success: true,
        data: null,
        debug: {
          trustId: String(resolvedTrustId)
        }
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        trust_id: data.trust_id,
        type: data.type,
        name: data.name || '',
        description: data.description || null,
        attachments: normalizeAttachments(data.attachments),
        status: data.status,
        created_by: data.created_by || null,
        created_at: data.created_at || null,
        updated_at: data.updated_at || null
      }
    };
  } catch (error) {
    console.error('Error fetching facility detail:', error);
    return { success: false, data: null, message: error.message || 'Failed to fetch facility detail' };
  }
};

export const fetchEvents = async ({ trustId = null, trustName = null, includePast = false } = {}) => {
  try {
    const resolvedTrustId = await resolveTrustId(trustId, trustName);
    if (!resolvedTrustId) return { success: true, data: [] };

    const { data, error } = await supabase
      .from('events')
      .select('id, trust_id, type, title, description, banner_image, attachments, location, event_date, start_time, end_time, max_participants, is_registration_required, status, created_at, updated_at')
      .eq('trust_id', resolvedTrustId)
      .eq('status', 'active')
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (error) throw error;

    const today = todayIsoDate();
    const filtered = (data || []).filter((item) => (includePast ? true : item.event_date >= today));

    return { success: true, data: filtered };
  } catch (error) {
    console.error('Error fetching events:', error);
    return { success: false, data: [], message: error.message || 'Failed to fetch events' };
  }
};


