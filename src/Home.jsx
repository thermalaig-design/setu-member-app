import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { User, Users, Clock, FileText, UserPlus, Bell, ChevronRight, Heart, Shield, Plus, ArrowRight, Pill, ShoppingCart, Calendar, Stethoscope, Building2, QrCode, Monitor, Brain, Package, FileCheck, Search, Filter, Star, HelpCircle, BookOpen, Video, Headphones, Menu, X, Home as HomeIcon, Settings, UserCircle, Image, Trash2, Code, FolderOpen, Crown } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TermsModal from './components/TermsModal';
import ImageSlider from './components/ImageSlider';
import { getProfile, getMarqueeUpdates, getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } from './services/api';
import { useGalleryContext } from './context/GalleryContext';
import { useAppTheme } from './context/ThemeContext';
import { registerSidebarState, useTrustDataVersion } from './hooks';
import { supabase } from './services/supabaseClient';
import { clearLoginTermsPromptPending, isLoginTermsPromptPending, resolveLegalTrustId } from './utils/legalContent';
import { readNotificationCache, writeNotificationCache } from './services/notificationCache';
import { getCurrentNotificationContext, matchesNotificationForContext } from './services/notificationAudience';
import { fetchFeatureFlags, subscribeFeatureFlags, isFeatureEnabled } from './services/featureFlags';
import { fetchMemberTrusts, fetchTrustById, fetchDefaultTrust } from './services/trustService';
import {
  ensureAllSponsorsLoaded,
  getCachedCarouselBatch,
  getSponsorDebugInfo,
  preloadCarouselBatchImages,
  prefetchCarouselBatch,
  preloadSponsorListFirstPage,
  readCarouselProgress,
  readSponsorOrder,
  readSponsorsById,
  setPinnedSponsor,
  setSelectedSponsorId,
  sponsorConfig
} from './services/sponsorStore';
import {
  getFooterThemeStyles,
  getNavbarThemeStyles,
  getThemeToken,
  normalizeHomeLayout
} from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { resolveNotificationRedirectRoute } from './services/notificationRedirectService';

const DEFAULT_TRUST_NAME = import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust';
const SPONSOR_CHUNK_SIZE = sponsorConfig.CAROUSEL_BATCH_SIZE;
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const POWERED_BY_URL = 'https://teiltd.in';
const getInitialSponsorTrustId = () =>
  localStorage.getItem('selected_trust_id') || import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const BASE_TRUST_ID = String(import.meta.env.VITE_DEFAULT_TRUST_ID || '').trim();

const buildNotificationContentKey = (notification) => {
  const title = String(notification?.title || '').trim().toLowerCase();
  const message = String(notification?.message || notification?.body || '').trim().toLowerCase();
  const type = String(notification?.type || '').trim().toLowerCase();
  const createdAt = String(notification?.created_at || '').trim();
  const createdAtSecond = createdAt ? createdAt.slice(0, 19) : '';
  return `${type}|${title}|${message}|${createdAtSecond}`;
};

const mergeUniqueTrusts = (...collections) => {
  const merged = [];
  const seen = new Set();

  collections
    .flat()
    .filter(Boolean)
    .forEach((trust) => {
      const id = trust.id === null || trust.id === undefined ? '' : String(trust.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push({
        id,
        name: trust.name || null,
        icon_url: trust.icon_url || null,
        remark: trust.remark || null,
        is_active: Boolean(trust.is_active) !== false,
        role: trust.role || null,
        membership_number: trust.membership_number || trust['Membership number'] || null,
        members_id: trust.members_id || trust.member_id || null,
      });
    });

  return merged;
};

const readCachedTrustList = () => {
  try {
    const raw = localStorage.getItem('trust_list_cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const FEATURE_FLAGS_CACHE_PREFIX = 'feature_flags_cache_v3:';
const readInitialFeatureFlagsCache = (trustId) => {
  try {
    const normalizedTrustId = String(trustId || '').trim();
    if (!normalizedTrustId) return { flags: {}, flagsData: {} };
    const raw = sessionStorage.getItem(`${FEATURE_FLAGS_CACHE_PREFIX}${normalizedTrustId}:general`);
    if (!raw) return { flags: {}, flagsData: {} };
    const parsed = JSON.parse(raw);
    const isFresh = Number(parsed?.ts) > 0 && (Date.now() - Number(parsed.ts)) <= (5 * 60 * 1000);
    if (!isFresh) return { flags: {}, flagsData: {} };
    return {
      flags: parsed?.flags && typeof parsed.flags === 'object' ? parsed.flags : {},
      flagsData: parsed?.flagsData && typeof parsed.flagsData === 'object' ? parsed.flagsData : {}
    };
  } catch {
    return { flags: {}, flagsData: {} };
  }
};

const mergeTrustsWithExistingVisuals = (incomingTrusts = [], existingTrusts = []) => {
  const byId = new Map(
    (existingTrusts || [])
      .filter(Boolean)
      .map((trust) => [String(trust?.id || '').trim(), trust])
      .filter(([id]) => Boolean(id))
  );

  return (incomingTrusts || []).map((trust) => {
    const id = String(trust?.id || '').trim();
    if (!id) return trust;
    const existing = byId.get(id);
    if (!existing) return trust;
    return {
      ...trust,
      // Prefer fresh incoming data; keep cache only as fallback.
      name: trust?.name || existing?.name || null,
      icon_url: trust?.icon_url || existing?.icon_url || null,
      remark: trust?.remark || existing?.remark || null,
    };
  });
};

const pinBaseTrustFirst = (trusts = []) => {
  const baseId = String(BASE_TRUST_ID || '').trim();
  if (!baseId || !Array.isArray(trusts) || trusts.length === 0) return trusts;
  const baseIndex = trusts.findIndex((trust) => String(trust?.id || '').trim() === baseId);
  if (baseIndex <= 0) return trusts;
  const baseTrust = trusts[baseIndex];
  const remaining = trusts.filter((_, index) => index !== baseIndex);
  return [baseTrust, ...remaining];
};

const TRUST_ICON_CACHE_KEY = 'trust_icon_url_cache_v1';
const readTrustIconUrlCache = () => {
  try {
    const raw = localStorage.getItem(TRUST_ICON_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const buildCacheBustedIconUrl = (iconUrl, versionToken) => {
  const src = String(iconUrl || '').trim();
  if (!src) return '';
  if (!versionToken) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}v=${encodeURIComponent(String(versionToken))}`;
};

const resolveTrustIconToken = (trust, fallback = '1') =>
  String(
    trust?.version ||
    trust?.updated_at ||
    trust?.created_at ||
    trust?.icon_url ||
    fallback
  );

const TrustChipIcon = memo(({ iconUrl, altText, versionToken, state }) => {
  const [failedSrc, setFailedSrc] = useState('');

  const src = buildCacheBustedIconUrl(iconUrl, versionToken);

  const hasValidIcon = Boolean(src) && failedSrc !== src;

  if (!hasValidIcon) {
    return <Building2 className="h-7 w-7" style={{ color: 'var(--body-text-color)' }} />;
  }

  return (
    <img
      src={src}
      alt={altText || 'Trust'}
      className="w-10 h-10 object-contain rounded-full"
      loading="eager"
      decoding="async"
      onError={() => setFailedSrc(src)}
      style={state ? {} : { filter: 'grayscale(30%)', opacity: 0.7 }}
    />
  );
}, (prevProps, nextProps) => (
  prevProps.iconUrl === nextProps.iconUrl
  && prevProps.altText === nextProps.altText
  && prevProps.versionToken === nextProps.versionToken
  && prevProps.state === nextProps.state
));

const normalizeMemberName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  const blockedNames = new Set([
    'aaaaa',
    'gau grass',
    'guest user',
    'test',
    'test user',
    'null',
    'undefined',
    'n/a',
    'na'
  ]);
  const compact = raw.replace(/\s+/g, '');
  const repeatedSingleChar = /^([a-zA-Z])\1{2,}$/.test(compact);
  if (blockedNames.has(lowered) || repeatedSingleChar) return '';
  return raw;
};

const getCachedUserProfileSnapshot = () => {
  try {
    const user = localStorage.getItem('user');
    if (!user) return null;
    const parsed = JSON.parse(user);
    const fallbackName = normalizeMemberName(parsed.name || parsed.Name || parsed['Name'] || '');
    const userKey = `userProfile_${parsed.Mobile || parsed.mobile || parsed.id || 'default'}`;
    const savedProfile = localStorage.getItem(userKey);
    const cachedProfile = savedProfile ? JSON.parse(savedProfile) : null;
    const cachedName = normalizeMemberName(cachedProfile?.name || '');
    const resolvedName = cachedName || fallbackName;
    const profilePhotoUrl = cachedProfile?.profile_photo_url || cachedProfile?.profilePhotoUrl || '';
    if (!resolvedName && !profilePhotoUrl) return null;
    return { name: resolvedName, profilePhotoUrl };
  } catch {
    return null;
  }
};

const Home = ({ onNavigate, onLogout }) => {
  const { displayTrustVersion } = useTrustDataVersion();
  const normalizeTrustId = (id) => {
    if (id === null || id === undefined) return '';
    const normalized = String(id).trim();
    if (!normalized) return '';
    const lowered = normalized.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'nan') return '';
    return normalized;
  };
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mainContainerRef = useRef(null);
  const channelRef = useRef(null);
  const latestNotificationsFetchRef = useRef(0);
  const trustListScrollRef = useRef(null);
  const trustChipRefs = useRef({});
  const trustSwitchAnimationTimerRef = useRef(null);
  const previousSelectedTrustIdRef = useRef('');

  // Welcome strip: initialize from localStorage instantly to avoid delay
  const [userProfile, setUserProfile] = useState(() => getCachedUserProfileSnapshot());

  // Trust: prefer user's last selection; fall back to env trust id.
  const [selectedTrustId, setSelectedTrustId] = useState(() => {
    const cachedSelected = normalizeTrustId(localStorage.getItem('selected_trust_id') || '');
    const persistedSelected = normalizeTrustId(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '');
    let cachedDefaultId = '';
    try {
      const cachedDefault = localStorage.getItem('default_trust_cache');
      if (cachedDefault) {
        const parsed = JSON.parse(cachedDefault);
        cachedDefaultId = normalizeTrustId(parsed?.id || '');
      }
    } catch {
      // ignore malformed cache
    }
    const envId = normalizeTrustId(import.meta.env.VITE_DEFAULT_TRUST_ID || '');
    return cachedSelected || persistedSelected || cachedDefaultId || envId || '';
  });

  useEffect(() => {
    const normalizedSelected = normalizeTrustId(selectedTrustId);
    if (!normalizedSelected) return;
    try {
      localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, normalizedSelected);
    } catch {
      // ignore storage write failures
    }
  }, [selectedTrustId]);

  // Synchronously pre-populate trustInfo from cached default-trust data
  const [trustInfo, setTrustInfo] = useState(() => {
    try {
      const cached = localStorage.getItem('default_trust_cache');
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
    return null;
  });

  // trustList: pre-populate from full trust list cache so selector shows instantly
  const [trustList, setTrustList] = useState(() => {
    try {
      const listCached = localStorage.getItem('trust_list_cache');
      if (listCached) {
        const list = JSON.parse(listCached);
        if (Array.isArray(list) && list.length > 0) return list;
      }
      const cached = localStorage.getItem('default_trust_cache');
      if (cached) return [JSON.parse(cached)];
    } catch { /* ignore */ }
    return [];
  });
  const [defaultTrust, setDefaultTrust] = useState(() => {
    try {
      const cached = localStorage.getItem('default_trust_cache');
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
    return null;
  });
  const [showTermsModal, setShowTermsModal] = useState(() => isLoginTermsPromptPending());
  const [termsModalContent, setTermsModalContent] = useState('');
  const [termsModalTrustName, setTermsModalTrustName] = useState('');
  const [termsModalLoading, setTermsModalLoading] = useState(() => isLoginTermsPromptPending());
  const [termsModalError, setTermsModalError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadCountByTrust, setUnreadCountByTrust] = useState({});
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [animatingTrustId, setAnimatingTrustId] = useState('');
  const [marqueeUpdates, setMarqueeUpdates] = useState(() => {
    try {
      const trustId = localStorage.getItem('selected_trust_id') || import.meta.env.VITE_DEFAULT_TRUST_ID || '';
      if (!trustId) return [];
      const cached = localStorage.getItem(`marquee_cache_${trustId}`);
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
    return [];
  });

  const initialSponsorTrustId = getInitialSponsorTrustId();
  const initialSponsorOrder = initialSponsorTrustId ? readSponsorOrder(initialSponsorTrustId) : [];
  const initialSponsorProgress = initialSponsorTrustId ? readCarouselProgress(initialSponsorTrustId) : {
    sponsorBatchesLoaded: [],
    hasMoreSponsors: false
  };

  // Sponsors: normalized cache-first state (order + byId, no index-based mapping to data)
  const [sponsorsById, setSponsorsById] = useState(() => {
    return initialSponsorTrustId ? readSponsorsById(initialSponsorTrustId) : {};
  });
  const [sponsorOrder, setSponsorOrder] = useState(initialSponsorOrder);
  const [isSponsorsLoading, setIsSponsorsLoading] = useState(initialSponsorOrder.length === 0);
  const [isCarouselBatchLoading, setIsCarouselBatchLoading] = useState(false);
  const [sponsorFetchSettledTrustId, setSponsorFetchSettledTrustId] = useState(
    initialSponsorOrder.length > 0 ? initialSponsorTrustId : ''
  );
  const [loadedBatchCount, setLoadedBatchCount] = useState(
    Array.isArray(initialSponsorProgress.sponsorBatchesLoaded) ? initialSponsorProgress.sponsorBatchesLoaded.length : 0
  );
  const [hasMoreSponsorBatches, setHasMoreSponsorBatches] = useState(
    Boolean(initialSponsorProgress.hasMoreSponsors)
  );
  const [isCarouselReady, setIsCarouselReady] = useState(initialSponsorOrder.length > 0);
  const [sponsorIndex, setSponsorIndex] = useState(0);
  const sponsorTouchStartRef = useRef(null);
  const sponsorTouchEndRef = useRef(null);
  const sponsorListPreloadRef = useRef({});
  const sponsorBootstrapInFlightRef = useRef('');
  const sponsors = useMemo(
    () => sponsorOrder.map((id) => sponsorsById[id]).filter(Boolean),
    [sponsorOrder, sponsorsById]
  );
  const [featureFlags, setFeatureFlags] = useState(() => readInitialFeatureFlagsCache(
    selectedTrustId || localStorage.getItem('selected_trust_id') || trustInfo?.id || ''
  ).flags || {});
  const [flagsData, setFlagsData] = useState(() => readInitialFeatureFlagsCache(
    selectedTrustId || localStorage.getItem('selected_trust_id') || trustInfo?.id || ''
  ).flagsData || {}); // full metadata: { feature_key: { display_name, tagline, icon_url } }
  const [trustIconVersionById, setTrustIconVersionById] = useState({});
  const [trustIconUrlById, setTrustIconUrlById] = useState(() => readTrustIconUrlCache());
  const hasLoadedMemberTrusts = useRef(false);
  const {
    carouselImages,
    isLoading: isGalleryMetaLoading,
    error: galleryError,
  } = useGalleryContext();
  const [showGalleryLoader, setShowGalleryLoader] = useState(false);

  // Global app theme from central provider
  const theme = useAppTheme();
  const footerTheme = useMemo(() => getFooterThemeStyles(theme), [theme]);
  const navbarTheme = useMemo(() => getNavbarThemeStyles(theme), [theme]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const cacheKey = `theme_cache_${selectedTrustId || ''}`;
    let cachedThemeEntry = null;
    try {
      cachedThemeEntry = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    } catch {
      cachedThemeEntry = null;
    }
    const cachedTheme = cachedThemeEntry?.theme || cachedThemeEntry || null;
    const usingDbTheme = Boolean(theme?.templateId || theme?.baseTemplateUpdatedAt || theme?.selectedTemplateUpdatedAt);
    const resolvedFooterConfig = theme?.themeConfig?.footer || null;
    const resolvedNavbarConfig = theme?.themeConfig?.navbar || null;
    const resolvedNavbarBg = theme?.themeConfig?.navbar_bg || null;
    const resolvedTypographyOverrides = theme?.themeConfig?.typography?.component_overrides || null;

    console.log('[FooterTheme][Debug]', {
      currentTemplateId: theme?.templateId || null,
      currentTrustId: theme?.selectedTrustId || theme?.trustId || selectedTrustId || null,
      currentTemplateUpdatedAt: theme?.templateUpdatedAt || null,
      currentBaseTemplateUpdatedAt: theme?.baseTemplateUpdatedAt || null,
      currentSelectedTemplateUpdatedAt: theme?.selectedTemplateUpdatedAt || null,
      cachedTemplateUpdatedAt: cachedTheme?.templateUpdatedAt || null,
      cachedBaseTemplateUpdatedAt: cachedTheme?.baseTemplateUpdatedAt || null,
      cachedSelectedTemplateUpdatedAt: cachedTheme?.selectedTemplateUpdatedAt || null,
      resolvedFooterConfig,
      resolvedTypographyOverrides,
      resolvedFooterBackground: footerTheme.backgroundStyle,
      resolvedFooterTextColor: footerTheme.textColor,
      resolvedFooterTextSource: footerTheme.textColorSource,
      usingTypographyOverride: footerTheme.usingTypographyOverride,
      hardcodedFooterTextOverrideDetected: false,
      usingDbTheme,
      usingFallbackTheme: !usingDbTheme
    });

    console.log('[NavbarTheme][Debug]', {
      currentTemplateId: theme?.templateId || null,
      currentTrustId: theme?.selectedTrustId || theme?.trustId || selectedTrustId || null,
      resolvedNavbarConfig,
      resolvedNavbarBg,
      resolvedTypographyOverrides,
      resolvedNavbarBackgroundStyle: navbarTheme.backgroundStyle,
      resolvedNavbarBackgroundSource: navbarTheme.backgroundSource,
      resolvedNavbarTextColor: navbarTheme.textColor,
      resolvedNavbarTextSource: navbarTheme.textColorSource,
      resolvedNavbarBlur: navbarTheme.blurPx,
      resolvedNavbarBlurSource: navbarTheme.blurSource,
      resolvedNavbarOpacity: navbarTheme.opacity,
      resolvedNavbarOpacitySource: navbarTheme.opacitySource,
      hardcodedNavbarOverrideDetected: false
    });
  }, [footerTheme, navbarTheme, selectedTrustId, theme]);

  useEffect(() => {
    setShowGalleryLoader(false);
    return undefined;
  }, [isGalleryMetaLoading, carouselImages.length]);

  const syncSponsorStoreSnapshot = (trustId) => {
    if (!trustId) {
      setSponsorsById({});
      setSponsorOrder([]);
      setLoadedBatchCount(0);
      setHasMoreSponsorBatches(false);
      setIsCarouselReady(false);
      return;
    }

    const byId = readSponsorsById(trustId);
    const order = readSponsorOrder(trustId);
    const progress = readCarouselProgress(trustId);

    setSponsorsById(byId || {});
    setSponsorOrder(Array.isArray(order) ? order : []);
    setLoadedBatchCount(Array.isArray(progress.sponsorBatchesLoaded) ? progress.sponsorBatchesLoaded.length : 0);
    setHasMoreSponsorBatches(Boolean(progress.hasMoreSponsors));
    setIsCarouselReady(Array.isArray(order) && order.length > 0);
  };

  // Register sidebar state with Android back handler
  useEffect(() => {
    registerSidebarState(isMenuOpen, () => setIsMenuOpen(false));
  }, [isMenuOpen]);

  const setSessionSelectionFlag = () => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem('trust_selected_in_session', 'true');
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    let isActive = true;
    const loadDefaultTrust = async () => {
      try {
        let trust = null;
        const envTrustId = import.meta.env.VITE_DEFAULT_TRUST_ID;
        const normalizedEnvTrustId = normalizeTrustId(envTrustId);
        let resolvedViaEnv = false;

        if (envTrustId) {
          trust = await fetchTrustById(envTrustId);
          resolvedViaEnv = Boolean(trust);
        }

        if (!trust) trust = await fetchDefaultTrust();

        if (isActive && trust) {
          const normalizedDefaultId = normalizeTrustId(trust.id);
          const currentSelected = normalizeTrustId(localStorage.getItem('selected_trust_id') || selectedTrustId);

          setDefaultTrust(trust);
          setTrustList((prev) => {
            const existing = (prev || []).find((t) => normalizeTrustId(t.id) === normalizedDefaultId);
            if (existing) {
              return (prev || []).map((t) =>
                normalizeTrustId(t.id) === normalizedDefaultId ? { ...t, ...trust } : t
              );
            }
            return [trust, ...(prev || [])];
          });

          // Apply as active trust only when nothing is selected yet.
          // Also apply default when selected trust is just stale env id
          // that failed to resolve (common after env/db trust id changes).
          const shouldApplyDefaultSelection =
            !currentSelected ||
            (!resolvedViaEnv && normalizedEnvTrustId && currentSelected === normalizedEnvTrustId);
          if (shouldApplyDefaultSelection) {
            setSelectedTrustId(normalizedDefaultId);
            localStorage.setItem('selected_trust_id', normalizedDefaultId);
            if (trust.name) localStorage.setItem('selected_trust_name', trust.name);
            setTrustInfo(trust);
          }

          try { localStorage.setItem('default_trust_cache', JSON.stringify(trust)); } catch { /* ignore */ }
        }
      } catch (err) {
        console.warn('Failed to load default trust:', err);
      }
    };
    loadDefaultTrust();
    return () => { isActive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once on mount, selectedTrustId only read as an initial fallback
  }, []);
  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen) {
        const isSidebarClick = event.target.closest('[data-sidebar="true"]');
        const isOverlayClick = event.target.closest('[data-sidebar-overlay="true"]');
        if (isOverlayClick) setIsMenuOpen(false);
        if (!isSidebarClick && !isOverlayClick) setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  }, [isMenuOpen]);

  // Close notifications when clicking outside
  useEffect(() => {
    if (isNotificationsOpen) {
      const handleOutsideInteraction = (event) => {
        const notificationsPanel = event.target.closest('.notification-dropdown');
        const notificationsButton = event.target.closest('.notification-button');
        const isInsideNotificationUi = Boolean(notificationsPanel || notificationsButton);

        if (!isInsideNotificationUi) {
          event.preventDefault();
          event.stopPropagation();
          setIsNotificationsOpen(false);
        }
      };

      document.addEventListener('pointerdown', handleOutsideInteraction, true);
      document.addEventListener('click', handleOutsideInteraction, true);
      return () => {
        document.removeEventListener('pointerdown', handleOutsideInteraction, true);
        document.removeEventListener('click', handleOutsideInteraction, true);
      };
    }
    return undefined;
  }, [isNotificationsOpen]);

  // Lock scroll when notifications open
  useEffect(() => {
    if (isNotificationsOpen) {
      const scrollY = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.touchAction = 'none';

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
        const y = parseInt(document.body.style.top || '0') * -1;
        document.documentElement.style.overflow = 'unset';
        document.body.style.overflow = 'unset';
        document.body.style.position = 'unset';
        document.body.style.width = 'unset';
        document.body.style.top = 'unset';
        document.body.style.touchAction = 'auto';
        window.scrollTo(0, y);
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
    return undefined;
  }, [isNotificationsOpen]);

  // Load user profile — state is already pre-filled synchronously above;
  // this effect only upgrades it with the full profile from API/cache
  useEffect(() => {
    const loadProfile = async () => {
      const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const user = localStorage.getItem('user');
      if (user) {
        try {
          const parsedUser = JSON.parse(user);
          const userKey = `userProfile_${parsedUser.Mobile || parsedUser.mobile || parsedUser.id || 'default'}`;
          const fallbackName = normalizeMemberName(
            parsedUser?.Name || parsedUser?.name || parsedUser?.full_name || parsedUser?.['Full Name'] || ''
          );
          let cachedSnapshot = null;

          // First, apply cached profile photo if available
          const savedProfile = localStorage.getItem(userKey);
          if (savedProfile) {
            const parsed = JSON.parse(savedProfile);
            const normalizedName = normalizeMemberName(parsed?.name || '');
            cachedSnapshot = parsed;
            setUserProfile((prev) => ({
              ...prev,
              ...parsed,
              name: normalizedName || prev?.name || fallbackName || ''
            }));
          } else if (fallbackName) {
            setUserProfile((prev) => ({
              ...prev,
              name: prev?.name || fallbackName
            }));
          }
          const userId = parsedUser['Membership number'] || parsedUser.mobile || parsedUser.id;
          if (userId) {
            try {
              const response = await getProfile();
              if (response.success && response.profile) {
                const normalizedName = normalizeMemberName(
                  response.profile.name || response.profile.full_name || cachedSnapshot?.name || fallbackName || ''
                );
                const profilePhotoUrl =
                  response.profile.profile_photo_url ||
                  response.profile.profilePhotoUrl ||
                  cachedSnapshot?.profile_photo_url ||
                  cachedSnapshot?.profilePhotoUrl ||
                  '';
                const nextSnapshot = {
                  ...(cachedSnapshot || {}),
                  ...(response.profile || {}),
                  name: normalizedName,
                  profile_photo_url: profilePhotoUrl,
                  profilePhotoUrl
                };

                setUserProfile((prev) => ({
                  ...prev,
                  name: normalizedName || prev?.name || fallbackName || '',
                  profilePhotoUrl
                }));
                try {
                  localStorage.setItem(userKey, JSON.stringify(nextSnapshot));
                } catch {
                  // ignore cache write failures
                }
                return;
              }
            } catch (error) {
              console.error('Error loading from Supabase:', error);
            }
          }

          const fallbackSnapshot = getCachedUserProfileSnapshot();
          if (fallbackSnapshot) {
            setUserProfile((prev) => ({
              ...prev,
              ...fallbackSnapshot,
              name: fallbackSnapshot.name || prev?.name || fallbackName || ''
            }));
          } else if (fallbackName) {
            setUserProfile((prev) => ({
              ...prev,
              name: prev?.name || fallbackName
            }));
          }
        } catch (error) {
          console.error('Error loading user profile:', error);
        }
      }
      if (import.meta.env.DEV) {
        const endedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        console.log(`[Perf][Home] profile bootstrap completed in ${Math.round(endedAt - startedAt)}ms`);
      }
    };
    loadProfile();
  }, []);

  useEffect(() => {
    const syncProfileFromCache = () => {
      const snapshot = getCachedUserProfileSnapshot();
      if (snapshot) setUserProfile(snapshot);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncProfileFromCache();
    };

    window.addEventListener('user-profile-updated', syncProfileFromCache);
    window.addEventListener('focus', syncProfileFromCache);
    window.addEventListener('storage', syncProfileFromCache);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('user-profile-updated', syncProfileFromCache);
      window.removeEventListener('focus', syncProfileFromCache);
      window.removeEventListener('storage', syncProfileFromCache);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Load trusts from user localStorage
  useEffect(() => {
    const user = localStorage.getItem('user');
    if (!user) return;
    try {
      const parsedUser = JSON.parse(user);
      const memberships = Array.isArray(parsedUser.hospital_memberships) ? parsedUser.hospital_memberships : [];
      const derivedTrusts = memberships.map((m) => ({
        id: m.trust_id || m.id || null,
        name: m.trust_name || null,
        icon_url: m.trust_icon_url || null,
        remark: m.trust_remark || null,
        is_active: m.is_active !== false,
        role: m.role || null,
        membership_number: m.membership_number || m['Membership number'] || null,
        members_id: m.members_id || m.member_id || null,
      }));
      const uniqueTrusts = mergeUniqueTrusts(derivedTrusts);
      const primaryTrust = parsedUser.primary_trust || parsedUser.trust || derivedTrusts.find((t) => t.is_active) || derivedTrusts[0] || (parsedUser.trust_name ? { name: parsedUser.trust_name } : null);
      const normalizedTrusts = uniqueTrusts.length > 0 ? uniqueTrusts : primaryTrust ? [primaryTrust] : [];
      // Keep only trusts linked to current member (no global/mixed trust carry-over).
      let mergedTrusts = normalizedTrusts.length > 0
        ? mergeUniqueTrusts(normalizedTrusts)
        : mergeUniqueTrusts(defaultTrust ? [defaultTrust] : []);

      // Preserve known icon_url/name from cache so trust chips don't flash placeholders.
      mergedTrusts = mergeTrustsWithExistingVisuals(mergedTrusts, readCachedTrustList());
      mergedTrusts = pinBaseTrustFirst(mergedTrusts);

      setTrustList(mergedTrusts);
      try { localStorage.setItem('trust_list_cache', JSON.stringify(mergedTrusts)); } catch { /* ignore */ }

      const normalizedSelected = normalizeTrustId(
        localStorage.getItem('selected_trust_id') || selectedTrustId
      );
      const selectedExistsInMerged = mergedTrusts.some((t) => normalizeTrustId(t.id) === normalizedSelected);
      const effectiveTrustId =
        (selectedExistsInMerged ? normalizedSelected : '') ||
        normalizeTrustId(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '') ||
        normalizeTrustId(primaryTrust?.id) ||
        normalizeTrustId(defaultTrust?.id) ||
        normalizeTrustId(mergedTrusts[0]?.id) ||
        '';
      const effectiveTrustForEvent =
        mergedTrusts.find((t) => normalizeTrustId(t.id) === effectiveTrustId) ||
        primaryTrust ||
        defaultTrust ||
        mergedTrusts[0] ||
        null;
      if (effectiveTrustId && effectiveTrustId !== selectedTrustId) {
        setSelectedTrustId(effectiveTrustId);
        localStorage.setItem('selected_trust_id', effectiveTrustId);
        localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, effectiveTrustId);
        window.dispatchEvent(new CustomEvent('trust-changed', {
          detail: { trustId: effectiveTrustId, trustName: effectiveTrustForEvent?.name || null }
        }));
      }
      const effectiveTrust =
        mergedTrusts.find((t) => normalizeTrustId(t.id) === effectiveTrustId) ||
        primaryTrust ||
        defaultTrust ||
        mergedTrusts[0] ||
        null;
      setTrustInfo(effectiveTrust);
      if (effectiveTrust?.name) localStorage.setItem('selected_trust_name', effectiveTrust.name);
    } catch (error) {
      console.warn('Could not parse user trust info:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-run only when defaultTrust id changes; selectedTrustId/defaultTrust read fresh from localStorage/closure each run
  }, [defaultTrust?.id]);

  // Hydrate trust visuals from Trust table so stale membership/cache values are corrected.
  useEffect(() => {
    const trustsToHydrate = (trustList || []).filter((trust) => {
      const id = normalizeTrustId(trust?.id);
      return Boolean(id);
    });
    if (trustsToHydrate.length === 0) return;

    let active = true;
    const hydrateTrustIcons = async () => {
      const resolved = await Promise.all(
        trustsToHydrate.map(async (trust) => {
          const trustId = normalizeTrustId(trust?.id);
          if (!trustId) return null;
          try {
            const row = await fetchTrustById(trustId);
            return row
              ? {
                id: trustId,
                icon_url: row.icon_url || null,
                name: row.name || null,
                remark: row.remark || null,
                version: row.version || null
              }
              : null;
          } catch {
            return null;
          }
        })
      );

      if (!active) return;

      const byId = {};
      resolved.forEach((item) => {
        if (!item?.id) return;
        byId[item.id] = item;
      });
      if (Object.keys(byId).length === 0) return;

      setTrustList((prev) => {
        let changed = false;
        const next = (prev || []).map((trust) => {
          const id = normalizeTrustId(trust?.id);
          const hydrated = byId[id];
          if (!hydrated) return trust;
          const nextTrust = {
            ...trust,
            // Prefer latest DB visuals over cached values to avoid stale logos.
            icon_url: hydrated.icon_url || trust.icon_url || null,
            name: hydrated.name || trust.name || null,
            remark: hydrated.remark || trust.remark || null,
            version: hydrated.version || trust.version || null
          };
          if (
            nextTrust.icon_url !== trust.icon_url ||
            nextTrust.name !== trust.name ||
            nextTrust.remark !== trust.remark ||
            nextTrust.version !== trust.version
          ) {
            changed = true;
          }
          return nextTrust;
        });
        if (!changed) return prev;
        try { localStorage.setItem('trust_list_cache', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });

      setTrustIconVersionById((prev) => {
        const now = Date.now();
        const next = { ...prev };
        Object.values(byId).forEach((trust) => {
          const id = normalizeTrustId(trust?.id);
          if (!id) return;
          next[id] = `${resolveTrustIconToken(trust, '1')}-${now}`;
        });
        return next;
      });
    };

    hydrateTrustIcons();
    return () => { active = false; };
  }, [trustList]);

  // Always refresh selected trust visual fields from DB (icon/name/remark)
  // so updated logos are reflected even when cache has a non-empty stale icon.
  useEffect(() => {
    const normalizedSelectedTrustId = normalizeTrustId(
      selectedTrustId || localStorage.getItem('selected_trust_id') || ''
    );
    if (!normalizedSelectedTrustId) return undefined;

    let active = true;

    const syncSelectedTrustVisuals = async () => {
      try {
        const freshTrust = await fetchTrustById(normalizedSelectedTrustId);
        if (!active || !freshTrust) return;

        const normalizedFreshId = normalizeTrustId(freshTrust.id);
        if (!normalizedFreshId) return;

        setTrustInfo((prev) => {
          if (normalizeTrustId(prev?.id) !== normalizedFreshId) return prev;
          return {
            ...prev,
            ...freshTrust,
            icon_url: freshTrust?.icon_url || prev?.icon_url || null,
          };
        });

        setTrustList((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          let found = false;
          const next = list.map((trust) => {
            if (normalizeTrustId(trust?.id) !== normalizedFreshId) return trust;
            found = true;
            return {
              ...trust,
              ...freshTrust,
              icon_url: freshTrust?.icon_url || trust?.icon_url || null,
            };
          });
          const finalList = found ? next : [...next, freshTrust];
          try { localStorage.setItem('trust_list_cache', JSON.stringify(finalList)); } catch { /* ignore */ }
          return finalList;
        });
        setTrustIconVersionById((prev) => ({
          ...prev,
          [normalizedFreshId]: `${resolveTrustIconToken(freshTrust, '1')}-${Date.now()}`,
        }));
        if (freshTrust?.icon_url) {
          setTrustIconUrlById((prev) => {
            const next = { ...prev, [normalizedFreshId]: freshTrust.icon_url };
            try { localStorage.setItem(TRUST_ICON_CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }

        if (normalizeTrustId(defaultTrust?.id) === normalizedFreshId) {
          setDefaultTrust((prev) => {
            const nextDefault = {
              ...(prev || {}),
              ...freshTrust,
              icon_url: freshTrust?.icon_url || prev?.icon_url || null,
            };
            try {
              localStorage.setItem('default_trust_cache', JSON.stringify(nextDefault));
            } catch {
              // ignore cache write failure
            }
            return nextDefault;
          });
        }
      } catch (err) {
        console.warn('Failed to refresh selected trust visuals:', err?.message || err);
      }
    };

    syncSelectedTrustVisuals();
    window.addEventListener('focus', syncSelectedTrustVisuals);
    return () => {
      active = false;
      window.removeEventListener('focus', syncSelectedTrustVisuals);
    };
  }, [selectedTrustId, defaultTrust?.id]);

  // Load member trusts from API
  useEffect(() => {
    if (hasLoadedMemberTrusts.current) return;
    const user = localStorage.getItem('user');
    if (!user) return;
    let parsedUser = null;
    try { parsedUser = JSON.parse(user); } catch { return; }

    const userDerivedTrusts = Array.isArray(parsedUser?.hospital_memberships)
      ? parsedUser.hospital_memberships.map((m) => ({
        id: m?.trust_id || m?.id || null,
        name: m?.trust_name || null,
        icon_url: m?.trust_icon_url || null,
        remark: m?.trust_remark || null,
        is_active: m?.is_active
      }))
      : [];

    console.log('📋 User derived trusts from hospital_memberships:', userDerivedTrusts.length, userDerivedTrusts.map(t => t.name).join(', '));

    const fallbackIdsFromMemberships = Array.isArray(parsedUser?.hospital_memberships)
      ? parsedUser.hospital_memberships.map((m) => m?.members_id).filter(Boolean)
      : [];
    const explicitMemberIds = Array.isArray(parsedUser?.member_ids)
      ? parsedUser.member_ids.filter(Boolean)
      : [];
    const membersIds = Array.from(
      new Set(
        [
          parsedUser?.members_id,
          parsedUser?.member_id,
          parsedUser?.id,
          ...explicitMemberIds,
          ...fallbackIdsFromMemberships
        ]
          .filter(Boolean)
          .map((id) => String(id))
      )
    );
    if (membersIds.length === 0) {
      // If member id is not present, still honor trusts carried in user payload
      // (selected account's hospital_memberships from login flow).
      if (userDerivedTrusts.length > 0) {
        let memberOnlyTrusts = mergeUniqueTrusts(userDerivedTrusts);
        memberOnlyTrusts = mergeTrustsWithExistingVisuals(memberOnlyTrusts, readCachedTrustList());
        memberOnlyTrusts = pinBaseTrustFirst(memberOnlyTrusts);
        setTrustList(memberOnlyTrusts);
        try { localStorage.setItem('trust_list_cache', JSON.stringify(memberOnlyTrusts)); } catch { /* ignore */ }
      }
      return;
    }
    hasLoadedMemberTrusts.current = true;
    const loadMemberTrusts = async () => {
      try {
        console.log('🔍 Fetching member trusts for IDs:', membersIds.join(', '));

        const membershipResults = await Promise.all(
          membersIds.map((memberId) => fetchMemberTrusts(memberId).catch(() => []))
        );
        const membershipTrusts = membershipResults
          .flat()
          .map((trust) => ({
            id: trust.id || null,
            name: trust.name || null,
            icon_url: trust.icon_url || null,
            remark: trust.remark || null,
            is_active: trust.is_active,
            role: trust.role || null,
            membership_number: trust.membership_number || trust['Membership number'] || null,
            members_id: trust.members_id || trust.member_id || null,
          }));

        console.log('📊 Membership trusts found:', membershipTrusts.length, membershipTrusts.map(t => t.name).join(', '));

        const uniqueTrusts = mergeUniqueTrusts(userDerivedTrusts, membershipTrusts);
        console.log('✨ Total unique trusts:', uniqueTrusts.length, uniqueTrusts.map(t => t.name).join(', '));

        if (uniqueTrusts.length === 0) return;

        const primaryTrust = parsedUser?.primary_trust || uniqueTrusts.find((t) => t.is_active) || uniqueTrusts[0];
        const merged = mergeUniqueTrusts(uniqueTrusts);
        let withDefault = mergeTrustsWithExistingVisuals(merged, readCachedTrustList());
        withDefault = pinBaseTrustFirst(withDefault);
        setTrustList(() => {
          // Cache full trust list so it appears instantly on next refresh
          try { localStorage.setItem('trust_list_cache', JSON.stringify(withDefault)); } catch { /* ignore */ }
          console.log(`✅ Final trust list (${withDefault.length} trusts):`, withDefault.map(t => ({ name: t.name, id: t.id.substring(0, 8) })));
          return withDefault;
        });
        const normalizedSelected = normalizeTrustId(selectedTrustId);
        const selectedExistsInFinalList = withDefault.some((t) => normalizeTrustId(t.id) === normalizedSelected);
        const effectiveTrustId =
          (selectedExistsInFinalList ? normalizedSelected : '') ||
          normalizeTrustId(localStorage.getItem(LAST_SELECTED_TRUST_ID_KEY) || '') ||
          normalizeTrustId(primaryTrust?.id) ||
          normalizeTrustId(withDefault[0]?.id) ||
          '';
        const effectiveTrustForEvent =
          withDefault.find((t) => normalizeTrustId(t.id) === effectiveTrustId) ||
          primaryTrust ||
          withDefault[0] ||
          null;
        if (effectiveTrustId && effectiveTrustId !== selectedTrustId) {
          setSelectedTrustId(effectiveTrustId);
          localStorage.setItem('selected_trust_id', effectiveTrustId);
          localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, effectiveTrustId);
          window.dispatchEvent(new CustomEvent('trust-changed', {
            detail: { trustId: effectiveTrustId, trustName: effectiveTrustForEvent?.name || null }
          }));
        }
        const effectiveTrust =
          withDefault.find((t) => normalizeTrustId(t.id) === effectiveTrustId) ||
          primaryTrust ||
          withDefault[0] ||
          null;
        if (effectiveTrust) {
          setTrustInfo(effectiveTrust);
          if (effectiveTrust.name) localStorage.setItem('selected_trust_name', effectiveTrust.name);
        }
      } catch (error) {
        console.warn('Failed to load member trusts:', error);
      }
    };
    loadMemberTrusts();
  }, [selectedTrustId, defaultTrust?.id]);


  // Feature flags
  useEffect(() => {
    const loadFlags = async (force = false) => {
      const trustId = selectedTrustId || trustInfo?.id || '';
      const result = await fetchFeatureFlags(trustId || null, { force });
      if (result.success) {
        setFeatureFlags(result.flags || {});
        setFlagsData(result.flagsData || {}); // store full metadata (display_name, tagline, icon_url)
      }
    };
    loadFlags();
    const handleFocus = () => loadFlags(true);
    const handleVisibility = () => { if (document.visibilityState === 'visible') loadFlags(true); };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    const trustId = selectedTrustId || trustInfo?.id || '';
    const unsubscribe = subscribeFeatureFlags(trustId || null, () => loadFlags(true));
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
    };
  }, [selectedTrustId, trustInfo?.id]);

  const handleTrustSelect = async (trustId) => {
    const normalizedId = normalizeTrustId(trustId);
    if (normalizedId === normalizeTrustId(selectedTrustId)) return;
    console.log(`🔄 Switching trust from "${selectedTrustId}" to "${normalizedId}"`);

    // Force reload by resetting heavy modules; keep marquee visible from cache
    // so trust switch does not blank the updates strip.
    try {
      const cachedMarquee = localStorage.getItem(`marquee_cache_${normalizedId}`);
      if (cachedMarquee) {
        const parsed = JSON.parse(cachedMarquee);
        if (Array.isArray(parsed)) setMarqueeUpdates(parsed);
      }
    } catch {
      // ignore malformed marquee cache
    }
    setSponsorsById({});
    setSponsorOrder([]);
    setSponsorIndex(0);
    setIsNotificationsLoading(true);
    setSponsorFetchSettledTrustId(''); // Force sponsor refetch

    // Clear localStorage caches for this operation to force refresh
    try {
      localStorage.removeItem(`sponsor_carousel_index_${normalizedId}`);
    } catch { /* ignore */ }

    // Update selected trust
    setSelectedTrustId(normalizedId);
    localStorage.setItem('selected_trust_id', normalizedId);
    localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, normalizedId);
    setSessionSelectionFlag();

    const selected = trustList.find((t) => normalizeTrustId(t.id) === normalizedId) || null;
    setTrustInfo(selected);
    if (selected?.name) {
      localStorage.setItem('selected_trust_name', selected.name);
      console.log(`✓ Trust switched to: ${selected.name}`);
    }

    window.dispatchEvent(new CustomEvent('trust-changed', {
      detail: { trustId: normalizedId, trustName: selected?.name || null }
    }));

    // Fetch and update fresh trust details
    try {
      const freshTrust = await fetchTrustById(normalizedId);
      if (freshTrust) {
        console.log(`✓ Fetched fresh trust details: ${freshTrust.name}`);
        setTrustInfo(freshTrust);
        setTrustList((prev) => (prev || []).map((t) => {
          if (normalizeTrustId(t.id) !== normalizedId) return t;
          return {
            ...t,
            ...freshTrust,
            icon_url: freshTrust?.icon_url || t?.icon_url || null,
          };
        }));
        setTrustIconVersionById((prev) => ({
          ...prev,
          [normalizedId]: `${resolveTrustIconToken(freshTrust, '1')}-${Date.now()}`,
        }));
        if (freshTrust?.icon_url) {
          setTrustIconUrlById((prev) => {
            const next = { ...prev, [normalizedId]: freshTrust.icon_url };
            try { localStorage.setItem(TRUST_ICON_CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            return next;
          });
        }
        if (freshTrust.name) localStorage.setItem('selected_trust_name', freshTrust.name);
      }
    } catch (err) {
      console.warn('Failed to refresh trust details:', err?.message);
    }
  };

  const handleTrustChipClick = async (trust) => {
    const trustId = normalizeTrustId(trust?.id);
    const trustUnreadCount = Number(unreadCountByTrust[trustId] || 0);

    if (trustId && trustUnreadCount > 0) {
      try {
        const response = await getUserNotifications(trustId);
        const trustNotifications = Array.isArray(response?.data) ? response.data : [];
        const unreadNotifications = trustNotifications
          .filter((notification) => !notification?.is_read)
          .sort((a, b) => {
            const aTime = Date.parse(a?.created_at || '') || 0;
            const bTime = Date.parse(b?.created_at || '') || 0;
            return bTime - aTime;
          });

        for (const notification of unreadNotifications) {
          const redirectRoute = await resolveNotificationRedirectRoute(notification);
          if (!redirectRoute) continue;

          try {
            await markNotificationAsRead(notification.id);
            setNotifications((prev) => prev.map((item) => (
              item.id === notification.id ? { ...item, is_read: true } : item
            )));
            setUnreadCount((prev) => Math.max(0, prev - 1));
            setUnreadCountByTrust((prev) => ({
              ...prev,
              [trustId]: Math.max(0, Number(prev[trustId] || 0) - 1),
            }));
          } catch {
            // Redirect should still work even if read-state sync fails.
          }

          if (typeof onNavigate === 'function') {
            onNavigate(redirectRoute);
          } else {
            window.location.href = redirectRoute;
          }
          return;
        }
      } catch (error) {
        console.warn('Failed to resolve trust notification redirect:', error?.message || error);
      }
    }

    await handleTrustSelect(trust?.id);
  };

  // Marquee updates
  useEffect(() => {
    let active = true;
    const loadMarqueeUpdates = async () => {
      try {
        const trustId =
          normalizeTrustId(selectedTrustId) ||
          normalizeTrustId(trustInfo?.id) ||
          normalizeTrustId(localStorage.getItem('selected_trust_id')) ||
          null;
        const trustName = localStorage.getItem('selected_trust_name') || trustInfo?.name || null;

        // Keep existing/cached marquee visible while fresh data loads (SWR-style).

        const response = await getMarqueeUpdates(trustId, trustName);
        if (!active) return;
        if (response.success && response.data && response.data.length > 0) {
          const updates = response.data.map(item => item.message).filter(msg => msg && msg.trim() !== '');
          if (updates.length > 0) {
            setMarqueeUpdates(updates);
            // Cache for instant display next time
            if (trustId) {
              try { localStorage.setItem(`marquee_cache_${trustId}`, JSON.stringify(updates)); } catch { /* ignore */ }
            }
          }
        } else {
          setMarqueeUpdates([]);
          if (trustId) {
            try { localStorage.removeItem(`marquee_cache_${trustId}`); } catch { /* ignore */ }
          }
        }
      } catch (error) {
        console.error('Error loading marquee updates:', error);
        // Keep last known marquee on fetch error to avoid refresh flicker.
      }
    };
    // No artificial delay — cached data shows in <1ms
    loadMarqueeUpdates();
    return () => { active = false; };
  }, [selectedTrustId, trustInfo]);

  // Sponsor: initial 3 cards, then progressive background batches.
  useEffect(() => {
    let isActive = true;

    const trustId =
      normalizeTrustId(selectedTrustId) ||
      normalizeTrustId(trustInfo?.id) ||
      normalizeTrustId(localStorage.getItem('selected_trust_id')) ||
      normalizeTrustId(import.meta.env.VITE_DEFAULT_TRUST_ID) ||
      '';
    if (!trustId) {
      setIsSponsorsLoading(false);
      setSponsorFetchSettledTrustId('');
      syncSponsorStoreSnapshot('');
      return;
    }

    if (sponsorBootstrapInFlightRef.current === trustId) {
      return;
    }
    sponsorBootstrapInFlightRef.current = trustId;

    const cachedFirstBatch = getCachedCarouselBatch(trustId, 0);
    const cachedOrder = readSponsorOrder(trustId);
    const hasAnyCachedSponsors =
      cachedFirstBatch.sponsors.length > 0 ||
      (Array.isArray(cachedOrder) && cachedOrder.length > 0);
    if (hasAnyCachedSponsors) {
      syncSponsorStoreSnapshot(trustId);
      setIsSponsorsLoading(false);
      setSponsorFetchSettledTrustId(trustId);
      ensureAllSponsorsLoaded(trustId, { force: true })
        .then(() => {
          if (!isActive) return;
          syncSponsorStoreSnapshot(trustId);
          setSponsorFetchSettledTrustId(trustId);
        })
        .catch(() => { });
    } else {
      setIsSponsorsLoading(true);
      setIsCarouselReady(false);
    }

    const loadInitialSponsorBatch = (attempt = 0) => {
      preloadCarouselBatchImages({ trustId, batchIndex: 0 })
        .then((firstBatch) => {
          if (!isActive) return;
          syncSponsorStoreSnapshot(trustId);
          const incomingSponsors = Array.isArray(firstBatch?.sponsors) ? firstBatch.sponsors : [];
          const currentOrder = readSponsorOrder(trustId);
          if (incomingSponsors.length > 0 && (!Array.isArray(currentOrder) || currentOrder.length === 0)) {
            const byId = {};
            const order = [];
            for (const sponsor of incomingSponsors) {
              const id = sponsor?.id ? String(sponsor.id).trim() : '';
              if (!id) continue;
              byId[id] = sponsor;
              order.push(id);
            }
            if (order.length > 0) {
              console.error('[SponsorFlash][HomeMismatch] API returned sponsors but store snapshot was empty. Hydrating UI from incoming batch.', {
                trustId,
                incomingCount: incomingSponsors.length,
                incomingIds: order
              });
              setSponsorsById(byId);
              setSponsorOrder(order);
              setIsCarouselReady(true);
            }
          }
          const currentById = readSponsorsById(trustId);
          const currentByIdCount = currentById && typeof currentById === 'object' ? Object.keys(currentById).length : 0;
          if (incomingSponsors.length > 0 && currentByIdCount === 0) {
            const byId = {};
            const order = Array.isArray(currentOrder) ? [...currentOrder] : [];
            for (const sponsor of incomingSponsors) {
              const id = sponsor?.id ? String(sponsor.id).trim() : '';
              if (!id) continue;
              byId[id] = sponsor;
              if (!order.includes(id)) order.push(id);
            }
            if (Object.keys(byId).length > 0) {
              setSponsorsById(byId);
              setSponsorOrder(order);
              setIsCarouselReady(true);
            }
          }
          setSponsorIndex(0);
          setIsSponsorsLoading(false);
          setSponsorFetchSettledTrustId(trustId);
          sponsorBootstrapInFlightRef.current = '';

          // Next batches are fetched by the progressive loader effect.
        })
        .catch((err) => {
          console.error('Error loading sponsors:', err);
          if (!isActive) return;

          if (!hasAnyCachedSponsors && attempt < 2) {
            const retryDelayMs = 700 * (attempt + 1);
            setTimeout(() => {
              if (!isActive) return;
              loadInitialSponsorBatch(attempt + 1);
            }, retryDelayMs);
            return;
          }

          if (!hasAnyCachedSponsors) {
            syncSponsorStoreSnapshot(trustId);
            // Keep skeleton instead of showing a false "no sponsor" empty state on transient failures.
            setIsSponsorsLoading(true);
            setSponsorFetchSettledTrustId('');
            sponsorBootstrapInFlightRef.current = '';
            return;
          }

          setIsSponsorsLoading(false);
          setSponsorFetchSettledTrustId(trustId);
          sponsorBootstrapInFlightRef.current = '';
        });
    };

    loadInitialSponsorBatch(0);

    return () => {
      isActive = false;
      if (sponsorBootstrapInFlightRef.current === trustId) {
        sponsorBootstrapInFlightRef.current = '';
      }
    };
  }, [selectedTrustId, trustInfo?.id]);

  useEffect(() => {
    if (!sponsors.length) return;
    const trustId =
      normalizeTrustId(selectedTrustId) ||
      normalizeTrustId(trustInfo?.id) ||
      normalizeTrustId(localStorage.getItem('selected_trust_id')) ||
      null;
    if (!trustId) return;
    const current = sponsors[sponsorIndex];
    if (current?.is_user_match) return;
    const trustKey = `sponsor_carousel_index_${trustId}`;
    try {
      localStorage.setItem(trustKey, String(sponsorIndex));
    } catch {
      // ignore
    }
  }, [sponsorIndex, sponsors, selectedTrustId, trustInfo?.id]);

  useEffect(() => {
    if (!isCarouselReady) return;
    if (!sponsors.length) return;
    if (sponsorIndex >= sponsors.length) {
      setSponsorIndex(0);
      return;
    }
    const current = sponsors[sponsorIndex];
    const durationSeconds = Math.max(1, Number(current?.duration_seconds) || 5);
    const timer = setTimeout(() => {
      setSponsorIndex((prev) => (prev + 1) % sponsors.length);
    }, durationSeconds * 1000);
    return () => clearTimeout(timer);
  }, [isCarouselReady, sponsors, sponsorIndex]);

  useEffect(() => {
    let active = true;
    if (!isCarouselReady) return;
    if (!hasMoreSponsorBatches) return;
    if (isCarouselBatchLoading) return;

    const trustId =
      normalizeTrustId(selectedTrustId) ||
      normalizeTrustId(trustInfo?.id) ||
      normalizeTrustId(localStorage.getItem('selected_trust_id')) ||
      normalizeTrustId(import.meta.env.VITE_DEFAULT_TRUST_ID) ||
      '';
    if (!trustId) return;

    const nextBatchIndex = loadedBatchCount;
    setIsCarouselBatchLoading(true);
    prefetchCarouselBatch({ trustId, batchIndex: nextBatchIndex })
      .then((nextBatch) => {
        if (!active) return;
        const incoming = Array.isArray(nextBatch?.sponsors) ? nextBatch.sponsors : [];
        if (!incoming.length) {
          setHasMoreSponsorBatches(false);
          return;
        }
        syncSponsorStoreSnapshot(trustId);
        setLoadedBatchCount((count) => Math.max(count, nextBatchIndex + 1));
        setHasMoreSponsorBatches(Boolean(nextBatch?.hasMore));
      })
      .finally(() => {
        if (!active) return;
        setIsCarouselBatchLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isCarouselReady, loadedBatchCount, hasMoreSponsorBatches, isCarouselBatchLoading, selectedTrustId, trustInfo?.id]);

  const currentSponsorTrustId =
    normalizeTrustId(selectedTrustId) ||
    normalizeTrustId(trustInfo?.id) ||
    normalizeTrustId(localStorage.getItem('selected_trust_id')) ||
    normalizeTrustId(import.meta.env.VITE_DEFAULT_TRUST_ID) ||
    '';
  const hasSettledSponsorsForCurrentTrust =
    Boolean(currentSponsorTrustId) &&
    sponsorFetchSettledTrustId === currentSponsorTrustId;
  const hasRenderableSponsors = sponsors.length > 0;
  const isSponsorSectionLoading = !hasRenderableSponsors && (!hasSettledSponsorsForCurrentTrust || isSponsorsLoading);
  const sponsorDebugInfo = currentSponsorTrustId ? getSponsorDebugInfo(currentSponsorTrustId) : null;
  const sponsorEmptyDebugReason = !isSponsorSectionLoading && sponsors.length === 0
    ? sponsorDebugInfo?.reason || ''
    : '';
  const sponsorChunkStart = sponsors.length > 0
    ? Math.floor(sponsorIndex / SPONSOR_CHUNK_SIZE) * SPONSOR_CHUNK_SIZE
    : 0;
  const visibleSponsors = sponsors.slice(sponsorChunkStart, sponsorChunkStart + SPONSOR_CHUNK_SIZE);
  const activeVisibleSponsorIndex = sponsorIndex - sponsorChunkStart;
  const sponsorSkeletonRows = [0, 1, 2];

  useEffect(() => {
    if (isSponsorSectionLoading) return;
    if (sponsors.length > 0) return;
    console.error('[SponsorFlash][HomeEmptyRender]', {
      trustId: currentSponsorTrustId,
      sponsorFetchSettledTrustId,
      sponsorOrderLength: sponsorOrder.length,
      sponsorsByIdCount: Object.keys(sponsorsById || {}).length,
      debugReason: sponsorDebugInfo?.reason || null,
      debugCounts: sponsorDebugInfo?.counts || null,
      debugSponsorIds: sponsorDebugInfo?.joinedSponsorIds || []
    });
  }, [
    isSponsorSectionLoading,
    sponsors.length,
    currentSponsorTrustId,
    sponsorFetchSettledTrustId,
    sponsorOrder.length,
    sponsorsById,
    sponsorDebugInfo
  ]);

  useEffect(() => {
    const trustId = currentSponsorTrustId;
    if (!trustId) return;
    if (sponsorListPreloadRef.current[trustId]) return;

    const timer = setTimeout(() => {
      preloadSponsorListFirstPage(trustId).catch(() => { });
      sponsorListPreloadRef.current[trustId] = true;
    }, 250);
    return () => clearTimeout(timer);
  }, [currentSponsorTrustId]);

  // Gallery trust-sync and reload are handled centrally in GalleryContext.

  // Notifications
  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_NOTIFICATIONS === 'true') return;
    const selectedTrustKey = normalizeTrustId(
      localStorage.getItem('selected_trust_id') ||
      selectedTrustId ||
      trustInfo?.id ||
      ''
    );
    const cachedNotifications = readNotificationCache(selectedTrustKey);

    if (cachedNotifications) {
      setNotifications(cachedNotifications.notifications || []);
      setUnreadCount((cachedNotifications.notifications || []).filter((n) => !n.is_read).length);
      setIsNotificationsLoading(false);
    }

    const fetchNotifications = async ({ showLoader = true } = {}) => {
      const fetchId = latestNotificationsFetchRef.current + 1;
      latestNotificationsFetchRef.current = fetchId;

      const requestedTrustId = selectedTrustKey;

      if (showLoader) {
        setIsNotificationsLoading(true);
      }

      const isStaleFetch = () => {
        const currentTrustId = normalizeTrustId(
          localStorage.getItem('selected_trust_id') ||
          selectedTrustId ||
          trustInfo?.id ||
          ''
        );
        return latestNotificationsFetchRef.current !== fetchId || currentTrustId !== requestedTrustId;
      };

      try {
        const response = await getUserNotifications();
        if (isStaleFetch()) return;

        if (response.success) {
          const nextNotifications = response.data || [];
          setNotifications(nextNotifications);
          setUnreadCount(nextNotifications.filter(n => !n.is_read).length);
          writeNotificationCache(requestedTrustId, nextNotifications);
        }

        const trustIds = [...new Set((trustList || [])
          .map((trust) => normalizeTrustId(trust?.id))
          .filter(Boolean))];

        if (trustIds.length === 0) {
          setUnreadCountByTrust({});
          return;
        }

        const unreadResults = await Promise.all(
          trustIds.map(async (trustId) => {
            try {
              const trustResponse = await getUserNotifications(trustId);
              const trustUnreadCount = trustResponse.success
                ? (trustResponse.data || []).filter((notification) => !notification.is_read).length
                : 0;
              return [trustId, trustUnreadCount];
            } catch {
              return [trustId, 0];
            }
          })
        );

        if (isStaleFetch()) return;
        setUnreadCountByTrust(Object.fromEntries(unreadResults));
      } catch (error) {
        if (isStaleFetch()) return;
        console.error('Error fetching notifications:', error);
      } finally {
        if (!isStaleFetch() && showLoader) {
          setIsNotificationsLoading(false);
        }
      }
    };
    const handleBirthdayInserted = () => fetchNotifications({ showLoader: false });
    window.addEventListener('birthdayNotifInserted', handleBirthdayInserted);
    const handlePushNotificationArrived = () => fetchNotifications({ showLoader: false });
    window.addEventListener('pushNotificationArrived', handlePushNotificationArrived);
    const handlePushNotificationClicked = () => fetchNotifications({ showLoader: false });
    window.addEventListener('pushNotificationClicked', handlePushNotificationClicked);
    const handleAppResumed = () => fetchNotifications({ showLoader: false });
    window.addEventListener('appResumed', handleAppResumed);

    // Trust switch should reflect notifications immediately.
    if (!cachedNotifications) {
      setIsNotificationsLoading(true);
    }
    fetchNotifications({ showLoader: !cachedNotifications });
    const warmRetry = setTimeout(() => fetchNotifications({ showLoader: false }), 700);
    const interval = setInterval(() => fetchNotifications({ showLoader: false }), 30000);
    return () => {
      clearInterval(interval);
      clearTimeout(warmRetry);
      window.removeEventListener('birthdayNotifInserted', handleBirthdayInserted);
      window.removeEventListener('pushNotificationArrived', handlePushNotificationArrived);
      window.removeEventListener('pushNotificationClicked', handlePushNotificationClicked);
      window.removeEventListener('appResumed', handleAppResumed);
    };
  }, [selectedTrustId, trustList]);

  // Real-time notifications
  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_NOTIFICATIONS === 'true') return;
    const subscribeToNotifications = () => {
      const notificationContext = getCurrentNotificationContext();
      if (!notificationContext.userId) return;
      const channel = supabase
        .channel('notifications-realtime-home')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
          const newNotif = payload.new;
          const isForMe = matchesNotificationForContext(newNotif, notificationContext);
          if (isForMe) {
            const currentTrustKey = normalizeTrustId(
              localStorage.getItem('selected_trust_id') ||
              selectedTrustId ||
              trustInfo?.id ||
              ''
            );
            setNotifications((prev) => {
              const existingKeys = new Set(prev.map(buildNotificationContentKey));
              const newKey = buildNotificationContentKey(newNotif);
              if (existingKeys.has(newKey)) return prev;
              const next = [newNotif, ...prev];
              if (!newNotif.is_read) setUnreadCount((count) => count + 1);
              writeNotificationCache(currentTrustKey, next);
              return next;
            });
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
          const updatedNotif = payload.new;
          const isForMe = matchesNotificationForContext(updatedNotif, notificationContext);
          if (isForMe) {
            let shouldDecrementUnread = false;
            const currentTrustKey = normalizeTrustId(
              localStorage.getItem('selected_trust_id') ||
              selectedTrustId ||
              trustInfo?.id ||
              ''
            );
            setNotifications((prev) => {
              const next = prev.map((n) => {
                if (n.id !== updatedNotif.id) return n;
                if (!n.is_read && updatedNotif.is_read) shouldDecrementUnread = true;
                return updatedNotif;
              });
              writeNotificationCache(currentTrustKey, next);
              return next;
            });
            if (shouldDecrementUnread) {
              setUnreadCount((prev) => Math.max(0, prev - 1));
            }
          }
        })
        .subscribe();
      channelRef.current = channel;
    };
    subscribeToNotifications();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [selectedTrustId]);

  const handleMarkAsRead = async (id) => {
    try {
      await markNotificationAsRead(id);
      let shouldDecrementUnread = false;
      const currentTrustKey = normalizeTrustId(
        localStorage.getItem('selected_trust_id') ||
        selectedTrustId ||
        trustInfo?.id ||
        ''
      );
      setNotifications((prev) => {
        const next = prev.map((n) => {
          if (n.id !== id) return n;
          if (!n.is_read) shouldDecrementUnread = true;
          return n.is_read ? n : { ...n, is_read: true };
        });
        writeNotificationCache(currentTrustKey, next);
        return next;
      });
      if (shouldDecrementUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) { console.error('Error marking notification as read:', error); }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsAsRead();
      const currentTrustKey = normalizeTrustId(
        localStorage.getItem('selected_trust_id') ||
        selectedTrustId ||
        trustInfo?.id ||
        ''
      );
      setNotifications((prev) => {
        const next = prev.map(n => ({ ...n, is_read: true }));
        writeNotificationCache(currentTrustKey, next);
        return next;
      });
      setUnreadCount(0);
    } catch (error) { console.error('Error marking all notifications as read:', error); }
  };

  const handleDismissNotification = async (id) => {
    try {
      let removedUnread = false;
      const currentTrustKey = normalizeTrustId(
        localStorage.getItem('selected_trust_id') ||
        selectedTrustId ||
        trustInfo?.id ||
        ''
      );
      setNotifications((prev) => {
        const dismissed = prev.find((n) => n.id === id);
        removedUnread = Boolean(dismissed && !dismissed.is_read);
        const next = prev.filter((n) => n.id !== id);
        writeNotificationCache(currentTrustKey, next);
        return next;
      });
      if (removedUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
      try { await deleteNotification(id); } catch (apiError) { console.error('Error deleting notification from backend:', apiError); }
    } catch (error) { console.error('Error dismissing notification:', error); }
  };

  const handleClearAll = async () => {
    const toDelete = [...notifications];
    const currentTrustKey = normalizeTrustId(
      localStorage.getItem('selected_trust_id') ||
      selectedTrustId ||
      trustInfo?.id ||
      ''
    );
    setNotifications([]);
    writeNotificationCache(currentTrustKey, []);
    setUnreadCount(0);
    setIsNotificationsOpen(false);
    try { await Promise.all(toDelete.map(n => deleteNotification(n.id))); } catch (error) { console.error('Error clearing notifications:', error); }
  };

  useEffect(() => {
    if (!showTermsModal) return undefined;

    let active = true;
    const loadTermsContent = async () => {
      const trustId = resolveLegalTrustId(selectedTrustId || trustInfo?.id || defaultTrust?.id || '');
      if (!trustId) {
        setTermsModalContent('');
        setTermsModalTrustName(trustInfo?.name || defaultTrust?.name || localStorage.getItem('selected_trust_name') || '');
        setTermsModalLoading(false);
        return;
      }

      try {
        setTermsModalLoading(true);
        setTermsModalError('');
        const trust = await fetchTrustById(trustId);
        if (!active || !trust) return;
        setTermsModalContent(trust.terms_content || '');
        setTermsModalTrustName(trust.name || localStorage.getItem('selected_trust_name') || '');
      } catch (err) {
        if (!active) return;
        console.warn('[Home] Failed to load terms content:', err?.message || err);
        setTermsModalError('Failed to load Terms & Conditions. Please try again.');
        setTermsModalContent('');
        setTermsModalTrustName(localStorage.getItem('selected_trust_name') || '');
      } finally {
        if (active) setTermsModalLoading(false);
      }
    };

    loadTermsContent();
    return () => {
      active = false;
    };
  }, [showTermsModal, selectedTrustId, trustInfo?.id, trustInfo?.name, defaultTrust?.id, defaultTrust?.name]);

  const handleAcceptTerms = () => {
    clearLoginTermsPromptPending();
    setShowTermsModal(false);
    setTermsModalContent('');
    setTermsModalTrustName('');
    setTermsModalError('');
    setTermsModalLoading(false);
  };

  const formatNotificationTitle = (title, message) => {
    if (title.includes('Appointment') && message.includes('appointment')) {
      if (message.includes('date has been changed')) return '📅 Appointment Rescheduled';
      else if (message.includes('remark')) return '💬 New Message';
      else return '📋 Appointment Updated';
    }
    return title;
  };

  const formatNotificationMessage = (message) => {
    if (message.includes('appointment') && message.includes('date has been changed')) {
      const dateMatch = message.match(/date has been changed from ([\d-]+) to ([\d-]+)/i);
      if (dateMatch) return `Hi there! Your appointment has been rescheduled from ${formatDate(dateMatch[1])} to ${formatDate(dateMatch[2])}.`;
    } else if (message.includes('appointment') && message.includes('remark')) {
      const remarkMatch = message.match(/has a new remark: (.+)/i);
      if (remarkMatch) return `Hi there! New message regarding your appointment: "${remarkMatch[1]}".`;
      else return `Hi there! New message regarding your appointment.`;
    }
    return message;
  };

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  };

  const handleSponsorTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    sponsorTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
    sponsorTouchEndRef.current = null;
  };

  const handleSponsorTouchMove = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    sponsorTouchEndRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleSponsorTouchEnd = () => {
    if (sponsors.length <= 1) return;
    const start = sponsorTouchStartRef.current;
    const end = sponsorTouchEndRef.current;
    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 42 || absX <= absY) return;

    if (dx < 0) {
      setSponsorIndex((prev) => (prev + 1) % sponsors.length);
    } else {
      setSponsorIndex((prev) => (prev - 1 + sponsors.length) % sponsors.length);
    }
  };

  const ff = (key) => isFeatureEnabled(featureFlags, key);
  const normalizeQuickRoute = (route) => {
    const raw = String(route || '').trim().toLowerCase();
    const value = raw
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/[?#].*$/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (value === 'noticeboard' || value === 'notices') return 'notices';
    if (value === 'facility' || value === 'facilities') return 'facilities';
    if (value === 'event' || value === 'events') return 'events';
    if (value === 'achievement' || value === 'achievements') return 'achievements';
    if (value === 'donation' || value === 'donations') return 'donation';
    if (value === 'executive-body' || value === 'executive_body' || value === 'executive body' || value === 'executivebody') return 'executive-body';
    if (value === 'opd' || value === 'appointment' || value === 'appointments') return 'appointment';
    if (value === 'referral' || value === 'reference' || value === 'references') return 'reference';
    if (value === 'report' || value === 'reports') return 'reports';
    if (value === 'directory' || value === 'healthcare-trustee-directory') return 'directory';
    return value || '';
  };

  const fallbackQuickRouteByFeatureKey = {
    feature_executive_body: 'executive-body',
  };

  const resolveQuickRoute = (route, featureKey = '') => {
    const normalizedRoute = normalizeQuickRoute(route);
    if (normalizedRoute) return normalizedRoute;
    return fallbackQuickRouteByFeatureKey[String(featureKey || '').trim().toLowerCase()] || '';
  };

  const resolveQuickIcon = (route, explicitIcon) => {
    const icon = String(explicitIcon || '').trim();
    if (icon) return icon;
    const normalized = normalizeQuickRoute(route);
    const iconByRoute = {
      notices: '/icons/quick-access/noticeboard.svg',
      facilities: '/icons/quick-access/facilities.svg',
      events: '/icons/quick-access/events.svg',
      achievements: '/icons/quick-access/directory.svg',
      donation: '/icons/quick-access/donation.svg',
      'executive-body': '/icons/quick-access/directory.svg',
      directory: '/icons/quick-access/directory.svg',
      appointment: '/icons/quick-access/opd.svg',
      reference: '/icons/quick-access/referral.svg',
      reports: '/icons/quick-access/reports.svg',
    };
    return iconByRoute[normalized] || '/icons/quick-access/directory.svg';
  };

  // Build Quick Access tiles from Supabase flag metadata.
  const dbQuickActions = Object.entries(flagsData)
    .filter(([key, data]) => (
      Boolean(key)
      && data?.is_enabled
      && key !== 'feature_add_community'
      && key !== 'feature_nomination_details'
      && key !== 'feature_nomination'
      && normalizeQuickRoute(data?.route) !== 'add-community'
      && normalizeQuickRoute(data?.route) !== 'nomination-details'
      && normalizeQuickRoute(data?.route) !== 'nomination'
      && Boolean(resolveQuickRoute(data?.route, key))
    ))
    .map(([key, data]) => ({
      id: key,
      route: resolveQuickRoute(data.route, key),
      displayName: data.display_name || key,
      tagline: data.tagline || '',
      icon_url: resolveQuickIcon(data.route, data.icon_url),
      quick_order: data.quick_order ?? null,
    }));

  // Fallback tiles ensure quick-access is still visible even when flag rows are partially seeded.
  const fallbackQuickActions = [
    ff('feature_directory') ? {
      id: 'feature_directory_fallback',
      route: 'directory',
      displayName: 'Directory',
      tagline: 'Member directory',
      icon_url: '/icons/quick-access/directory.svg',
      quick_order: 50,
    } : null,
    ff('feature_opd') ? {
      id: 'feature_opd_fallback',
      route: 'appointment',
      displayName: 'OPD',
      tagline: 'Book appointments',
      icon_url: '/icons/quick-access/opd.svg',
      quick_order: 60,
    } : null,
    ff('feature_referral') ? {
      id: 'feature_referral_fallback',
      route: 'reference',
      displayName: 'Referral',
      tagline: 'Share references',
      icon_url: '/icons/quick-access/referral.svg',
      quick_order: 70,
    } : null,
    ff('feature_reports') ? {
      id: 'feature_reports_fallback',
      route: 'reports',
      displayName: 'Reports',
      tagline: 'View reports',
      icon_url: '/icons/quick-access/reports.svg',
      quick_order: 75,
    } : null,
    ff('feature_noticeboard') ? {
      id: 'feature_noticeboard_fallback',
      route: 'notices',
      displayName: 'Noticeboard',
      tagline: 'Latest updates',
      icon_url: '/icons/quick-access/noticeboard.svg',
      quick_order: 80,
    } : null,
    ff('feature_facilities') ? {
      id: 'feature_facilities_fallback',
      route: 'facilities',
      displayName: 'Facilities',
      tagline: 'Trust facilities',
      icon_url: '/icons/quick-access/facilities.svg',
      quick_order: 85,
    } : null,
    ff('feature_events') ? {
      id: 'feature_events_fallback',
      route: 'events',
      displayName: 'Events',
      tagline: 'Upcoming activities',
      icon_url: '/icons/quick-access/events.svg',
      quick_order: 90,
    } : null,
    ff('feature_achievements') ? {
      id: 'feature_achievements_fallback',
      route: 'achievements',
      displayName: 'Achievements',
      tagline: 'Your milestones & recognition',
      icon_url: '/icons/quick-access/directory.svg',
      quick_order: 92,
    } : null,
    ff('feature_donation') ? {
      id: 'feature_donation_fallback',
      route: 'donation',
      displayName: 'Donation',
      tagline: 'Support trust causes',
      icon_url: '/icons/quick-access/donation.svg',
      quick_order: 95,
    } : null,
  ].filter(Boolean);

  const enabledQuickActions = [...dbQuickActions, ...fallbackQuickActions]
    .filter((item) => {
      const normalizedRoute = normalizeQuickRoute(item?.route);
      const excludedQuickRoutes = new Set([
        'gallery',
        'notifications',
        'notification',
        'add-community',
        'nomination',
        'nomination-details',
        'developers',
        'developer-info',
        'developerinfo',
        'trustlist',
        'trust-list'
      ]);
      return !excludedQuickRoutes.has(normalizedRoute);
    })
    .filter((item, index, all) =>
      all.findIndex((entry) => normalizeQuickRoute(entry.route) === normalizeQuickRoute(item.route)) === index
    )
    .sort((a, b) => {
      const ao = a.quick_order ?? 9999;
      const bo = b.quick_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return String(a.displayName).localeCompare(String(b.displayName));
    });

  const activeTrust = useMemo(() => (
    trustList.find((trust) => normalizeTrustId(trust?.id) === normalizeTrustId(selectedTrustId)) ||
    trustInfo ||
    defaultTrust ||
    null
  ), [selectedTrustId, trustList, trustInfo, defaultTrust]);

  const selectedTrust = activeTrust;
  const otherTrusts = useMemo(() => {
    if (!Array.isArray(trustList) || trustList.length === 0) return [];
    const normalizedSelectedTrustId = normalizeTrustId(selectedTrustId);
    if (!normalizedSelectedTrustId) return trustList;
    return trustList.filter((trust) => normalizeTrustId(trust?.id) !== normalizedSelectedTrustId);
  }, [selectedTrustId, trustList]);

  useEffect(() => {
    const normalizedSelectedTrustId = normalizeTrustId(selectedTrustId);
    const previousSelectedTrustId = normalizeTrustId(previousSelectedTrustIdRef.current);
    previousSelectedTrustIdRef.current = normalizedSelectedTrustId;

    if (!normalizedSelectedTrustId) return;
    if (!previousSelectedTrustId || previousSelectedTrustId === normalizedSelectedTrustId) return;

    setAnimatingTrustId(normalizedSelectedTrustId);
    if (trustSwitchAnimationTimerRef.current) {
      clearTimeout(trustSwitchAnimationTimerRef.current);
    }
    trustSwitchAnimationTimerRef.current = setTimeout(() => {
      setAnimatingTrustId('');
      trustSwitchAnimationTimerRef.current = null;
    }, 520);
  }, [selectedTrustId]);

  useEffect(() => () => {
    if (trustSwitchAnimationTimerRef.current) {
      clearTimeout(trustSwitchAnimationTimerRef.current);
    }
  }, []);
  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const selectedTrustMembership = useMemo(() => {
    const memberships = Array.isArray(currentUser?.hospital_memberships)
      ? currentUser.hospital_memberships
      : [];
    const normalizedSelectedTrustId =
      normalizeTrustId(selectedTrustId) ||
      normalizeTrustId(activeTrust?.id) ||
      normalizeTrustId(localStorage.getItem('selected_trust_id'));

    if (!normalizedSelectedTrustId) return null;

    const membershipMatch = (
      memberships.find((membership) =>
        normalizeTrustId(membership?.trust_id || membership?.id) === normalizedSelectedTrustId &&
        membership?.is_active !== false
      ) ||
      memberships.find((membership) =>
        normalizeTrustId(membership?.trust_id || membership?.id) === normalizedSelectedTrustId
      ) ||
      null
    );
    if (membershipMatch) return membershipMatch;

    // Fallback: when selected trust came from merged trust list, still show header badges.
    const trustMatch = (trustList || []).find(
      (trust) => normalizeTrustId(trust?.id) === normalizedSelectedTrustId
    );
    if (!trustMatch) return null;
    return {
      trust_id: trustMatch.id || null,
      role: trustMatch.role || null,
      membership_number: trustMatch.membership_number || null,
      members_id: trustMatch.members_id || null,
      is_active: trustMatch.is_active !== false
    };
  }, [activeTrust?.id, currentUser?.hospital_memberships, selectedTrustId, trustList]);

  const showSelectedTrustMemberBanner = Boolean(selectedTrustMembership?.trust_id || selectedTrustMembership?.id);
  const footerShareLink = POWERED_BY_URL;

  const renderTrustChip = (trust) => {
    if (!trust?.id) return null;

    const normalizedTrustId = normalizeTrustId(trust.id);
    const isActive = normalizedTrustId === selectedTrustId;
    const isAnimatingSelection = isActive && animatingTrustId === normalizedTrustId;
    const trustUnreadCount = Number(unreadCountByTrust[normalizedTrustId] || 0);
    const shouldBlinkForUnread = trustUnreadCount > 0;
    const trustChipAnimations = [
      isAnimatingSelection ? 'trustChipMoveToFront 520ms cubic-bezier(0.22, 1, 0.36, 1)' : null,
      shouldBlinkForUnread ? 'trustChipUnreadPulse 1.5s ease-in-out infinite' : null,
    ].filter(Boolean).join(', ');

    return (
      <button
        key={normalizedTrustId || trust.id || trust.name}
        onClick={() => handleTrustChipClick(trust)}
        ref={(node) => {
          if (!normalizedTrustId) return;
          if (node) trustChipRefs.current[normalizedTrustId] = node;
          else delete trustChipRefs.current[normalizedTrustId];
        }}
        className="flex-shrink-0 w-[3rem] h-[3rem] rounded-full flex items-center justify-center overflow-visible transition-all duration-200 relative"
        style={{
          border: isActive
            ? `2.5px solid ${theme.primary}`
            : '2px solid color-mix(in srgb, var(--body-text-color) 18%, var(--surface-color))',
          backgroundColor: 'color-mix(in srgb, var(--app-page-bg) 86%, var(--surface-color))',
          transform: isActive ? 'scale(1.05)' : 'scale(1)',
          boxShadow: isActive
            ? '0 4px 12px color-mix(in srgb, var(--brand-navy) 22%, transparent)'
            : 'none',
          animation: trustChipAnimations || 'none',
          '--trust-ring-color': theme.primary,
          '--trust-ring-glow': `color-mix(in srgb, ${theme.primary} 45%, ${theme.accent || theme.secondary})`,
        }}
        title={trust?.name || ''}
      >
        <TrustChipIcon
          iconUrl={trust?.icon_url || trustIconUrlById[normalizedTrustId]}
          altText={trust?.name || 'Trust'}
          versionToken={trustIconVersionById[normalizedTrustId] || resolveTrustIconToken(trust, '')}
          state={isActive}
        />
        {isActive && (
          <div className="absolute bottom-0 right-[6px] w-4 h-4 rounded-full flex items-center justify-center" style={{ background: theme.primary }}>
            <span className="text-[10px] text-white">✓</span>
          </div>
        )}
      </button>
    );
  };

  const shouldShowTrustSelector = trustList.length > 0;
  const showTrustSelector = shouldShowTrustSelector;
  const surfaceColor = getThemeToken(theme, 'accent_bg', null)
    || theme?.accentBg
    || 'var(--surface-color)';
  const mutedTextColor = getThemeToken(theme, 'typography.body_text_color', 'var(--body-text-color)');
  const headingColor = getThemeToken(theme, 'typography.heading_color', 'var(--heading-color)');
  const onPrimaryText = getThemeToken(theme, 'app_buttons.text_color', 'var(--app-button-text)');
  const appButtonBg = 'var(--app-button-bg)';
  const quickActionsBg = 'var(--quick-actions-bg)';
  const quickActionsText = 'var(--quick-actions-text)';
  const quickActionsIconBg = 'var(--quick-actions-icon-bg)';
  const navbarTextColor = 'var(--navbar-text)';
  const subtleBorderColor = `color-mix(in srgb, ${theme.secondary} 16%, transparent)`;
  const subtleSurfaceColor = `color-mix(in srgb, ${surfaceColor} 82%, ${theme.accentBg})`;
  const sponsorTheme = {
    bgColor1: getThemeToken(theme, 'advertisement.bg_color_1', getThemeToken(theme, 'advertisement.bg_color', theme.accentBg || 'var(--app-accent-bg)')),
    bgColor2: getThemeToken(theme, 'advertisement.bg_color_2', getThemeToken(theme, 'advertisement.bg_color', theme.accent || theme.accentBg || 'var(--app-accent)')),
    bgOpacity: Number(getThemeToken(theme, 'advertisement.bg_opacity', 1)),
    gradientType: String(getThemeToken(theme, 'advertisement.gradient_type', 'linear') || 'linear').toLowerCase(),
    gradientAngle: Number(getThemeToken(theme, 'advertisement.gradient_angle', 135)),
    textColor: getThemeToken(theme, 'advertisement.text_color', headingColor),
    titleColor: getThemeToken(theme, 'advertisement.title_color', headingColor),
    subtitleColor: getThemeToken(theme, 'advertisement.subtitle_color', mutedTextColor),
    descriptionColor: getThemeToken(theme, 'advertisement.description_color', mutedTextColor),
    borderColor1: getThemeToken(theme, 'advertisement.card_border_color', getThemeToken(theme, 'advertisement.border_color_1', theme.primary)),
    borderColor2: getThemeToken(theme, 'advertisement.card_border_color', getThemeToken(theme, 'advertisement.border_color_2', theme.secondary)),
    shadowColor: getThemeToken(theme, 'advertisement.card_shadow_color', theme.secondary),
    cardBgColor: getThemeToken(
      theme,
      'advertisement.card_bg_color',
      getThemeToken(theme, 'advertisement.bg_color', surfaceColor)
    ),
    cardBgOpacity: Number(
      getThemeToken(
        theme,
        'advertisement.card_bg_opacity',
        getThemeToken(theme, 'advertisement.bg_opacity', 0.93)
      )
    ),
    badgeBgColor: getThemeToken(theme, 'advertisement.badge_bg_color', theme.accent),
    badgeTextColor: getThemeToken(theme, 'advertisement.badge_text_color', theme.primary),
    badgeDotColor: getThemeToken(theme, 'advertisement.badge_dot_color', theme.primary),
    patternColor: getThemeToken(theme, 'advertisement.pattern_color', theme.accentBg),
    glowColor1: getThemeToken(theme, 'advertisement.glow_color_1', theme.primary),
    glowColor2: getThemeToken(theme, 'advertisement.glow_color_2', theme.secondary),
    photoRingColor1: getThemeToken(theme, 'advertisement.photo_ring_color_1', theme.primary),
    photoRingColor2: getThemeToken(theme, 'advertisement.photo_ring_color_2', theme.secondary),
    indicatorActive1: getThemeToken(theme, 'advertisement.indicator_active_color_1', theme.primary),
    indicatorActive2: getThemeToken(theme, 'advertisement.indicator_active_color_2', theme.secondary),
    indicatorInactive: getThemeToken(theme, 'advertisement.indicator_inactive_color', applyOpacity(theme.primary, 0.21)),
    emptyTextColor: getThemeToken(theme, 'advertisement.empty_text_color', mutedTextColor),
    skeletonColor: getThemeToken(theme, 'advertisement.skeleton_color', theme.accent || 'var(--app-accent)'),
  };
  const sponsorBgColor1 = sponsorTheme.bgColor1;
  const sponsorBgColor2 = sponsorTheme.bgColor2 || sponsorBgColor1;
  const sponsorOverlayBackground = sponsorTheme.gradientType === 'none'
    ? applyOpacity(sponsorBgColor1, sponsorTheme.bgOpacity)
    : `linear-gradient(${Number.isFinite(sponsorTheme.gradientAngle) ? sponsorTheme.gradientAngle : 135}deg, ${applyOpacity(sponsorBgColor1, sponsorTheme.bgOpacity)} 0%, ${applyOpacity(sponsorBgColor2, sponsorTheme.bgOpacity)} 100%)`;
  const animationMap = {
    none: 'none',
    fadeIn: 'themeFadeIn 360ms ease-out both',
    fadeUp: 'themeFadeUp 420ms ease-out both',
    slideUp: 'themeFadeUp 420ms ease-out both',
    fadeSlideDown: 'themeFadeSlideDown 420ms ease-out both',
    zoomIn: 'themeZoomIn 420ms ease-out both'
  };
  const resolveAnimation = (slotName, fallbackName = 'fadeUp') => {
    const preferred = String(theme?.animations?.[slotName] || '').trim();
    if (animationMap[preferred]) return animationMap[preferred];
    return animationMap[fallbackName] || 'none';
  };
  const resolvedHomeLayout = useMemo(() => {
    const stableDefaultOrder = ['trustList', 'sponsors', 'marquee', 'gallery', 'quickActions'];
    const configuredLayout = normalizeHomeLayout(theme?.homeLayout, stableDefaultOrder);
    const mergedLayout = [...configuredLayout];

    stableDefaultOrder.forEach((sectionKey) => {
      if (!mergedLayout.includes(sectionKey)) {
        mergedLayout.push(sectionKey);
      }
    });

    return mergedLayout;
  }, [theme?.homeLayout]);

  return (
    <div
      ref={mainContainerRef}
      className={`flex flex-col relative ${isMenuOpen ? 'overflow-hidden max-h-screen' : 'overflow-hidden'}`}
      style={{ background: 'var(--page-bg, var(--app-page-bg))', minHeight: '100%' }}
    >
      {/* Decorative blobs (theme-aware) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: '-110px',
          left: '-120px',
          width: '320px',
          height: '320px',
          borderRadius: '9999px',
          background: `radial-gradient(circle, ${applyOpacity(theme.primary, 0.12)} 0%, transparent 70%)`,
          animation: 'homeFloat1 7s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          bottom: '-140px',
          right: '-110px',
          width: '360px',
          height: '360px',
          borderRadius: '9999px',
          background: `radial-gradient(circle, ${applyOpacity(theme.secondary, 0.12)} 0%, transparent 70%)`,
          animation: 'homeFloat2 9s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: '35%',
          left: '55%',
          width: '220px',
          height: '220px',
          borderRadius: '9999px',
          background: `radial-gradient(circle, ${applyOpacity(theme.primary, 0.07)} 0%, transparent 70%)`,
          animation: 'homeFloat3 6s ease-in-out infinite',
        }}
      />

      {/* ══ Light Navbar (theme-aware) ══ */}
      <div
        role="navigation"
        className="theme-navbar sticky top-0 z-50 w-full"
        style={{
          background: 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: 'blur(var(--navbar-blur, 12px))',
          WebkitBackdropFilter: 'blur(var(--navbar-blur, 12px))',
          boxShadow: `0 2px 16px ${applyOpacity(theme.secondary, 0.13)}`,
          borderBottom: '1px solid var(--navbar-border)'
        }}
      >
        {/* Thin top accent bar */}
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />

        {/* Top row: hamburger | logo+name | bell */}
        <div
          className="flex items-center justify-between"
          style={{
            paddingTop: 'max(24px, calc(env(safe-area-inset-top, 0px) + 24px))',
            paddingBottom: '10px',
            paddingLeft: '16px',
            paddingRight: '16px',
          }}
        >

          {/* Hamburger */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all flex-shrink-0 active:scale-95"
            style={{
              background: isMenuOpen
                ? appButtonBg
                : 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
              boxShadow: isMenuOpen ? `0 4px 12px ${applyOpacity(theme.primary, 0.25)}` : 'none',
            }}
          >
            {isMenuOpen
              ? <X className="h-5 w-5" style={{ color: onPrimaryText }} />
              : <Menu className="h-[22px] w-[22px]" style={{ color: navbarTextColor }} />}
          </button>

          {/* Trust logo + name */}
          <div className="flex items-center gap-2.5 flex-1 justify-center">
            {(() => {
              const trustName = activeTrust?.name || trustInfo?.name || defaultTrust?.name || '';
              const isLongName = trustName.length > 20;
              
              return isLongName ? (
                <div className="overflow-hidden w-full flex items-center">
                  <h1
                    className="font-extrabold text-[15px] whitespace-nowrap"
                    style={{ color: navbarTextColor, animation: 'marquee 15s linear infinite', maxWidth: '9rem' }}
                  >
                    {trustName}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                  </h1>
                </div>
              ) : (
                <h1
                  className="font-extrabold text-[15px]"
                  style={{ color: navbarTextColor }}
                >
                  {trustName}
                </h1>
              );
            })()}
          </div>

          {/* Bell / placeholder */}
          <div className="flex-shrink-0">
            {ff('feature_notifications') ? (
              <div className="relative">
                <button
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className="notification-button w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95"
                  style={{
                    background: isNotificationsOpen
                      ? appButtonBg
                      : 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
                    boxShadow: isNotificationsOpen ? `0 4px 12px ${applyOpacity(theme.primary, 0.25)}` : 'none',
                  }}
                >
                  <Bell
                    className="h-[22px] w-[22px]"
                    style={{ color: isNotificationsOpen ? onPrimaryText : navbarTextColor }}
                  />
                  {unreadCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 text-[9px] font-bold h-[18px] w-[18px] flex items-center justify-center rounded-full border-2"
                      style={{ background: theme.primary, color: onPrimaryText, borderColor: surfaceColor }}
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {isNotificationsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[9998]"
                      style={{ background: 'rgba(10, 16, 30, 0.12)' }}
                      onClick={() => setIsNotificationsOpen(false)}
                      onTouchMove={(e) => e.preventDefault()}
                    />
                    <div
                      className="notification-dropdown fixed right-3 top-[72px] w-80 rounded-2xl shadow-2xl z-[9999] overflow-hidden"
                      style={{
                        border: `1px solid ${applyOpacity(theme.primary, 0.12)}`,
                        background: 'var(--surface-color)'
                      }}
                    >
                      <div className="p-4 flex items-center justify-between"
                        style={{
                          borderBottom: '1px solid var(--navbar-border)',
                          background: 'var(--navbar-bg, var(--app-navbar-bg))'
                        }}>
                        <h3 className="font-bold text-sm" style={{ color: navbarTextColor }}>Notifications ({notifications.length})</h3>
                        <div className="flex items-center gap-3">
                          {unreadCount > 0 && (
                            <button onClick={handleMarkAllAsRead} className="text-xs font-bold" style={{ color: navbarTextColor }}>Mark all read</button>
                          )}
                          {notifications.length > 0 && (
                            <button onClick={handleClearAll} className="flex items-center gap-1 text-xs font-bold" style={{ color: navbarTextColor }}>
                              <Trash2 className="w-3.5 h-3.5" /> Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="notification-list-scroll max-h-[360px] overflow-y-auto">
                        {isNotificationsLoading ? (
                          <div className="p-8 text-center">
                            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-current opacity-30 animate-spin" style={{ color: navbarTextColor }} />
                            <p className="text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>
                              Loading notifications...
                            </p>
                          </div>
                        ) : notifications.length > 0 ? (
                          notifications.slice(0, 4).map((notification) => (
                          <div key={notification.id}
                            className="px-4 py-3 relative cursor-pointer transition-colors"
                            style={{
                              borderBottom: `1px solid ${subtleBorderColor}`,
                              background: notification.is_read
                                ? 'color-mix(in srgb, var(--surface-color) 90%, var(--app-accent-bg))'
                                : `color-mix(in srgb, ${theme.primary} 9%, var(--surface-color))`
                            }}
                          >
                            <div
                              className="rounded-xl px-2.5 py-2 transition-colors"
                              style={{
                                background: notification.is_read
                                  ? 'transparent'
                                  : `color-mix(in srgb, ${theme.primary} 7%, transparent)`
                              }}
                              onClick={() => { handleMarkAsRead(notification.id); sessionStorage.setItem('initialNotification', JSON.stringify(notification)); setIsNotificationsOpen(false); onNavigate('notifications'); }}
                            >
                              {!notification.is_read && <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: theme.primary }} />}
                              <h4
                                className={`text-[15px] font-bold mb-1 leading-snug ${!notification.is_read ? 'pl-3' : ''}`}
                                style={{ color: 'var(--heading-color)' }}
                              >
                                {formatNotificationTitle(notification.title, notification.message)}
                              </h4>
                              <p className="text-[13px] leading-relaxed mb-2" style={{ color: 'var(--body-text-color)' }}>
                                {formatNotificationMessage(notification.message)}
                              </p>
                              <span className="inline-block text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 72%, var(--surface-color))', background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))' }}>
                                {new Date(notification.created_at).toLocaleDateString()} at {new Date(notification.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDismissNotification(notification.id); }}
                              className="absolute top-2.5 right-2.5 p-1 rounded-full transition-colors"
                              style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          ))
                        ) : (
                          <div className="p-8 text-center">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: theme.accent }}>
                              <Bell className="h-5 w-5" style={{ color: navbarTextColor }} />
                            </div>
                            <p className="text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>
                              No notifications yet
                            </p>
                          </div>
                        )}
                      </div>
                      {notifications.length > 0 && (
                        <div className="p-3 text-center" style={{ borderTop: `1px solid ${subtleBorderColor}`, background: subtleSurfaceColor }}>
                          <button onClick={() => { setIsNotificationsOpen(false); onNavigate('notifications'); }}
                            className="text-xs font-bold" style={{ color: navbarTextColor }}>
                            View all {notifications.length} →
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : <div className="w-9" />}
          </div>
        </div>

        {/* Welcome strip / member banner */}
        {(userProfile?.name || showSelectedTrustMemberBanner) && (
          <div className="px-4 pb-3">
            <div
              className="rounded-[22px] px-3 py-2"
              style={{
                background: showSelectedTrustMemberBanner
                  ? 'linear-gradient(135deg, #121212 0%, #1b1b1b 55%, #2a2a2a 100%)'
                  : `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.6)}, ${theme.accentBg})`,
                border: `1px solid ${showSelectedTrustMemberBanner ? 'rgba(212, 160, 23, 0.5)' : applyOpacity(theme.primary, 0.08)}`,
                boxShadow: showSelectedTrustMemberBanner
                  ? '0 14px 32px rgba(212, 160, 23, 0.18)'
                  : 'none',
              }}
            >
              <div className="flex items-center gap-2 min-w-0 justify-between">
                <div className='flex gap-2'>
                {userProfile?.profilePhotoUrl ? (
                  <img
                    src={userProfile.profilePhotoUrl}
                    alt={userProfile.name}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    style={{ border: `1.5px solid ${showSelectedTrustMemberBanner ? '#d4a017' : theme.primary}` }}
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                    style={{
                      background: showSelectedTrustMemberBanner
                        ? 'linear-gradient(135deg, #7c5a00 0%, #d4a017 100%)'
                        : appButtonBg,
                      color: showSelectedTrustMemberBanner ? '#fffdf5' : onPrimaryText,
                    
                    }}
                  >
                    {(userProfile?.name || currentUser?.name || 'M').charAt(0).toUpperCase()}
                  </div>
                )}

                <div >
                <div className="min-w-0 flex-1">
                  {userProfile?.name ? (
                    <div className="flex items-center min-w-0">
                      <p className="text-[14px] font-semibold truncate leading-snug relative top-[3px]" style={{ color: showSelectedTrustMemberBanner ? '#f8f0c5' : headingColor }}>
                        <span className="font-extrabold">{userProfile.name}</span>
                      </p>
                    </div>
                  ) : null}
                </div>
                <div>
                  {showSelectedTrustMemberBanner && selectedTrustMembership?.role ? (
                  <span
                    className="inline-flex items-center  text-[10px] uppercase tracking-[0.1em] flex-shrink-0"
                    style={{
                      // background: 'linear-gradient(135deg, #5a3f00 0%, #d4a017 100%)',
                      color: '#fff8db',
                      // border: '1px solid rgba(255, 227, 133, 0.5)',
                    }}
                  >
                    {/* <Crown className="h-3.5 w-3.5 flex-shrink-0" /> */}
                    <span className="truncate">{selectedTrustMembership.role}</span>
                  </span>
                ) : null}
                  </div>
                </div>
                </div>
                <div>
                {showSelectedTrustMemberBanner && selectedTrustMembership?.membership_number ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em]  flex-shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #5a3f00 0%, #d4a017 100%)',
                      color: '#fff8db',
                      border: '1px solid rgba(255, 227, 133, 0.5)',
                    }}
                  >
                    <Crown className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{selectedTrustMembership.membership_number}</span>
                  </span>
                ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>


      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="home" onLogout={onLogout} />

      {/* ── Dynamic Section Renderer (order from theme.homeLayout) ── */}
      <div
        aria-hidden={isNotificationsOpen}
        style={{
          pointerEvents: isNotificationsOpen ? 'none' : 'auto',
          userSelect: isNotificationsOpen ? 'none' : 'auto'
        }}
      >
      
        {(() => {
          const SECTIONS = {
            trustList: showTrustSelector && (selectedTrust || otherTrusts.length > 0) ? (
              <div key="trustList">
                <p className="text-sm font-semibold text-muted-foreground ml-4 mt-1" style={{color: ` ${theme.primary}`}}>Our trusts</p>
                <div
                  className="flex items-center gap-2 px-4 py-2"
                  style={{
                    animation: resolveAnimation('trustList', 'cards'),
                  }}
                >
                  {selectedTrust ? (
                    <div className="flex-shrink-0">
                      {renderTrustChip(selectedTrust)}
                    </div>
                  ) : null}
                  {otherTrusts.length > 0 ? (
                    <div
                      className="flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain py-2 pl-2"
                      style={{
                        scrollbarWidth: 'none',
                        background: 'transparent',
                        borderBottom: 'none',
                        scrollBehavior: 'smooth'
                      }}
                      ref={trustListScrollRef}
                    >
                      {otherTrusts.map((trust) => renderTrustChip(trust))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null,
            marquee: ff('feature_marquee') && marqueeUpdates.length > 0 ? (
              <div
                className="mt-0 mb-2 w-full overflow-hidden"
                style={{
                  background: 'var(--marquee-bg)',
                  boxShadow: `0 2px 12px ${applyOpacity(theme.primary, 0.3)}`,
                  animation: resolveAnimation('marquee', 'cards')
                }}
                key="marquee"
              >
                <div className="flex items-stretch">
                  <div className="flex-shrink-0 px-3 flex items-center gap-2" style={{ background: `color-mix(in srgb, ${theme.secondary} 28%, transparent)` }}>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-70" style={{ background: 'var(--marquee-text)' }} />
                      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--marquee-text)' }} />
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--marquee-text)' }}>
                      {flagsData?.feature_marquee?.display_name || 'Updates'}
                    </span>
                  </div>
                  <div className="w-px my-1.5" style={{ background: 'color-mix(in srgb, var(--marquee-text) 30%, transparent)' }} />
                  <div className="overflow-hidden flex-1 py-2">
                    <div className="marquee-track flex">
                      {[...marqueeUpdates, ...marqueeUpdates].map((msg, i) => (
                        <span key={i} className="whitespace-nowrap text-xs font-semibold px-6" style={{ color: 'var(--marquee-text)' }}>⭐ {msg}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null,
            gallery: ff('feature_gallery') ? (
              <div className="relative px-4 mt-5 mb-3" style={{ animation: resolveAnimation('gallery', 'zoomIn') }} key="gallery">
                <div className="pointer-events-none absolute -top-1.5 left-7 z-20 ">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] relative top-[12px]  flex-shrink-0"
                    style={{
                      color: onPrimaryText,
                      background: `linear-gradient(135deg, ${applyOpacity(theme.primary, 0.94)}, ${applyOpacity(theme.secondary, 0.88)})`,
                      border: `1px solid ${applyOpacity(theme.secondary, 0.42)}`,
                      boxShadow: `0 10px 22px ${applyOpacity(theme.primary, 0.34)}, 0 2px 6px ${applyOpacity(theme.secondary, 0.18)}`,
                      backdropFilter: 'blur(10px)',
                      textShadow: '0 1px 2px rgba(0, 0, 0, 0.18)',
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: onPrimaryText }} />
                    Gallery
                  </span>
                </div>

                <div
                  className="rounded-3xl overflow-hidden"
                  style={{
                    boxShadow: `0 10px 32px ${applyOpacity(theme.secondary, 0.16)}, 0 2px 8px ${applyOpacity(theme.primary, 0.08)}`,
                    border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
                  }}
                >
                  <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})` }} />
                  {showGalleryLoader ? (
                    <div className="w-full h-[200px] flex items-center justify-center" style={{ background: theme.accentBg }}>
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: theme.primary, borderTopColor: 'transparent' }} />
                        <p className="text-xs font-medium" style={{ color: theme.secondary }}>Loading gallery...</p>
                      </div>
                    </div>
                  ) : carouselImages.length > 0 ? (
                    <ImageSlider images={carouselImages} onNavigate={onNavigate} />
                  ) : (
                    <button
                      onClick={() => onNavigate('gallery')}
                      className="w-full h-[200px] flex flex-col items-center justify-center gap-3"
                      style={{
                        background: 'color-mix(in srgb, var(--app-page-bg) 80%, var(--surface-color))'
                      }}
                    >
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentBg})` }}
                      >
                        <Image className="h-7 w-7" style={{ color: theme.primary }} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-center" style={{ color: theme.secondary }}>
                          {(activeTrust?.name || defaultTrust?.name || DEFAULT_TRUST_NAME)} Gallery
                        </p>
                        <p
                          className="text-xs text-center mt-0.5"
                          style={{ color: 'color-mix(in srgb, var(--body-text-color) 72%, var(--surface-color))' }}
                        >
                          {galleryError || 'Tap to open gallery'}
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            ) : null,

            quickActions: enabledQuickActions.length > 0 ? (
              <div className="px-4 mt-5 mb-4" style={{ animation: resolveAnimation('quickActions', 'cards') }} key="quickActions">
                <div className="grid grid-cols-2 gap-3">
                  {enabledQuickActions.map((action) => {
                    return (
                      <button
                        key={action.id}
                        onClick={() => onNavigate(action.route)}
                        className="rounded-2xl text-left transition-all active:scale-[0.97] duration-150"
                        style={{
                          background: quickActionsBg,
                          border: `1px solid color-mix(in srgb, ${quickActionsText} 22%, transparent)`,
                          boxShadow: `0 4px 16px color-mix(in srgb, ${quickActionsText} 14%, transparent), 0 1px 4px color-mix(in srgb, ${quickActionsText} 10%, transparent)`,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          className="h-[4px]"
                          style={{ background: `linear-gradient(90deg, ${quickActionsText} 0%, color-mix(in srgb, ${quickActionsText} 60%, var(--surface-color)) 100%)` }}
                        />
                        <div className="p-3.5">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center mb-2.5"
                            style={{
                              background: quickActionsIconBg,
                              border: `1px solid color-mix(in srgb, ${quickActionsText} 20%, transparent)`,
                            }}
                          >
                            <img
                              src={action.icon_url}
                              alt={action.displayName}
                              className="h-[18px] w-[18px] object-contain"
                            />
                          </div>
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <h3 className="text-[12px] font-extrabold leading-snug" style={{ color: quickActionsText }}>
                                {action.displayName}
                              </h3>
                              <p className="text-[10px] font-medium mt-0.5 leading-snug" style={{ color: `color-mix(in srgb, ${quickActionsText} 80%, var(--surface-color))` }}>
                                {action.tagline}
                              </p>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: `color-mix(in srgb, ${quickActionsText} 72%, transparent)` }} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null,

            sponsors: ff('feature_sponsors') ? (
              <div className="px-4 mt-5 mb-4" style={{ animation: resolveAnimation('sponsors', 'cards') }} key="sponsors">
                {sponsors.length > 0 ? (
                  <div className="relative">
                    <div
                      className="relative overflow-hidden rounded-3xl"
                      onTouchStart={handleSponsorTouchStart}
                      onTouchMove={handleSponsorTouchMove}
                      onTouchEnd={handleSponsorTouchEnd}
                    >
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: sponsorOverlayBackground,
                        }}
                      />
                      <div className="relative min-h-[196px]">
                        {visibleSponsors.map((sponsor, idx) => {
                          if (!sponsor?.id) return null;
                          const isActive = idx === activeVisibleSponsorIndex;
                          return (
                            <button
                              key={sponsor.id}
                              onClick={() => {
                                console.log(`[Sponsor] clicked sponsor.id=${sponsor.id}`);
                                setSelectedSponsorId(sponsor.id);
                                setPinnedSponsor(currentSponsorTrustId, sponsor.id);
                                onNavigate('sponsors');
                              }}
                              className={`absolute inset-0 w-full text-left transition-all duration-700 ease-out ${isActive ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-1 scale-[0.99] pointer-events-none'}`}
                              aria-hidden={!isActive}
                              tabIndex={isActive ? 0 : -1}
                            >
                              <div
                                className="relative rounded-3xl p-[1px] h-full overflow-hidden"
                                style={{
                                  background: `linear-gradient(130deg, ${sponsorTheme.borderColor1}44 0%, ${sponsorTheme.borderColor2}33 40%, ${sponsorTheme.borderColor1}2E 100%)`,
                                  boxShadow: `0 12px 28px ${sponsorTheme.shadowColor}1F`,
                                }}
                              >
                                <div
                                  className="relative rounded-3xl p-5 flex items-center gap-4 h-full overflow-hidden"
                                  style={{
                                    background: applyOpacity(sponsorTheme.cardBgColor, sponsorTheme.cardBgOpacity),
                                    backdropFilter: 'blur(8px)',
                                  }}
                                >
                                  <div
                                    className="absolute inset-0 pointer-events-none opacity-45"
                                    style={{
                                      background: `repeating-linear-gradient(135deg, transparent 0 13px, ${sponsorTheme.patternColor}44 13px 14px)`,
                                    }}
                                  />
                                  <div
                                    className="absolute -top-10 -right-10 h-24 w-24 rounded-full pointer-events-none"
                                    style={{ background: `radial-gradient(circle, ${sponsorTheme.glowColor1}66 0%, transparent 70%)` }}
                                  />
                                  <div
                                    className="absolute -bottom-10 -left-8 h-20 w-20 rounded-full pointer-events-none"
                                    style={{ background: `radial-gradient(circle, ${sponsorTheme.glowColor2}4A 0%, transparent 75%)` }}
                                  />

                                  <div className="w-20 h-20 rounded-[1.2rem] p-[2px] flex-shrink-0 z-10" style={{ background: `linear-gradient(145deg, ${sponsorTheme.photoRingColor1}55, ${sponsorTheme.photoRingColor2}44)` }}>
                                    <div
                                      className="w-full h-full rounded-[1rem] flex items-center justify-center overflow-hidden"
                                      style={{
                                        background: surfaceColor,
                                        boxShadow: `0 6px 16px ${sponsorTheme.photoRingColor1}1A`,
                                      }}
                                    >
                                      {(sponsor.photo_url || sponsor.photo_thumb_url)
                                        ? <img src={sponsor.photo_url || sponsor.photo_thumb_url} alt={sponsor.name || sponsor.company_name} className="w-full h-full object-cover" style={{ objectPosition: '50% 20%' }} loading="lazy" decoding="async" />
                                        : <Star className="h-6 w-6" style={{ color: sponsorTheme.textColor }} />}
                                    </div>
                                  </div>

                                  <div className="flex-1 min-w-0 z-10">
                                    <div className="mb-1.5">
                                      <div
                                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
                                        style={{ background: sponsorTheme.badgeBgColor, border: `1px solid ${sponsorTheme.badgeTextColor}30`, boxShadow: `0 1px 5px ${sponsorTheme.badgeTextColor}12` }}
                                      >
                                        <span className="w-2 h-2 rounded-full inline-block animate-pulse" style={{ background: sponsorTheme.badgeDotColor }} />
                                        <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: sponsorTheme.badgeTextColor }}>
                                          {sponsor.badge_label || 'Official Sponsor'}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="text-[20px] font-extrabold leading-snug truncate" style={{ color: sponsorTheme.titleColor }}>
                                      {sponsor.name || sponsor.company_name}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 min-w-0">
                                      <Building2 className="h-4 w-4 flex-shrink-0" style={{ color: sponsorTheme.subtitleColor }} />
                                      <p className="text-[14px] font-bold truncate tracking-wide" style={{ color: sponsorTheme.subtitleColor }}>
                                        {sponsor.company_name || sponsor.position || 'Community partner'}
                                      </p>
                                    </div>

                                    <p className="text-[13px] font-medium mt-2 line-clamp-3 leading-relaxed" style={{ color: sponsorTheme.descriptionColor }}>
                                      {sponsor.shortText || 'Supporting our community with care and commitment.'}
                                    </p>
                                  </div>

                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {sponsors.length > 1 && (
                      <div className="flex justify-center items-center gap-1.5 mt-2">
                        {visibleSponsors.map((_, idx) => {
                          const globalIndex = sponsorChunkStart + idx;
                          const isActive = globalIndex === sponsorIndex;
                          return (
                            <span
                              key={`sponsor-indicator-${globalIndex}`}
                              className="h-1.5 rounded-full transition-all duration-300"
                              style={{
                                width: isActive ? 16 : 6,
                                background: isActive ? `linear-gradient(90deg, ${sponsorTheme.indicatorActive1}, ${sponsorTheme.indicatorActive2})` : sponsorTheme.indicatorInactive,
                                boxShadow: isActive ? `0 1px 5px ${sponsorTheme.indicatorActive1}38` : 'none',
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : isSponsorSectionLoading ? (
                  <div
                    className="relative overflow-hidden rounded-3xl"
                    style={{
                      boxShadow: `0 8px 24px ${applyOpacity(theme.secondary, 0.07)}`
                    }}
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: sponsorOverlayBackground,
                      }}
                    />
                    <div
                      className="relative rounded-3xl p-[1px]"
                      style={{
                        background: `linear-gradient(130deg, ${sponsorTheme.borderColor1}44 0%, ${sponsorTheme.borderColor2}33 40%, ${sponsorTheme.borderColor1}2E 100%)`,
                      }}
                    >
                      <div
                        className="relative rounded-3xl p-4 min-h-[168px] overflow-hidden"
                        style={{
                          background: applyOpacity(sponsorTheme.cardBgColor, sponsorTheme.cardBgOpacity),
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <div
                          className="absolute inset-0 pointer-events-none opacity-45"
                          style={{
                            background: `repeating-linear-gradient(135deg, transparent 0 13px, ${sponsorTheme.patternColor}44 13px 14px)`,
                          }}
                        />
                        <div className="relative z-10 h-full flex items-center gap-4">
                          <div className="w-20 h-20 rounded-[1.2rem] animate-pulse flex-shrink-0" style={{ background: sponsorTheme.skeletonColor }} />
                          <div className="flex-1 min-w-0 space-y-2.5">
                            {sponsorSkeletonRows.map((row) => (
                              <div
                                key={`sponsor-skeleton-${row}`}
                                className={`rounded-full animate-pulse ${row === 1 ? 'h-6 w-52' : row === 2 ? 'h-4 w-40' : 'h-4 w-32'}`}
                                style={{ background: sponsorTheme.skeletonColor }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="relative overflow-hidden rounded-3xl"
                    style={{
                      boxShadow: `0 8px 24px ${applyOpacity(theme.secondary, 0.07)}`
                    }}
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: sponsorOverlayBackground,
                      }}
                    />
                    <div
                      className="relative rounded-3xl p-[1px]"
                      style={{
                        background: `linear-gradient(130deg, ${sponsorTheme.borderColor1}44 0%, ${sponsorTheme.borderColor2}33 40%, ${sponsorTheme.borderColor1}2E 100%)`,
                      }}
                    >
                      <div
                        className="relative rounded-3xl p-4 min-h-[168px] overflow-hidden"
                        style={{
                          background: applyOpacity(sponsorTheme.cardBgColor, sponsorTheme.cardBgOpacity),
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <div
                          className="absolute inset-0 pointer-events-none opacity-45"
                          style={{
                            background: `repeating-linear-gradient(135deg, transparent 0 13px, ${sponsorTheme.patternColor}44 13px 14px)`,
                          }}
                        />
                        <div className="relative z-10 h-full flex items-center gap-4">
                          <div className="w-20 h-20 rounded-[1.2rem] flex items-center justify-center flex-shrink-0" style={{ background: sponsorTheme.skeletonColor }}>
                            <Star className="h-6 w-6" style={{ color: sponsorTheme.badgeTextColor }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold" style={{ color: sponsorTheme.emptyTextColor }}>
                              No active sponsors available right now.
                            </p>
                            {!sponsors.length && import.meta.env.DEV && sponsorEmptyDebugReason && (
                              <p className="text-[11px] mt-1 font-medium break-words" style={{ color: getThemeToken(theme, 'typography.component_overrides.error_text', theme.primary) }}>
                                Debug: {sponsorEmptyDebugReason}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            ) : null,
          };

          return resolvedHomeLayout.map((key) => {
            if (key === 'trustList' && !showTrustSelector) return null;
            return SECTIONS[key] || null;
          });
        })()}
      </div>



      <style>{`
        .marquee-track {
          display: flex;
          animation: marquee-scroll 30s linear infinite;
          width: max-content;
        }
        @keyframes marquee-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        @keyframes themeFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes themeFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes themeFadeSlideDown {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes themeZoomIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }

        /* Decorative home blobs animations */
        @keyframes homeFloat1 {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-18px) scale(1.04); }
        }
        @keyframes homeFloat2 {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(14px) scale(0.97); }
        }
        @keyframes homeFloat3 {
          0%, 100% { transform: translateX(0px); }
          50% { transform: translateX(12px); }
        }

        @keyframes trustChipMoveToFront {
          0% {
            transform: translateX(14px) scale(0.92);
            opacity: 0.72;
            box-shadow: 0 0 0 rgba(0, 0, 0, 0);
          }
          55% {
            transform: translateX(-6px) scale(1.11);
            opacity: 1;
            box-shadow: 0 14px 28px color-mix(in srgb, var(--brand-navy) 26%, transparent);
          }
          100% {
            transform: translateX(0) scale(1.05);
            opacity: 1;
            box-shadow: 0 4px 12px color-mix(in srgb, var(--brand-navy) 22%, transparent);
          }
        }

        @keyframes trustChipUnreadPulse {
          0%, 100% {
            border-color: var(--trust-ring-color);
            box-shadow:
              0 0 0 0 color-mix(in srgb, var(--trust-ring-glow) 0%, transparent),
              0 4px 12px color-mix(in srgb, var(--brand-navy) 22%, transparent);
          }
          50% {
            border-color: color-mix(in srgb, var(--trust-ring-color) 68%, var(--surface-color));
            box-shadow:
              0 0 0 7px color-mix(in srgb, var(--trust-ring-glow) 28%, transparent),
              0 8px 18px color-mix(in srgb, var(--trust-ring-glow) 32%, transparent);
          }
        }

        /* Hide scrollbar on home page content */
        .home-scroll::-webkit-scrollbar { display: none; }
        .home-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        .notification-list-scroll::-webkit-scrollbar { display: none; }
        .notification-list-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ── Footer ── */}
      <footer
        className="mt-auto py-3 px-6"
        style={{
          borderTop: '1px solid var(--footer-border)',
          background: 'var(--footer-bg)',
          color: 'var(--footer-text)'
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <div className="w-8 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--footer-accent))' }} />
          <a
            href={footerShareLink}
            className="text-[11px] font-medium transition-colors no-underline hover:opacity-90"
            style={{ color: 'var(--footer-text)' }}
          >
            Powered by Developers
          </a>
          <div className="w-8 h-px" style={{ background: 'linear-gradient(to left, transparent, var(--footer-accent))' }} />
        </div>
        <p className="text-[11px] font-semibold text-center mt-2 opacity-80">App Version {displayTrustVersion}</p>
      </footer>
      <TermsModal
        isOpen={showTermsModal}
        onAccept={handleAcceptTerms}
        content={termsModalContent}
        trustName={termsModalTrustName}
        loading={termsModalLoading}
        error={termsModalError}
      />
    </div>
  );
};

export default Home;




















