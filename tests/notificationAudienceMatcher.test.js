import test from 'node:test';
import assert from 'node:assert/strict';

import { isNotificationRelevantForUser } from '../backend/features/notifications/notificationAudienceMatcher.js';

test('isNotificationRelevantForUser matches phone audience IDs across common India formats', () => {
  const notification = {
    audience_type: 'users',
    audience_payload: {
      user_ids: ['+919876543210'],
    },
  };

  assert.equal(
    isNotificationRelevantForUser(notification, {
      userId: '9876543210',
      memberIds: [],
    }),
    true
  );
});

test('isNotificationRelevantForUser matches mixed audience against member type', () => {
  const notification = {
    audience_type: 'mixed',
    audience_payload: {
      target_audience: 'Trustee',
    },
  };

  assert.equal(
    isNotificationRelevantForUser(notification, {
      userId: '9876543210',
      memberIds: [],
      memberType: 'trustee',
    }),
    true
  );
});
