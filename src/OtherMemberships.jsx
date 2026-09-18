import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, X, Menu, Home as HomeIcon,
  AlertCircle, Building2, Loader2, ChevronRight, BadgeCheck
} from 'lucide-react';
import Sidebar from './features/sidebar/Sidebar';
import TrustIdCard from './TrustIdCard';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';
import { fetchActiveTrustsByMobile } from './services/trustService';
import { isFeatureVisible } from './services/featureFlags';
import { useFeatureFlags } from './hooks/useFeatureFlags';
import { getAppHomePath } from './utils/tenantNavigation';

// ─── Supabase helpers ──────────────────────────────────────────────────────

const getSupabase = async () => {
  const { supabase } = await import('./services/supabaseClient.js');
  return supabase;
};

const getMobileVariants = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.length >= 10) variants.add(digits.slice(-10));
  if (!digits.startsWith('91') && digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
  }
  variants.add(`+${digits}`);
  variants.add(`0${digits.slice(-10)}`);
  return [...variants].filter(Boolean);
};

const resolveOtherMembershipMemberId = async (parsedUser = {}) => {
  const supabase = await getSupabase();

  const directCandidates = [
    parsedUser?.members_id,
    parsedUser?.member_id,
    parsedUser?.id,
  ]
    .map(normalizeText)
    .filter(Boolean);

  for (const candidate of directCandidates) {
    const { data, error } = await supabase
      .from('Members')
      .select('members_id')
      .eq('members_id', candidate)
      .limit(1)
      .maybeSingle();

    if (!error && data?.members_id) {
      return normalizeText(data.members_id);
    }
  }

  const mobileCandidates = getMobileVariants(
    parsedUser?.Mobile || parsedUser?.mobile || parsedUser?.phone || ''
  );

  for (const mobile of mobileCandidates) {
    const { data, error } = await supabase
      .from('Members')
      .select('members_id')
      .eq('Mobile', mobile)
      .limit(1)
      .maybeSingle();

    if (!error && data?.members_id) {
      return normalizeText(data.members_id);
    }
  }

  return '';
};

// Fetch existing other_memberships for a member
const fetchOtherMemberships = async (memberId) => {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('other_memberships')
    .select(`
      id,
      member_id,
      member_name,
      member_phone,
      trust_id,
      organisation_name,
      membership_no,
      membership_type,
      is_active,
      remark,
      created_at,
      Trust:trust_id ( id, name, icon_url )
    `)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};



// Delete an other_membership record
const deleteOtherMembership = async (id) => {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from('other_memberships')
    .delete()
    .eq('id', id);
  if (error) throw error;
};

// ─── Small reusable components ─────────────────────────────────────────────

const Label = ({ children }) => (
  <p style={{
    fontSize: '11px', fontWeight: 700, color: 'var(--advertisement-description)',
    textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 5px'
  }}>{children}</p>
);

// Marquee: always duplicates text; CSS animation scrolls the inner span.
// The container clips overflow so text scrolling is seamless.
const MarqueeText = ({ children, style = {}, speed = 38 }) => {
  const text = String(children || '').trim();
  const containerRef = React.useRef(null);
  // Dedicated, always-unpadded probe used only for width measurement so the
  // visible (possibly padded/duplicated) marquee span never skews the check.
  const probeRef = React.useRef(null);
  const [overflow, setOverflow] = React.useState(false);
  const [dur, setDur] = React.useState(6);

  React.useEffect(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!container || !probe) return;
    const measure = () => {
      const textW = probe.scrollWidth;
      const containerW = container.clientWidth;
      const isOverflow = textW > containerW + 1;
      setOverflow(isOverflow);
      // duration proportional to text width so speed feels constant
      setDur(isOverflow ? Math.max(3, textW / speed) : 0);
    };
    measure();
    // Container width can be stable at mount while a webfont swap later
    // changes the text's rendered width, so watch both and re-check once
    // fonts finish loading (fallback timeout covers browsers without it).
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(probe);
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    const timeoutId = setTimeout(measure, 300);
    return () => {
      ro.disconnect();
      clearTimeout(timeoutId);
    };
  }, [text, speed]);

  if (!text) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}
      >
        {text}
      </span>
      <span
        className="om-marquee-inner"
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          animation: overflow ? `om-marquee-scroll ${dur}s linear infinite` : 'none',
        }}
      >
        <span style={{ paddingRight: overflow ? '36px' : '0' }}>{text}</span>
        {overflow && <span style={{ paddingRight: '36px' }}>{text}</span>}
      </span>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────

const normalizeText = (value) => String(value || '').trim();

const normalizeId = (value) => normalizeText(value).toLowerCase();

const getMembershipDisplayName = (item = {}) =>
  normalizeText(item?.Trust?.name || item?.organisation_name || item?.trust_name || item?.name);

const sortMembershipsAlphabetically = (items = []) =>
  [...items].sort((a, b) => getMembershipDisplayName(a).localeCompare(
    getMembershipDisplayName(b),
    undefined,
    { sensitivity: 'base', numeric: true }
  ));

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
};

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
};

const getMemberProfileFields = (parsedUser = {}) => {
  const bloodGroup = pickFirstText(
    parsedUser?.blood_group,
    parsedUser?.bloodGroup,
    parsedUser?.['Blood Group']
  );
  const addressHome = pickFirstText(
    parsedUser?.address_home,
    parsedUser?.['Address Home'],
    parsedUser?.home_address
  );
  const addressOffice = pickFirstText(
    parsedUser?.address_office,
    parsedUser?.['Address Office'],
    parsedUser?.office_address
  );
  const address = pickFirstText(
    parsedUser?.address,
    parsedUser?.member_address,
    addressHome,
    addressOffice
  );

  return {
    blood_group: bloodGroup || null,
    address: address || null,
    address_home: addressHome || null,
    address_office: addressOffice || null,
  };
};

const getMemberLookupFields = (parsedUser = {}) => ({
  mobile: pickFirstText(
    parsedUser?.Mobile,
    parsedUser?.mobile,
    parsedUser?.phone,
    parsedUser?.Phone
  ),
  name: pickFirstText(
    parsedUser?.Name,
    parsedUser?.name,
    parsedUser?.full_name
  ),
});

const refreshUserMembershipsFromActiveTrusts = async (parsedUser = {}) => {
  const lookup = getMemberLookupFields(parsedUser);
  if (!lookup.mobile) return parsedUser;

  const activeTrustResult = await fetchActiveTrustsByMobile({
    mobile: lookup.mobile,
    name: lookup.name || null,
  });

  const memberships = Array.isArray(activeTrustResult?.memberships)
    ? activeTrustResult.memberships
    : [];

  if (memberships.length === 0) return parsedUser;

  const refreshedUser = {
    ...parsedUser,
    members_id: activeTrustResult?.member_id || parsedUser?.members_id,
    member_id: activeTrustResult?.member_id || parsedUser?.member_id,
    hospital_memberships: memberships,
    trusts_loaded_from_active_api: true,
  };

  try {
    localStorage.setItem('user', JSON.stringify(refreshedUser));
  } catch {
    // Keep the refreshed in-memory payload even if storage is unavailable.
  }

  return refreshedUser;
};

const enrichTrustCardData = (link = {}, parsedUser = getStoredUser()) => {
  const cardData = { ...(link && typeof link === 'object' ? link : {}) };
  const profileFields = getMemberProfileFields(parsedUser);

  if (!normalizeText(cardData.blood_group) && profileFields.blood_group) {
    cardData.blood_group = profileFields.blood_group;
  }
  if (!normalizeText(cardData.address) && profileFields.address) {
    cardData.address = profileFields.address;
  }
  if (!normalizeText(cardData.address_home) && profileFields.address_home) {
    cardData.address_home = profileFields.address_home;
  }
  if (!normalizeText(cardData.address_office) && profileFields.address_office) {
    cardData.address_office = profileFields.address_office;
  }
  if (!normalizeText(cardData.joined_date) && normalizeText(parsedUser?.joined_date)) {
    cardData.joined_date = parsedUser.joined_date;
  }
  if (!normalizeText(cardData.valid_till) && normalizeText(parsedUser?.valid_till)) {
    cardData.valid_till = parsedUser.valid_till;
  }

  return cardData;
};

const TRUST_LINKS_CACHE_KEY_PREFIX = 'other_memberships_trust_links_v1_';
const TRUST_LINKS_LAST_CACHE_KEY = 'other_memberships_trust_links_v1_last';
const TRUST_ID_CARD_CACHE_KEY = 'trust_id_card_payload_v1';

const getTrustLinksCacheKey = (memberId) => `${TRUST_LINKS_CACHE_KEY_PREFIX}${normalizeText(memberId || 'anonymous')}`;

const readTrustLinksCache = (memberId) => {
  try {
    const raw = localStorage.getItem(getTrustLinksCacheKey(memberId));
    if (!raw) {
      const fallback = localStorage.getItem(TRUST_LINKS_LAST_CACHE_KEY);
      if (!fallback) return [];
      const parsedFallback = JSON.parse(fallback);
      return Array.isArray(parsedFallback) ? parsedFallback : [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeTrustLinksCache = (memberId, links) => {
  try {
    const safeLinks = JSON.stringify(Array.isArray(links) ? links : []);
    localStorage.setItem(getTrustLinksCacheKey(memberId), safeLinks);
    localStorage.setItem(TRUST_LINKS_LAST_CACHE_KEY, safeLinks);
  } catch {
    // Ignore cache write failures (quota/private mode)
  }
};

const buildTrustLinksFromUserPayload = (parsedUser = {}) => {
  const selectedTrustId = normalizeText(localStorage.getItem('selected_trust_id'));
  const selectedTrustName = normalizeText(localStorage.getItem('selected_trust_name'));
  const memberName = normalizeText(
    parsedUser?.Name
    || parsedUser?.name
    || parsedUser?.full_name
  );
  const memberPhone = normalizeText(
    parsedUser?.Mobile
    || parsedUser?.mobile
    || parsedUser?.phone
    || parsedUser?.Phone
  );
  const memberPhotoUrl = normalizeText(
    parsedUser?.profile_photo_url
    || parsedUser?.profilePhotoUrl
  );
  const selectedTrustMembershipNo = normalizeText(
    parsedUser?.['Membership number']
    || parsedUser?.membership_number
    || parsedUser?.membershipNumber
  );
  const memberProfileFields = getMemberProfileFields(parsedUser);

  const hospitalMemberships = Array.isArray(parsedUser?.hospital_memberships)
    ? parsedUser.hospital_memberships
    : [];

  const normalizedSelectedTrustId = normalizeId(selectedTrustId);
  const merged = hospitalMemberships.map((hm, idx) => {
    const trustId = normalizeText(hm?.trust_id);
    const isCurrentTrust = normalizedSelectedTrustId && normalizeId(trustId) === normalizedSelectedTrustId;
    const membershipNo = normalizeText(hm?.membership_number) || (isCurrentTrust ? selectedTrustMembershipNo : '');

    return {
      _key: hm.trust_id || `hm-${idx}`,
      id: hm?.reg_id || hm?.id || hm?.trust_id || `hm-${idx}`,
      trust_id: hm.trust_id || null,
      Trust: {
        id: hm.trust_id,
        name: hm.trust_name,
        icon_url: hm.trust_icon_url,
        legal_name: hm.trust_legal_name || null,
      },
      membership_no: membershipNo || '-',
      location: null,
      remark1: hm.trust_remark || null,
      remark2: null,
      is_active: hm.is_active !== false,
      role: hm.role || null,
      joined_date: hm.joined_date || hm.created_at || null,
      valid_till: hm.valid_till || hm.expiry_date || hm.expires_at || null,
      ...memberProfileFields,
      member_name: memberName || null,
      member_phone: memberPhone || null,
      member_photo_url: memberPhotoUrl || null,
      qr_code: hm.qr_code || hm.qrCode || null,
      source: hm.source || 'reg_members',
      is_vip: true,
      is_current_trust: isCurrentTrust,
    };
  });

  const hasSelectedTrustCard = merged.some((item) => normalizeId(item?.trust_id) === normalizedSelectedTrustId);
  if (!hasSelectedTrustCard && (selectedTrustId || selectedTrustName) && selectedTrustMembershipNo) {
    merged.unshift({
      _key: `selected-${selectedTrustId || selectedTrustName}`,
      id: `selected-${selectedTrustId || selectedTrustName}`,
      trust_id: selectedTrustId || null,
      Trust: {
        id: selectedTrustId || null,
        name: selectedTrustName || 'Current Trust',
        icon_url: null,
      },
      membership_no: selectedTrustMembershipNo,
      location: null,
      remark1: null,
      remark2: null,
      is_active: true,
      role: null,
      joined_date: parsedUser?.joined_date || parsedUser?.created_at || null,
      valid_till: parsedUser?.valid_till || parsedUser?.expiry_date || parsedUser?.expires_at || null,
      ...memberProfileFields,
      member_name: memberName || null,
      member_phone: memberPhone || null,
      member_photo_url: memberPhotoUrl || null,
      source: 'reg_members',
      is_vip: true,
      is_current_trust: true,
    });
  }

  merged.sort((a, b) => Number(Boolean(b.is_current_trust)) - Number(Boolean(a.is_current_trust)));
  return merged;
};

const areMembershipCollectionsEqual = (left = [], right = []) => {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  return JSON.stringify(left) === JSON.stringify(right);
};

// Resolves any CSS color (including var(--token)) to its computed rgb() by
// letting the browser do the resolution, so theme tokens work the same as
// literal hex/rgb values from a tenant's theme config.
const resolveCssColorToRgb = (value) => {
  const raw = String(value || '').trim();
  if (!raw || typeof document === 'undefined') return null;
  const probe = document.createElement('div');
  probe.style.color = raw;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const match = computed.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
};

const getRelativeLuminance = ({ r, g, b }) => {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

// Only the tenant's page background decides light vs dark: a light background
// gets theme-derived card colors, a dark one (e.g. Setu's current navy/gold
// look) keeps the existing fixed gold styling as-is.
const isLightBackground = (bgColor) => {
  const rgb = resolveCssColorToRgb(bgColor);
  if (!rgb) return false;
  return getRelativeLuminance(rgb) > 0.6;
};

const OtherMemberships = ({ onNavigate, variant = 'page' }) => {
  const navigate = useNavigate();
  const isHomeVariant = variant === 'home';
  const theme = useAppTheme();
  const { flags: featureFlags } = useFeatureFlags();
  const navbarTheme = getNavbarThemeStyles(theme);
  const bootUser = getStoredUser();
  const bootMemberId = bootUser?.members_id || bootUser?.id || 'anonymous';
  const bootTrustLinksFromUser = buildTrustLinksFromUserPayload(bootUser);
  const bootTrustLinks = readTrustLinksCache(bootMemberId);
  const initialTrustLinks = bootTrustLinksFromUser.length > 0 ? bootTrustLinksFromUser : bootTrustLinks;
  const primaryColor = getThemeToken(theme, 'primary_color', 'var(--brand-red)');
  const secondaryColor = getThemeToken(theme, 'secondary_color', 'var(--brand-navy)');
  const accentColor = getThemeToken(theme, 'accent_color', 'var(--app-accent)');
  const accentBgColor = getThemeToken(theme, 'accent_bg', 'var(--app-accent-bg)');

  const colors = {
    primary: primaryColor,
    secondary: secondaryColor,
    accent: accentColor,
    accentBg: accentBgColor,
    bg: getThemeToken(theme, 'page_bg.background_color', 'var(--app-page-bg)'),
    surface: 'var(--surface-color)',
    card: `linear-gradient(180deg, ${applyOpacity('var(--surface-color)', 0.96)} 0%, ${applyOpacity(accentBgColor, 0.72)} 100%)`,
    cardInner: applyOpacity(accentBgColor, 0.42),
    border: applyOpacity(secondaryColor, 0.13),
    muted: 'var(--body-text-color)',
    onPrimary: getThemeToken(theme, 'app_buttons.text_color', 'var(--app-button-text)'),
    error: 'var(--brand-red-dark)',
    errorBg: 'var(--brand-red-light)',
    vipText: getThemeToken(theme, 'advertisement.badge_text_color', 'var(--advertisement-badge-text)'),
    vipBg: 'linear-gradient(135deg, var(--advertisement-badge-bg) 0%, var(--app-accent-bg) 52%, var(--app-accent) 100%)',
    vipBorder: getThemeToken(theme, 'advertisement.card_border_color', 'var(--advertisement-card-border)'),
  };

  // Setu's own theme is dark and already looks right with the fixed gold
  // card styling; only tenants with a light page background get theme-driven
  // card colors instead.
  const isLightTheme = useMemo(() => isLightBackground(colors.bg), [colors.bg]);

  // ── state ──
  const [trustLinks, setTrustLinks] = useState(initialTrustLinks); // from reg_members-backed user payload
  const [otherMems, setOtherMems] = useState([]);        // from other_memberships table
  const [loading, setLoading] = useState(initialTrustLinks.length === 0);
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [trustCardModalData, setTrustCardModalData] = useState(null);
  const [openingTrustId, setOpeningTrustId] = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState(null);

  const sortedOtherMems = useMemo(() => sortMembershipsAlphabetically(otherMems), [otherMems]);
  const sortedTrustLinks = useMemo(() => sortMembershipsAlphabetically(trustLinks), [trustLinks]);
  const showCreateNewApp = isFeatureVisible(featureFlags, 'feature_add_community');

  // ── fetch data ──
  const loadData = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    if (!silent) setLoading(true);
    setError('');
    try {
      const storedUser = getStoredUser();
      let parsedUser = storedUser;
      try {
        parsedUser = await refreshUserMembershipsFromActiveTrusts(storedUser);
      } catch (e) {
        console.warn('active trusts refresh failed:', e);
      }
      const resolvedId = await resolveOtherMembershipMemberId(parsedUser);
      const id = resolvedId || normalizeText(parsedUser?.members_id);
      if (!id) {
        setError('Member ID not found. Please re-login.');
        setLoading(false);
        return;
      }
      const merged = buildTrustLinksFromUserPayload(parsedUser);

      setTrustLinks((prev) => (areMembershipCollectionsEqual(prev, merged) ? prev : merged));
      writeTrustLinksCache(id || 'anonymous', merged);

      // ── other_memberships table ──
      try {
        const otherMemsData = await fetchOtherMemberships(id);
        setOtherMems((prev) => {
          const next = otherMemsData || [];
          return areMembershipCollectionsEqual(prev, next) ? prev : next;
        });
      } catch (e) {
        console.warn('other_memberships fetch failed:', e);
      }
    } catch (err) {
      console.error('OtherMemberships load error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Clear any temporary global scroll-lock styles left by previous screens.
  useEffect(() => {
    if (isHomeVariant) return undefined;
    document.documentElement.style.overflow = '';
    document.documentElement.style.position = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    document.body.style.touchAction = '';
  }, [isHomeVariant]);

  useEffect(() => {
    const hasCachedTrustLinks = initialTrustLinks.length > 0;
    loadData({ silent: hasCachedTrustLinks });
  }, [loadData, initialTrustLinks.length]);

  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen, isHomeVariant]);

  useEffect(() => {
    if (!trustCardModalData) return undefined;

    const y = window.scrollY;
    Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTrustCardModalData(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const restoredY = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(restoredY) ? restoredY : 0);
    };
  }, [trustCardModalData]);

  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen, isHomeVariant]);

  // ── handlers ──
  const handleDelete = async (id) => {
    if (!window.confirm('Remove this membership record?')) return;
    setDeletingId(id);
    try {
      await deleteOtherMembership(id);
      setOtherMems(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      alert('Failed to delete: ' + (err?.message || 'Unknown error'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateNewApp = () => {
    if (onNavigate) {
      onNavigate('add-community');
      return;
    }
    navigate('/add-community');
  };

  const handleOpenTrustWebApp = async (link) => {
    const trustId = normalizeText(link?.trust_id || link?.Trust?.id);
    if (!trustId || openingTrustId) return;

    setOpeningTrustId(trustId);
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc('manage_user_panel_by_trust_details', {
        p_action: 'view',
        p_trust_id: trustId,
      });
      if (error) throw error;

      const webAppUrl = normalizeText(data?.[0]?.web_app_url);
      if (!webAppUrl) {
        throw new Error('This trust does not have a web app link yet.');
      }

      window.open(webAppUrl, '_blank', 'noopener,noreferrer');
      setOpeningTrustId('');
    } catch (err) {
      console.error('Failed to open trust web app:', err);
      alert('Failed to open: ' + (err?.message || 'Unknown error'));
      setOpeningTrustId('');
    }
  };

  const openTrustIdCard = (link) => {
    const cardData = enrichTrustCardData(link);
    try {
      sessionStorage.setItem(TRUST_ID_CARD_CACHE_KEY, JSON.stringify(cardData));
    } catch {
      // Ignore storage failures and continue with the modal.
    }
    setIsMenuOpen(false);
    setTrustCardModalData(cardData);
  };

  // ── render helpers ──
  const TrustAvatar = ({ trust, size = 44 }) => {
    const name = (typeof trust === 'string' ? trust : trust?.name) || 'T';
    const iconUrl = typeof trust === 'object' ? trust?.icon_url : null;
    return iconUrl ? (
      <img src={iconUrl} alt={name}
        style={{ width: size, height: size, borderRadius: size * 0.3, objectFit: 'contain', border: `2px solid ${colors.border}`, background: 'color-mix(in srgb, var(--advertisement-card-bg) 82%, var(--app-accent-bg))', flexShrink: 0 }}
        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
      />
    ) : (
      <div style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 800, color: colors.onPrimary, flexShrink: 0 }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  };

  const MembershipCard = ({ m, showGoldenMembershipBadge = false, clickable = false, onClick = null }) => {
    const trustName = m.Trust?.name || m.organisation_name || '—';
    const isVip = m.source === 'reg_members' || m.is_vip;
    const showDelete = !isVip;
    const membershipLabel = 'Membership No.';
    const membershipNoText = normalizeText(m.membership_no) || '-';
    const membershipTypeText = normalizeText(m.membership_type || m.role).toUpperCase();
    const showSetuVerifiedBadge = showGoldenMembershipBadge && (m.source === 'reg_members' || m.is_vip !== false);
    const shouldShowMembershipRow = !showGoldenMembershipBadge;
    const shouldShowOrganisationRow = Boolean(m.organisation_name && m.organisation_name !== trustName);
    const shouldShowRemarkRow = Boolean(m.remark);
    const showDetailsPanel = shouldShowMembershipRow || shouldShowOrganisationRow || shouldShowRemarkRow;
    const handleKeyDown = (event) => {
      if (!clickable) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.();
      }
    };

    return (
      <div
        key={m.id}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? onClick : undefined}
        onKeyDown={handleKeyDown}
        style={{
          background: colors.card,
          borderRadius: '24px',
          border: `1.5px solid ${colors.border}`,
          boxShadow: `0 14px 34px ${applyOpacity(colors.secondary, 0.1)}`,
          overflow: 'hidden',
          cursor: clickable ? 'pointer' : 'default',
          transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        }}
        onMouseEnter={(event) => {
          if (!clickable) return;
          event.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(event) => {
          if (!clickable) return;
          event.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <div style={{ height: '3px', background: isVip ? colors.vipBg : `linear-gradient(90deg, ${colors.primary}, ${colors.accent})` }} />
        <div style={{ padding: '16px 16px 14px' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
            <TrustAvatar trust={m.Trust || { name: trustName, icon_url: null }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--heading-color)', margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trustName}
              </h3>
              {showSetuVerifiedBadge && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '2px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 800, color: colors.onPrimary, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`, border: `1px solid ${applyOpacity(colors.primary, 0.4)}`, padding: '3px 10px 3px 8px', borderRadius: '999px', letterSpacing: '0.06em', boxShadow: `0 2px 6px ${applyOpacity(colors.primary, 0.35)}` }}>
                    <BadgeCheck size={11} strokeWidth={2.5} />
                    Setu verified
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, color: colors.vipText, background: colors.vipBg, border: `1px solid ${colors.vipBorder}`, padding: '3px 10px', borderRadius: '999px', letterSpacing: '0.08em' }}>
                    {membershipNoText}
                  </span>
                  {membershipTypeText && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 800, color: colors.vipText, background: colors.vipBg, border: `1px solid ${colors.vipBorder}`, padding: '3px 10px', borderRadius: '999px', letterSpacing: '0.08em' }}>
                      {membershipTypeText}
                    </span>
                  )}
                </div>
              )}
            </div>
            {clickable ? (
              <div
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{
                  background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))',
                  color: colors.primary,
                  flexShrink: 0,
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </div>
            ) : null}
            {/* Delete button */}
            {showDelete && (
              <button
                onClick={() => handleDelete(m.id)}
                disabled={deletingId === m.id}
                style={{ width: 32, height: 32, borderRadius: '10px', border: 'none', background: colors.errorBg, color: colors.error, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                title="Remove"
              >
                {deletingId === m.id ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <X size={14} />}
              </button>
            )}
          </div>

          {/* Details grid */}
          {showDetailsPanel && (
            <div style={{ background: `linear-gradient(160deg, ${colors.cardInner} 0%, ${applyOpacity(colors.accentBg, 0.24)} 100%)`, borderRadius: '16px', padding: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', border: `1px solid ${applyOpacity(colors.secondary, 0.06)}` }}>
            {shouldShowMembershipRow && (
              <div style={{ gridColumn: '1/-1' }}>
                <Label>{membershipLabel}</Label>
                <p style={{ fontSize: '15px', fontWeight: 800, color: colors.primary, margin: 0, letterSpacing: '0.05em' }}>{m.membership_no}</p>
              </div>
            )}
            {shouldShowOrganisationRow && (
              <div style={{ gridColumn: '1/-1' }}>
                <Label>Organisation</Label>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--heading-color)', margin: 0 }}>{m.organisation_name}</p>
              </div>
            )}
            {shouldShowRemarkRow && (
              <div style={{ gridColumn: '1/-1', background: 'color-mix(in srgb, var(--advertisement-badge-bg) 42%, var(--advertisement-card-bg))', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--advertisement-card-border)', marginTop: 2 }}>
                <Label>Remark</Label>
                <p style={{ fontSize: '12px', color: 'var(--advertisement-description)', margin: 0, lineHeight: 1.5, fontWeight: 500 }}>{m.remark}</p>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    );
  };

  const TrustLinkTile = ({ link, onClick, onOpenCard, isLoading }) => {
    const trustName = link.Trust?.name || link.organisation_name || '-';
    const legalName = normalizeText(
      link.Trust?.legal_name
      || link.remark1
      || link.remark
      || link.role
      || link.membership_type
    );
    const trustId = normalizeText(link?.trust_id || link?.Trust?.id || link?.id);
    const portalCode = trustId
      ? trustId.replace(/[^a-z0-9]/gi, '').slice(-3).toUpperCase()
      : String(Math.max(1, trustName.length)).padStart(3, '0');

    const handleKeyDown = (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.();
      }
    };

    const handleOpenCardClick = (event) => {
      event.stopPropagation();
      onOpenCard?.();
    };

    // Setu's dark theme keeps its fixed gold look; a light tenant theme gets
    // colors derived from that theme instead so the cards don't clash.
    const tile = isLightTheme
      ? {
          cardBg: `linear-gradient(155deg, ${applyOpacity(colors.secondary, 0.1)} 0%, ${applyOpacity('var(--surface-color)', 0.98)} 62%, ${applyOpacity(colors.primary, 0.06)} 100%)`,
          border: applyOpacity(colors.primary, 0.22),
          borderHover: applyOpacity(colors.primary, 0.55),
          shadow: `0 8px 24px ${applyOpacity(colors.secondary, 0.14)}, inset 0 1px 0 rgba(255,255,255,0.5)`,
          shadowHover: `0 16px 36px ${applyOpacity(colors.secondary, 0.18)}, 0 0 0 1px ${applyOpacity(colors.primary, 0.16)}, inset 0 1px 0 rgba(255,255,255,0.6)`,
          accentLine: `linear-gradient(90deg, transparent, ${applyOpacity(colors.primary, 0.7)} 40%, ${applyOpacity(colors.accent, 0.9)} 60%, transparent)`,
          glow: `radial-gradient(circle, ${applyOpacity(colors.primary, 0.08)}, transparent 70%)`,
          avatarFrame: `linear-gradient(135deg, ${applyOpacity(colors.primary, 0.3)}, ${applyOpacity(colors.primary, 0.05)})`,
          badgeText: colors.primary,
          badgeBg: applyOpacity(colors.primary, 0.08),
          badgeBorder: applyOpacity(colors.primary, 0.22),
          nameColor: 'var(--heading-color)',
          legalColor: 'var(--advertisement-description)',
        }
      : {
          cardBg: 'linear-gradient(155deg, rgba(28,31,45,0.98) 0%, rgba(13,15,24,0.99) 62%, rgba(20,17,10,0.99) 100%)',
          border: 'rgba(226, 178, 39, 0.22)',
          borderHover: 'rgba(226, 178, 39, 0.6)',
          shadow: '0 8px 24px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.05)',
          shadowHover: '0 16px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(226,178,39,0.18), inset 0 1px 0 rgba(255,255,255,0.07)',
          accentLine: 'linear-gradient(90deg, transparent, rgba(226,178,39,0.75) 40%, rgba(255,213,110,0.95) 60%, transparent)',
          glow: 'radial-gradient(circle, rgba(226,178,39,0.10), transparent 70%)',
          avatarFrame: 'linear-gradient(135deg, rgba(226,178,39,0.35), rgba(226,178,39,0.05))',
          badgeText: 'rgba(226,178,39,0.75)',
          badgeBg: 'rgba(226,178,39,0.08)',
          badgeBorder: 'rgba(226,178,39,0.22)',
          nameColor: '#f6f2e6',
          legalColor: 'rgba(224,230,241,0.58)',
        };

    return (
      <div
        className={`other-membership-card${isLightTheme ? ' other-membership-card--light' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        style={{
          position: 'relative',
          background: tile.cardBg,
          border: `1px solid ${tile.border}`,
          borderRadius: '18px',
          padding: '14px 13px 12px',
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: '9px',
          boxShadow: tile.shadow,
          transition: 'transform 0.2s cubic-bezier(0.22,1,0.36,1), border-color 0.2s ease, box-shadow 0.2s ease',
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.transform = 'translateY(-4px) scale(1.015)';
          event.currentTarget.style.borderColor = tile.borderHover;
          event.currentTarget.style.boxShadow = tile.shadowHover;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = 'translateY(0) scale(1)';
          event.currentTarget.style.borderColor = tile.border;
          event.currentTarget.style.boxShadow = tile.shadow;
        }}
      >
        {/* Theme accent line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2.5px',
          background: tile.accentLine,
          borderRadius: '18px 18px 0 0',
        }} />

        {/* Soft corner glow */}
        <div style={{
          position: 'absolute', top: '-30%', right: '-30%', width: '70%', height: '70%',
          background: tile.glow,
          pointerEvents: 'none',
        }} />

        {/* Row 1: Logo + Portal badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{
            padding: '3px',
            borderRadius: '13px',
            background: tile.avatarFrame,
          }}>
            <TrustAvatar trust={link.Trust || { name: trustName, icon_url: null }} size={36} />
          </div>
          <span style={{
            fontSize: '7px',
            fontWeight: 800,
            color: tile.badgeText,
            background: tile.badgeBg,
            border: `1px solid ${tile.badgeBorder}`,
            borderRadius: '5px',
            padding: '3px 6px',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            flexShrink: 0,
            marginTop: '2px',
          }}>Portal</span>
        </div>

        {/* Row 2: Trust name */}
        <MarqueeText
          speed={20}
          style={{
            fontSize: '12.5px',
            lineHeight: 1.3,
            fontWeight: 800,
            color: tile.nameColor,
            letterSpacing: '-0.01em',
          }}
        >
          {trustName}
        </MarqueeText>

        {/* Row 3: Legal name */}
        {legalName && (
          <MarqueeText
            speed={20}
            style={{
              fontSize: '9.5px',
              lineHeight: 1.4,
              fontWeight: 500,
              color: tile.legalColor,
            }}
          >
            {legalName}
          </MarqueeText>
        )}
      </div>
    );
  };

  // ── render ──
  return (
    <div
      className="om-shell"
      style={{
        width: '100%',
        margin: '0 auto',
	        minHeight: isHomeVariant ? 'auto' : '100dvh',
        overflow: 'visible',
        fontFamily: "var(--font-family, 'Inter', sans-serif)",
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ── */}
      <div
        className="px-4 py-4 md:px-8 md:py-5 lg:px-12 flex items-center justify-between sticky top-0 z-50 shadow-md"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          color: navbarTheme?.textColor || 'var(--navbar-text)',
        }}
      >
        <button
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className="p-2 rounded-xl transition-colors"
          style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <h1 className="text-base md:text-lg font-bold tracking-wide" style={{ color: navbarTheme?.textColor || 'var(--navbar-text)' }}>
          Other Memberships
        </h1>
        <button
          onClick={() => (onNavigate ? onNavigate('home') : navigate(getAppHomePath()))}
          className="p-2 rounded-xl transition-colors"
          style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
        >
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

	      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="other-memberships" />
	        </>
	      )}

      {/* ── Content ── */}
      <div className="om-content" style={{ width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Success banner */}
        {submitSuccess && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: colors.successBg, border: `1.5px solid #BBF7D0`, borderRadius: '14px', padding: '12px 16px', marginBottom: '16px', animation: 'fadeUp 0.3s ease-out' }}>
            <CheckCircle size={18} color={colors.success} />
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#15803d', margin: 0 }}>{submitSuccess}</p>
          </div>
        )}

        {/* Loading spinner */}
        {loading && trustLinks.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0' }}>
            <div style={{ width: 48, height: 48, border: '3px solid var(--advertisement-card-border)', borderTop: `3px solid ${colors.primary}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '16px' }} />
            <p style={{ fontSize: '14px', color: colors.muted, fontWeight: 500 }}>Loading memberships...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{ background: colors.errorBg, border: '1.5px solid var(--advertisement-card-border)', borderRadius: '16px', padding: '20px', textAlign: 'center', marginBottom: '16px' }}>
            <AlertCircle size={24} color={colors.error} style={{ margin: '0 auto 8px', display: 'block' }} />
            <p style={{ color: colors.error, fontSize: '14px', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button onClick={loadData} style={{ padding: '8px 20px', background: colors.primary, color: colors.onPrimary, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        {!error && (
          <>
            {showCreateNewApp && (
              <button
                className="om-primary-btn"
                onClick={() => { setShowForm(true); setSubmitError(''); setSubmitSuccess(''); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px 20px', background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`, color: '#fff', border: 'none', borderRadius: '16px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '20px', boxShadow: `0 8px 18px ${applyOpacity(colors.primary, 0.26)}`, letterSpacing: '-0.2px', animation: 'fadeUp 0.3s ease-out' }}
              >
                <Plus size={20} />
                Create New App
              </button>
            )}

            {/* ── ADD MEMBERSHIP FORM ── */}
            {showForm && (
              <div className="om-form-card" style={{ background: 'var(--advertisement-card-bg)', borderRadius: '20px', border: '2px solid var(--advertisement-card-border)', boxShadow: '0 12px 32px color-mix(in srgb, var(--advertisement-card-shadow) 26%, transparent)', marginBottom: '24px', overflow: 'hidden', animation: 'fadeUp 0.35s ease-out' }}>
                <div style={{ background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={18} color="#fff" />
                    </div>
                    <div>
                      <h2 style={{ color: '#fff', fontSize: '15px', fontWeight: 800, margin: 0 }}>Add New Membership</h2>
                      <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '11px', margin: 0 }}>Fill in the trust membership details</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowForm(false); setSubmitError(''); setForm(EMPTY_FORM); }}
                    style={{ width: 32, height: 32, borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <X size={16} />
                  </button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '20px' }}>

                  {/* Trust / Organisation — plain text input */}
                  <div style={{ marginBottom: '16px' }}>
                    <Label><Building2 size={10} style={{ display: 'inline', marginRight: 5 }} />Trust / Organisation *</Label>
                    <input
                      type="text"
                      placeholder="Enter trust or organisation name"
                      value={form.organisation_name}
                      onChange={e => handleFormChange('organisation_name', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  {/* Membership Number */}
                  <div style={{ marginBottom: '16px' }}>
                    <Label><Hash size={10} style={{ display: 'inline', marginRight: 5 }} />Membership Number *</Label>
                    <input
                      type="text"
                      placeholder="e.g. MBR-2024-001"
                      value={form.membership_no}
                      onChange={e => handleFormChange('membership_no', e.target.value)}
                      required
                      style={inputStyle}
                    />
                  </div>

                  {/* Membership Type — free text, optional */}
                  <div style={{ marginBottom: '16px' }}>
                    <Label><Tag size={10} style={{ display: 'inline', marginRight: 5 }} />Membership Type (optional)</Label>
                    <input
                      type="text"
                      placeholder="e.g. Life Member, Annual Member..."
                      value={form.membership_type}
                      onChange={e => handleFormChange('membership_type', e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  {/* Remark */}
                  <div style={{ marginBottom: '20px' }}>
                    <Label><FileText size={10} style={{ display: 'inline', marginRight: 5 }} />Remark (optional)</Label>
                    <textarea
                      placeholder="Any notes or remarks..."
                      value={form.remark}
                      onChange={e => handleFormChange('remark', e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </div>

                  {/* Submit error */}
                  {submitError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: colors.errorBg, border: `1px solid #FECACA`, borderRadius: '10px', padding: '10px 14px', marginBottom: '14px' }}>
                      <AlertCircle size={16} color={colors.error} />
                      <p style={{ fontSize: '13px', color: colors.error, margin: 0, fontWeight: 600 }}>{submitError}</p>
                    </div>
                  )}

                  {/* Submit buttons */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button"
                      onClick={() => { setShowForm(false); setSubmitError(''); setForm(EMPTY_FORM); }}
                      style={{ flex: 1, padding: '12px', background: 'color-mix(in srgb, var(--advertisement-card-bg) 82%, var(--app-accent-bg))', color: 'var(--advertisement-description)', border: '1px solid var(--advertisement-card-border)', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button type="submit" disabled={submitting}
                      style={{ flex: 2, padding: '12px', background: submitting ? 'var(--body-text-color)' : `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`, color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: submitting ? 'none' : `0 8px 16px ${applyOpacity(colors.primary, 0.22)}` }}>
                      {submitting
                        ? <><Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> Saving…</>
                        : <><Save size={16} /> Save Membership</>}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ── SECTION: Other Memberships (from other_memberships table) ── */}
            {otherMems.length > 0 && (
              <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '8px', background: `linear-gradient(135deg, ${colors.accent}, ${colors.primary})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Building2 size={14} color={colors.onPrimary} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: colors.accent }}>
                    {otherMems.length} Added Membership{otherMems.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="om-card-grid">
                  {otherMems.map((m, idx) => (
                    <MembershipCard key={m.id} m={m} index={idx} showGoldenMembershipBadge={false} />
                  ))}
                </div>
              </div>
            )}

            {/* ── SECTION: Trust Links (from reg_members-backed user payload) ── */}
            {trustLinks.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '8px', background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={14} color="#fff" />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: colors.primary }}>
                    {trustLinks.length} Trust{trustLinks.length !== 1 ? 's' : ''} Linked
                  </span>
                </div>
                <div className="om-card-grid">
                  {trustLinks.map((link, index) => (
                    <MembershipCard
                      key={link.id || index}
                      m={link}
                      index={index}
                      showGoldenMembershipBadge
                      clickable
                      onClick={() => openTrustIdCard(link)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {otherMems.length === 0 && trustLinks.length === 0 && (
              <div
                className="om-empty-state"
                style={{
                  textAlign: 'center',
                  padding: '60px 24px',
                  background: 'var(--advertisement-card-bg)',
                  borderRadius: '20px',
                  border: '1.5px solid var(--advertisement-card-border)',
                  boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 32%, transparent)'
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '20px',
                    background: 'color-mix(in srgb, var(--advertisement-card-bg) 78%, var(--app-accent-bg))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}
                >
                  <Building2 size={32} color={'var(--advertisement-title)'} />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--advertisement-description)', margin: '0 0 8px' }}>No Memberships Yet</h3>
                <p style={{ fontSize: '13px', color: 'var(--advertisement-subtitle)', margin: 0, lineHeight: 1.5 }}>
                  Your linked memberships will appear here when available.
                </p>
              </div>
            )}
          </>
        )}

      </div>

      {trustCardModalData && (
        <div
          data-sidebar-overlay="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
          onClick={() => setTrustCardModalData(null)}
        >
          <button
            type="button"
            onClick={() => setTrustCardModalData(null)}
            className="absolute right-2 top-2 rounded-full"
            style={{
              width: 33,
              height: 36,
              border: 'none',
              background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))',
              color: colors.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close trust card"
          >
            <X size={16} />
          </button>
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '92vh',
              overflow: 'hidden',
              borderRadius: '28px',
            }}
          >
            <div style={{ maxHeight: 'calc(92vh - 66px)', overflow: 'auto' }}>
              <TrustIdCard embedded cardData={trustCardModalData} onNavigate={onNavigate} />
            </div>
          </div>
        </div>
      )}

      <style>{`
        input::placeholder, textarea::placeholder {
          color: var(--advertisement-subtitle);
          opacity: 0.9;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
	        @keyframes fadeUp {
	          from { opacity: 0; transform: translateY(16px); }
	          to   { opacity: 1; transform: translateY(0); }
	        }
	        .portal-text-window {
	          width: 100%;
	          min-width: 0;
	          overflow: hidden;
	          white-space: nowrap;
	        }
	        .portal-static-text {
	          display: block;
	          overflow: hidden;
	          text-overflow: ellipsis;
	          white-space: nowrap;
	        }
	        .portal-marquee-track {
	          display: inline-flex;
	          width: max-content;
	          min-width: 100%;
	          animation: portalTextMarquee 18s linear infinite;
	        }
	        .portal-marquee-text {
	          flex-shrink: 0;
	          white-space: nowrap;
	          padding-right: 26px;
	        }
	        @keyframes portalTextMarquee {
	          from { transform: translateX(0); }
	          to { transform: translateX(-50%); }
	        }
	        .legal-name-marquee-track {
	          display: flex;
	          width: max-content;
          animation: legalNameMarquee 10s linear infinite;
        }
        .legal-name-marquee-text {
          flex-shrink: 0;
          font-size: 12px;
          color: var(--advertisement-subtitle);
          line-height: 1.35;
          white-space: nowrap;
          padding-right: 28px;
        }
        @keyframes legalNameMarquee {
          0%, 20%   { transform: translateX(0); }
          80%, 100% { transform: translateX(-50%); }
        }

        .om-shell { max-width: 430px; }
        .om-content { padding: 20px 16px 40px; }
        .om-card-grid { display: flex; flex-direction: column; gap: 12px; }

        @media (min-width: 768px) {
          .om-shell { max-width: 100%; }
          .om-content { max-width: 1148px; margin-left: auto; margin-right: auto; padding: 28px 32px 48px; }
          .om-card-grid { display: flex; flex-direction: row; flex-wrap: wrap;  gap: 16px; }
          .om-card-grid > div { flex: 0 1 340px; }
          .om-primary-btn { max-width: 480px; margin-left: auto; margin-right: auto; }
          .om-form-card { max-width: 560px; margin-left: auto; margin-right: auto; }
          .om-empty-state { max-width: 560px; margin-left: auto; margin-right: auto; }
        }

        @media (min-width: 1024px) {
          .om-content {
            max-width: none;
            padding: 24px 28px 44px;
          }

          .om-primary-btn {
            width: fit-content !important;
            max-width: none;
            display: inline-flex !important;
            margin-left: auto !important;
            margin-right: 0 !important;
            padding-left: 22px !important;
            padding-right: 22px !important;
            float:right;
          }

          .om-card-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 18px;
          }

          .om-card-grid > div {
            width: 100%;
            min-width: 0;
            max-width: none;
          }
        }
      `}</style>
    </div>
  );
};

export const OtherMembershipsContent = (props) => <OtherMemberships {...props} variant="home" />;

export default OtherMemberships;
