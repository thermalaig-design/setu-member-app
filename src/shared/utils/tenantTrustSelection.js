// Pure guard used by Home.jsx's several "restore selected Trust from a
// multi-trust membership list" effects (the strict active-trusts-by-mobile
// sync, the default-trust fallback, and the two localStorage-derived
// membership-list syncs).
//
// An installed tenant PWA window is pinned to one Trust — see
// TenantLanding.jsx's grantTenantHome() (the only place that is supposed to
// set selected_trust_id for that session) and TenantContext's per-slug
// installedTrustId. When isPinnedTenantSession is true, that pinned Trust
// must never be swapped for a different one from a separate membership-list
// API/cache just because it isn't (yet) present there — e.g. right after
// this tenant's app_visibility or membership approval just changed and that
// other source hasn't caught up. Returns true when the caller should skip
// its own reassignment (leaving the current selection exactly as it is)
// instead of falling through to "any other Trust from the list" — the
// mechanism that let a previously opened tenant (e.g. Backup) on the same
// origin hijack a different tenant's installed PWA.
//
// Outside a pinned tenant session (the ordinary, non-tenant multi-trust
// member app) this always returns false, so normal Trust switching/restore
// behavior there is completely unaffected.
export const shouldSkipTrustReassignment = ({ isPinnedTenantSession, selectedExists }) =>
  Boolean(isPinnedTenantSession) && !selectedExists;
