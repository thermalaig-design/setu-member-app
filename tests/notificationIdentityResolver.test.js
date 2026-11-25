import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRegMemberLookupPairs } from '../backend/features/notifications/notificationIdentityResolver.js';

test('buildRegMemberLookupPairs includes members_id lookup for UUID-based user identifiers', () => {
  const pairs = buildRegMemberLookupPairs('c6912e61-16e8-4670-90be-285bc71f85eb');

  assert.ok(
    pairs.some(([column, value]) => column === 'members_id' && value === 'c6912e61-16e8-4670-90be-285bc71f85eb')
  );
});

test('buildRegMemberLookupPairs includes mobility and membership number lookups for phone-based identifiers', () => {
  const pairs = buildRegMemberLookupPairs('9876543210');

  assert.ok(pairs.some(([column, value]) => column === 'mobile' && value === '9876543210'));
  assert.ok(pairs.some(([column, value]) => column === 'Membership number' && value === '9876543210'));
});
