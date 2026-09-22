import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTenantAuthSlug,
  resolveLoginSelectedTrustId,
  mergeTenantMembershipEntry
} from '../src/utils/tenantAuthSelection.js';

// These two pure functions are the fix for the first-login tenant-selection
// race: OTPVerification.jsx's completeLogin() used to require the target
// tenant's reg_members row to already exist in the pre-login
// activeTrustMemberships snapshot, and fell back to
// activeTrustMemberships[0] (alphabetically first, e.g. "Alpha") when it
// didn't — which is exactly what happens on a fresh device's first tenant
// login, since resolve_app_access (which creates/promotes that row) only
// runs later, inside TenantLanding, after this redirect.

test('1. Fresh device: existing Alpha member installs/opens public DDS tenant, first login -> resolves DDS, never Alpha, no refresh required', () => {
  // Reached via TenantLanding's standalone auto-entry -> navigate('/login',
  // { state: { tenantSlug: 'dds' } }) -> Login.jsx forwards it on to OTP's
  // own location.state — the explicit-state signal, authoritative on its
  // own regardless of whether TenantContext's installedSlug/installedTrustId
  // happen to be resolved yet.
  const tenantSlug = resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: 'dds', windowSlug: '' });
  assert.equal(tenantSlug, 'dds');

  const isTenantAuth = Boolean(tenantSlug);
  // DDS's Trust ID is already known (TenantContext resolved it), but DDS
  // is NOT yet in this member's membership-list snapshot (Alpha is, and
  // sorts alphabetically first per mapActiveTrustResponseToMemberships).
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth,
    tenantTrustId: 'dds-trust-id',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '',
    fallbackMembershipTrustId: 'alpha-trust-id' // would have won under the old logic
  });
  assert.equal(selectedTrustId, 'dds-trust-id');
});

test('2. Alpha alphabetically comes before DDS in the membership list -> still resolves DDS', () => {
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: true,
    tenantTrustId: 'dds-trust-id',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: 'alpha-trust-id', // "Alpha" happens to equal the base Trust here too
    fallbackMembershipTrustId: 'alpha-trust-id'
  });
  assert.equal(selectedTrustId, 'dds-trust-id');
});

test('3. DDS missing entirely from the pre-login membership snapshot -> still pins DDS (resolve_app_access creates/promotes the membership afterwards, not here)', () => {
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: true,
    tenantTrustId: 'dds-trust-id',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '', // no membership at all yet
    fallbackMembershipTrustId: '' // membership list could even be empty
  });
  assert.equal(selectedTrustId, 'dds-trust-id');
});

test('4. tenantTrustId not resolvable at all (DDS private + nonmember, Trust lookup itself unavailable): falls back to baseTrustId, never a foreign membership', () => {
  // This models the last-resort case inside completeLogin where even
  // fetchTrustByAppSlug(tenantSlug) failed to resolve a Trust ID — identity
  // pinning degrades to the base Trust rather than ever picking Alpha.
  // (The actual DDS private/pending-vs-allowed decision is TenantLanding's
  // resolveTenantAppAccess, exercised separately in tenantAccessDecision.test.js.)
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: true,
    tenantTrustId: '',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '',
    fallbackMembershipTrustId: 'alpha-trust-id'
  });
  assert.equal(selectedTrustId, 'setu-base-trust-id');
});

test('5. tenantSlug known but installedTrustId not resolved yet: slug alone is enough to mark this a tenant auth session', () => {
  const tenantSlug = resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: 'dds', windowSlug: '' });
  assert.equal(tenantSlug, 'dds');
  assert.equal(Boolean(tenantSlug), true);

  // Even with tenantTrustId still empty at this point (OTPVerification.jsx
  // then resolves it directly via fetchTrustByAppSlug(tenantSlug) before
  // this decision runs — see completeLogin), once resolved it must win.
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: true,
    tenantTrustId: 'dds-trust-id', // as if fetchTrustByAppSlug('dds') just resolved it
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '',
    fallbackMembershipTrustId: 'alpha-trust-id'
  });
  assert.equal(selectedTrustId, 'dds-trust-id');
});

test('6. Normal non-tenant "/" login: existing multi-trust fallback (base membership, then first-active, then base Trust) is unchanged', () => {
  assert.equal(resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: '', windowSlug: '' }), '');

  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: false,
    tenantTrustId: '',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '',
    fallbackMembershipTrustId: 'alpha-trust-id'
  });
  // Non-tenant auth is allowed to fall back to the first-active membership.
  assert.equal(selectedTrustId, 'alpha-trust-id');

  const withBaseMembership = resolveLoginSelectedTrustId({
    isTenantAuth: false,
    tenantTrustId: '',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: 'setu-base-trust-id',
    fallbackMembershipTrustId: 'alpha-trust-id'
  });
  assert.equal(withBaseMembership, 'setu-base-trust-id');
});

test('7. Reload after login: re-deriving tenantSlug/selection from the same inputs yields the same tenant', () => {
  // An installed standalone PWA reload/relaunch — the one case where
  // installedSlug/windowSlug are trusted at all (no explicit navigation
  // state exists across a real page reload; React Router state does not
  // survive one).
  const inputs = { installedSlug: 'dds', locationTenantSlug: '', windowSlug: '', isStandaloneDisplay: true };
  const first = resolveTenantAuthSlug(inputs);
  const afterReload = resolveTenantAuthSlug(inputs);
  assert.equal(first, 'dds');
  assert.equal(afterReload, 'dds');

  const selection = { isTenantAuth: true, tenantTrustId: 'dds-trust-id', baseTrustId: 'setu-base-trust-id', baseMembershipTrustId: '', fallbackMembershipTrustId: 'alpha-trust-id' };
  assert.equal(resolveLoginSelectedTrustId(selection), resolveLoginSelectedTrustId(selection));
});

test('tenant slug priority order: explicit location state tenantSlug (unconditional) > installedSlug/windowSlug (standalone only)', () => {
  // Explicit state wins even over a DIFFERENT stale installedSlug, and
  // regardless of standalone display.
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: 'backup', locationTenantSlug: 'dds', windowSlug: 'other', isStandaloneDisplay: false }),
    'dds'
  );
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: 'backup', locationTenantSlug: 'dds', windowSlug: 'other', isStandaloneDisplay: true }),
    'dds'
  );
  // No explicit state, non-standalone -> installedSlug/windowSlug are both
  // ignored, even though installedSlug is present.
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: 'dds', locationTenantSlug: '', windowSlug: 'other', isStandaloneDisplay: false }),
    ''
  );
  // No explicit state, standalone -> installedSlug wins over windowSlug.
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: 'dds', locationTenantSlug: '', windowSlug: 'other', isStandaloneDisplay: true }),
    'dds'
  );
  // No explicit state, standalone, installedSlug empty -> windowSlug used.
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: '', windowSlug: 'other', isStandaloneDisplay: true }),
    'other'
  );
});

// --- Stale active_app_slug guard --------------------------------------
// A normal, non-standalone /login visit must never be misclassified as
// tenant auth just because this browser tab visited a different tenant
// earlier and left its slug in sessionStorage (active_app_slug).

test('stale active_app_slug guard: visited tenant A earlier in this tab, later opens ordinary /login (no tenant route/state, non-standalone) -> normal non-tenant login, NOT tenant A', () => {
  // installedSlug/locationTenantSlug are both '' here because this /login
  // visit carries no tenant route or navigation state of its own (a fresh
  // tab/reload landing straight on /login) — only the stale sessionStorage
  // record from tenant A's earlier visit in this same tab survives.
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: '',
    locationTenantSlug: '',
    windowSlug: 'a', // stale active_app_slug from an earlier /app/a visit
    isStandaloneDisplay: false
  });
  assert.equal(tenantSlug, '');
  assert.equal(Boolean(tenantSlug), false);

  // With isTenantAuth false, login selection must use the ordinary
  // non-tenant fallback chain, never tenant A's Trust ID.
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth: Boolean(tenantSlug),
    tenantTrustId: 'trust-a-id',
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: '',
    fallbackMembershipTrustId: 'trust-b-id'
  });
  assert.notEqual(selectedTrustId, 'trust-a-id');
  assert.equal(selectedTrustId, 'trust-b-id');
});

test('stale active_app_slug guard does not break installed standalone PWA reload recovery: same stale slug, standalone display -> tenant auth preserved', () => {
  // Same sessionStorage-only signal as above, but this time the page is an
  // installed PWA recovering its own identity after a reload/relaunch
  // (e.g. reopened deep on an in-app route with no slug in the URL) — a
  // real tenant-owned context, not a stray leftover from browsing history.
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: '',
    locationTenantSlug: '',
    windowSlug: 'dds',
    isStandaloneDisplay: true
  });
  assert.equal(tenantSlug, 'dds');
});

// --- SAFE AUTH RULE: explicitly named coverage --------------------------

test('SAFE AUTH RULE 1: /app/dds -> login carries explicit tenantSlug in navigation state -> resolves DDS', () => {
  // Mirrors TenantLanding.jsx's navigate('/login', { state: { tenantSlug:
  // 'dds' } }) -> Login.jsx receiving it via location.state.
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: '', // not yet resolved in TenantContext at this point
    locationTenantSlug: 'dds',
    windowSlug: '',
    isStandaloneDisplay: false
  });
  assert.equal(tenantSlug, 'dds');
});

test('SAFE AUTH RULE 2: standalone DDS login recovery with no navigation state -> resolves DDS from installedSlug', () => {
  // An installed standalone PWA reopened deep in-app (e.g. after being
  // killed and relaunched) with no /login navigation state at all — the
  // legitimate "standalone PWA recovery" case the rule carves out.
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: 'dds',
    locationTenantSlug: '',
    windowSlug: '',
    isStandaloneDisplay: true
  });
  assert.equal(tenantSlug, 'dds');
});

test('SAFE AUTH RULE 3: root/native logout/login carries no tenant slug anywhere -> non-tenant, in both standalone and non-standalone shells', () => {
  // App.jsx's clearAuthAndRedirectToLogin (root/native logout) navigates to
  // /login with no state at all, and a root/native app never visits
  // /app/<slug> — so every source is empty regardless of display mode.
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: '', windowSlug: '', isStandaloneDisplay: false }),
    ''
  );
  assert.equal(
    resolveTenantAuthSlug({ installedSlug: '', locationTenantSlug: '', windowSlug: '', isStandaloneDisplay: true }),
    ''
  );
});

// --- Session membership merge shape ------------------------------------

test('mergeTenantMembershipEntry: merges onto an existing partial DDS entry, preserves Alpha untouched, preserves DDS extra fields, updates is_active/trust metadata', () => {
  const hospitalMemberships = [
    { trust_id: 'alpha-id', trust_name: 'Alpha', is_active: true, membership_number: 'ALPHA-001', role: 'member', custom_alpha_field: 'keep-me' },
    // Partial/stale DDS membership: missing trust_icon_url/trust_remark,
    // stale name, and an extra field this merge doesn't know about that
    // must survive.
    { trust_id: 'dds-id', trust_name: 'Old DDS Name', is_active: false, membership_number: 'DDS-777', role: 'pending', extra_local_field: 'keep-me-too' }
  ];

  const result = mergeTenantMembershipEntry({
    hospitalMemberships,
    trust: { id: 'dds-id', name: 'DDS Trust', icon_url: 'https://example.com/dds.png', remark: 'DDS remark' },
    regMember: { id: 'reg-dds-1', is_active: true, role: 'member' }, // no membership_number this time
    fallbackMembersId: 'member-1'
  });

  assert.equal(result.hospitalMemberships.length, 2);

  const alpha = result.hospitalMemberships.find((m) => m.trust_id === 'alpha-id');
  const dds = result.hospitalMemberships.find((m) => m.trust_id === 'dds-id');

  // Alpha is completely untouched.
  assert.deepEqual(alpha, hospitalMemberships[0]);

  // Exactly one DDS entry.
  assert.equal(result.hospitalMemberships.filter((m) => m.trust_id === 'dds-id').length, 1);

  // DDS extra/unknown field survives the merge.
  assert.equal(dds.extra_local_field, 'keep-me-too');
  // membership_number wasn't provided by this resolve -> preserved from the
  // existing entry rather than wiped to null.
  assert.equal(dds.membership_number, 'DDS-777');
  // is_active/trust metadata/role update from this resolve's own data.
  assert.equal(dds.is_active, true);
  assert.equal(dds.trust_name, 'DDS Trust');
  assert.equal(dds.trust_icon_url, 'https://example.com/dds.png');
  assert.equal(dds.trust_remark, 'DDS remark');
  assert.equal(dds.role, 'member');
  assert.equal(dds.id, 'reg-dds-1');

  assert.deepEqual(result.trustSummary, {
    id: 'dds-id',
    name: 'DDS Trust',
    icon_url: 'https://example.com/dds.png',
    remark: 'DDS remark'
  });
});

// --- Root/native app regression: normal multi-trust login must stay
// completely untouched --------------------------------------------------
//
// On the root/native app ('/' — including the Capacitor/native shell,
// which also boots on '/'), no code path ever calls rememberWindowTenantSlug
// (the only writer of sessionStorage's active_app_slug — see
// TenantContext.jsx/tenantNavigation.js) unless a /app/<slug> route was
// actually visited in this session. So a genuine root-only session has
// installedSlug === '', locationTenantSlug === '' (Login.jsx only ever
// receives tenantSlug in location.state when TenantLanding redirected
// here) AND windowSlug === '' — all three tiers empty, independent of
// isStandaloneDisplay. isTenantAuth is therefore always false here, with
// no code change needed for this case.

test('root/native app "/" login, multi-trust user, no tenant context anywhere: isTenantAuth is false and existing multi-trust selection is exactly unchanged', () => {
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: '',       // never resolved — this session never visited /app/<slug>
    locationTenantSlug: '',  // no tenantSlug in location.state — this is a direct '/' login, not a TenantLanding redirect
    windowSlug: '',          // active_app_slug was never written (rememberWindowTenantSlug never called)
    isStandaloneDisplay: true // even if the Capacitor/native shell reports standalone-like display
  });
  assert.equal(tenantSlug, '');
  const isTenantAuth = Boolean(tenantSlug);
  assert.equal(isTenantAuth, false);

  // Multi-trust member: Alpha (base Trust) and Beta as an existing active
  // membership. Selection must follow the ORIGINAL base/fallback chain,
  // completely unaffected by any tenant logic, and no Trust is forced.
  const selectedTrustId = resolveLoginSelectedTrustId({
    isTenantAuth,
    tenantTrustId: '', // never computed in the non-tenant path
    baseTrustId: 'setu-base-trust-id',
    baseMembershipTrustId: 'alpha-trust-id',
    fallbackMembershipTrustId: 'beta-trust-id'
  });
  assert.equal(selectedTrustId, 'alpha-trust-id');
});

test('root/native app "/" login: a stale active_app_slug from an earlier tenant visit this device made at some point cannot switch a fresh non-standalone root login into tenant mode', () => {
  // Models a device/browser profile that visited a tenant at some earlier
  // point (so sessionStorage still has active_app_slug), now doing an
  // ordinary, non-standalone root login with no tenant route/state.
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: '',
    locationTenantSlug: '',
    windowSlug: 'dds',
    isStandaloneDisplay: false
  });
  assert.equal(tenantSlug, '');
  assert.equal(Boolean(tenantSlug), false);
});

// --- Stale installedSlug across SPA navigation ---------------------------
// TenantProvider is mounted once above <App/> (main.jsx), so
// TenantContext's installedSlug React state can survive SPA navigation
// after leaving /app/<slug> — e.g. a user browses tenant "dds", then
// navigates (client-side, no reload) to an ordinary root /login with no
// tenant route or explicit navigation state. installedSlug must NOT be
// trusted as tenant auth in that case.

test('stale installedSlug across SPA navigation: non-standalone, ordinary root /login with no explicit tenantSlug state -> isTenantAuth is false', () => {
  const tenantSlug = resolveTenantAuthSlug({
    installedSlug: 'dds', // stale — left over in TenantContext from an earlier /app/dds visit this session
    locationTenantSlug: '', // this /login navigation carries no explicit tenant state
    windowSlug: 'dds',
    isStandaloneDisplay: false
  });
  assert.equal(tenantSlug, '');
  assert.equal(Boolean(tenantSlug), false);
});

test('mergeTenantMembershipEntry: brand-new tenant (no existing entry) adds it without disturbing other memberships', () => {
  const hospitalMemberships = [
    { trust_id: 'alpha-id', trust_name: 'Alpha', is_active: true }
  ];

  const result = mergeTenantMembershipEntry({
    hospitalMemberships,
    trust: { id: 'dds-id', name: 'DDS Trust', icon_url: null, remark: null },
    regMember: { id: 'reg-dds-1', is_active: true },
    fallbackMembersId: 'member-1'
  });

  assert.equal(result.hospitalMemberships.length, 2);
  assert.deepEqual(
    result.hospitalMemberships.find((m) => m.trust_id === 'alpha-id'),
    hospitalMemberships[0]
  );
  assert.ok(result.hospitalMemberships.find((m) => m.trust_id === 'dds-id'));
});
