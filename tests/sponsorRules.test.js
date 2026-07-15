import test from 'node:test';
import assert from 'node:assert/strict';
import { isDateValidForToday, isFresh, isRowActive } from '../src/services/sponsorRules.js';

test('inactive sponsor rows are filtered out', () => {
  assert.equal(isRowActive({ status: 'inactive' }), false);
  assert.equal(isRowActive({ status: 'paused' }), false);
  assert.equal(isRowActive({ is_active: false }), false);
  assert.equal(isRowActive({ status: 'active' }), true);
});

test('sponsor date window must include today', () => {
  const today = '2026-06-30';

  assert.equal(
    isDateValidForToday({ start_date: '2026-06-01', end_date: '2026-07-01' }, today),
    true
  );
  assert.equal(
    isDateValidForToday({ start_date: '2026-07-01', end_date: '2026-07-31' }, today),
    false
  );
  assert.equal(
    isDateValidForToday({ start_date: '2026-06-01', end_date: '2026-06-29' }, today),
    false
  );
});

test('cache freshness decides whether old sponsor data can stay visible', () => {
  const now = 1_750_000_000_000;
  const ttl = 15 * 60 * 1000;

  assert.equal(isFresh(now - (10 * 60 * 1000), ttl, now), true);
  assert.equal(isFresh(now - (16 * 60 * 1000), ttl, now), false);
});

