import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkipTrustReassignment } from '../src/utils/tenantTrustSelection.js';

// This predicate is Home.jsx's guard against the tenant-identity leak: an
// installed tenant PWA (e.g. /app/dds) is pinned to one Trust, and Home's
// several "restore selected Trust from the member's full multi-trust
// membership list" effects must never swap that pinned Trust for a
// different one (e.g. a stale/cached "Backup" Trust from another tenant PWA
// opened earlier on the same origin) just because the pinned Trust isn't
// (yet) present in some separate membership-list API/cache response.

test('DDS PWA + stale Backup selected_trust_id + private->public revalidation: pinned session with DDS missing from the API list skips reassignment (never falls to Backup)', () => {
  // Simulates: selected_trust_id was pinned to DDS by grantTenantHome, but
  // the member's full active-trusts-by-mobile list (which may lag a fresh
  // resolve_app_access approval) doesn't include DDS yet.
  const skip = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: false });
  assert.equal(skip, true);
});

test('same scenario survives a full refresh: pinned session recomputed from scratch still skips reassignment', () => {
  // A refresh re-derives isPinnedTenantSession fresh from
  // useTenant().installedTrustId alone (unaffected by the refresh, since
  // /app/dds resolves the same Trust again), so the same inputs must
  // produce the same "skip" decision.
  const beforeRefresh = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: false });
  const afterRefresh = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: false });
  assert.equal(beforeRefresh, true);
  assert.equal(afterRefresh, true);
});

test('normal browser tab (not installed/standalone) on /app/dds + stale Backup selected_trust_id + pinned DDS trust id: Home stays DDS, never auto-reassigns', () => {
  // Home.jsx's isPinnedTenantSession is Boolean(pinnedTenantTrustId) only —
  // deliberately NOT gated on isStandaloneDisplay(). TenantContext already
  // treats an explicit /app/<slug> URL as authoritative and sets
  // installedTrustId for it in an ordinary browser tab exactly the same as
  // in an installed PWA (see TenantContext.jsx's getUrlSlug()-driven
  // resolution, which reads the URL, not display-mode). So a member with a
  // stale Backup selected_trust_id who opens /app/dds in plain Chrome (no
  // install) must still be pinned to DDS.
  const isPinnedTenantSession = Boolean('dds-trust-id'); // pinnedTenantTrustId resolved from the /app/dds URL
  const selectedExists = false; // localStorage still holds Backup's id from an earlier session
  assert.equal(shouldSkipTrustReassignment({ isPinnedTenantSession, selectedExists }), true);
});

test('pinned session where the pinned Trust IS present in the list: reassignment is allowed (it just re-affirms the same Trust)', () => {
  const skip = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: true });
  assert.equal(skip, false);
});

test('non-pinned (ordinary multi-trust member app, "/" route): reassignment/switching is never blocked', () => {
  // isPinnedTenantSession is false outside an installed tenant PWA (see
  // Home.jsx: installedTrustId is '' on the plain "/" route), so the
  // ordinary multi-trust restore/switch behavior must be unaffected.
  assert.equal(shouldSkipTrustReassignment({ isPinnedTenantSession: false, selectedExists: false }), false);
  assert.equal(shouldSkipTrustReassignment({ isPinnedTenantSession: false, selectedExists: true }), false);
});

test('tenant A and tenant B installed on the same origin do not cross-contaminate: each pinned session only ever evaluates its own selectedExists', () => {
  // Tenant A (DDS) window: its own selected_trust_id (DDS) is not in
  // whatever list this call happens to see -> skip, stays DDS.
  const tenantA = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: false });
  // Tenant B (Backup) window: independently, its own selected_trust_id
  // (Backup) IS in its own list -> no skip, stays Backup (its own Trust,
  // never DDS's).
  const tenantB = shouldSkipTrustReassignment({ isPinnedTenantSession: true, selectedExists: true });
  assert.equal(tenantA, true);
  assert.equal(tenantB, false);
});
