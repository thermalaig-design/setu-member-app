import { supabase } from './supabaseClient';

const TABLE = 'events';

// ── Date/time helpers ───────────────────────────────────────────────────────

export function getTodayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getNowHhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const toYmd = (value) => {
  if (!value) return null;
  try {
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch { return null; }
};

const toHhmm = (value) => {
  if (!value) return null;
  try {
    const s = String(value).trim();
    if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
    return null;
  } catch { return null; }
};

const pick = (obj, keys = []) => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return null;
};

const normalizeEvent = (event) => {
  if (!event || typeof event !== 'object') return event;
  const startEventDate = pick(event, ['startEventDate', 'start_event_date']);
  const endEventDate = pick(event, ['endEventDate', 'end_event_date']);
  const startTime = pick(event, ['startTime', 'start_time']);
  const endTime = pick(event, ['endTime', 'end_time']);
  const trust_id = pick(event, ['trust_id', 'trustId']);

  return {
    ...event,
    trust_id: trust_id ?? null,
    startEventDate: startEventDate ?? null,
    endEventDate: endEventDate ?? null,
    startTime: startTime ?? null,
    endTime: endTime ?? null
  };
};

/**
 * Classify an event into 'current' | 'upcoming' | 'past'
 */
export function classifyEvent(event) {
  const normalizedEvent = normalizeEvent(event);
  const today = getTodayYmd();
  const nowTime = getNowHhmm();

  const start = toYmd(normalizedEvent?.startEventDate);
  const end = toYmd(normalizedEvent?.endEventDate) || start; // null endDate = single day
  const startTime = toHhmm(normalizedEvent?.startTime);
  const endTime = toHhmm(normalizedEvent?.endTime);

  if (!start) return 'past'; // no date = treat as past

  // PAST: end date already passed
  if (end < today) return 'past';

  // UPCOMING: starts in the future
  if (start > today) return 'upcoming';
  if (start === today && startTime && startTime > nowTime) return 'upcoming';

  // CURRENT: start <= today <= end
  if (start <= today && end >= today) {
    // If today is end-day and endTime passed, event becomes past.
    // Applies to both single-day and multi-day events.
    if (today === end && endTime && endTime < nowTime) return 'past';

    // If single-day event starts later today, it's upcoming (already handled above).
    // If times are missing, date-window match is current.
    return 'current';
  }

  return 'past';
}

const compareAscByDateTime = (a, b) => {
  const na = normalizeEvent(a);
  const nb = normalizeEvent(b);
  const sa = String(na?.startEventDate || '');
  const sb = String(nb?.startEventDate || '');
  if (sa !== sb) return sa.localeCompare(sb);

  const ta = String(na?.startTime || '');
  const tb = String(nb?.startTime || '');
  if (ta !== tb) return ta.localeCompare(tb);

  const ca = String(a?.created_at || '');
  const cb = String(b?.created_at || '');
  if (ca !== cb) return cb.localeCompare(ca);

  return String(a?.id || '').localeCompare(String(b?.id || ''));
};

const comparePastDesc = (a, b) => {
  const na = normalizeEvent(a);
  const nb = normalizeEvent(b);
  const sa = String(na?.startEventDate || '');
  const sb = String(nb?.startEventDate || '');
  if (sa !== sb) return sb.localeCompare(sa);

  const ea = String(na?.endEventDate || na?.startEventDate || '');
  const eb = String(nb?.endEventDate || nb?.startEventDate || '');
  if (ea !== eb) return eb.localeCompare(ea);

  const ta = String(na?.endTime || '');
  const tb = String(nb?.endTime || '');
  if (ta !== tb) return tb.localeCompare(ta);

  return String(a?.id || '').localeCompare(String(b?.id || ''));
};

export function sortEventsByCategory(category, events) {
  const list = Array.isArray(events) ? [...events] : [];
  if (category === 'past') return list.sort(comparePastDesc);
  return list.sort(compareAscByDateTime);
}

/**
 * Format event date range for display
 */
export function formatEventDate(startDate, endDate) {
  const toLabel = (v) => {
    if (!v) return null;
    try {
      return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return String(v); }
  };
  const s = toLabel(startDate);
  const e = toLabel(endDate);
  if (s && e && s !== e) return `${s} – ${e}`;
  return s || e || 'Date TBD';
}

/**
 * Format time range for display
 */
export function formatTimeRange(startTime, endTime) {
  const fmt = (t) => {
    if (!t) return null;
    try {
      const [h, m] = t.slice(0, 5).split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, '0')} ${period}`;
    } catch { return t; }
  };
  const s = fmt(startTime);
  const e = fmt(endTime);
  if (s && e) return `${s} – ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return null;
}


// ── API fetch ───────────────────────────────────────────────────────────────


/**
 * Fetch all active events for a trust from DB (2 columns only for list).
 * Classification (current/upcoming/past) happens client-side.
 */
export async function fetchAllEventsForTrust({ trustId }) {
  if (!trustId) return { success: true, data: [] };
  console.log('[EventsService][Build] eventsService diagnostic v4 loaded at', new Date().toISOString());
  console.log('[EventsService][Debug] requested_trust_id=', trustId);

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('trust_id', trustId);

  if (error) {
    console.error('[EventsService] fetchAllEventsForTrust error:', error);
    return { success: false, data: [], error: error.message };
  }

  let events = (Array.isArray(data) ? data : []).map(normalizeEvent);
  console.log('[EventsService][Debug] strict_trust_query_count=', events.length);

  // Defensive fallback:
  // Some deployments have schema/key drift (trust_id vs trustId mapping in API layer).
  // If strict trust_id filter returns empty, retry and filter client-side.
  if (events.length === 0) {
    const fallback = await supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (!fallback.error) {
      const allRows = Array.isArray(fallback.data) ? fallback.data : [];
      events = allRows
        .map(normalizeEvent)
        .filter((row) => String(row?.trust_id || '').trim() === String(trustId).trim());
      console.log('[EventsService][Debug] fallback_scan_total=', allRows.length, 'fallback_matched=', events.length);
      if (allRows.length > 0 && events.length === 0) {
        console.log('[EventsService][Debug] fallback_sample_keys=', Object.keys(allRows[0] || {}));
      }
    } else {
      console.error('[EventsService] fallback scan error:', fallback.error);
    }
  }

  console.log(`[EventsService][Debug] trust=${trustId} fetched=${events.length} events`);
  return { success: true, data: events };
}

/**
 * Fetch full event detail by ID (for detail page).
 */
export async function fetchEventById({ eventId, trustId }) {
  if (!eventId) return { success: false, data: null };

  let query = supabase
    .from(TABLE)
    .select('*')
    .eq('id', eventId);

  if (trustId) query = query.eq('trust_id', trustId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[EventsService] fetchEventById error:', error);
    return { success: false, data: null, error: error.message };
  }

  return { success: true, data: data ? normalizeEvent(data) : null };
}
