import { supabase } from '../config/supabase.js';
import { sendPushForNotification } from './pushService.js';

let notificationChannel = null;

const handleNotificationInsert = async (payload) => {
  try {
    await sendPushForNotification(payload?.new || {});
  } catch (error) {
    console.error(
      'Push worker failed for notification:',
      payload?.new?.id,
      error?.message || error
    );
  }
};

export const startNotificationPushWorker = () => {
  if (notificationChannel) {
    return notificationChannel;
  }

  notificationChannel = supabase
    .channel('notification-push-worker')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notification',
      },
      handleNotificationInsert
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      },
      handleNotificationInsert
    )
    .subscribe((status) => {
      console.log('Notification push worker status:', status);
    });

  return notificationChannel;
};
