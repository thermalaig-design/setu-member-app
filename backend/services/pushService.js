import { supabase } from '../config/supabase.js';
import { getFirebaseAdmin } from '../config/firebaseAdmin.js';

const getAudienceMobiles = async (targetAudience) => {
  const audience = String(targetAudience || '').trim();
  if (!audience) return [];

  let query = supabase.from('Members Table').select('Mobile');
  if (audience === 'Trustee' || audience === 'Patron') {
    query = query.eq('type', audience);
  } else if (audience === 'Both') {
    query = query.in('type', ['Trustee', 'Patron']);
  } else {
    return [];
  }

  const { data, error } = await query.limit(5000);
  if (error || !data) return [];
  return [...new Set(data.map((row) => String(row.Mobile || '').trim()).filter(Boolean))];
};

const getPhonesFromPatientName = async (patientName) => {
  const name = String(patientName || '').trim();
  if (!name) return [];
  const { data, error } = await supabase
    .from('appointments')
    .select('patient_phone')
    .eq('patient_name', name)
    .limit(200);

  if (error || !data) return [];
  return [...new Set(data.map((row) => String(row.patient_phone || '').trim()).filter(Boolean))];
};

const getTargetUserIds = async (notification) => {
  const userIds = new Set();
  const directUserId = String(notification.user_id || '').trim();
  if (directUserId && !directUserId.startsWith('ADMIN_BROADCAST_')) {
    userIds.add(directUserId);
    const phonesForName = await getPhonesFromPatientName(directUserId);
    phonesForName.forEach((phone) => userIds.add(phone));
  }

  if (notification.target_audience) {
    const audienceMobiles = await getAudienceMobiles(notification.target_audience);
    audienceMobiles.forEach((mobile) => userIds.add(mobile));
  }

  return [...userIds];
};

const getTokensForUsers = async (userIds) => {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from('notification_devices')
    .select('token')
    .in('user_id', userIds)
    .eq('platform', 'android')
    .eq('is_active', true);

  if (error || !data) return [];
  return [...new Set(data.map((row) => row.token).filter(Boolean))];
};

const deactivateInvalidTokens = async (tokens) => {
  if (!tokens.length) return;
  await supabase
    .from('notification_devices')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in('token', tokens);
};

export const sendPushForNotification = async (notification) => {
  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) return;

  const userIds = await getTargetUserIds(notification);
  if (!userIds.length) return;

  const tokens = await getTokensForUsers(userIds);
  if (!tokens.length) return;

  const message = {
    tokens,
    notification: {
      title: notification.title || 'New Notification',
      body: (notification.message || '').slice(0, 200),
    },
    data: {
      notificationId: String(notification.id || ''),
      type: String(notification.type || 'general'),
      open: 'notifications',
    },
    android: {
      priority: 'high',
    },
  };

  const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
  const invalidTokens = [];
  response.responses.forEach((result, idx) => {
    if (!result.success) {
      const code = result.error?.code || '';
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token')
      ) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  if (invalidTokens.length) {
    await deactivateInvalidTokens(invalidTokens);
  }
};
