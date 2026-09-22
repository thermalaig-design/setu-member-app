import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessAllowed, resolveMembershipIsActive } from '../src/utils/tenantAccessDecision.js';

// These mirror the generate-webApp-link Edge Function's resolve_app_access
// response shape: access_allowed is the actual open/pending decision (it
// already accounts for a public app overriding a false stored membership
// row), is_active is a backward-compatible alias of it, membership_is_active
// / reg_member.is_active carry the raw stored reg_members.is_active value
// separately. See TenantLanding.jsx's enterTenantTrust()/handleProfileSubmit
// for the real callers of resolveAccessAllowed().

test('public app + an existing membership row with is_active=false is still allowed', () => {
  const access = {
    app_visibility: 'public',
    access_allowed: true,
    access_status: 'allowed',
    is_active: true,
    membership_is_active: false,
    reg_member: { is_active: false },
  };
  assert.equal(resolveAccessAllowed(access), true);
  assert.equal(resolveMembershipIsActive(access), false);
});

test('private app + is_active=false is pending, not allowed', () => {
  const access = {
    app_visibility: 'private',
    access_allowed: false,
    access_status: 'pending',
    is_active: false,
    membership_is_active: false,
    reg_member: { is_active: false },
  };
  assert.equal(resolveAccessAllowed(access), false);
  assert.equal(resolveMembershipIsActive(access), false);
});

test('private app + is_active=true (approved membership) is allowed', () => {
  const access = {
    app_visibility: 'private',
    access_allowed: true,
    access_status: 'allowed',
    is_active: true,
    membership_is_active: true,
    reg_member: { is_active: true },
  };
  assert.equal(resolveAccessAllowed(access), true);
  assert.equal(resolveMembershipIsActive(access), true);
});

test('a previously-pending member becomes allowed once revalidation returns access_allowed=true', () => {
  const pendingResponse = {
    app_visibility: 'private',
    access_allowed: false,
    is_active: false,
    membership_is_active: false,
    reg_member: { is_active: false },
  };
  assert.equal(resolveAccessAllowed(pendingResponse), false);

  // Same tenant/member, re-resolved later (e.g. TenantLanding's
  // visibilitychange revalidation) after an admin approves the membership.
  const approvedResponse = {
    app_visibility: 'private',
    access_allowed: true,
    is_active: true,
    membership_is_active: true,
    reg_member: { is_active: true },
  };
  assert.equal(resolveAccessAllowed(approvedResponse), true);
});

test('never trusts reg_member.is_active as the access decision on its own', () => {
  // A response shape that could theoretically occur if access_allowed and
  // is_active were both omitted/undefined but reg_member.is_active were
  // true — resolveAccessAllowed must NOT fall through to reg_member.
  const access = { reg_member: { is_active: true } };
  assert.equal(resolveAccessAllowed(access), false);
});

test('falls back to top-level is_active when access_allowed is absent (older response shape)', () => {
  assert.equal(resolveAccessAllowed({ is_active: true }), true);
  assert.equal(resolveAccessAllowed({ is_active: false }), false);
});

test('resolveMembershipIsActive falls back to reg_member.is_active when membership_is_active is absent', () => {
  assert.equal(resolveMembershipIsActive({ reg_member: { is_active: true } }), true);
  assert.equal(resolveMembershipIsActive({ reg_member: { is_active: false } }), false);
  assert.equal(resolveMembershipIsActive({}), false);
});
