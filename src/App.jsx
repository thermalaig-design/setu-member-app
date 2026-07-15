import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ThemeContext } from './context/ThemeContext';
import { GalleryProvider } from './context/GalleryContext';
import Login from './Login';
import VIPLogin from './VIPLogin';
import Home from './Home';
import OTPVerification from './OTPVerification';
import SpecialOTPVerification from './SpecialOTPVerification';
import Directory from './Directory';
import Profile from './Profile';
import Appointments from './Appointments';
import Reports from './Reports';
import Referral from './Referral';
import Notices from './Notices';
import NoticeDetail from './NoticeDetail';
import Facilities from './Facilities';
import FacilityDetail from './FacilityDetail';
import Events from './Events';
import EventDetail from './EventDetail';
import Achievements from './Achievements';
import AchievementDetail from './AchievementDetail';
import Donation from './Donation';
import DonationForm from './DonationForm';
import ExecutiveBody from './ExecutiveBody';
import Notifications from './Notifications';
import HealthcareTrusteeDirectory from './HealthcareTrusteeDirectory';
import MemberDetails from './MemberDetails';
import CommitteeMembers from './CommitteeMembers';
import ProtectedRoute from './ProtectedRoute';
import SponsorDetails from './SponsorDetails';
import SponsorsList from './SponsorsList';
import DeveloperDetails from './DeveloperDetails';
import FeatureGuard from './components/FeatureGuard';

import TermsAndConditions from './TermsAndConditions';
import PrivacyPolicy from './PrivacyPolicy';
import Gallery from './Gallery';
import OtherMemberships from './OtherMemberships';
import AdminUserProfiles from './admin/AdminUserProfiles';
import ContactUs from './ContactUs';
import MyFamily from './MyFamily';
import NominationDetails from './NominationDetails';
import AddCommunity from './AddCommunity';
import TrustIdCard from './TrustIdCard';
import AppVersionUpdatePrompt from './components/AppVersionUpdatePrompt';
import { getCurrentNotificationContext, matchesNotificationForContext } from './services/notificationAudience';
import { initPushNotifications } from './services/pushNotificationService';
import { syncTrustVersion } from './services/trustVersionService';
import { logUserSessionEvent } from './services/sessionAuditService';
import { applyThemeCssVariables, scopeCustomCss } from './utils/themeUtils';
import { clearLoginTermsPromptPending } from './utils/legalContent';
import { colorToHex } from './utils/colorUtils';
import {
  THEME_REFRESH_EVENT
} from './utils/themeEvents';

import {
  useAndroidBackHandler,
  useAndroidStatusBar,
  useAndroidSafeArea,
  useAndroidScreenOrientation,
  useAndroidKeyboard,
  useSwipeBackNavigation,
  useTheme,
  useInAppUpdate
} from './hooks';

const LAST_THEME_CACHE_KEY = 'last_theme_cache_v3';
const LEGACY_LAST_THEME_CACHE_KEYS = ['last_theme_cache_v2', 'last_theme_cache_v1'];
const THEME_CACHE_VERSION = 'v3';
const LEGACY_THEME_CACHE_VERSIONS = ['v2'];
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const TRUST_ID_CARD_CACHE_KEY = 'trust_id_card_payload_v1';
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 30);
const AUTO_LOGOUT_MS = Math.max(1, AUTO_LOGOUT_MINUTES) * 60 * 1000;
const getPersistTrustCacheIndexKey = (trustId) => `theme_cache_persist_trust_${THEME_CACHE_VERSION}_${trustId}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_RE.test(String(value || '').trim());

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readLastKnownThemeTrust = () => {
  const parsedCurrent = safeParse(localStorage.getItem(LAST_THEME_CACHE_KEY) || '');
  const parsedLegacy = LEGACY_LAST_THEME_CACHE_KEYS
    .map((key) => safeParse(localStorage.getItem(key) || ''))
    .find(Boolean);
  const parsed = parsedCurrent || parsedLegacy;
  if (!parsed || typeof parsed !== 'object') return { id: '', name: '' };
  const id = String(parsed.selectedTrustId || parsed.trustId || '').trim();
  const name = String(parsed.selectedTrustName || parsed.trustName || '').trim();
  return { id, name };
};

const readBootThemeCache = (trustId) => {
  const normalizedTrustId = String(trustId || '').trim();
  if (!normalizedTrustId) return null;

  const trustIndexKey = `theme_cache_trust_${THEME_CACHE_VERSION}_${normalizedTrustId}`;
  const activeEntryKey = sessionStorage.getItem(trustIndexKey);
  if (activeEntryKey) {
    const parsedEntry = safeParse(sessionStorage.getItem(activeEntryKey) || '');
    if (parsedEntry?.theme && typeof parsedEntry.theme === 'object') {
      return parsedEntry.theme;
    }
  }

  const legacyEntry = safeParse(sessionStorage.getItem(`theme_cache_${normalizedTrustId}`) || '');
  if (legacyEntry && typeof legacyEntry === 'object') {
    if (legacyEntry.theme && typeof legacyEntry.theme === 'object') {
      return legacyEntry.theme;
    }
    return legacyEntry;
  }

  const persistIndexKey = getPersistTrustCacheIndexKey(normalizedTrustId);
  const persistEntryKey = localStorage.getItem(persistIndexKey);
  if (persistEntryKey) {
    const parsedPersist = safeParse(localStorage.getItem(persistEntryKey) || '');
    if (parsedPersist?.theme && typeof parsedPersist.theme === 'object') {
      return parsedPersist.theme;
    }
  }

  const lastTheme = safeParse(localStorage.getItem(LAST_THEME_CACHE_KEY) || '')
    || LEGACY_LAST_THEME_CACHE_KEYS.map((key) => safeParse(localStorage.getItem(key) || '')).find(Boolean);
  if (!lastTheme || typeof lastTheme !== 'object') {
    // Recovery path when index keys are missing but trust cache entries exist.
    const sessionPrefixes = [
      `theme_cache_${THEME_CACHE_VERSION}_${normalizedTrustId}_`,
      ...LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_${version}_${normalizedTrustId}_`)
    ];
    const persistPrefixes = [
      `theme_cache_persist_${THEME_CACHE_VERSION}_${normalizedTrustId}_`,
      ...LEGACY_THEME_CACHE_VERSIONS.map((version) => `theme_cache_persist_${version}_${normalizedTrustId}_`)
    ];
    let recoveredTheme = null;
    let recoveredTs = 0;

    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key || !sessionPrefixes.some((prefix) => key.startsWith(prefix))) continue;
      const parsed = safeParse(sessionStorage.getItem(key) || '');
      const candidateTheme = parsed?.theme;
      const candidateTs = Number(parsed?.ts) || 0;
      if (candidateTheme && typeof candidateTheme === 'object' && candidateTs >= recoveredTs) {
        recoveredTheme = candidateTheme;
        recoveredTs = candidateTs;
      }
    }

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !persistPrefixes.some((prefix) => key.startsWith(prefix))) continue;
      const parsed = safeParse(localStorage.getItem(key) || '');
      const candidateTheme = parsed?.theme;
      const candidateTs = Number(parsed?.ts) || 0;
      if (candidateTheme && typeof candidateTheme === 'object' && candidateTs >= recoveredTs) {
        recoveredTheme = candidateTheme;
        recoveredTs = candidateTs;
      }
    }

    return recoveredTheme;
  }

  const cachedTrustId = String(lastTheme.selectedTrustId || lastTheme.trustId || '').trim();
  if (cachedTrustId === normalizedTrustId) return lastTheme;
  return null;
};

const applyThemeToDocument = (theme) => {
  applyThemeCssVariables(theme);

  const styleId = 'trust-custom-css-scoped';
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();
  document.getElementById('trust-custom-css-global')?.remove();

  const scopedCustomCss = scopeCustomCss(theme?.customCss || '');
  if (!scopedCustomCss) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = scopedCustomCss;
  document.head.appendChild(style);
};

const HospitalTrusteeApp = () => {
  const BASE_TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
  const BASE_TRUST_NAME = import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust';
  const LAST_VISITED_ROUTE_KEY = 'lastVisitedRoute';
  const PUBLIC_ROUTES = ['/login', '/otp-verification', '/special-otp-verification', '/terms-and-conditions', '/privacy-policy', '/developers', '/vip-login'];
  const navigate = useNavigate();
  const location = useLocation();
  const [isMember] = useState(true);
  const shouldRestoreMemberState =
    location.pathname === '/member-details'
    || location.pathname === '/executive_members_details'
    || location.pathname === '/committee-members';
  const routeStateMember = location.state?.memberData || null;
  const [selectedMember, setSelectedMember] = useState(() => {
    if (!shouldRestoreMemberState) return null;
    const storedMember = safeParse(sessionStorage.getItem('selectedMember') || '');
    return storedMember && typeof storedMember === 'object' ? storedMember : null;
  });
  const [selectedDetailMember, setSelectedDetailMember] = useState(() => {
    if (!shouldRestoreMemberState) return null;
    const storedDetailMember = safeParse(sessionStorage.getItem('selectedDetailMember') || '');
    return storedDetailMember && typeof storedDetailMember === 'object' ? storedDetailMember : null;
  });
  const [previousScreen, setPreviousScreen] = useState(() => {
    if (!shouldRestoreMemberState) return null;
    return String(sessionStorage.getItem('previousScreen') || '').trim() || null;
  });
  const [previousScreenName, setPreviousScreenName] = useState(() => {
    if (!shouldRestoreMemberState) return null;
    return String(sessionStorage.getItem('previousScreenName') || '').trim() || null;
  });
  const committeeDetailMember =
    (routeStateMember?.source === 'committee-members' ? routeStateMember : null)
    || (selectedDetailMember?.source === 'committee-members' ? selectedDetailMember : null);
  const resolvedCommitteePreviousScreen = selectedMember?.previousScreen || previousScreen;
  const resolvedCommitteePreviousScreenName = selectedMember?.previousScreenName || previousScreenName;
  const [activeTrustId, setActiveTrustId] = useState(() => {
    const selected = localStorage.getItem('selected_trust_id') || '';
    if (selected) return selected;
    const persistedSelected = String(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '').trim();
    if (persistedSelected) return persistedSelected;
    try {
      const cachedDefault = localStorage.getItem('default_trust_cache');
      if (cachedDefault) {
        const parsed = JSON.parse(cachedDefault);
        if (parsed?.id) return String(parsed.id);
      }
    } catch {
      // ignore malformed cache
    }
    const lastKnownThemeTrust = readLastKnownThemeTrust();
    if (lastKnownThemeTrust.id) return lastKnownThemeTrust.id;
    return '';
  });
  const resolveDefaultThemeTrust = () => {
    try {
      const cachedDefault = localStorage.getItem('default_trust_cache');
      if (cachedDefault) {
        const parsed = JSON.parse(cachedDefault);
        const id = parsed?.id ? String(parsed.id).trim() : '';
        const name = parsed?.name ? String(parsed.name).trim() : '';
        if (id) {
          return { id, name: name || BASE_TRUST_NAME };
        }
      }
    } catch {
      // ignore malformed default cache
    }

    const selectedId = String(localStorage.getItem('selected_trust_id') || '').trim();
    const selectedName = String(localStorage.getItem('selected_trust_name') || '').trim();
    if (selectedId) {
      return { id: selectedId, name: selectedName || BASE_TRUST_NAME };
    }

    const persistedSelectedId = String(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '').trim();
    if (persistedSelectedId) {
      return { id: persistedSelectedId, name: selectedName || BASE_TRUST_NAME };
    }

    const lastKnownThemeTrust = readLastKnownThemeTrust();
    if (lastKnownThemeTrust.id) {
      return { id: lastKnownThemeTrust.id, name: lastKnownThemeTrust.name || BASE_TRUST_NAME };
    }

    if (BASE_TRUST_ID) {
      return { id: BASE_TRUST_ID, name: BASE_TRUST_NAME };
    }

    return { id: '', name: BASE_TRUST_NAME };
  };
  const authThemeRoutes = ['/login', '/otp-verification', '/special-otp-verification', '/vip-login', '/terms-and-conditions', '/privacy-policy'];
  const shouldUseBaseTheme = authThemeRoutes.includes(location.pathname);
  const defaultThemeTrust = resolveDefaultThemeTrust();
  const resolvedThemeTrustId = shouldUseBaseTheme
    ? defaultThemeTrust.id
    : (activeTrustId || defaultThemeTrust.id);
  const { theme: appTheme, refreshTheme } = useTheme(resolvedThemeTrustId);
  const notificationLightColorRef = useRef('');
  const pushInitCleanupRef = useRef(null);
  const pushInitAttemptedRef = useRef(false);
  const lastLoggedInStateRef = useRef(false);

  useLayoutEffect(() => {
    if (!resolvedThemeTrustId) return;
    const cachedTheme = readBootThemeCache(resolvedThemeTrustId);
    if (!cachedTheme) return;

    applyThemeToDocument(cachedTheme);
  }, [resolvedThemeTrustId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const rootBrand = typeof window !== 'undefined'
      ? window.getComputedStyle(document.documentElement).getPropertyValue('--brand-red').trim()
      : '';
    const baseColor = appTheme?.primary || rootBrand || 'var(--brand-red)';
    notificationLightColorRef.current = `${colorToHex(baseColor)}E5`;
  }, [appTheme?.primary]);

  // Initialize Android features
  useAndroidBackHandler();
  useSwipeBackNavigation();
  useAndroidStatusBar();
  useAndroidSafeArea();
  useAndroidScreenOrientation('PORTRAIT');
  useAndroidKeyboard();
  useInAppUpdate();

  useEffect(() => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const wasLoggedIn = lastLoggedInStateRef.current;
    lastLoggedInStateRef.current = isLoggedIn;

    if (!isLoggedIn) {
      if (wasLoggedIn && typeof pushInitCleanupRef.current === 'function') {
        pushInitCleanupRef.current();
        pushInitCleanupRef.current = null;
      }
      pushInitAttemptedRef.current = false;
      return undefined;
    }

    if (pushInitAttemptedRef.current) return undefined;

    pushInitAttemptedRef.current = true;
    const setupPushNotifications = async () => {
      try {
        const cleanup = await initPushNotifications();
        if (typeof cleanup === 'function') {
          pushInitCleanupRef.current = cleanup;
        }
      } catch (error) {
        console.warn('Push notification init skipped:', error?.message || error);
      }
    };

    setupPushNotifications();
  }, [location.pathname]);

  useEffect(() => () => {
    if (typeof pushInitCleanupRef.current === 'function') {
      pushInitCleanupRef.current();
      pushInitCleanupRef.current = null;
    }
  }, []);

  const clearAuthAndRedirectToLogin = async (reason = 'logout', explicitUser = null) => {
    let currentUser = explicitUser;
    if (!currentUser) {
      try {
        const rawUser = localStorage.getItem('user');
        if (rawUser) currentUser = JSON.parse(rawUser);
      } catch {
        currentUser = null;
      }
    }
    await logUserSessionEvent({
      user: currentUser,
      actionType: reason === 'autologout' ? 'autologout' : 'logout',
      extra: { source: 'app-shell', reason }
    });
    const resetTrust = resolveDefaultThemeTrust();
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('user');
    localStorage.removeItem(LAST_VISITED_ROUTE_KEY);
    clearLoginTermsPromptPending();
    if (resetTrust.id) {
      localStorage.setItem('selected_trust_id', resetTrust.id);
      localStorage.setItem('selected_trust_name', resetTrust.name || BASE_TRUST_NAME);
      localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, resetTrust.id);
    } else {
      localStorage.removeItem('selected_trust_id');
      localStorage.removeItem('selected_trust_name');
      localStorage.removeItem(LAST_SELECTED_TRUST_ID_KEY);
    }
    sessionStorage.removeItem('selectedMember');
    sessionStorage.removeItem('selectedDetailMember');
    sessionStorage.removeItem('previousScreen');
    sessionStorage.removeItem('previousScreenName');
    sessionStorage.removeItem('trust_selected_in_session');
    setActiveTrustId(resetTrust.id || '');
    window.dispatchEvent(new CustomEvent('trust-changed', {
      detail: { trustId: resetTrust.id || null, trustName: resetTrust.name || BASE_TRUST_NAME }
    }));
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    if (PUBLIC_ROUTES.includes(location.pathname)) return undefined;

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (!isLoggedIn) return undefined;

    let isLoggingOut = false;
    let lastActivityAt = Date.now();

    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    // Keep activity signals strict so tiny cursor movement does not keep session alive.
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach((evt) => window.addEventListener(evt, markActivity, { passive: true }));
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markActivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const intervalId = setInterval(() => {
      if (isLoggingOut) return;
      const isStillLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
      if (!isStillLoggedIn) return;
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs >= AUTO_LOGOUT_MS) {
        isLoggingOut = true;
        clearAuthAndRedirectToLogin('autologout');
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
      events.forEach((evt) => window.removeEventListener(evt, markActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [location.pathname]);

  useEffect(() => {
    const syncTrustId = () => {
      let next = localStorage.getItem('selected_trust_id') || '';
      if (!next) next = String(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '').trim();
      if (!next) {
        try {
          const cachedDefault = localStorage.getItem('default_trust_cache');
          if (cachedDefault) {
            const parsed = JSON.parse(cachedDefault);
            next = parsed?.id ? String(parsed.id) : '';
          }
        } catch {
          // ignore malformed cache
        }
      }
      setActiveTrustId((prev) => (prev === next ? prev : next));
    };

    const onTrustChanged = (event) => {
      const next = event?.detail?.trustId || localStorage.getItem('selected_trust_id') || '';
      setActiveTrustId((prev) => (prev === next ? prev : next));
    };

    syncTrustId();
    window.addEventListener('trust-changed', onTrustChanged);
    window.addEventListener('focus', syncTrustId);
    window.addEventListener('storage', syncTrustId);
    document.addEventListener('visibilitychange', syncTrustId);

    return () => {
      window.removeEventListener('trust-changed', onTrustChanged);
      window.removeEventListener('focus', syncTrustId);
      window.removeEventListener('storage', syncTrustId);
      document.removeEventListener('visibilitychange', syncTrustId);
    };
  }, []);

  useEffect(() => {
    if (!activeTrustId) return undefined;

    let cancelled = false;

    const runVersionSync = async () => {
      try {
        await syncTrustVersion(activeTrustId);
      } catch (error) {
        if (!cancelled) {
          console.warn('[TrustVersion] sync failed:', error?.message || error);
        }
      }
    };

    const onFocus = () => {
      runVersionSync();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') runVersionSync();
    };

    const onTrustChanged = (event) => {
      const nextTrustId = String(event?.detail?.trustId || localStorage.getItem('selected_trust_id') || '').trim();
      if (nextTrustId) {
        syncTrustVersion(nextTrustId).catch((error) => {
          console.warn('[TrustVersion] trust change sync failed:', error?.message || error);
        });
      }
    };

    runVersionSync();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('trust-changed', onTrustChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('trust-changed', onTrustChanged);
    };
  }, [activeTrustId]);

  useEffect(() => {
    applyThemeToDocument(appTheme);

    return () => {
      document.getElementById('trust-custom-css-scoped')?.remove();
      document.getElementById('trust-custom-css-global')?.remove();
    };
  }, [appTheme]);

  useEffect(() => {
    const handleThemeRefresh = () => refreshTheme();
    window.addEventListener(THEME_REFRESH_EVENT, handleThemeRefresh);

    return () => {
      window.removeEventListener(THEME_REFRESH_EVENT, handleThemeRefresh);
    };
  }, [refreshTheme]);

  // Push tap deep link fallback
  useEffect(() => {
    const shouldOpen = localStorage.getItem('openNotificationsFromPush');
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (shouldOpen === '1' && isLoggedIn) {
      localStorage.removeItem('openNotificationsFromPush');
      navigate('/notifications');
    }
  }, [location.pathname, navigate]);

  // â”€â”€â”€ Birthday Notification Check (Direct Supabase) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_NOTIFICATIONS === 'true') return;
    const checkBirthday = async () => {
      try {
        const userStr = localStorage.getItem('user');
        if (!userStr) {
          return;
        }

        const parsedUser = JSON.parse(userStr);

        const mobileForSearch = parsedUser.Mobile || parsedUser.mobile || parsedUser.phone || '';
        const membershipId = parsedUser['Membership number'] || parsedUser.membershipNumber || parsedUser['membership_number'] || '';
        const membersId = [parsedUser.members_id, parsedUser.member_id, parsedUser.id].find(isUuid) || '';
        // Primary userId for notifications table
        const userId = mobileForSearch || membershipId || String(membersId || '');

        if (!userId) {
          return;
        }

        // Avoid showing local notification more than once per day
        const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        const today = todayIST.toISOString().slice(0, 10); // YYYY-MM-DD
        const localKey = `birthdayNotif_${userId}_${today}`;
        if (localStorage.getItem(localKey)) {
          return;
        }

        // Import supabase dynamically to avoid circular deps
        const { supabase } = await import('./services/supabaseClient');

        if (!membersId) {
          return;
        }

        const { data: profile } = await supabase
          .from('member_profiles')
          .select('date_of_birth')
          .eq('members_id', membersId)
          .maybeSingle();

        if (!profile || !profile.date_of_birth) return;

        const dobParts = String(profile.date_of_birth).split('-');
        if (dobParts.length < 3) return;
        const dobMonth = dobParts[1];
        const dobDay = dobParts[2].substring(0, 2);
        const todayMonth = String(todayIST.getUTCMonth() + 1).padStart(2, '0');
        const todayDay = String(todayIST.getUTCDate()).padStart(2, '0');

        if (dobMonth !== todayMonth || dobDay !== todayDay) return;

        const userName = parsedUser.name || parsedUser.Name || 'Member';

        const isMissingUserIdColumnError = (error) =>
          /column\s+notifications\.user_id\s+does not exist/i.test(String(error?.message || ''));

        let existing = [];
        let canUseUserIdColumn = true;
        const { data: existingData, error: existingError } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', String(userId))
          .eq('type', 'birthday')
          .gte('created_at', `${today}T00:00:00.000Z`)
          .limit(1);

        if (existingError) {
          if (isMissingUserIdColumnError(existingError)) {
            canUseUserIdColumn = false;
            console.warn('[Birthday] notifications.user_id column missing; skipping birthday DB sync.');
          } else {
            throw existingError;
          }
        } else {
          existing = existingData || [];
        }

        const birthdayMessage = `ðŸŽ‚ Maharaja Agrasen Samiti ki taraf se aapko janamdin ki hardik shubhkamnayein, ${userName} ji! Aapka yeh din bahut khaas ho! ðŸŽ‰ðŸŽŠ`;

        if (canUseUserIdColumn && (!existing || existing.length === 0)) {
          const { error: insertErr } = await supabase.from('notifications').insert({
            user_id: String(userId),
            title: 'ðŸŽ‚ Happy Birthday!',
            message: birthdayMessage,
            type: 'birthday',
            is_read: false,
            created_at: new Date().toISOString(),
          });
          if (insertErr) {
            console.error('ðŸŽ‚ [Birthday] DB insert error:', insertErr.message);
          }
        }

        localStorage.setItem(localKey, '1');
        window.dispatchEvent(new Event('birthdayNotifInserted'));

        try {
          await LocalNotifications.createChannel({
            id: 'birthday_channel',
            name: 'Birthday Wishes',
            description: 'Birthday notifications from Mah-Setu app',
            importance: 5,
            visibility: 1,
            sound: 'default',
            vibration: true,
            lights: true,
            lightColor: notificationLightColorRef.current,
          });

          const permResult = await LocalNotifications.requestPermissions();
          if (permResult.display === 'granted') {
            const notifId = Date.now() % 2147483647;
            await LocalNotifications.schedule({
              notifications: [
                {
                  id: notifId,
                  title: 'ðŸŽ‚ Happy Birthday!',
                  body: `Mah-Setu ki taraf se ${userName} ji ko janamdin ki hardik shubhkamnayein! ðŸŽ‰ðŸŽŠ`,
                  channelId: 'birthday_channel',
                  schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true },
                  sound: null,
                  attachments: null,
                  actionTypeId: '',
                  extra: null,
                },
              ],
            });
          }
        } catch (notifErr) {
          console.warn('[Birthday] LocalNotifications error:', notifErr.message || notifErr);
        }
      } catch (err) {
        console.error('[Birthday] Unexpected error:', err);
      }
    };

    const timer = setTimeout(checkBirthday, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Notification listener for Supabase -> LocalNotifications (no Firebase required)
  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_NOTIFICATIONS === 'true') return;
    let pollInterval = null;
    let timer = null;
    let supabaseRef = null;
    let realtimeChannel = null;
    let isDisposed = false;

    const setupNotificationListener = async () => {
      try {
        const userStr = localStorage.getItem('user');
        if (!userStr) {
          return;
        }

        const notificationContext = getCurrentNotificationContext();
        const { userId, userIdVariants, audienceVariants } = notificationContext;

        if (!userId) {
          return;
        }

        const { supabase } = await import('./services/supabaseClient');
        supabaseRef = supabase;

        const notificationTracker = new Set();
        const trackerKey = `shownNotifications_${userId}`;
        const normalizeId = (value) => String(value || '').trim().toLowerCase();
        const fallbackUserIdSet = new Set();
        const fallbackUserIdRawSet = new Set();
        let canQueryNotificationUserId = true;
        const isMissingUserIdColumnError = (error) =>
          /column\s+notifications\.user_id\s+does not exist/i.test(String(error?.message || ''));
        const isUserIdTypeMismatchError = (error) =>
          /invalid input syntax for type uuid/i.test(String(error?.message || ''))
          || /operator does not exist/i.test(String(error?.message || ''));
        const phoneLikeUserIdVariants = userIdVariants.filter((value) => {
          if (!/^\d+$/.test(String(value || '').trim())) return false;
          const digits = String(value || '').replace(/\D/g, '');
          return digits.length >= 10;
        });

        const refreshFallbackUserIds = async () => {
          if (phoneLikeUserIdVariants.length === 0) return;
          try {
            const { data: linkedAppointments } = await supabase
              .from('appointments')
              .select('patient_name, membership_number, user_id')
              .in('patient_phone', phoneLikeUserIdVariants)
              .limit(500);

            fallbackUserIdSet.clear();
            fallbackUserIdRawSet.clear();
            (linkedAppointments || []).forEach((row) => {
              const patientName = String(row?.patient_name || '').trim();
              const membershipNumber = String(row?.membership_number || '').trim();
              const appointmentUserId = String(row?.user_id || '').trim();

              if (patientName) {
                fallbackUserIdRawSet.add(patientName);
                fallbackUserIdSet.add(normalizeId(patientName));
              }
              if (membershipNumber) {
                fallbackUserIdRawSet.add(membershipNumber);
                fallbackUserIdSet.add(normalizeId(membershipNumber));
              }
              if (appointmentUserId) {
                fallbackUserIdRawSet.add(appointmentUserId);
                fallbackUserIdSet.add(normalizeId(appointmentUserId));
              }
            });
          } catch (fallbackErr) {
            console.warn('[NotifListener] Fallback user-id refresh failed:', fallbackErr?.message || fallbackErr);
          }
        };

        await refreshFallbackUserIds();
        const existing = localStorage.getItem(trackerKey);
        if (existing) {
          try {
            const existingIds = JSON.parse(existing);
            existingIds.forEach((id) => notificationTracker.add(id));
          } catch {
            console.warn('[NotifListener] Could not parse notification tracker');
          }
        }

        const showPushNotification = async (notification) => {
          if (isDisposed || notificationTracker.has(notification.id)) return;

          try {
            window.dispatchEvent(new CustomEvent('pushNotificationArrived', { detail: notification }));

            await LocalNotifications.createChannel({
              id: `notif_channel_${notification.type || 'general'}`,
              name: notification.type === 'appointment_insert' ? 'Appointment Updates'
                : notification.type === 'referral' ? 'Referral Updates'
                  : notification.type === 'birthday' ? 'Birthday Wishes'
                    : notification.type === 'test' ? 'Test Notifications'
                      : 'Hospital Notifications',
              description: 'Updates from Mah-Setu app',
              importance: 5,
              visibility: 1,
              sound: 'default',
              vibration: true,
              lights: true,
              lightColor: notificationLightColorRef.current,
            });

            const permResult = await LocalNotifications.requestPermissions();
            if (permResult.display !== 'granted') {
              console.warn('[NotifListener] Permission not granted:', permResult.display);
              return;
            }

            const notifId = Date.now() % 2147483647;
            await LocalNotifications.schedule({
              notifications: [
                {
                  id: notifId,
                  title: notification.title || 'New Notification',
                  body: (notification.message || notification.body || 'You have a new notification').substring(0, 200),
                  channelId: `notif_channel_${notification.type || 'general'}`,
                  schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
                  sound: null,
                  attachments: null,
                  actionTypeId: '',
                  extra: { notificationId: notification.id },
                },
              ],
            });

            notificationTracker.add(notification.id);
            const recentIds = Array.from(notificationTracker).slice(-100);
            localStorage.setItem(trackerKey, JSON.stringify(recentIds));
          } catch (err) {
            console.error('[NotifListener] Error showing notification:', err.message || err);
          }
        };

        pollInterval = setInterval(async () => {
          try {
            if (isDisposed) return;

            const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();

            const notificationUserIds = [
              ...new Set([
                ...userIdVariants,
                ...Array.from(fallbackUserIdRawSet),
              ].filter(isUuid)),
            ];

            let userNotifications = [];
            if (canQueryNotificationUserId && notificationUserIds.length > 0) {
              const { data, error: userNotifError } = await supabase
                .from('notifications')
                .select('*')
                .in('user_id', notificationUserIds)
                .gte('created_at', fiveSecondsAgo)
                .order('created_at', { ascending: false });

              if (userNotifError) {
                if (isMissingUserIdColumnError(userNotifError) || isUserIdTypeMismatchError(userNotifError)) {
                  canQueryNotificationUserId = false;
                  console.warn('[NotifListener] notifications.user_id cannot be queried with current identifiers; skipping direct user polling.');
                } else {
                  console.error('[NotifListener] User polling error:', userNotifError.message);
                  return;
                }
              } else {
                userNotifications = data || [];
              }
            }

            const { data: audienceNotifications, error: audienceError } = await supabase
              .from('notifications')
              .select('*')
              .in('target_audience', audienceVariants)
              .gte('created_at', fiveSecondsAgo)
              .order('created_at', { ascending: false });

            if (audienceError) {
              console.error('[NotifListener] Audience polling error:', audienceError.message);
              return;
            }

            const merged = [...(userNotifications || []), ...(audienceNotifications || [])];
            const uniqueRecent = [...new Map(merged.map((item) => [item.id, item])).values()];

            for (const notif of uniqueRecent) {
              if (notif.type !== 'birthday' && !notificationTracker.has(notif.id)) {
                await showPushNotification(notif);
              }
            }
          } catch (err) {
            console.error('[NotifListener] Polling error:', err.message || err);
          }
        }, 5000);

        try {
          realtimeChannel = supabase
            .channel(`notifications_channel_${userId}`)
            .on(
              'postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'notifications' },
              (payload) => {
                const newNotification = payload.new;
                const directMatch = matchesNotificationForContext(newNotification, notificationContext);
                const fallbackMatch = fallbackUserIdSet.has(normalizeId(newNotification?.user_id));
                const isForThisUser = directMatch || fallbackMatch;

                if (isForThisUser && newNotification.type !== 'birthday') {
                  showPushNotification(newNotification);
                }
              }
            )
            .subscribe();
        } catch (rtErr) {
          console.warn('[NotifListener] Real-time setup warning:', rtErr.message || rtErr);
        }
      } catch (err) {
        console.error('[NotifListener] Setup error:', err);
      }
    };

    timer = setTimeout(setupNotificationListener, 2000);

    return () => {
      isDisposed = true;
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      if (supabaseRef && realtimeChannel) {
        supabaseRef.removeChannel(realtimeChannel).catch(() => { });
      }
    };
  }, [location.pathname]);

  // Appointment state
  const [appointmentForm, setAppointmentForm] = useState({
    patientName: '',
    phone: '',
    doctor: '',
    date: '',
    time: '',
    reason: '',
    bookingFor: 'self',
    patientRelationship: '',
    age: '',
    gender: '',
    patientEmail: '',
    relationship: '',
    relationshipText: '',
    isFirstVisit: ''
  });

  // Reference state
  const [referenceView, setReferenceView] = useState('menu');
  const [newReference, setNewReference] = useState({
    patientName: '',
    age: '',
    gender: '',
    phone: '',
    referredTo: '',
    condition: '',
    category: '',
    notes: ''
  });

  // Navigation handler - supports both route-based and state-based navigation
  const handleNavigate = (screen, data = null) => {
    // Some callers (e.g. notification click-redirects) already resolve a real
    // route path like "/events" instead of a screen key — pass those straight
    // through to the router instead of looking them up in routeMap below.
    if (typeof screen === 'string' && screen.startsWith('/')) {
      navigate(screen);
      return;
    }
    if (screen === 'appointment' && !isMember) {
      alert('Only members can book appointments.');
      return;
    }
    if (screen === 'achievement-details' && data?.achievementId) {
      navigate(`/achievements/${encodeURIComponent(String(data.achievementId))}`);
      return;
    }
    if (screen === 'executive-body') {
      navigate('/executive-body');
      return;
    }
    if (screen === 'trust-id-card') {
      if (data && typeof data === 'object') {
        try {
          sessionStorage.setItem(TRUST_ID_CARD_CACHE_KEY, JSON.stringify(data));
        } catch {
          // Ignore storage failures and continue navigating.
        }
      }
      navigate('/trust-id-card');
      return;
    }
    if ((screen === 'member-details' || screen === 'executive-member-details') && data) {
      const isCommitteeDetail = data?.source === 'committee-members';
      if (isCommitteeDetail) {
        setSelectedDetailMember(data);
        sessionStorage.setItem('selectedDetailMember', JSON.stringify(data));
      } else {
        setSelectedDetailMember(null);
        sessionStorage.removeItem('selectedDetailMember');
      }
      setPreviousScreen(location.pathname);
      setPreviousScreenName(data.previousScreenName || location.pathname);
      setSelectedMember(data);
      sessionStorage.setItem('selectedMember', JSON.stringify(data));
      sessionStorage.setItem('previousScreen', location.pathname);
      sessionStorage.setItem('previousScreenName', data.previousScreenName || location.pathname);
      navigate('/executive_members_details');
    } else if (screen === 'committee-members' && data) {
      const committeePayload = {
        ...data,
        previousScreen: location.pathname,
        previousScreenName: data.previousScreenName || location.pathname,
      };
      setPreviousScreen(location.pathname);
      setPreviousScreenName(committeePayload.previousScreenName);
      setSelectedMember(committeePayload);
      sessionStorage.setItem('selectedMember', JSON.stringify(committeePayload));
      sessionStorage.setItem('previousScreen', location.pathname);
      sessionStorage.setItem('previousScreenName', committeePayload.previousScreenName);
      navigate('/committee-members');
    } else {
      const routeMap = {
        'home': '/',
        'login': '/login',
        'vip-login': '/vip-login',
        'profile': '/profile',
        'directory': '/directory',
        'healthcare-trustee-directory': '/healthcare-trustee-directory',
        'appointment': '/appointment',
        'reports': '/reports',
        'reference': '/reference',
        'notices': '/notices',
        'facilities': '/facilities',
        'events': '/events',
        'achievements': '/achievements',
        'donation': '/donation',
        'executive-body': '/executive-body',
        'donation-form': '/donation-form',
        'notifications': '/notifications',
        'committee-members': '/committee-members',
        'sponsor-details': '/sponsor-details',
        'sponsors': '/sponsors',
        'developers': '/developers',
        'gallery': '/gallery',
        'admin-profiles': '/admin-profiles',
        'contact-us': '/contact-us',
        'my-family': '/my-family',
        'nomination-details': '/nomination-details',
        'add-community': '/add-community',
        'trust-id-card': '/trust-id-card',
        'other-memberships': '/other-memberships',
      };
      const route = routeMap[screen] || '/';
      console.log('Navigating to route:', screen, '->', route);
      navigate(route);
    }
  };

  // Load member data from sessionStorage on mount if on member-details or committee-members route
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      location.pathname === '/member-details'
      || location.pathname === '/executive_members_details'
      || location.pathname === '/committee-members'
    ) {
      const storedMember = sessionStorage.getItem('selectedMember');
      const storedDetailMember = sessionStorage.getItem('selectedDetailMember');
      const storedPreviousScreen = sessionStorage.getItem('previousScreen');
      const storedPreviousScreenName = sessionStorage.getItem('previousScreenName');

      if (location.pathname === '/executive_members_details' && storedDetailMember) {
        try {
          const parsedDetailMember = JSON.parse(storedDetailMember);
          if (JSON.stringify(selectedDetailMember) !== JSON.stringify(parsedDetailMember)) {
            setSelectedDetailMember(parsedDetailMember);
          }
        } catch (e) {
          console.error('Error parsing stored detail member:', e);
        }
      } else if (storedMember) {
        try {
          const parsedMember = JSON.parse(storedMember);
          if (JSON.stringify(selectedMember) !== JSON.stringify(parsedMember)) {
            setSelectedMember(parsedMember);
          }
        } catch (e) {
          console.error('Error parsing stored member:', e);
        }
      }
      if (storedPreviousScreen) {
        if (previousScreen !== storedPreviousScreen) {
          setPreviousScreen(storedPreviousScreen);
        }
      }
      if (storedPreviousScreenName) {
        if (previousScreenName !== storedPreviousScreenName) {
          setPreviousScreenName(storedPreviousScreenName);
        }
      }
    }
  }, [location.pathname, selectedDetailMember, selectedMember, previousScreen, previousScreenName]);

  const appContent = (
    <div
      className={`min-h-screen relative shadow-2xl overflow-x-hidden app-route-shell ${(location.pathname === '/login' || location.pathname === '/otp-verification' || location.pathname === '/profile' || location.pathname === '/vip-login') ? 'overflow-hidden' : 'overflow-y-auto'
        } w-full max-w-[430px] mx-auto`}
      style={{
        background: 'var(--page-bg, var(--app-page-bg))',
        color: 'var(--body-text-color)',
        fontFamily: "var(--font-family, 'Inter', sans-serif)",
        marginInline: 'auto',
        width: 'min(100%, 430px)',
        maxWidth: '430px',
        flexShrink: 0,
      }}
    >
      <AppVersionUpdatePrompt trustId={resolvedThemeTrustId} />
      <Routes>
        <Route
          path="/login"
          element={<Login />}
        />
        <Route
          path="/vip-login"
          element={
            <FeatureGuard featureKey="feature_vip_login" fallbackPath="/login">
              <VIPLogin
                onNavigate={handleNavigate}
                onLogout={clearAuthAndRedirectToLogin}
              />
            </FeatureGuard>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home
                onNavigate={handleNavigate}
                onLogout={clearAuthAndRedirectToLogin}
                isMember={isMember}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_profile">
                <Profile
                  onNavigate={handleNavigate}
                  onNavigateBack={() => navigate('/')}
                  onProfileUpdate={() => { }}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/directory"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_directory">
                <Directory
                  onNavigate={handleNavigate}
                  onNavigateBack={() => navigate('/')}
                  onLogout={clearAuthAndRedirectToLogin}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/healthcare-trustee-directory"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_directory">
                <HealthcareTrusteeDirectory
                  onNavigate={handleNavigate}
                  onNavigateBack={() => navigate('/')}
                  onLogout={clearAuthAndRedirectToLogin}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/appointment"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_opd">
                <Appointments
                  onNavigate={handleNavigate}
                  appointmentForm={appointmentForm}
                  setAppointmentForm={setAppointmentForm}
                  onNavigateBack={() => navigate('/')}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_reports">
                <Reports onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reference"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_referral">
                <Referral
                  onNavigate={handleNavigate}
                  referenceView={referenceView}
                  setReferenceView={setReferenceView}
                  newReference={newReference}
                  setNewReference={setNewReference}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notices"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_noticeboard">
                <Notices onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notices/:noticeId"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_noticeboard">
                <NoticeDetail onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/facilities"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_facilities">
                <Facilities onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/facilities/:facilityId"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_facilities">
                <FacilityDetail onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/events"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_events">
                <Events onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/events/:eventId"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_events">
                <EventDetail onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/achievements"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_achievements">
                <Achievements onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/achievements/:achievementId"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_achievements">
                <AchievementDetail onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/donation"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_donation">
                <Donation onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/donation-form"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_donation">
                <DonationForm />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/executive-body"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_executive_body">
                <ExecutiveBody onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_notifications">
                <Notifications onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/executive_members_details"
          element={
            <ProtectedRoute>
              {(committeeDetailMember || selectedMember) ? (
                <MemberDetails
                  member={committeeDetailMember || selectedMember}
                  onNavigate={handleNavigate}
                  onNavigateBack={() => {
                    const resolvedPreviousScreenName = committeeDetailMember?.previousScreenName || previousScreenName;
                    const resolvedPreviousScreen = committeeDetailMember?.previousScreen || previousScreen;

                    if (resolvedPreviousScreenName && (resolvedPreviousScreenName === 'healthcare' || resolvedPreviousScreenName === 'committee' || resolvedPreviousScreenName === 'trustee')) {
                      navigate('/healthcare-trustee-directory');
                      sessionStorage.setItem('restoreDirectory', resolvedPreviousScreenName);
                    } else if (resolvedPreviousScreenName && (resolvedPreviousScreenName === 'healthcare' || resolvedPreviousScreenName === 'trustees' || resolvedPreviousScreenName === 'patrons' || resolvedPreviousScreenName === 'committee' || resolvedPreviousScreenName === 'doctors' || resolvedPreviousScreenName === 'hospitals' || resolvedPreviousScreenName === 'elected')) {
                      navigate('/directory');
                      sessionStorage.setItem('restoreDirectoryTab', resolvedPreviousScreenName);
                    } else {
                      const prevScreen = resolvedPreviousScreen || '/directory';
                      navigate(prevScreen);
                    }
                  }}
                  previousScreenName={committeeDetailMember?.previousScreenName || previousScreenName}
                />
              ) : (
                <Navigate to="/executive-body" replace />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/committee-members"
          element={
            <ProtectedRoute>
              {selectedMember && (selectedMember.is_committee_group || Array.isArray(selectedMember.committee_members)) ? (
                <CommitteeMembers
                  committeeData={selectedMember}
                  onNavigateBack={() => {
                    if (resolvedCommitteePreviousScreenName && (resolvedCommitteePreviousScreenName === 'healthcare' || resolvedCommitteePreviousScreenName === 'committee' || resolvedCommitteePreviousScreenName === 'trustee')) {
                      navigate('/healthcare-trustee-directory');
                      sessionStorage.setItem('restoreDirectory', resolvedCommitteePreviousScreenName);
                    } else {
                      const prevScreen = resolvedCommitteePreviousScreen || '/directory';
                      navigate(prevScreen);
                    }
                  }}
                  previousScreenName={resolvedCommitteePreviousScreenName}
                  onNavigate={handleNavigate}
                />
              ) : (
                <Navigate to="/directory" replace />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/sponsor-details"
          element={
            <ProtectedRoute>
              <SponsorDetails onBack={() => navigate(-1)} onNavigate={handleNavigate} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sponsors"
          element={
            <ProtectedRoute>
              <SponsorsList onBack={() => navigate(-1)} onNavigate={handleNavigate} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/developers"
          element={
            <FeatureGuard featureKey="feature_developer_info">
              <DeveloperDetails
                onNavigateBack={() => navigate(-1)}
                onNavigate={handleNavigate}
              />
            </FeatureGuard>
          }
        />
        <Route
          path="/gallery"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_gallery">
                <Gallery
                  onNavigate={handleNavigate}
                  onNavigateBack={() => navigate('/')}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/contact-us"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="ContactUs">
                <ContactUs
                  onNavigateBack={() => navigate('/')}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-family"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_my_family">
                <MyFamily onNavigate={handleNavigate} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/nomination-details"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_nomination_details">
                <NominationDetails
                  onNavigate={handleNavigate}
                />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/add-community"
          element={
            <ProtectedRoute>
              <FeatureGuard featureKey="feature_add_community">
                <AddCommunity onNavigateBack={() => navigate('/')} />
              </FeatureGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/trust-id-card"
          element={
            <ProtectedRoute>
              <TrustIdCard onNavigate={handleNavigate} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin-profiles"
          element={
            <ProtectedRoute>
              <AdminUserProfiles onNavigate={handleNavigate} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/other-memberships"
          element={
            <ProtectedRoute>
              <OtherMemberships onNavigate={handleNavigate} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/otp-verification"
          element={<OTPVerification />}
        />
        <Route
          path="/special-otp-verification"
          element={<SpecialOTPVerification />}
        />
        <Route
          path="/terms-and-conditions"
          element={<TermsAndConditions />}
        />
        <Route
          path="/privacy-policy"
          element={<PrivacyPolicy />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );

  return (
    <ThemeContext.Provider value={appTheme}>
      <GalleryProvider>
        <div
          className="min-h-screen w-full flex justify-center overflow-x-hidden app-root-shell"
          data-theme-scope="trust-app"
          style={{
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          {appContent}
        </div>
      </GalleryProvider>
    </ThemeContext.Provider>
  );
};

export default HospitalTrusteeApp;
