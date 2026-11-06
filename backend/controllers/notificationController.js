import { supabase } from '../config/supabase.js';
import { createCompatibleNotification } from '../services/notificationCompatibilityService.js';
import { buildNotificationViewModel, mergeNotifications } from '../services/notificationSchemaMapper.js';
import { isNotificationRelevantForUser } from '../services/notificationAudienceMatcher.js';
import { resolveMemberIdForUser, resolveMemberIdsForUser, resolveMemberRolesForUser, resolvePersonIdForUser } from '../services/memberIdentityResolver.js';

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

const buildNotificationAccessContext = async (userId, trustId = null, membersId = null) => {
  const normalizedUserId = normalizeText(userId);
  const normalizedTrustId = normalizeText(trustId);
  const normalizedMembersId = normalizeText(membersId);
  const memberIds = await resolveMemberIdsForUser(normalizedUserId, normalizedMembersId);
  const userRoles = await resolveMemberRolesForUser(normalizedUserId, normalizedTrustId, normalizedMembersId);
  // 'Trustee'/'Patron' membership type lives on reg_members.role (per-trust), not on
  // Members — there's no separate "type" column there, so derive it from the roles
  // we already resolved instead of a second, differently-sourced lookup.
  const memberType = userRoles[0] || null;

  return {
    userId: normalizedUserId,
    membersId: normalizedMembersId || null,
    memberIds,
    memberType,
    userRoles,
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

// ?scope=all lists/updates across every trust the member belongs to (the in-app
// Notifications screen). Without it the old behaviour (current trust only) is kept, which
// Home still relies on for its per-trust unread counters.
const isAllTrustsScope = (req) => normalizeText(req.query?.scope).toLowerCase() === 'all';

// 'dismissed' = deleted by the member, 'expired' = closed out by the system.
const HIDDEN_RECIPIENT_STATUSES = new Set(['dismissed', 'expired']);
const isHiddenRecipientStatus = (status) => HIDDEN_RECIPIENT_STATUSES.has(normalizeText(status).toLowerCase());

const attachTrustNames = async (notifications = []) => {
  const trustIds = [...new Set(notifications.map((row) => normalizeText(row?.trust_id)).filter(Boolean))];
  if (!trustIds.length) return notifications;

  const { data, error } = await supabase.from('Trust').select('id, name').in('id', trustIds);
  if (error || !data?.length) return notifications;

  const nameById = new Map(data.map((row) => [String(row.id), row.name]));
  return notifications.map((row) => ({
    ...row,
    trust_name: nameById.get(normalizeText(row?.trust_id)) || null,
  }));
};

const hasRecipientAccess = async (notificationId, context) => {
  if (!notificationId || !context?.memberIds?.length) return false;

  const { data, error } = await supabase
    .from('notification_recipients')
    .select('id, status')
    .eq('notification_id', notificationId)
    .in('member_id', context.memberIds)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('Unable to verify notification recipient access:', error?.message || error);
    return false;
  }

  return Boolean(data?.id && !isHiddenRecipientStatus(data?.status));
};

const canAccessNotification = async (notification, context) => {
  if (!notification || !context) return false;
  if (!matchesTrustScope(notification, context.trustId)) return false;
  if (isNotificationRelevantForUser(notification, context)) return true;
  return await hasRecipientAccess(notification.id, context);
};

const syncRecipientStatus = async ({ userId, membersId = null, trustId = null, notificationIds, status }) => {
  if (!userId || !notificationIds?.length) return;

  const normalizedStatus = normalizeText(status) || 'unread';
  const memberIds = await resolveMemberIdsForUser(userId, membersId);
  const preferredMemberId = await resolveMemberIdForUser(userId, trustId, membersId);
  const fallbackMemberId = preferredMemberId || memberIds[0] || null;
  if (!memberIds.length && !fallbackMemberId) return;

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
        .update({ status: normalizedStatus, updated_at: updatedAt })
        .eq('id', existingRecipients.id);
      return;
    }

    if (!fallbackMemberId) return;

    await supabase
      .from('notification_recipients')
      .insert([{ notification_id: notificationId, member_id: fallbackMemberId, status: normalizedStatus, created_at: updatedAt, updated_at: updatedAt }]);
  });

  await Promise.all(syncPromises);
};

const syncRecipientReadState = async ({ userId, membersId = null, trustId = null, notificationIds, isRead }) => {
  await syncRecipientStatus({
    userId,
    membersId,
    trustId,
    notificationIds,
    status: isRead ? 'read' : 'unread',
  });
};

// ─── Push tokens ────────────────────────────────────────────────────────────
// The phone's FCM token lives in member_session.metadata (no dedicated table): a login row
// holding `fcm_token` means "this device is currently logged in". Logout removes it again.
const FCM_META_KEYS = ['fcm_token', 'fcm_updated_at', 'fcm_platform'];

const stripFcmKeys = (metadata) => {
  const next = { ...(metadata || {}) };
  FCM_META_KEYS.forEach((key) => delete next[key]);
  return next;
};

// Only login rows are touched: logout/autologout rows keep their copy of the token, which
// the sender uses to ignore a token whose logout could not clear the login row (offline).
const clearTokenFromLoginRows = async (token, exceptRowId = null) => {
  const { data, error } = await supabase
    .from('member_session')
    .select('id, metadata')
    .eq('action_type', 'login')
    .eq('metadata->>fcm_token', token);
  if (error) throw error;

  const rows = (data || []).filter((row) => row.id !== exceptRowId);
  await Promise.all(rows.map((row) => supabase
    .from('member_session')
    .update({ metadata: stripFcmKeys(row.metadata) })
    .eq('id', row.id)));
  return rows.length;
};

const findLoginRowsForPerson = async ({ personId, membersIdHint, userId }) => {
  const keys = [...new Set([personId, membersIdHint].map(normalizeText).filter(Boolean))];
  if (keys.length) {
    const { data, error } = await supabase
      .from('member_session')
      .select('id, metadata, action_at')
      .in('members_id', keys)
      .eq('action_type', 'login')
      .order('action_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    if (error) throw error;
    if (data?.length) return data;
  }

  // Fallback for the few session rows whose members_id is not the person id.
  const digits = normalizeText(userId).replace(/\D/g, '');
  if (digits.length < 10) return [];
  const last10 = digits.slice(-10);
  const { data, error } = await supabase
    .from('member_session')
    .select('id, metadata, action_at')
    .in('mobile', [last10, `91${last10}`])
    .eq('action_type', 'login')
    .order('action_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(25);
  if (error) throw error;
  return data || [];
};

export const registerDeviceToken = async (req, res) => {
  try {
    const token = normalizeText(req.body?.token);
    const userId = normalizeText(req.body?.userId || req.body?.user_id);
    const membersIdHint = normalizeText(req.body?.members_id || req.body?.membersId);
    const previousToken = normalizeText(req.body?.previousToken);
    const platform = normalizeText(req.body?.platform).toLowerCase() || null;

    if (!token || (!userId && !membersIdHint)) {
      return res.status(400).json({ success: false, message: 'token and userId (or members_id) are required' });
    }

    const personId = await resolvePersonIdForUser(userId, membersIdHint);
    const loginRows = await findLoginRowsForPerson({ personId, membersIdHint, userId });

    // Not logged in anywhere (no login row): nothing to attach the token to.
    if (!loginRows.length) {
      return res.json({ success: true, registered: false, message: 'No login session found; token not stored' });
    }

    const holdsToken = (row, value) => value && normalizeText(row?.metadata?.fcm_token) === value;
    const target =
      loginRows.find((row) => holdsToken(row, token)) ||            // same token again: just refresh
      loginRows.find((row) => holdsToken(row, previousToken)) ||    // token rotated on this phone
      loginRows.find((row) => !normalizeText(row?.metadata?.fcm_token)); // newest login row without a device

    if (!target) {
      return res.json({ success: true, registered: false, message: 'No free login session for this token' });
    }

    const metadata = {
      ...(target.metadata || {}),
      fcm_token: token,
      fcm_updated_at: new Date().toISOString(),
      ...(platform ? { fcm_platform: platform } : {}),
    };

    const { error: updateError } = await supabase
      .from('member_session')
      .update({ metadata })
      .eq('id', target.id);
    if (updateError) {
      return res.status(500).json({ success: false, message: updateError.message });
    }

    // The same phone may have been logged in as someone else before: the token now belongs here.
    await clearTokenFromLoginRows(token, target.id);

    return res.json({ success: true, registered: true, message: 'Device token registered' });
  } catch (error) {
    console.error('Error registering device token:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const unregisterDeviceToken = async (req, res) => {
  try {
    const token = normalizeText(req.body?.token || req.query?.token);
    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    await clearTokenFromLoginRows(token);
    return res.json({ success: true, message: 'Device token unregistered' });
  } catch (error) {
    console.error('Error unregistering device token:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createNotification = async (req, res) => {
  try {
    const callerUserId = req.headers['user-id'];
    const callerMembersId = req.headers['members-id'];
    const requestTrustId = normalizeText(req.body?.trust_id || req.headers['trust-id']);

    if (!callerUserId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const targetUserId = normalizeText(req.body?.user_id || req.body?.userId || callerUserId);
    const title = normalizeText(req.body?.title);
    const message = normalizeText(req.body?.message || req.body?.body);

    if (!targetUserId || !title || !message) {
      return res.status(400).json({ success: false, message: 'user_id, title, and message are required' });
    }

    const compatibilityResult = await createCompatibleNotification({
      user_id: targetUserId,
      members_id: req.body?.members_id || req.body?.member_id || callerMembersId || null,
      trust_id: requestTrustId || null,
      title,
      message,
      type: req.body?.type || req.body?.click_action || 'general',
      click_action: req.body?.click_action || req.body?.type || 'general',
      audience_type: req.body?.audience_type,
      audience_payload: req.body?.audience_payload,
      target_audience: req.body?.target_audience,
      expires_at: req.body?.expires_at || null,
      created_at: req.body?.created_at || new Date().toISOString(),
    });

    if (!compatibilityResult.success) {
      return res.status(500).json({
        success: false,
        message: compatibilityResult.legacyError || 'Failed to create notification',
      });
    }

    return res.status(201).json({
      success: true,
      data: buildNotificationViewModel({
        ...compatibilityResult.legacyNotification,
        recipient_status: 'unread',
        source: 'new_schema',
      }, callerUserId),
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get user notifications
export const getNotifications = async (req, res) => {
  try {
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];
    const membersId = req.headers['members-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const allTrusts = isAllTrustsScope(req);
    const context = await buildNotificationAccessContext(userId, allTrusts ? '' : trustId, membersId);
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
      if (row?.notification_id && !recipientStatusByNotification.has(row.notification_id)) {
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
        directNotifications = directRows.filter((row) => {
          const recipientStatus = recipientStatusByNotification.get(row.id);
          return (
            !isHiddenRecipientStatus(recipientStatus) &&
            isNotExpired(row) &&
            matchesTrustScope(row, context.trustId)
          );
        });
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
      if (isHiddenRecipientStatus(recipientStatusByNotification.get(row.id))) return false;
      const isRelevant = isNotificationVisibleToContext(row, context);
      return isRelevant;
    });

    const mappedNotifications = [...directNotifications, ...relevantNotifications]
      .map((row) => buildNotificationViewModel({
        ...row,
        recipient_status: recipientStatusByNotification.get(row.id) || row?.recipient_status || '',
        source: 'new_schema',
      }, normalizedUserId));

    const uniqueNotifications = await attachTrustNames(mergeNotifications(mappedNotifications));

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
    const membersId = req.headers['members-id'];

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

    // A notification can belong to any of the member's trusts (the list shows all of them),
    // so access is not limited to the trust currently selected in the app.
    const context = await buildNotificationAccessContext(userId, '', membersId);
    if (!(await canAccessNotification(existingNotification, context))) {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this notification' });
    }

    await syncRecipientReadState({
      userId,
      membersId,
      trustId: existingNotification.trust_id || trustId,
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
    const allTrusts = isAllTrustsScope(req);
    const userId = req.headers['user-id'];
    const trustId = req.headers['trust-id'];
    const membersId = req.headers['members-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const context = await buildNotificationAccessContext(userId, allTrusts ? '' : trustId, membersId);
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
        console.warn('Unable to read notification recipient rows for mark-all:', recipientError?.message || recipientError);
      } else {
        recipientRows = data || [];
      }
    }

    const recipientStatusByNotification = new Map();
    recipientRows.forEach((row) => {
      if (row?.notification_id && !recipientStatusByNotification.has(row.notification_id)) {
        recipientStatusByNotification.set(row.notification_id, row.status);
      }
    });
    const directNotificationIdSet = new Set(
      recipientRows
        .filter((row) => !isHiddenRecipientStatus(row?.status))
        .map((row) => row.notification_id)
        .filter(Boolean)
    );

    const { data: allNotifications, error: fetchError } = await supabase
      .from('notification')
      .select('id, trust_id, audience_type, audience_payload, expires_at')
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    const relevantNotificationIds = (allNotifications || [])
      .filter((notification) => {
        if (!isNotExpired(notification)) return false;
        if (!matchesTrustScope(notification, context.trustId)) return false;
        if (isHiddenRecipientStatus(recipientStatusByNotification.get(notification.id))) return false;
        return directNotificationIdSet.has(notification.id) || isNotificationRelevantForUser(notification, context);
      })
      .map((notification) => notification.id);

    if (!relevantNotificationIds.length) {
      return res.json({ success: true, message: 'No unread notifications found' });
    }

    const uniqueNotificationIds = [...new Set(relevantNotificationIds)];

    // Recipient rows are created per trust membership, so with ?scope=all each
    // notification is synced against its own trust.
    const idsByTrust = new Map();
    uniqueNotificationIds.forEach((notificationId) => {
      const notificationTrust = allTrusts
        ? normalizeText((allNotifications || []).find((row) => row.id === notificationId)?.trust_id) || normalizeText(trustId)
        : normalizeText(trustId);
      if (!idsByTrust.has(notificationTrust)) idsByTrust.set(notificationTrust, []);
      idsByTrust.get(notificationTrust).push(notificationId);
    });

    for (const [groupTrustId, groupIds] of idsByTrust) {
      await syncRecipientReadState({
        userId: normalizedUserId,
        membersId,
        trustId: groupTrustId || null,
        notificationIds: groupIds,
        isRead: true,
      });
    }

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
    const trustId = req.headers['trust-id'];
    const membersId = req.headers['members-id'];

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
      .select('id, trust_id, audience_type, audience_payload')
      .eq('click_action', 'birthday')
      .gte('created_at', `${todayStr}T00:00:00.000Z`)
      .limit(1000);

    const context = await buildNotificationAccessContext(userId, trustId, membersId);
    const alreadySentForUser = !checkError && (existing || []).some((row) => isNotificationVisibleToContext(row, context));

    if (alreadySentForUser) {
      return res.json({ success: true, birthdayToday: true, alreadySent: true, name: userName });
    }

    // 4. Insert birthday notification into notifications table
    const birthdayMessage = `🎂 Maharaja Agrasen Samiti ki taraf se aapko janamdin ki hardik shubhkamnayein, ${userName} ji! Aapka yeh din bahut khaas ho! 🎉🎊`;

    const compatibilityResult = await createCompatibleNotification({
      user_id: userId,
      title: '🎂 Happy Birthday!',
      message: birthdayMessage,
      type: 'birthday',
      trust_id: trustId || null,
      members_id: membersId || null,
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
    const membersId = req.headers['members-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const context = await buildNotificationAccessContext(userId, '', membersId);

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

    const isAuthorized = await canAccessNotification(existingNotification, context);

    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this notification' });
    }

    await syncRecipientStatus({
      userId,
      membersId,
      trustId: existingNotification.trust_id || trustId,
      notificationIds: [id],
      status: 'dismissed',
    });

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

