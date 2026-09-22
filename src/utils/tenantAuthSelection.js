// Pure helpers behind the first-login tenant-selection race fix — see
// Login.jsx and OTPVerification.jsx for the full context/comments.

// Resolves which tenant slug (if any) this auth session belongs to,
// independently of whether TenantContext's installedTrustId (an async
// Trust-row fetch) has resolved yet.
//
// Priority:
// 1. locationTenantSlug — authoritative, UNCONDITIONALLY. This is the
//    tenantSlug explicitly preserved through navigation state (TenantLanding
//    passes it to Login.jsx; Login.jsx passes it on to OTPVerification.jsx)
//    — the one signal that always reflects the navigation that actually
//    just happened, never a leftover from something earlier.
// 2. installedSlug / windowSlug (this window's own sessionStorage-recorded
//    active_app_slug) — ONLY when isStandaloneDisplay is true. TenantContext
//    (TenantProvider is mounted once above <App/> in main.jsx) keeps
//    installedSlug in React state, which can survive SPA navigation well
//    after leaving /app/<slug> — e.g. a user browses tenant "dds", then
//    client-side-navigates to an ordinary root /login with no tenant route
//    or state at all. Trusting installedSlug there would misclassify that
//    ordinary login as tenant auth for a Trust the user never asked to log
//    into again. windowSlug has the identical risk for the same reason
//    (survives across an ordinary browser tab having visited a *different*
//    tenant earlier in the same tab). Both are only real signals of a
//    tenant-owned context when this is a standalone (installed) PWA
//    recovering its own identity — e.g. reopened deep on an in-app route
//    with no slug in the URL and no navigation state to carry it.
//
// A fresh-device race must never collapse this to '' just because source 1
// hasn't been passed yet on a genuinely tenant-originated navigation — that
// is exactly what let a first-login OTP redirect fall back to a different
// Trust (e.g. an alphabetically-earlier existing membership). This is why
// every tenant-origin navigation to /login/OTP must explicitly pass
// `{ state: { tenantSlug } }` (see TenantLanding.jsx/Login.jsx) rather than
// relying on installedSlug/windowSlug outside standalone recovery.
export const resolveTenantAuthSlug = ({ installedSlug, locationTenantSlug, windowSlug, isStandaloneDisplay } = {}) => {
  const explicit = String(locationTenantSlug || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (!isStandaloneDisplay) return '';
  return String(installedSlug || windowSlug || '').trim().toLowerCase();
};

// The post-login "which Trust is selected" decision.
//
// For tenant auth (a slug was resolved above), the target tenant Trust ID
// always wins — never activeTrustMemberships[0]/first-active-membership/
// selectedMemberships[0]/base Trust — even when that tenant's own
// membership doesn't exist in the pre-login membership-list snapshot yet
// (resolve_app_access, which runs after this, is what creates/promotes it;
// tenant identity and tenant access are separate concerns).
//
// For non-tenant auth (the ordinary '/' login), the existing base/fallback
// membership selection is completely unchanged.
export const resolveLoginSelectedTrustId = ({
  isTenantAuth,
  tenantTrustId,
  baseTrustId,
  baseMembershipTrustId,
  fallbackMembershipTrustId,
} = {}) => {
  if (isTenantAuth) {
    return String(tenantTrustId || baseTrustId || '').trim();
  }
  return String(baseMembershipTrustId || fallbackMembershipTrustId || baseTrustId || '').trim();
};

// Backs TenantLanding.jsx's mergeResolvedTenantMembershipIntoUserSession —
// the piece that folds a resolve_app_access response into the saved user
// session's hospital_memberships list BEFORE Home first renders. Pure and
// side-effect-free (no localStorage) so it can be unit-tested directly; the
// caller owns reading/writing localStorage.
//
// MERGES onto an existing membership entry for the same trust_id rather
// than replacing it with a smaller object built only from this call's own
// trust/regMember — a field this specific resolve didn't carry (e.g.
// membership_number on a revalidation that only returns is_active) keeps
// its previously known value instead of being wiped to null. Every OTHER
// membership (a different trust_id) is returned completely untouched, and
// the result never contains more than one entry for this trust_id.
export const mergeTenantMembershipEntry = ({ hospitalMemberships, trust, regMember, fallbackMembersId } = {}) => {
  const trustId = String(trust?.id || '').trim();
  const list = Array.isArray(hospitalMemberships) ? hospitalMemberships : [];
  if (!trustId) {
    return { hospitalMemberships: list, trustSummary: null, membershipEntry: null };
  }

  const existingIndex = list.findIndex((m) => String(m?.trust_id || '').trim() === trustId);
  const existingEntry = existingIndex >= 0 ? list[existingIndex] : null;

  const membershipEntry = {
    ...existingEntry,
    id: regMember?.id ?? existingEntry?.id ?? null,
    trust_id: trustId,
    trust_name: trust?.name ?? existingEntry?.trust_name ?? null,
    trust_icon_url: trust?.icon_url ?? existingEntry?.trust_icon_url ?? null,
    trust_remark: trust?.remark ?? existingEntry?.trust_remark ?? null,
    is_active: regMember?.is_active !== undefined ? regMember.is_active !== false : (existingEntry?.is_active ?? true),
    role: regMember?.role ?? existingEntry?.role ?? null,
    membership_number:
      regMember?.['Membership number'] ?? regMember?.membership_number ?? existingEntry?.membership_number ?? null,
    members_id: regMember?.members_id ?? existingEntry?.members_id ?? fallbackMembersId ?? null,
    source: 'resolve_app_access'
  };

  const otherMemberships = list.filter((_, index) => index !== existingIndex);

  const trustSummary = {
    id: trustId,
    name: trust?.name ?? existingEntry?.trust_name ?? null,
    icon_url: trust?.icon_url ?? existingEntry?.trust_icon_url ?? null,
    remark: trust?.remark ?? existingEntry?.trust_remark ?? null
  };

  return {
    hospitalMemberships: [membershipEntry, ...otherMemberships],
    trustSummary,
    membershipEntry
  };
};
