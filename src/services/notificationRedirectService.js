import { supabase } from './supabaseClient';

const normalizeAction = (notification = {}) => {
  const candidates = [notification?.click_action, notification?.action, notification?.type];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
};

// app_redirect_routes.route_url is admin-entered and may be a full domain URL
// (https://app-test.teiltd.in/events), a relative path (/events) or a bare
// screen key (events). We only ever need the in-app path, so extract just
// that — the domain itself is irrelevant since navigation stays client-side.
const sanitizeRouteUrl = (routeUrl) => {
  const value = String(routeUrl || '').trim();
  if (!value || value === '#') return '';

  if (/^https?:\/\//i.test(value)) {
    try {
      const { pathname, search, hash } = new URL(value);
      return `${pathname}${search}${hash}`.replace(/^\/+/, '/') || '';
    } catch {
      return '';
    }
  }

  return `/${value.replace(/^\/+/, '')}`;
};

export const resolveNotificationRedirectRoute = async (notification) => {
  const action = normalizeAction(notification);
  if (!action) return null;

  try {
    const { data, error } = await supabase
      .from('app_redirect_routes')
      .select('route_url, page_name, click_action')
      .eq('click_action', action)
      .maybeSingle();

    if (error) {
      console.warn('Unable to resolve notification redirect route:', error?.message || error);
      return null;
    }

    return sanitizeRouteUrl(data?.route_url);
  } catch (error) {
    console.warn('Notification redirect lookup failed:', error?.message || error);
    return null;
  }
};

export const tryNavigateNotificationRoute = async ({ notification, navigate, fallback }) => {
  const redirectRoute = await resolveNotificationRedirectRoute(notification);
  if (redirectRoute) {
    if (typeof navigate === 'function') {
      navigate(redirectRoute);
    }
    return true;
  }

  if (typeof fallback === 'function') {
    fallback();
  }

  return false;
};
