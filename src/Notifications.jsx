import React, { useState, useEffect, useRef } from 'react';
import { Bell, ChevronRight, Home as HomeIcon, Menu, X, Check, Calendar, User, Stethoscope, Clock, MapPin, Building2, FileText } from 'lucide-react';
import { getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } from './services/api';
import { supabase } from './services/supabaseClient';
import { readNotificationCache, writeNotificationCache } from './services/notificationCache';
import { getCurrentNotificationContext, matchesNotificationForContext } from './services/notificationAudience';
import { tryNavigateNotificationRoute } from './services/notificationRedirectService';
import Sidebar from './components/Sidebar';
import { useAppTheme } from './context/ThemeContext';

const buildNotificationContentKey = (notification) => {
  const title = String(notification?.title || '').trim().toLowerCase();
  const message = String(notification?.message || notification?.body || '').trim().toLowerCase();
  const type = String(notification?.type || '').trim().toLowerCase();
  const createdAt = String(notification?.created_at || '').trim();
  const createdAtSecond = createdAt ? createdAt.slice(0, 19) : '';
  return `${type}|${title}|${message}|${createdAtSecond}`;
};

const dedupeNotificationsByContent = (notifications) => {
  const seen = new Set();
  return notifications.filter((notification) => {
    const key = buildNotificationContentKey(notification);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const upsertNotificationById = (notifications, incomingNotification) => {
  const nextNotifications = [...(notifications || [])];
  const existingIndex = nextNotifications.findIndex((notification) => notification.id === incomingNotification.id);

  if (existingIndex >= 0) {
    nextNotifications[existingIndex] = {
      ...nextNotifications[existingIndex],
      ...incomingNotification,
    };
    return nextNotifications;
  }

  return dedupeNotificationsByContent([incomingNotification, ...nextNotifications]);
};

const Notifications = ({ onNavigate }) => {
  const theme = useAppTheme();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const channelRef = useRef(null);
  const pageBg = 'var(--page-bg, var(--app-page-bg))';
  const surface = 'var(--surface-color)';
  const heading = 'var(--heading-color)';
  const bodyText = 'var(--body-text-color)';
  const borderSoft = 'color-mix(in srgb, var(--brand-navy) 10%, transparent)';

  // Scroll locking only when sidebar is open (modal handles its own scroll)
  useEffect(() => {
    if (isMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';

      // Prevent scrolling
      const preventScroll = (e) => {
        if (e.type === 'wheel' || e.type === 'touchmove') {
          e.preventDefault();
        }
      };

      document.addEventListener('wheel', preventScroll, { passive: false });
      document.addEventListener('touchmove', preventScroll, { passive: false });

      return () => {
        document.removeEventListener('wheel', preventScroll);
        document.removeEventListener('touchmove', preventScroll);
      };
    } else {
      const scrollY = parseInt(document.body.style.top || '0') * -1;
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
      window.scrollTo(0, scrollY);
    }
    return () => {
      document.documentElement.style.overflow = 'unset';
      document.body.style.overflow = 'unset';
      document.body.style.position = 'unset';
      document.body.style.width = 'unset';
      document.body.style.top = 'unset';
      document.body.style.touchAction = 'auto';
    };
  }, [isMenuOpen]);

  // Load notifications on component mount and subscribe to realtime
  useEffect(() => {
    const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
    const cachedNotifications = readNotificationCache(trustKey);
    if (cachedNotifications) {
      setNotifications(cachedNotifications.notifications || []);
      setLoading(false);
    }

    const syncNotifications = (options = {}) => {
      fetchNotifications(options);

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      subscribeToNotifications();
    };

    // âœ… NEW: Add event listeners for notification updates
    const handlePushNotificationArrived = () => {
      syncNotifications({ showLoader: false });
    };

    const handlePushNotificationClicked = () => {
      syncNotifications({ showLoader: false });
    };

    const handleAppResumed = () => {
      syncNotifications({ showLoader: false });
    };

    const handleTrustChanged = () => {
      syncNotifications({ showLoader: false });
    };

    window.addEventListener('pushNotificationArrived', handlePushNotificationArrived);
    window.addEventListener('pushNotificationClicked', handlePushNotificationClicked);
    window.addEventListener('appResumed', handleAppResumed);
    window.addEventListener('trust-changed', handleTrustChanged);

    syncNotifications({ showLoader: !cachedNotifications });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      window.removeEventListener('pushNotificationArrived', handlePushNotificationArrived);
      window.removeEventListener('pushNotificationClicked', handlePushNotificationClicked);
      window.removeEventListener('appResumed', handleAppResumed);
      window.removeEventListener('trust-changed', handleTrustChanged);
    };
  }, []);

  const subscribeToNotifications = () => {
    const notificationContext = getCurrentNotificationContext();
    if (!notificationContext.userId) return;

    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotif = payload.new;
          const isForMe = matchesNotificationForContext(newNotif, notificationContext);
          if (isForMe) {
            const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
            setNotifications((prev) => {
              const next = upsertNotificationById(prev, newNotif);
              writeNotificationCache(trustKey, next);
              return next;
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload) => {
          const updatedNotif = payload.new;
          const isForMe = matchesNotificationForContext(updatedNotif, notificationContext);
          if (isForMe) {
            const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
            setNotifications((prev) => {
              const next = upsertNotificationById(prev, updatedNotif);
              writeNotificationCache(trustKey, next);
              return next;
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications' },
        (payload) => {
          const deletedNotif = payload.old;
          const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
          setNotifications((prev) => {
            const next = prev.filter((notification) => notification.id !== deletedNotif.id);
            writeNotificationCache(trustKey, next);
            return next;
          });
        }
      )
      .subscribe();

    channelRef.current = channel;
  };

  // Handle initial notification from sessionStorage
  useEffect(() => {
    const storedNotification = sessionStorage.getItem('initialNotification');
    if (storedNotification) {
      try {
        const notification = JSON.parse(storedNotification);
        if (notification) {
          // Process the notification
          handleNotificationClick(notification);
          // Remove from sessionStorage after processing
          sessionStorage.removeItem('initialNotification');
        }
      } catch (error) {
        console.error('Error parsing stored notification:', error);
      }
    }
  }, []);

  const fetchNotifications = async ({ showLoader = true } = {}) => {
    const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
    const cachedNotifications = readNotificationCache(trustKey);

    if (cachedNotifications) {
      setNotifications(cachedNotifications.notifications || []);
      setError('');
    }

    try {
      if (showLoader) {
        setLoading(true);
      }
      const response = await getUserNotifications();
      if (response.success) {
        const nextNotifications = response.data || [];
        setError('');
        setNotifications(nextNotifications);
        writeNotificationCache(trustKey, nextNotifications);
      } else {
        if (!cachedNotifications) {
          setNotifications([]);
          setError(response.message || 'Failed to fetch notifications');
        }
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
      if (!cachedNotifications) {
        setNotifications([]);
        setError('Failed to fetch notifications');
      }
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await markNotificationAsRead(id);
      // Update the notification locally
      const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
      setNotifications((prev) => {
        const next = prev.map((notif) => (
          notif.id === id ? { ...notif, is_read: true } : notif
        ));
        writeNotificationCache(trustKey, next);
        return next;
      });
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const handleNotificationClick = async (notification) => {
    try {
      // Mark as read when clicked
      if (!notification.is_read) {
        await markNotificationAsRead(notification.id);
        const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
        setNotifications((prev) => {
          const next = (Array.isArray(prev) ? prev : []).map((notif) => (
            notif.id === notification.id ? { ...notif, is_read: true } : notif
          ));
          writeNotificationCache(trustKey, next);
          return next;
        });
      }

      const hasRedirectRoute = await tryNavigateNotificationRoute({
        notification,
        navigate: onNavigate ? (route) => onNavigate(route) : null,
        fallback: () => {
          const appointmentId = extractAppointmentId(notification.message);
          setSelectedNotification({ ...notification, appointmentId });
          setShowDetailModal(true);
        },
      });

      if (hasRedirectRoute) {
        return;
      }
    } catch (err) {
      console.error('Error handling notification click:', err);
    }
  };

  const extractAppointmentId = (message) => {
    const text = String(message || '');
    const match = text.match(/appointment #([0-9]+)/i);
    return match ? match[1] : null;
  };

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedNotification(null);
  };

  // Handle opening a specific notification by ID (from push/local notification tap)
  useEffect(() => {
    const pendingId = sessionStorage.getItem('openNotificationId');
    if (!pendingId || notifications.length === 0) return;

    const found = notifications.find((n) => String(n.id) === String(pendingId));
    if (found) {
      handleNotificationClick(found);
      sessionStorage.removeItem('openNotificationId');
    }
  }, [notifications]);

  const handleDeleteNotification = async (e, id) => {
    e.stopPropagation();
    try {
      // Optimistically remove from UI
      const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id);
        writeNotificationCache(trustKey, next);
        return next;
      });
      // Call backend
      await deleteNotification(id);
    } catch (err) {
      console.error('Error deleting notification:', err);
      // Re-fetch if delete fails
      fetchNotifications();
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsAsRead();
      // Update all notifications locally
      const trustKey = String(localStorage.getItem('selected_trust_id') || '').trim();
      setNotifications((prev) => {
        const next = prev.map((notif) => ({ ...notif, is_read: true }));
        writeNotificationCache(trustKey, next);
        return next;
      });
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className={`min-h-screen pb-10 relative${isMenuOpen ? ' overflow-hidden max-h-screen' : ''}`} style={{ background: pageBg }}>
      {/* Navbar */}
      <div className="theme-navbar border-b px-4 sm:px-6 py-5 flex items-center justify-between sticky top-0 z-50 transition-all duration-300 pointer-events-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 rounded-xl transition-colors pointer-events-auto"
          style={{ background: 'transparent' }}
        >
          {isMenuOpen ? <X className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-6 w-6" style={{ color: 'var(--navbar-text)' }} />}
        </button>
        <h1 className="text-lg font-bold transition-colors" style={{ color: 'var(--navbar-text)' }}>Notifications</h1>
        <button
          onClick={() => onNavigate('home')}
          className="p-2 rounded-xl transition-colors flex items-center justify-center"
          style={{ color: 'var(--navbar-text)', background: 'transparent' }}
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <Sidebar
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onNavigate={onNavigate}
        currentPage="notifications"
      />

      {/* Actions Bar */}
      {notifications.length > 0 && unreadCount > 0 && (
        <div className="px-6 py-3 border-b flex items-center justify-between" style={{ background: surface, borderColor: borderSoft }}>
          <div className="text-sm" style={{ color: bodyText }}>{`${unreadCount} unread`}</div>
          <button
            onClick={handleMarkAllAsRead}
            className="text-xs font-semibold" style={{ color: theme.primary }}
          >
            Mark all as read
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="px-6 py-8">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-2xl p-4 shadow-sm border" style={{ background: surface, borderColor: borderSoft }}>
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="px-6 py-8">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <div className="text-red-600 mb-2">
              <Bell className="h-12 w-12 mx-auto" />
            </div>
            <h3 className="font-bold text-red-800 mb-1">Error Loading Notifications</h3>
            <p className="text-red-600 text-sm">{error}</p>
            <button
              onClick={fetchNotifications}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* No Notifications State */}
      {!loading && !error && notifications.length === 0 && (
        <div className="px-6 py-12">
          <div className="rounded-2xl p-8 text-center border" style={{ background: surface, borderColor: borderSoft }}>
            <div className="bg-gray-100 h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bell className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="font-bold mb-2" style={{ color: heading }}>No notifications yet</h3>
            <p className="text-gray-500 text-sm">
              You'll see important updates here when they arrive
            </p>
            <button
              onClick={() => onNavigate('home')}
              className="mt-4 px-4 py-2 text-white rounded-xl text-sm font-semibold transition-colors btn-brand"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}

      {/* Notifications List */}
      {!loading && !error && notifications.length > 0 && (
        <div className="px-6 py-4 space-y-4">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              className={`relative rounded-2xl p-5 shadow-sm border hover:shadow-md transition-all cursor-pointer ${!notification.is_read ? 'border-l-4 border-l-indigo-600' : ''
                }`}
              style={{
                background: !notification.is_read
                  ? `color-mix(in srgb, ${theme.primary} 8%, ${surface})`
                  : surface,
                borderColor: borderSoft
              }}
            >
              {/* Dismiss (X) button */}
              <button
                onClick={(e) => handleDeleteNotification(e, notification.id)}
                className="absolute top-3 right-3 p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
                title="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-start justify-between mb-2 pr-6">
                <h4 className={`font-semibold ${!notification.is_read ? 'font-bold' : ''}`} style={{ color: heading }}>
                  {notification.title}
                </h4>
                {!notification.is_read && (
                  <div className="flex-shrink-0 ml-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: theme.primary }}></div>
                  </div>
                )}
              </div>

              <p className="text-sm leading-relaxed mb-3" style={{ color: bodyText }}>
                {notification.message}
              </p>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 font-medium">
                  {new Date(notification.created_at).toLocaleDateString()} at {new Date(notification.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {!notification.is_read && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkAsRead(notification.id);
                    }}
                    className="text-xs font-semibold hover:opacity-80 flex items-center gap-1" style={{ color: theme.primary }}
                  >
                    <Check className="h-3 w-3" />
                    Mark as read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detailed Notification Modal */}
      {showDetailModal && selectedNotification && (() => {
        const doctorName = extractDoctorName(selectedNotification.message);
        const department = extractDepartment(selectedNotification.message);
        const dateTime = extractDateTime(selectedNotification.message);
        const patientName = extractPatientName(selectedNotification.message);

        return (
          <div className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center" onClick={closeDetailModal}>
            <div
              className="rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm overflow-hidden"
              style={{
                background: surface,
                border: `1px solid ${borderSoft}`,
                boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--navbar-border)', background: 'var(--navbar-bg, var(--app-navbar-bg))' }}>
                <h3 className="text-base font-extrabold tracking-tight" style={{ color: 'var(--navbar-text)' }}>Notification Details</h3>
                <button
                  onClick={closeDetailModal}
                  className="p-2 rounded-full transition-colors"
                  style={{ background: 'color-mix(in srgb, var(--navbar-bg) 78%, var(--surface-color))' }}
                >
                  <X className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="px-5 py-1.5 space-y-2" style={{ background: 'color-mix(in srgb, var(--surface-color) 95%, var(--app-page-bg))' }}>

                {/* Patient Name */}
                {patientName && (
                  <div className="rounded-xl p-3.5 border" style={{ background: `color-mix(in srgb, ${theme.secondary} 7%, var(--surface-color))`, borderColor: borderSoft }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: bodyText }}>Patient</p>
                    <p className="text-sm font-semibold" style={{ color: heading }}>{patientName}</p>
                  </div>
                )}

                {/* Doctor Details Card */}
                {(doctorName || department) && (
                  <div className="rounded-xl p-3.5 border-l-4" style={{ background: 'color-mix(in srgb, #3b82f6 7%, var(--surface-color))', borderLeftColor: '#3b82f6' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: bodyText }}>Doctor</p>
                    {doctorName && (
                      <p className="text-sm font-semibold mb-1" style={{ color: heading }}>Doctor: {doctorName}</p>
                    )}
                    {department && !department.includes('Not specified') && (
                      <p className="text-xs" style={{ color: bodyText }}>{department}</p>
                    )}
                  </div>
                )}

                {/* Date & Time Card */}
                {dateTime && !dateTime.includes('Not specified') && (
                  <div className="rounded-xl p-3.5 border-l-4" style={{ background: 'color-mix(in srgb, #10b981 8%, var(--surface-color))', borderLeftColor: '#10b981' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: bodyText }}>Appointment</p>
                    <p className="text-sm font-semibold" style={{ color: heading }}>{dateTime}</p>
                  </div>
                )}

                {/* Full Message (for reference) */}
                <div className="rounded-xl p-2.5 border" style={{ background: 'var(--surface-color)', borderColor: borderSoft }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: bodyText }}>Details</p>
                  <p className="text-sm leading-relaxed whitespace-pre-line text-justify" style={{ color: heading }}>{selectedNotification.message}</p>
                </div>

                {/* Timestamp */}
                <div className="pt-1 text-center">
                  <span className="inline-block text-xs font-semibold rounded-full px-3 py-1" style={{ color: bodyText, background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))' }}>
                    {new Date(selectedNotification.created_at).toLocaleDateString()} at{' '}
                    {new Date(selectedNotification.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t" style={{ borderColor: borderSoft }}>
                <button
                  onClick={closeDetailModal}
                  className="w-full py-2 text-white rounded-xl font-semibold text-sm transition-colors btn-brand"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};

// Helper functions to extract details from formatted messages
const extractPatientName = (message) => {
  // Pattern: ðŸ‘¤ Patient: [Name]
  const match = message.match(/ðŸ‘¤ Patient:\s*([^\n]+)/i);
  if (match) return match[1].trim();

  // Pattern: Hello [Name],
  const helloMatch = message.match(/Hello\s+([^,]+),/i);
  if (helloMatch) return helloMatch[1].trim();

  return null;
};

const extractDoctorName = (message) => {
  // Pattern: Doctor: Dr. [Name]
  const doctorMatch = message.match(/Doctor:\s*(?:Dr\.\s*)?([^\n]+)/i);
  if (doctorMatch) {
    const name = doctorMatch[1].trim();
    return name.startsWith('Dr.') ? name : `Dr. ${name}`;
  }

  // Pattern: ðŸ‘¨â€âš•ï¸ Doctor: Dr. [Name] or ðŸ‘¨â€âš•ï¸ Referred To: Dr. [Name]
  const emojiMatch = message.match(/ðŸ‘¨â€âš•ï¸\s+(?:Doctor|Referred To):\s*Dr\.\s*([^\n]+)/i);
  if (emojiMatch) return 'Dr. ' + emojiMatch[1].trim();

  // Pattern: with Dr. [Name]
  const withMatch = message.match(/with\s+Dr\.\s*([^\s]+(?:\s+[^\s]+)*)/i);
  if (withMatch) return 'Dr. ' + withMatch[1].trim();

  return null;
};

const formatDate = (dateStr) => {
  try {
    // Handle YYYY-MM-DD format
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }
    return dateStr;
  } catch {
    return dateStr;
  }
};

const extractDateTime = (message) => {
  // Pattern: Date: [formatted date] and Time: [time]
  const plainDateMatch = message.match(/Date:\s*([^\n]+)/i);
  const plainTimeMatch = message.match(/Time:\s*([^\n]+)/i);

  if (plainDateMatch && plainTimeMatch) {
    const dateStr = plainDateMatch[1].trim();
    const timeStr = plainTimeMatch[1].trim();
    // If dateStr looks like a formatted date, return as-is; otherwise try to format
    return `${dateStr} at ${timeStr}`;
  } else if (plainDateMatch) {
    const dateStr = plainDateMatch[1].trim();
    return dateStr;
  }

  // Pattern: ðŸ“… Previous Date & Time: [date] [time]
  // Pattern: âž¡ï¸ New Date & Time: [date] [time]
  const previousMatch = message.match(/ðŸ“…\s*Previous\s+Date\s+&\s+Time:\s*([^\n]+)/i);
  const newMatch = message.match(/âž¡ï¸\s*New\s+Date\s+&\s+Time:\s*([^\n]+)/i);

  if (previousMatch && newMatch) {
    const prevParts = previousMatch[1].trim().split(/\s+/);
    const newParts = newMatch[1].trim().split(/\s+/);
    const prevDate = prevParts[0];
    const prevTime = prevParts.slice(1).join(' ');
    const newDate = newParts[0];
    const newTime = newParts.slice(1).join(' ');

    return `Previous: ${formatDate(prevDate)} ${prevTime}\nNew: ${formatDate(newDate)} ${newTime}`;
  }

  // Pattern: ðŸ“… Appointment Date: [date]
  // Pattern: ðŸ• Appointment Time: [time]
  const dateMatch = message.match(/ðŸ“…\s*Appointment\s+Date:\s*([^\n]+)/i);
  const timeMatch = message.match(/ðŸ•\s*Appointment\s+Time:\s*([^\n]+)/i);

  if (dateMatch && timeMatch) {
    return `${formatDate(dateMatch[1].trim())} at ${timeMatch[1].trim()}`;
  } else if (dateMatch) {
    return formatDate(dateMatch[1].trim());
  }

  return null;
};

const extractDepartment = (message) => {
  // Pattern: Department: [Department]
  const match = message.match(/Department:\s*([^\n]+)/i);
  if (match) return match[1].trim();
  
  // Pattern: ðŸ¥ Department: [Department]
  const emojiMatch = message.match(/ðŸ¥\s*Department:\s*([^\n]+)/i);
  if (emojiMatch) return emojiMatch[1].trim();
  
  return null;
};

export default Notifications;
