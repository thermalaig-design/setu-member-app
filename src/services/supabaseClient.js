import { createClient } from '@supabase/supabase-js';
import { reportConnectionFailure, reportConnectionSuccess } from '../utils/connectionStatus';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly so it’s obvious why gallery isn’t loading.
  // Required in Vite: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment');
}

// Background calls must never flip the whole app into the "lost connection" page.
const SILENT_REQUEST_PATTERNS = ['/rpc/page_tracking_rpc'];

const getRequestUrl = (input) => {
  if (typeof input === 'string') return input;
  return input?.url || String(input || '');
};

// Only connectivity failures and 5xx count. 4xx / business errors are left to each caller.
const monitoredFetch = async (input, init) => {
  const silent = SILENT_REQUEST_PATTERNS.some((pattern) => getRequestUrl(input).includes(pattern));
  let response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (!silent && error?.name !== 'AbortError') reportConnectionFailure();
    throw error;
  }
  if (!silent) {
    if (response.status >= 500) reportConnectionFailure();
    else reportConnectionSuccess();
  }
  return response;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: monitoredFetch }
});
