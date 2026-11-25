import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNotificationViewModel, mergeNotifications } from '../backend/features/notifications/notificationSchemaMapper.js';

test('buildNotificationViewModel maps new-schema recipients into a readable notification view', () => {
  const viewModel = buildNotificationViewModel({
    id: 'notif-1',
    title: 'Welcome',
    message: 'Hello there',
    click_action: 'appointments',
    audience_payload: { user_ids: ['9999999999'] },
    created_at: '2026-01-01T00:00:00.000Z',
    recipient_status: 'read',
    source: 'new_schema',
  }, '9999999999');

  assert.equal(viewModel.id, 'notif-1');
  assert.equal(viewModel.title, 'Welcome');
  assert.equal(viewModel.message, 'Hello there');
  assert.equal(viewModel.type, 'appointments');
  assert.equal(viewModel.is_read, true);
  assert.equal(viewModel.source, 'new_schema');
  assert.equal(viewModel.user_id, '9999999999');
});

test('mergeNotifications keeps the newest version of duplicate records', () => {
  const merged = mergeNotifications([
    { id: 'a', created_at: '2026-01-01T00:00:00.000Z', title: 'Old' },
    { id: 'a', created_at: '2026-01-02T00:00:00.000Z', title: 'New' },
    { id: 'b', created_at: '2026-01-03T00:00:00.000Z', title: 'Later' },
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === 'a').title, 'New');
  assert.equal(merged.find((item) => item.id === 'b').title, 'Later');
});
