// Pure decision logic for a resolveTenantAppAccess() (generate-webApp-link's
// resolve_app_access action) response. Kept in its own module — separate
// from trustService.js, which touches the Supabase client at import time —
// purely so it can be unit-tested without a Supabase/Vite environment; see
// trustService.js's re-export of these two functions for the canonical,
// documented version consumers should import.

// THE single place that decides "may this member open the app". Prefers
// the explicit access_allowed decision (which already accounts for a
// public app staying open even when an existing reg_members row has
// is_active=false); is_active is only a fallback, for a response that
// predates access_allowed. Deliberately never reads reg_member.is_active —
// that is the raw stored membership value, not the access decision (a
// public app must open even when it is false).
export const resolveAccessAllowed = (access) =>
  Boolean(access?.access_allowed ?? access?.is_active === true);

// The raw membership state, kept separate from the access decision above —
// e.g. to show "your membership is pending approval" copy that reflects the
// stored reg_members row rather than the (possibly public-app-overridden)
// access decision.
export const resolveMembershipIsActive = (access) =>
  Boolean(access?.membership_is_active ?? access?.reg_member?.is_active === true);
