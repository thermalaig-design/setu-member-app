import { track } from '../../services/analytics';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { Users, ChevronRight, LogOut, Share2, PhoneCall, FileText, CirclePlus, Clock3, Lock, ShoppingBag } from 'lucide-react';
import { FaFacebookF, FaInstagram, FaLinkedinIn, FaWhatsapp, FaYoutube } from 'react-icons/fa';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { getProfile, updateMemberPrivacy } from '../../services/api';
import { fetchFeatureFlags, isFeatureVisible } from '../../services/featureFlags';
import { buildShareAppLinksFromMembership, getStoredMembershipForTrust } from '../../utils/trustMembershipLinks';
import { logUserSessionEvent } from '../../services/sessionAuditService';
import { unregisterPushToken } from '../../services/pushNotificationService';
import { trackAction } from '../../services/pageTrackingService';
import { useTrustDataVersion } from '../../hooks/useTrustDataVersion';
import { useAppTheme } from '../../context/ThemeContext';
import { applyOpacity } from '../../utils/colorUtils';
import { getThemeToken } from '../../utils/themeUtils';
import { getShareAppTargetLink } from '../../utils/shareApp';
import { resolveSelectedTrustMembership } from '../../utils/storageUtils';
import { MEMBER_PRIVACY_UPDATED_EVENT } from '../../utils/memberIdentity';
import { resolveAssetUrl } from '../../utils/assetUrl';

const normalizeSidebarRoute = (route = '', featureKey = '') => {
  const routeValue = String(route || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/_/g, '-');
  const featureValue = String(featureKey || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  if (routeValue === 'contact-us' || routeValue === 'contactus') return 'contact-us';
  if (featureValue === 'contactus' || featureValue === 'contact-us' || featureValue === 'feature-contact-us' || featureValue === 'feature_contact_us') return 'contact-us';
  if (routeValue === 'my-family' || routeValue === 'myfamily') return 'my-family';
  if (featureValue === 'myfamily' || featureValue === 'my-family' || featureValue === 'feature-my-family' || featureValue === 'feature_my_family') return 'my-family';
  if (routeValue === 'nomination-details' || routeValue === 'nominationdetails') return 'nomination-details';
  if (featureValue === 'nominationdetails' || featureValue === 'nomination-details' || featureValue === 'feature-nomination-details' || featureValue === 'feature_nomination_details') return 'nomination-details';
  if (routeValue === 'add-community' || routeValue === 'addcommunity') return 'add-community';
  if (featureValue === 'addcommunity' || featureValue === 'add-community' || featureValue === 'feature-add-community' || featureValue === 'feature_add_community') return 'add-community';
  if (routeValue === 'order-history' || routeValue === 'orderhistory') return 'order-history';
  if (featureValue === 'orderhistory' || featureValue === 'order-history' || featureValue === 'feature-order-history' || featureValue === 'feature_order_history') return 'order-history';
  if (routeValue === 'products' || routeValue === 'product' || routeValue === 'categories-products') return 'products';
  if (featureValue === 'product' || featureValue === 'products' || featureValue === 'feature-product' || featureValue === 'feature-products') return 'products';
  return routeValue;
};

const resolveSidebarIcon = (featureKey, route) => {
  const normalizedRoute = normalizeSidebarRoute(route, featureKey);
  if (normalizedRoute === 'contact-us') return PhoneCall;
  if (normalizedRoute === 'my-family') return Users;
  if (normalizedRoute === 'nomination-details') return FileText;
  if (normalizedRoute === 'add-community') return CirclePlus;
  if (normalizedRoute === 'order-history') return Clock3;
  if (normalizedRoute === 'products') return ShoppingBag;
  return FileText;
};

// Same per-route icon files the Home quick-access tiles use, so both places match.
const SIDEBAR_ICON_URL_BY_ROUTE = {
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
  products: '/icons/quick-access/products.svg',
  'order-history': '/icons/quick-access/order-history.svg',
  'add-community': '/icons/quick-access/directory.svg',
  'user-panel': '/icons/quick-access/directory.svg',
};
const SIDEBAR_LUCIDE_ONLY_ROUTES = new Set(['contact-us', 'my-family', 'nomination-details']);

const resolveSidebarIconUrl = (route, explicitIcon) => {
  const icon = String(explicitIcon || '').trim();
  if (icon) return icon;
  if (SIDEBAR_ICON_URL_BY_ROUTE[route]) return SIDEBAR_ICON_URL_BY_ROUTE[route];
  return SIDEBAR_LUCIDE_ONLY_ROUTES.has(route) ? '' : '/icons/quick-access/directory.svg';
};

// Menu icon: the feature's icon file masked in the given colour (as on Home tiles),
// falling back to a lucide glyph when there is no file or it fails to load.
const SidebarFeatureIcon = ({ iconUrl, Fallback, color }) => {
  const [failed, setFailed] = useState(false);
  const src = resolveAssetUrl(iconUrl);
  if (!src || failed) {
    return React.createElement(Fallback, { className: 'h-5 w-5 flex-shrink-0', style: { color } });
  }
  const mask = `url("${src}") center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-hidden="true"
      className="relative inline-block h-5 w-5 flex-shrink-0"
      style={{ backgroundColor: color, WebkitMask: mask, mask }}
    >
      <img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full opacity-0" onError={() => setFailed(true)} />
    </span>
  );
};

// WhatsApp-style placeholder: round avatar with a person silhouette.
const AvatarPlaceholder = ({ color }) => (
  <svg viewBox="0 0 56 56" className="h-full w-full" aria-hidden="true">
    <circle cx="28" cy="21" r="9.5" fill={color} />
    <path d="M9 56c0-12 8.5-20 19-20s19 8 19 20z" fill={color} />
  </svg>
);

const SIDEBAR_OPEN_MS = 380;
const SIDEBAR_CLOSE_MS = 260;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const normalizeDisplayInApp = (value) => String(value || 'home').trim().toLowerCase();

const toTitleCase = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

const sanitizeMemberName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  const blockedNames = new Set([
    'aaaaa',
    'gau grass',
    'guest user',
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

const resolveNameValue = (...candidates) => {
  for (const candidate of candidates) {
    const cleaned = sanitizeMemberName(candidate);
    if (cleaned) return cleaned;
  }
  return '';
};

const resolveMemberRoleValue = (...candidates) => {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const lowered = value.toLowerCase();
    if (['n/a', 'na', 'null', 'undefined'].includes(lowered)) continue;
    return value;
  }
  return 'Member';
};

const resolveMembershipNumberValue = (...candidates) => {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const lowered = value.toLowerCase();
    if (['n/a', 'na', 'null', 'undefined'].includes(lowered)) continue;
    return value;
  }
  return '';
};

const resolvePhotoUrl = (...candidates) => {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
};

const parseTimestamp = (value) => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

const getCachedSidebarProfile = () => {
  try {
    const user = localStorage.getItem('user');
    if (!user) return null;
    const parsedUser = JSON.parse(user);
    const key = `userProfile_${parsedUser.Mobile || parsedUser.mobile || parsedUser.id || 'default'}`;
    const saved = localStorage.getItem(key);
    const parsedProfile = saved ? JSON.parse(saved) : null;
    return {
      ...parsedProfile,
      name: resolveNameValue(parsedProfile?.name, parsedUser?.Name, parsedUser?.name),
      profilePhotoUrl: resolvePhotoUrl(parsedProfile?.profile_photo_url, parsedProfile?.profilePhotoUrl),
    };
  } catch {
    return null;
  }
};

// Calculate profile completion % based on filled fields
const calcCompletion = (profile, user) => {
  const fields = [
    profile?.name || user?.Name || user?.name,
    profile?.profilePhotoUrl,
    user?.Mobile || user?.mobile,
    user?.Email || user?.email,
    user?.['Company Name'] || user?.company,
    user?.['Address Home'] || user?.address,
    user?.['Membership number'] || user?.membership_number,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
};

const releaseGlobalScrollLocks = () => {
  document.documentElement.style.overflow = '';
  document.documentElement.style.position = '';
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  document.body.style.touchAction = 'auto';
};

const APP_ORG_NAME = 'Development Organization';
const APP_ORG_URL = 'https://teiltd.in';
const APP_DOWNLOAD_URL = 'https://teiltd.in/app-download';

const Sidebar = ({ isOpen, onClose, onNavigate, currentPage, onLogout }) => {
  const theme = useAppTheme();
  const primary = theme.primary || 'var(--brand-red)';
  const secondary = theme.secondary || 'var(--brand-navy)';
  const accent = theme.accent || 'var(--app-accent)';
  const sidebarTextColor = getThemeToken(theme, 'sidebar.text_color', 'var(--sidebar-text)');
  const sidebarButtonColor = getThemeToken(theme, 'sidebar.button_color', primary);
  const sidebarActiveTextColor = getThemeToken(theme, 'sidebar.active_text_color', sidebarButtonColor);
  const sidebarMutedTextColor = getThemeToken(
    theme,
    'sidebar.muted_text_color',
    sidebarTextColor
  );
  const sidebarChevronColor = getThemeToken(theme, 'sidebar.chevron_color', sidebarTextColor);
  const sidebarDividerColor = getThemeToken(theme, 'sidebar.divider_color', applyOpacity(sidebarTextColor, 0.16));
  const sidebarProgressTrackColor = getThemeToken(theme, 'sidebar.progress_track_color', applyOpacity(sidebarTextColor, 0.2));
  const sidebarBadgeBgColor = getThemeToken(theme, 'sidebar.badge_bg_color', applyOpacity(sidebarActiveTextColor, 0.16));
  // Readable text on the sidebar background: the theme's own text colour with a hint of its accent.
  const sidebarSoftTextColor = `color-mix(in srgb, ${sidebarTextColor} 90%, ${sidebarActiveTextColor})`;
  const sidebarBadgeTextColor = getThemeToken(theme, 'sidebar.badge_text_color', sidebarSoftTextColor);
  const sidebarTapHighlightColor = getThemeToken(theme, 'sidebar.tap_highlight_color', applyOpacity(sidebarActiveTextColor, 0.06));
  const sidebarToastBgColor = getThemeToken(theme, 'sidebar.toast_bg_color', secondary);
  const sidebarToastTextColor = getThemeToken(theme, 'sidebar.toast_text_color', 'var(--surface-color)');
  const sidebarOverlayBg = getThemeToken(theme, 'sidebar.overlay_bg', 'color-mix(in srgb, var(--app-page-bg) 60%, var(--surface-color))');
  const sidebarSocialButtonBg = getThemeToken(
    theme,
    'sidebar.social_button_bg',
    'color-mix(in srgb, var(--surface-color) 84%, var(--sidebar-bg))'
  );
  const sidebarSocialButtonBorder = getThemeToken(
    theme,
    'sidebar.social_button_border',
    applyOpacity(sidebarTextColor, 0.12)
  );
  const { displayTrustVersion } = useTrustDataVersion();
  const sidebarRef = useRef(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() => getCachedSidebarProfile());
  const [userData, setUserData] = useState(() => {
    try {
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  });
  const [selectedTrustId, setSelectedTrustId] = useState(() => String(localStorage.getItem('selected_trust_id') || '').trim());
  const [shareToast, setShareToast] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('');
  // Keep the panel mounted while it slides out so closing animates too.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setIsClosing(!isOpen);
  }
  const [featureFlags, setFeatureFlags] = useState({});
  const [flagsData, setFlagsData] = useState({});
  const [memberTrustLinks, setMemberTrustLinks] = useState([]);
  const [loadingTrustLinks, setLoadingTrustLinks] = useState(false);
  const [shareAppLinks, setShareAppLinks] = useState(null);
  const [privacyEnabled, setPrivacyEnabled] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const appOrgLink = APP_ORG_URL;

  // Load feature flags when sidebar opens
  useEffect(() => {
    if (!isOpen) return;
    const trustId = localStorage.getItem('selected_trust_id') || null;
    fetchFeatureFlags(trustId, { force: false }).then((result) => {
      if (result.success) {
        setFeatureFlags(result.flags || {});
        setFlagsData(result.flagsData || {});
      }
    });
  }, [isOpen, selectedTrustId]);

  const ff = (key) => isFeatureVisible(featureFlags, key);

  const openExternalLink = async (url) => {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) return;
    try {
      if (Capacitor.isNativePlatform()) {
        window.location.href = targetUrl;
        return;
      }
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleShareApp = async () => {
    try {
      const platform = Capacitor.getPlatform();
      const targetLink = getShareAppTargetLink(shareAppLinks, platform, APP_DOWNLOAD_URL);

      if (!targetLink) {
        setShareToast(true);
        window.setTimeout(() => setShareToast(false), 2500);
        return;
      }

      const sharePayload = {
        title: 'Download the app',
        text: 'Install the app from this link.',
        url: targetLink,
        dialogTitle: 'Share App',
      };

      if (Capacitor.isNativePlatform()) {
        await Share.share(sharePayload);
        return;
      }

      if (typeof navigator.share === 'function') {
        await navigator.share(sharePayload);
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(targetLink);
        setShareToast(true);
        window.setTimeout(() => setShareToast(false), 2500);
        return;
      }

      window.open(targetLink, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setShareToast(true);
      window.setTimeout(() => setShareToast(false), 2500);
    }
  };

  const socialLinks = [
    {
      key: 'instagram',
      label: 'Instagram',
      href: shareAppLinks?.instagram_link,
      icon: FaInstagram,
      color: '#E4405F'
    },
    {
      key: 'facebook',
      label: 'Facebook',
      href: shareAppLinks?.facebook_link,
      icon: FaFacebookF,
      color: '#1877F2'
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      href: shareAppLinks?.whatsapp_link,
      icon: FaWhatsapp,
      color: '#25D366'
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      href: shareAppLinks?.linkedin_link,
      icon: FaLinkedinIn,
      color: '#0A66C2'
    },
    {
      key: 'youtube',
      label: 'YouTube',
      href: shareAppLinks?.youtube_url,
      icon: FaYoutube,
      color: '#FF0000'
    }
  ].filter((item) => String(item.href || '').trim());

  // Load profile data when sidebar opens
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      try {
        const user = localStorage.getItem('user');
        const parsedUser = user ? JSON.parse(user) : null;
        setUserData(parsedUser);
        const cachedProfile = getCachedSidebarProfile();
        if (cachedProfile) setProfile(cachedProfile);

        const response = await getProfile();
        if (response.success && response.profile) {
          const responseProfile = response.profile || {};
          const profileIsStaleComparedToCache =
            parseTimestamp(cachedProfile?.updated_at || cachedProfile?.client_saved_at) >
            parseTimestamp(responseProfile?.updated_at);
          const effectiveProfile = profileIsStaleComparedToCache
            ? { ...responseProfile, ...cachedProfile }
            : responseProfile;
          const resolvedName = resolveNameValue(effectiveProfile?.name, parsedUser?.Name, parsedUser?.name);
          const profilePhotoUrl = resolvePhotoUrl(
            effectiveProfile?.profile_photo_url,
            effectiveProfile?.profilePhotoUrl,
            cachedProfile?.profile_photo_url,
            cachedProfile?.profilePhotoUrl
          );
          setProfile({
            ...effectiveProfile,
            name: resolvedName,
            profilePhotoUrl,
          });
          if (parsedUser) {
            const key = `userProfile_${parsedUser.Mobile || parsedUser.mobile || parsedUser.id || 'default'}`;
            const nextSnapshot = {
              ...(cachedProfile || {}),
              ...(effectiveProfile || {}),
              name: resolvedName,
              profile_photo_url: profilePhotoUrl,
              profilePhotoUrl
            };
            try {
              localStorage.setItem(key, JSON.stringify(nextSnapshot));
            } catch {
              // ignore cache write failures
            }
          }
        } else if (parsedUser) {
          const key = `userProfile_${parsedUser.Mobile || parsedUser.mobile || parsedUser.id || 'default'}`;
          const saved = localStorage.getItem(key);
          if (saved) {
            const parsedProfile = JSON.parse(saved);
            setProfile({
              ...parsedProfile,
              name: resolveNameValue(parsedProfile?.name, parsedUser?.Name, parsedUser?.name),
              profilePhotoUrl: resolvePhotoUrl(parsedProfile?.profile_photo_url, parsedProfile?.profilePhotoUrl),
            });
          } else {
            setProfile({ name: resolveNameValue(parsedUser?.Name, parsedUser?.name), profilePhotoUrl: '' });
          }
        }
      } catch {
        const user = localStorage.getItem('user');
        if (user) {
          const parsedUser = JSON.parse(user);
          setUserData(parsedUser);
          setProfile({ name: resolveNameValue(parsedUser?.Name, parsedUser?.name), profilePhotoUrl: '' });
        }
      }
    };
    load();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const syncSelectedTrust = (event) => {
      const nextTrustId = String(event?.detail?.trustId || localStorage.getItem('selected_trust_id') || '').trim();
      setSelectedTrustId(nextTrustId);
    };

    syncSelectedTrust();
    window.addEventListener('trust-changed', syncSelectedTrust);
    window.addEventListener('storage', syncSelectedTrust);
    return () => {
      window.removeEventListener('trust-changed', syncSelectedTrust);
      window.removeEventListener('storage', syncSelectedTrust);
    };
  }, [isOpen]);

  useEffect(() => {
    if (typeof profile?.privacy === 'boolean') {
      setPrivacyEnabled(profile.privacy);
    }
  }, [profile?.privacy]);

  useEffect(() => {
    const syncProfileFromCache = () => {
      const cachedProfile = getCachedSidebarProfile();
      if (cachedProfile) setProfile(cachedProfile);
      try {
        const user = localStorage.getItem('user');
        setUserData(user ? JSON.parse(user) : null);
      } catch {
        // ignore malformed cache
      }
    };

    window.addEventListener('user-profile-updated', syncProfileFromCache);
    return () => window.removeEventListener('user-profile-updated', syncProfileFromCache);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    try {
      const fallbackTrustId = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
      const trustId = String(selectedTrustId || localStorage.getItem('selected_trust_id') || fallbackTrustId).trim();

      setShareAppLinks(
        trustId ? buildShareAppLinksFromMembership(getStoredMembershipForTrust(trustId)) : null
      );
    } catch {
      setShareAppLinks(null);
    }
  }, [isOpen, selectedTrustId]);

  // Load member trusts when sidebar opens (reg_members based payload from login)
  useEffect(() => {
    if (!isOpen) return;
    const load = async () => {
      try {
        setLoadingTrustLinks(true);
        const user = localStorage.getItem('user');
        const parsedUser = user ? JSON.parse(user) : null;

        const hospitalMemberships = Array.isArray(parsedUser?.hospital_memberships)
          ? parsedUser.hospital_memberships
          : [];

        const trusts = hospitalMemberships.map((hm, idx) => ({
          _key: hm.trust_id || `hm-${idx}`,
          trust_id: hm.trust_id || null,
          Trust: {
            id: hm.trust_id || null,
            name: hm.trust_name || null,
            icon_url: hm.trust_icon_url || null,
          },
          source: 'reg_members',
        }));

        console.log(`[Sidebar] Loaded ${trusts.length} trusts from hospital_memberships`);
        setMemberTrustLinks(trusts);
      } catch (error) {
        console.error('[Sidebar] Error loading member trusts:', error);
        setMemberTrustLinks([]);
      } finally {
        setLoadingTrustLinks(false);
      }
    };
    load();
  }, [isOpen]);

  // No body scroll lock needed — overlay + fixed panel already block background interaction.
  // prevents background scroll on mobile, and covers background on desktop.

  useEffect(() => {
    if (isOpen) {
      let innerId = 0;
      const outerId = requestAnimationFrame(() => {
        innerId = requestAnimationFrame(() => setHasEntered(true));
      });
      return () => {
        cancelAnimationFrame(outerId);
        cancelAnimationFrame(innerId);
      };
    }
    setHasEntered(false);
    const timerId = setTimeout(() => setIsClosing(false), SIDEBAR_CLOSE_MS);
    return () => clearTimeout(timerId);
  }, [isOpen]);

  // Swipe left to close
  useEffect(() => {
    if (!isOpen) return;
    
    let isVerticalScroll = false;
    let startY = 0;
    
    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      touchEndX.current = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isVerticalScroll = false;
    };
    
    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = Math.abs(currentX - touchStartX.current);
      const deltaY = Math.abs(currentY - startY);
      
      // Detect if this is vertical scrolling (not swipe to close)
      if (deltaY > deltaX) {
        isVerticalScroll = true;
      }
      
      touchEndX.current = currentX;
    };
    
    const handleTouchEnd = () => {
      // Only trigger close if it's a clear horizontal swipe (not vertical scroll)
      if (!isVerticalScroll && touchStartX.current - touchEndX.current > 80) {
        onClose();
      }
    };
    
    const sidebar = sidebarRef.current;
    if (sidebar) {
      sidebar.addEventListener('touchstart', handleTouchStart, { passive: true });
      sidebar.addEventListener('touchmove', handleTouchMove, { passive: true });
      sidebar.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      if (sidebar) {
        sidebar.removeEventListener('touchstart', handleTouchStart);
        sidebar.removeEventListener('touchmove', handleTouchMove);
        sidebar.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen && !isClosing) return null;
  const reduceMotion = prefersReducedMotion();
  const isSidebarSettled = hasEntered && isOpen;

  const displayName = resolveNameValue(profile?.name, userData?.Name, userData?.name) || 'User';
  const selectedTrustMembership = resolveSelectedTrustMembership(userData || {}, selectedTrustId);
  // const selectedTrustDisplayName = resolveNameValue(
  //   selectedTrustName,
  //   selectedTrustMembership?.trust_name,
  //   selectedTrustMembership?.Trust?.name,
  //   selectedTrustMembership?.trust?.name
  // ) || 'Selected Trust';
  const selectedTrustRole = resolveMemberRoleValue(
    selectedTrustMembership?.role,
    selectedTrustMembership?.member_role,
    selectedTrustMembership?.type,
    selectedTrustMembership?.membership_type
  );
  const selectedTrustMembershipNumber = resolveMembershipNumberValue(
    selectedTrustMembership?.membership_number,
    selectedTrustMembership?.['Membership number'],
    selectedTrustMembership?.membershipNumber
  );
  const completion = calcCompletion(profile, userData);
  const completionColor = sidebarActiveTextColor;

  const handleOtherMembershipNavigation = () => {
    // Some screens temporarily lock body/html scrolling. Unlock before route change
    // so the centered app shell layout is preserved during client-side navigation.
    releaseGlobalScrollLocks();
    if (onClose) {
      flushSync(() => {
        onClose();
      });
    }
    requestAnimationFrame(() => {
      if (typeof onNavigate === 'function') onNavigate('other-memberships');
      else navigate('/other-memberships');
    });
  };

  const handleTogglePrivacy = async () => {
    if (privacySaving) return;
    const nextValue = !privacyEnabled;
    setPrivacyEnabled(nextValue);
    setPrivacySaving(true);
    try {
      await updateMemberPrivacy(nextValue);
      setProfile((prev) => (prev ? { ...prev, privacy: nextValue } : prev));
      if (userData) {
        const key = `userProfile_${userData.Mobile || userData.mobile || userData.id || 'default'}`;
        try {
          const saved = JSON.parse(localStorage.getItem(key) || '{}');
          localStorage.setItem(key, JSON.stringify({ ...saved, privacy: nextValue }));
        } catch {
          // ignore cache write failures
        }
      }
      // Directory/Executive Body lists cache full member rows client-side; drop them
      // so the new privacy value is reflected next time those screens load.
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const storageKey = localStorage.key(i);
          if (storageKey && storageKey.startsWith('directory_cache_v3_')) keysToRemove.push(storageKey);
        }
        keysToRemove.forEach((storageKey) => localStorage.removeItem(storageKey));
      } catch {
        // ignore cache cleanup failures
      }
      // Patch any already-mounted Directory/Executive Body/Committee list so the
      // change is reflected immediately instead of only after a remount/refresh.
      window.dispatchEvent(new CustomEvent(MEMBER_PRIVACY_UPDATED_EVENT, {
        detail: {
          privacy: nextValue,
          membersId: profile?.members_id || userData?.members_id || userData?.member_id || userData?.id || null,
          mobile: userData?.Mobile || userData?.mobile || null,
          membershipNumber:
            profile?.membership_number ||
            profile?.memberId ||
            userData?.['Membership number'] ||
            userData?.membership_number ||
            null,
        },
      }));
    } catch (err) {
      console.error('Failed to update privacy setting:', err);
      setPrivacyEnabled(!nextValue);
    } finally {
      setPrivacySaving(false);
    }
  };

  const menuItems = Object.entries(flagsData)
    .filter(([key, meta]) => {
      const resolvedRoute = normalizeSidebarRoute(meta?.route, key);
      return Boolean(key)
        && meta?.is_enabled
        && normalizeDisplayInApp(meta?.display_in_app) === 'sidebar'
        && Boolean(resolvedRoute);
    })
    .map(([key, meta]) => ({
      id: normalizeSidebarRoute(meta?.route, key),
      label: toTitleCase(meta?.display_name || meta?.name || key),
      icon: resolveSidebarIcon(key, meta?.route),
      iconUrl: resolveSidebarIconUrl(normalizeSidebarRoute(meta?.route, key), meta?.icon_url),
      quickOrder: meta?.quick_order ?? null,
    }))
    .sort((a, b) => {
      const ao = a.quickOrder ?? 9999;
      const bo = b.quickOrder ?? 9999;
      if (ao !== bo) return ao - bo;
      return String(a.label).localeCompare(String(b.label));
    });
  const addCommunityMenuItem = menuItems.find((item) => item.id === 'add-community');
  const primaryMenuItems = menuItems.filter((item) => item.id !== 'add-community');

  return (
    <>
      <style>{`
        /* Items ease in from the left once the panel is open. "backwards" fill keeps
           the final state untouched so active:scale-95 on buttons still works. */
        .sb-open .sb-head,
        .sb-open .sb-nav > *,
        .sb-open .sb-foot { animation: sbItemIn 420ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
        .sb-open .sb-head { animation-delay: 60ms; }
        .sb-open .sb-nav > *:nth-child(1) { animation-delay: 130ms; }
        .sb-open .sb-nav > *:nth-child(2) { animation-delay: 180ms; }
        .sb-open .sb-nav > *:nth-child(3) { animation-delay: 230ms; }
        .sb-open .sb-nav > *:nth-child(4) { animation-delay: 280ms; }
        .sb-open .sb-nav > *:nth-child(5) { animation-delay: 330ms; }
        .sb-open .sb-nav > *:nth-child(n+6) { animation-delay: 380ms; }
        .sb-open .sb-foot { animation-name: sbFootIn; animation-delay: 300ms; }
        @keyframes sbItemIn {
          from { opacity: 0; transform: translate3d(-18px, 0, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes sbFootIn {
          from { opacity: 0; transform: translate3d(0, 14px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-open .sb-head, .sb-open .sb-nav > *, .sb-open .sb-foot { animation: none; }
        }
      `}</style>
      {/* Overlay — absolute within parent container */}
      <div
        className="absolute max-md:fixed inset-0 backdrop-blur-sm z-40"
        data-sidebar-overlay="true"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        style={{
          touchAction: 'auto',
          background: sidebarOverlayBg,
          opacity: hasEntered ? 1 : 0,
          transition: reduceMotion ? 'none' : `opacity ${isOpen ? SIDEBAR_OPEN_MS : SIDEBAR_CLOSE_MS}ms ease-out`,
          pointerEvents: isOpen ? 'auto' : 'none'
        }}
      />

      {/* Sidebar panel — absolute, left-anchored, full height */}
      <div
        ref={sidebarRef}
        className={`theme-sidebar absolute max-md:fixed left-0 top-0 bottom-0 w-72 shadow-2xl z-50 flex flex-col${isSidebarSettled ? ' sb-open' : ''}`}
        data-sidebar="true"
        style={{
          maxWidth: '85vw',
          height: '100dvh',
          maxHeight: '100dvh',
          touchAction: 'pan-y',
          background: 'var(--sidebar-bg)',
          // Blur only once settled: animating a backdrop blur janks on Android.
          backdropFilter: hasEntered && isOpen ? 'blur(var(--sidebar-blur, 12px))' : 'none',
          WebkitBackdropFilter: hasEntered && isOpen ? 'blur(var(--sidebar-blur, 12px))' : 'none',
          opacity: 'var(--sidebar-opacity, 1)',
          transform: hasEntered ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)',
          transition: reduceMotion
            ? 'none'
            : isOpen
              ? `transform ${SIDEBAR_OPEN_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`
              : `transform ${SIDEBAR_CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1)`,
          pointerEvents: isOpen ? 'auto' : 'none',
          borderRight: '1px solid var(--sidebar-border)',
          overflow: 'hidden',
          WebkitOverflowScrolling: 'touch',
          willChange: 'transform',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Brand accent at top */}
        <div style={{ height: '4px', background: 'var(--sidebar-accent)' }} />
        {/* ── Profile Card Header ── */}
        {ff('feature_profile') && (
        <div
          className="sb-head px-5 pt-14 pb-5 flex-shrink-0 cursor-pointer"
	          style={{ borderBottom: `1px solid ${sidebarDividerColor}` }}
          onClick={() => { onNavigate('profile'); onClose(); }}
        >
          {/* Avatar + name row */}
          <div className="flex items-center gap-3 mb-3">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="h-14 w-14 rounded-full overflow-hidden flex items-center justify-center"
                style={{
                  background: `color-mix(in srgb, ${sidebarTextColor} 18%, transparent)`,
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${sidebarTextColor} 80%, transparent), 0 4px 12px rgba(0, 0, 0, 0.25)`,
                }}
              >
                {profile?.profilePhotoUrl && failedAvatarUrl !== profile.profilePhotoUrl ? (
                  <img
                    src={profile.profilePhotoUrl}
                    alt={displayName}
                    className="h-full w-full object-cover"
                    onError={() => setFailedAvatarUrl(profile.profilePhotoUrl)}
                  />
                ) : (
                  <AvatarPlaceholder color={`color-mix(in srgb, ${sidebarTextColor} 75%, transparent)`} />
                )}
              </div>
            </div>

            {/* Name + subtitle */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate" style={{ color: sidebarTextColor }}>{displayName}</p>
              <p>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase mr-1"
              style={{
                color: sidebarBadgeTextColor,
                background: sidebarBadgeBgColor,
                border: `1px solid ${applyOpacity(sidebarActiveTextColor, 0.18)}`
              }}
              title="Selected trust role"
            >
              {/* <span className="opacity-75">Role</span> */}
              <span className="normal-case tracking-normal">
                {selectedTrustRole}
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase"
              style={{
                color: sidebarBadgeTextColor,
                background: applyOpacity(sidebarActiveTextColor, 0.1),
                border: `1px solid ${applyOpacity(sidebarActiveTextColor, 0.14)}`
              }}
              title="Selected trust membership number"
            >
              {/* <span className="opacity-75">M No</span> */}
              <span className="normal-case tracking-normal">
                {selectedTrustMembershipNumber || 'Not available'}
              </span>
            </span>
          </p>
              <p className="text-xs font-semibold mt-1" style={{ color: sidebarSoftTextColor }}>View &amp; Edit Profile</p>
            </div>

            <ChevronRight
              className="h-4 w-4 flex-shrink-0"
	              style={{ color: sidebarChevronColor }}
            />
          </div>

          {/* Completion bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[11px] font-medium"
                style={{ color: sidebarMutedTextColor }}
              >
                Profile Completion
              </span>
              <span className="text-[11px] font-bold" style={{ color: completionColor }}>
                {completion}%
              </span>
            </div>
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
	              style={{ background: sidebarProgressTrackColor }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${completion}%`,
                  background: completionColor
                }}
              />
            </div>
          </div>
        </div>
        )}

        {/* ── Scrollable area: nav + extras ── */}
        

        <div 
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ 
            touchAction: 'pan-y', 
            WebkitOverflowScrolling: 'touch', 
            minHeight: 0,
            scrollBehavior: 'smooth',
            flex: '1 1 auto',
            overscrollBehavior: 'contain',
            paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))'
          }}
        >
          {/* Nav items + More Options */}
          <div className="py-3 px-3">
            <div className="sb-nav space-y-1">
              {primaryMenuItems.map((item) => {
                const cp = String(currentPage || '').trim().toLowerCase().replace(/_/g, '-');
                const aliasMap = {
                  'healthcare-directory': 'directory',
                  'healthcare-trustee-directory': 'directory',
                  'directory': 'directory',
                  'appointments': 'appointment',
                  'appointment': 'appointment',
                  'home': 'home',
                  'reports': 'reports',
                  'gallery': 'gallery',
                  'reference': 'reference',
                  'profile': 'profile',
                  'orderhistory': 'order-history'
                };
                let normalized = aliasMap[cp] || cp;
                if (!normalized) normalized = '';
                if (!aliasMap[cp] && normalized.endsWith('s')) normalized = normalized.slice(0, -1);
                const isActive = normalized === String(item.id).toLowerCase();
                const itemTextColor = sidebarTextColor;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); onClose(); }}
                    className="w-full flex items-center gap-3 px-4 rounded-xl transition-all text-left active:scale-95 select-none"
                  style={{
                      minHeight: '52px',
                      WebkitTapHighlightColor: sidebarTapHighlightColor,
                      background: isActive ? accent : 'transparent',
                    }}
                  >
                    <SidebarFeatureIcon
                      iconUrl={item.iconUrl}
                      Fallback={item.icon}
                      color={isActive ? sidebarActiveTextColor : itemTextColor}
                    />
                    <span
                      className="font-semibold flex-1"
                      style={{
                        color: isActive
                          ? sidebarActiveTextColor
                          : itemTextColor
                      }}
                    >
                      {item.label}
                    </span>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sidebarActiveTextColor }} />}
                  </button>
                );
              })}

              {/* Other Membership Details — Navigate to full page */}
              {ff('feature_othermembership') && normalizeDisplayInApp(flagsData?.feature_othermembership?.display_in_app) === 'sidebar' && (
              <button
                onClick={handleOtherMembershipNavigation}
              className="w-full flex items-center gap-3 px-4 rounded-xl transition-all text-left active:scale-95 select-none"
              style={{
                minHeight: '52px',
                background: 'transparent',
                WebkitTapHighlightColor: sidebarTapHighlightColor,
              }}
            >
	              <Users
	                className="h-5 w-5 flex-shrink-0"
	                style={{
	                  color: sidebarTextColor
	                }}
	              />
              <div className="flex-1 text-left">
                <span className="font-semibold" style={{ color: sidebarTextColor }}>
                  {toTitleCase(flagsData?.feature_othermembership?.display_name || 'Other Membership Details')}
                </span>
                {loadingTrustLinks && (
                  <span
                    className="ml-2 text-[10px]"
	                    style={{ color: sidebarMutedTextColor }}
                  >
                    Loading...
                  </span>
                )}
                {!loadingTrustLinks && memberTrustLinks.length > 0 && (
                  <span
                    className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
	                    style={{ background: sidebarBadgeBgColor, color: sidebarBadgeTextColor }}
                  >
                    {memberTrustLinks.length}
                  </span>
                )}
              </div>
              <ChevronRight
                className="h-4 w-4 flex-shrink-0"
	                style={{ color: sidebarChevronColor }}
              />
            </button>
              )}

              {/* Privacy toggle — hides this member's contact/address details from Directory & Executive Body */}
              <div
                className="w-full flex items-center gap-3 px-4 rounded-xl select-none"
                style={{ minHeight: '52px' }}
              >
                <Lock
                  className="h-5 w-5 flex-shrink-0"
                  style={{ color: sidebarTextColor }}
                />
                <div className="flex-1 text-left">
                  <span className="font-semibold block" style={{ color: sidebarTextColor }}>
                    Privacy Mode
                  </span>
                  {/* <span className="text-[10px]" style={{ color: sidebarMutedTextColor }}>
                    Hide my details in Directory
                  </span> */}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={privacyEnabled}
                  aria-label="Toggle privacy mode"
                  onClick={handleTogglePrivacy}
                  disabled={privacySaving}
                  className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors active:scale-95 disabled:opacity-60"
                  style={{
                    background: privacyEnabled ? sidebarActiveTextColor : sidebarProgressTrackColor,
                    WebkitTapHighlightColor: sidebarTapHighlightColor,
                  }}
                >
                  <span
                    className="inline-block h-4 w-4 transform rounded-full transition-transform"
                    style={{
                      background: 'var(--surface-color)',
                      transform: privacyEnabled ? 'translateX(22px)' : 'translateX(4px)',
                    }}
                  />
                </button>
              </div>

              {addCommunityMenuItem && (
                <button
                  onClick={() => { onNavigate(addCommunityMenuItem.id); onClose(); }}
                  className="w-full flex items-center gap-3 px-4 rounded-xl transition-all text-left active:scale-95 select-none"
                  style={{
                    minHeight: '52px',
                    WebkitTapHighlightColor: sidebarTapHighlightColor,
                    background: 'transparent',
                  }}
                >
                  <addCommunityMenuItem.icon
                    className="h-5 w-5 flex-shrink-0"
                    style={{ color: sidebarTextColor }}
                  />
                  <span
                    className="font-semibold flex-1"
                    style={{ color: sidebarTextColor }}
                  >
                    {addCommunityMenuItem.label}
                  </span>
                </button>
              )}

              {/* Share Button - controlled by feature_share_app */}
              {ff('feature_share_app') && <button
              data-track="share_click"
              onClick={handleShareApp}
              className="w-full flex items-center gap-3 px-4 rounded-xl transition-all text-left active:scale-95 select-none relative"
              style={{
                minHeight: '52px',
                background: 'transparent',
	                WebkitTapHighlightColor: sidebarTapHighlightColor,
              }}
            >
	              <Share2
	                className="h-5 w-5 flex-shrink-0"
	                style={{
	                  color: sidebarTextColor
	                }}
	              />
              <span
                className="font-semibold flex-1"
	                style={{ color: sidebarTextColor }}
              >
                Share App
              </span>
              
            </button>}
            </div>
          </div>
        </div>

      {/* ── Fixed Logout Button at Bottom ── */}
        <div
          className="sb-foot absolute left-0 right-0 bottom-0 px-3 pt-2 z-50"
          style={{
            background: 'var(--sidebar-bg)',
	          borderTop: `1px solid ${sidebarDividerColor}`,
            backdropFilter: 'blur(var(--sidebar-blur, 12px))',
            WebkitBackdropFilter: 'blur(var(--sidebar-blur, 12px))',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))'
          }}
        >
        {socialLinks.length > 0 && (
          <div
            className="mb-3 px-3 py-1"
            // style={{
            //   background: sidebarSocialSectionBg,
            //   borderColor: sidebarSocialSectionBg
            // }}
          >
            {/* <div className="mb-2 flex items-center justify-between gap-3">
              <span
                className="text-[9px] font-semibold tracking-[0.16em] uppercase"
                style={{ color: sidebarMutedTextColor }}
              >
                Follow us
              </span>
              <span
                className="text-[9px] font-medium"
                style={{ color: sidebarMutedTextColor, opacity: 0.8 }}
              >
                Social links
              </span>
            </div> */}
            <div className="grid grid-cols-5 gap-[2px]">
              {socialLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      trackAction('social_icon_clicked', { social_platform: item.key }, { route: '/sidebar' });
                      openExternalLink(item.href);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-95"
                    style={{
                      background: sidebarSocialButtonBg,
                      border: `1px solid ${sidebarSocialButtonBorder}`,
                      WebkitTapHighlightColor: sidebarTapHighlightColor
                    }}
                    aria-label={item.label}
                    title={item.label}
                  >
                    <Icon aria-hidden="true" size={20} style={{ color: item.color }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          className="mb-2 flex items-center justify-between gap-3 px-1"
          style={{
            color: sidebarMutedTextColor,
            opacity: 0.82,
          }}
        >
          <span className="text-[9px] font-medium tracking-[0.14em] uppercase">
            Version&nbsp; {displayTrustVersion}
          </span>
          <a
            href={appOrgLink}
            className="truncate text-[9px] font-medium no-underline hover:opacity-90"
            style={{ color: sidebarMutedTextColor }}
            title={APP_ORG_NAME}
          >
            {APP_ORG_NAME}
          </a>
        </div>

        <button
          onClick={async () => {
            // Called first: it reads the member identity synchronously, before logout clears it.
            trackAction('logout_clicked', {}, { route: '/sidebar' });
            if (typeof onLogout === 'function') {
              await onLogout();
            } else {
              let currentUser = null;
              try {
                const rawUser = localStorage.getItem('user');
                if (rawUser) currentUser = JSON.parse(rawUser);
              } catch {
                currentUser = null;
              }
              const pushToken = await unregisterPushToken();
              await logUserSessionEvent({
                user: currentUser,
                actionType: 'logout',
                extra: { source: 'sidebar-fallback', ...(pushToken ? { fcm_token: pushToken } : {}) }
              });
              localStorage.removeItem('user');
              localStorage.removeItem('isLoggedIn');
              localStorage.removeItem('setu_session_token');
              localStorage.removeItem('lastVisitedRoute');
              localStorage.removeItem('selected_trust_id');
              localStorage.removeItem('selected_trust_name');
              sessionStorage.removeItem('selectedMember');
              sessionStorage.removeItem('previousScreen');
              sessionStorage.removeItem('previousScreenName');
              sessionStorage.removeItem('trust_selected_in_session');
              navigate('/login', { replace: true });
            }
            track('logout');
            if (onClose) onClose();
          }}
          className="w-full flex items-center gap-3 px-4 rounded-xl transition-all text-left active:scale-95 select-none"
          style={{
            minHeight: '52px',
            background: 'transparent',
	            WebkitTapHighlightColor: sidebarTapHighlightColor,
          }}
        >
	          <LogOut
	            className="h-5 w-5 flex-shrink-0"
	            style={{
	              color: sidebarTextColor
	            }}
	          />
          <span
            className="font-semibold flex-1"
	            style={{ color: sidebarTextColor }}
          >
            Logout
          </span>
          <ChevronRight
            className="h-4 w-4 flex-shrink-0"
	            style={{ color: sidebarChevronColor }}
          />
        </button>
      </div>
      </div>
    </>
  );
};

export default Sidebar;

