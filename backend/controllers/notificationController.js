import { supabase } from '../config/supabase.js';
import { createCompatibleNotification } from '../services/notificationCompatibilityService.js';
import { buildNotificationViewModel, mergeNotifications } from '../services/notificationSchemaMapper.js';
import { isNotificationRelevantForUser } from '../services/notificationAudienceMatcher.js';
import { resolveMemberIdForUser, resolveMemberIdsForUser } from '../services/memberIdentityResolver.js';

// ─── Helper: today's date in IST ───────────────────────────────────────────
const getTodayIST = () => {
  const now = new Date();
  // UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istDate.getUTCDate()).padStart(2, '0');
  return { month: mm, day: dd, year: String(istDate.getUTCFullYear()) };
};

const isNotExpired = (row) => !row?.expires_at || new Date(row.expires_at) > new Date();
const normalizeText = (value) => String(value ?? '').trim();

const buildNotificationAccessContext = async (userId, trustId = null) => {
  const normalizedUserId = normalizeText(userId);
  const normalizedTrustId = normalizeText(trustId);
  const memberIds = await resolveMemberIdsForUser(normalizedUserId);
  const memberType = await resolveMemberTypeForUser(normalizedUserId);

  return {
    userId: normalizedUserId,
    memberIds,
    memberType,
    trustId: normalizedTrustId || null,
  };
};

const matchesTrustScope = (notification, trustId) => {
  const notificationTrustId = normalizeText(notification?.trust_id);
  if (!trustId) return true;
  if (!notificationTrustId) return true;
  return notificationTrustId === trustId;
};

const isNotificationVisibleToContext = (notification, context) => {
  if (!notification || !context) return false;
  if (!matchesTrustScope(notification, context.trustId)) return false;
  return isNotificationRelevantForUser(notification, context);
};

const resolveMemberTypeForUser = async (userId) => {
  if (!userId) return null;

  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) return null;

  const digits = normalizedUserId.replace(/\D/g, '').slice(-10);
  const candidateQueries = [
    supabase.from('Members Table').select('type').eq('Mobile', normalizedUserId).limit(1).maybeSingle(),
    ...(digits ? [supabase.from('Members Table').select('type').ilike('Mobile', `%${digits}%`).limit(1).maybeSingle()] : []),
  ];

  for (const queryPromise of candidateQueries) {
    const { data, error } = await queryPromise;
    if (!error && data?.type) return data.type;
  }

  return null;
};

const syncRecipientReadState = async ({ userId, trustId = null, notificationIds, isRead }) => {
  if (!userId || !notificationIds?.length) return;

  const memberIds = await resolveMemberIdsForUser(userId);
  const preferredMemberId = await resolveMemberIdForUser(userId, trustId);
  const fallbackMemberId = preferredMemberId || memberIds[0] || null;
  if (!memberIds.length && !fallbackMemberId) return;

  const status = isRead ? 'read' : 'unread';
  const updatedAt = new Date().toISOString();

  const syncPromises = notificationIds.map(async (notificationId) => {
    const { data: existingRecipients, error: lookupError } = await supabase
      .from('notification_recipients')
      .select('id')
      .eq('notification_id', notificationId)
        .in('member_id', memberIds.length ? memberIds : [fallbackMemberId].filter(Boolean))
        .limit(1)
        .maybeSingle();

    if (lookupError) {
      console.warn('Unable to sync notification recipient state:', lookupError?.message || lookupError);
      return;
    }

    if (existingRecipients?.id) {
      await supabase
        .from('notification_recipients')
        .update({ status, updated_at: updatedAt })
        .eq('id', existingRecipients.id);
      return;
    }

    if (!fallbackMemberId) return;

    await supabase
      .from('notification_recipients')
      .insert([{ notification_id: notificationId, member_id: fallbackMemberId, status, created_at: updatedAt, updated_at: updatedAt }]);
  });

  await Promise.all(syncPromises);
};

export const registerDeviceToken = async (req, res) => {
  try {
    const { userId, token, platform } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ success: false, message: 'userId and token are required' });
    }

    const payload = {
      user_id: String(userId).trim(),
      token: String(token).trim(),
      platform: String(platform || 'android').toLowerCase(),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('notification_devices')
      .upsert(payload, { onConflict: 'user_id,token' });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, message: 'Device token registered' });
  } catch {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const unregisterDeviceToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    const { error } = await supabase
      .from('notification_devices')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('token', String(token).trim());

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, message: 'Device token unregistered' });
  } catch {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get user notifications
export const getNotifications = async (req, res) => {
  try {
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const context = await buildNotificationAccessContext(userId, trustId);
    const normalizedUserId = context.userId;
    const { memberIds } = context;

    let recipientRows = [];
    if (memberIds.length) {
      const { data, error: recipientError } = await supabase
        .from('notification_recipients')
        .select('notification_id, status')
        .in('member_id', memberIds)
        .order('updated_at', { ascending: false });

      if (recipientError) {
        console.error(`[getNotifications] notification_recipients query error:`, recipientError.message || recipientError);
      }

      if (!recipientError && data?.length) {
        recipientRows = data;
      }
    } else {
      console.warn(`[getNotifications] no memberIds resolved — skipping notification_recipients direct lookup entirely`);
    }

    const recipientStatusByNotification = new Map();
    recipientRows.forEach((row) => {
      if (row?.notification_id) {
        recipientStatusByNotification.set(row.notification_id, row.status);
      }
    });

    const directNotificationIds = [...new Set(recipientRows.map((row) => row.notification_id).filter(Boolean))];
    let directNotifications = [];
    if (directNotificationIds.length) {
      const { data: directRows, error: directError } = await supabase
        .from('notification')
        .select('*')
        .in('id', directNotificationIds)
        .order('created_at', { ascending: false });

      if (!directError && directRows?.length) {
        directNotifications = directRows.filter((row) => isNotExpired(row) && isNotificationVisibleToContext(row, context));
      }
    }

    const { data: allNotificationRows, error: notificationsError } = await supabase
      .from('notification')
      .select('*')
      .order('created_at', { ascending: false });

    if (notificationsError) {
      throw notificationsError;
    }

    const relevantNotifications = (allNotificationRows || []).filter((row) => {
      if (!isNotExpired(row)) return false;
      const isRelevant = isNotificationVisibleToContext(row, context);
      return isRelevant;
    });

    const mappedNotifications = [...directNotifications, ...relevantNotifications]
      .map((row) => buildNotificationViewModel({
        ...row,
        recipient_status: recipientStatusByNotification.get(row.id) || row?.recipient_status || '',
        source: 'new_schema',
      }, normalizedUserId));

    const uniqueNotifications = mergeNotifications(mappedNotifications);

    res.json({ success: true, data: uniqueNotifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const { data: existingNotification, error: fetchError } = await supabase
      .from('notification')
      .select('*')
      .eq('id', id)
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingNotification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const context = await buildNotificationAccessContext(userId, trustId);
    if (!isNotificationVisibleToContext(existingNotification, context)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this notification' });
    }

    await syncRecipientReadState({
      userId,
      trustId,
      notificationIds: [id],
      isRead: true,
    });

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Mark all as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const context = await buildNotificationAccessContext(userId, trustId);
    const normalizedUserId = context.userId;

    const { data: allNotifications, error: fetchError } = await supabase
      .from('notification')
      .select('id, audience_type, audience_payload')
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    const relevantNotificationIds = (allNotifications || [])
      .filter((notification) => isNotificationVisibleToContext(notification, context))
      .map((notification) => notification.id);

    if (!relevantNotificationIds.length) {
      return res.json({ success: true, message: 'No unread notifications found' });
    }

    const uniqueNotificationIds = [...new Set(relevantNotificationIds)];

    await syncRecipientReadState({
      userId: normalizedUserId,
      trustId,
      notificationIds: uniqueNotificationIds,
      isRead: true,
    });

    res.json({ success: true, message: `Marked ${uniqueNotificationIds.length} notifications as read` });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Check & create birthday notifications ──────────────────────────────────
export const checkBirthdayNotifications = async (req, res) => {
  try {
    const userId = req.headers['user-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const { month, day, year } = getTodayIST();
    const todayStr = `${year}-${month}-${day}`; // e.g. 2026-02-24

    // 1. Find the user's profile by mobile number
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('name, dob, mobile, user_identifier')
      .or(`mobile.eq.${userId},user_identifier.eq.${userId}`)
      .limit(1)
      .single();

    if (profileError || !profile) {
      return res.json({ success: true, birthdayToday: false });
    }

    if (!profile.dob) {
      return res.json({ success: true, birthdayToday: false });
    }

    // 2. Extract month+day from DOB (format: YYYY-MM-DD)
    const dobParts = profile.dob.split('-');
    if (dobParts.length < 3) {
      return res.json({ success: true, birthdayToday: false });
    }
    const dobMonth = dobParts[1]; // MM
    const dobDay = dobParts[2].substring(0, 2); // DD (trim time if any)

    const isBirthday = dobMonth === month && dobDay === day;

    if (!isBirthday) {
      return res.json({ success: true, birthdayToday: false });
    }

    const userName = profile.name || 'Member';
    // 3. Check if birthday notification already sent today
    const { data: existing, error: checkError } = await supabase
      .from('notification')
      .select('id')
      .eq('click_action', 'birthday')
      .gte('created_at', `${todayStr}T00:00:00.000Z`)
      .limit(1);

    if (!checkError && existing && existing.length > 0) {
      return res.json({ success: true, birthdayToday: true, alreadySent: true, name: userName });
    }

    // 4. Insert birthday notification into notifications table
    const birthdayMessage = `🎂 Maharaja Agrasen Samiti ki taraf se aapko janamdin ki hardik shubhkamnayein, ${userName} ji! Aapka yeh din bahut khaas ho! 🎉🎊`;

    const compatibilityResult = await createCompatibleNotification({
      user_id: userId,
      title: '🎂 Happy Birthday!',
      message: birthdayMessage,
      type: 'birthday',
      is_read: false,
      created_at: new Date().toISOString(),
    });

    if (!compatibilityResult.success) {
      console.error('Error inserting birthday notification:', compatibilityResult.legacyError);
      // Still return birthdayToday: true so app can show local notification
    }

    return res.json({
      success: true,
      birthdayToday: true,
      alreadySent: false,
      name: userName,
      message: birthdayMessage,
    });
  } catch (error) {
    console.error('Error checking birthday notifications:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Admin: Send broadcast notification to Trustee / Patron / Both ──────────
export const sendAdminNotification = async (req, res) => {
  try {
    const { title, message, target_audience } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    const validAudiences = ['Trustee', 'Patron', 'Both'];
    if (!validAudiences.includes(target_audience)) {
      return res.status(400).json({ success: false, message: 'target_audience must be Trustee, Patron, or Both' });
    }

    const compatibilityResult = await createCompatibleNotification({
      user_id: `ADMIN_BROADCAST_${target_audience}`,
      title: title.trim(),
      message: message.trim(),
      type: 'admin_message',
      target_audience: target_audience,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    if (!compatibilityResult.success) {
      console.error('Error inserting admin notification:', compatibilityResult.legacyError);
      return res.status(500).json({ success: false, message: 'Failed to insert notification: ' + compatibilityResult.legacyError });
    }

    return res.json({ success: true, message: `Notification sent to all ${target_audience} members!` });
  } catch (error) {
    console.error('Error sending admin notification:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete a specific notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const context = await buildNotificationAccessContext(userId, trustId);
    const { memberIds } = context;

    const { data: existingNotification, error: fetchError } = await supabase
      .from('notification')
      .select('*')
      .eq('id', id)
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (!existingNotification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const isAuthorized = isNotificationVisibleToContext(existingNotification, context);

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this notification' });
    }

    if (memberIds.length) {
      await supabase
        .from('notification_recipients')
        .delete()
        .eq('notification_id', id)
        .in('member_id', memberIds);
    }

    const { data: remainingRecipients, error: recipientCheckError } = await supabase
      .from('notification_recipients')
      .select('id')
      .eq('notification_id', id)
      .limit(1)
      .maybeSingle();

    if (recipientCheckError) {
      throw recipientCheckError;
    }

    if (!remainingRecipients?.id) {
      const { error: deleteError } = await supabase
        .from('notification')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }
    }

    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Test/Debug endpoint to send a test notification
export const sendTestNotification = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'userId is required in request body' 
      });
    }
    
    const testNotification = {
      user_id: String(userId).trim(),
      title: '🧪 Test Notification',
      message: `यह एक test notification है। अगर आप यह message देख रहे हैं तो notification system सही काम कर रहा है! 
      
Test Time: ${new Date().toISOString()}
User ID: ${userId}

🎉 Notification system है working perfectly!`,
      type: 'test',
      is_read: false,
      created_at: new Date().toISOString()
    };
    
    const compatibilityResult = await createCompatibleNotification(testNotification);
    
    if (!compatibilityResult.success) {
      console.error('❌ Test notification insert error:', compatibilityResult.legacyError);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to send test notification',
        error: compatibilityResult.legacyError 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Test notification sent successfully',
      data: compatibilityResult.legacyNotification
    });
    
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while sending test notification',
      error: error.message 
    });
  }
};

