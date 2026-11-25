export const toYmdOnly = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ymdMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymdMatch) return ymdMatch[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isDateValidForToday = (row, todayYmd) => {
  const startYmd = toYmdOnly(row?.start_date);
  const endYmd = toYmdOnly(row?.end_date);
  const startOk = !startYmd || startYmd <= todayYmd;
  const endOk = !endYmd || endYmd >= todayYmd;
  return startOk && endOk;
};

export const isRowActive = (row) => {
  if (row?.status !== undefined && row?.status !== null) {
    return String(row.status).trim().toLowerCase() === 'active';
  }

  const value = row?.is_active;
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  return !['false', '0', 'no', 'inactive'].includes(normalized);
};

export const isFresh = (timestamp, ttlMs, nowMs = Date.now()) =>
  Number(timestamp) > 0 && Number(nowMs) - Number(timestamp) < Number(ttlMs);
