import express from 'express';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  checkBirthdayNotifications,
  sendAdminNotification,
  deleteNotification,
  sendTestNotification,
  registerDeviceToken,
  unregisterDeviceToken,
  createNotification,
} from './notificationController.js';

const router = express.Router();

router.get('/check-birthdays', checkBirthdayNotifications);
router.post('/device-token', registerDeviceToken);
router.delete('/device-token', unregisterDeviceToken);
router.post('/admin/send', sendAdminNotification);
router.post('/test', sendTestNotification); // For debugging/testing
router.post('/', createNotification);
router.get('/', getNotifications);
router.patch('/:id/read', markAsRead);
router.patch('/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);

export default router;
