import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Menu, Home as HomeIcon,
  AlertCircle, Building2, Loader2, ChevronRight, BadgeCheck, ExternalLink
} from 'lucide-react';
import Sidebar from './features/sidebar/Sidebar';
import BottomNav from './components/BottomNav';
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



const OtherMemberships = ({ onNavigate }) => {
  const navigate = useNavigate();
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

  // ── state ──
  const [trustLinks, setTrustLinks] = useState(initialTrustLinks); // from reg_members-backed user payload
  const [otherMems, setOtherMems] = useState([]);        // from other_memberships table
  const [loading, setLoading] = useState(initialTrustLinks.length === 0);
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [trustCardModalData, setTrustCardModalData] = useState(null);
  const [trustWebAppOverlay, setTrustWebAppOverlay] = useState(null);
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
    document.documentElement.style.overflow = '';
    document.documentElement.style.position = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    document.body.style.touchAction = '';
  }, []);

  useEffect(() => {
    const hasCachedTrustLinks = initialTrustLinks.length > 0;
    loadData({ silent: hasCachedTrustLinks });
  }, [loadData, initialTrustLinks.length]);

  useEffect(() => {
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen]);

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
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen]);

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
    const trustName = normalizeText(link?.Trust?.name) || 'Trust';

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

      setTrustWebAppOverlay({ url: webAppUrl, name: trustName });
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
    const trustName = link.Trust?.name || link.organisation_name || '—';
    const legalName = normalizeText(link.Trust?.legal_name);

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

    return (
      <div
        className="other-membership-card"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        style={{
          background: 'color-mix(in srgb, var(--advertisement-card-bg) 86%, var(--app-accent-bg))',
          border: '1px solid var(--advertisement-card-border)',
          borderRadius: '16px',
          padding: '14px',
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
            <TrustAvatar trust={link.Trust || { name: trustName, icon_url: null }} size={48} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--advertisement-title)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trustName}
              </h3>
              <button
                type="button"
                onClick={handleOpenCardClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  alignSelf: 'flex-start',
                  fontSize: '11px',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  color: colors.primary,
                  background: 'transparent',
                  border: `1px solid ${colors.primary}`,
                  borderRadius: '999px',
                  padding: '3px 10px',
                  cursor: 'pointer',
                  marginBottom: legalName ? '8px' : 0,
                }}
              >
                <BadgeCheck size={11} strokeWidth={2.5} />
                Digital ID
              </button>
              {legalName && (
                <div style={{ width: '150%', overflow: 'hidden', position:'relative', left:'-60px' }}>
                  {legalName.length > 25 ? (
                    <div className="legal-name-marquee-track">
                      <span className="legal-name-marquee-text">{legalName}</span>
                      <span className="legal-name-marquee-text">{legalName}</span>
                    </div>
                  ) : (
                    <p style={{ fontSize: '12px', color: 'var(--advertisement-subtitle)', margin: 0, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {legalName}
                    </p>
                  )}
                </div>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // ── render ──
  return (
    <div
      className="other-memberships-page"
      style={{
        width: '100%',
        maxWidth: '430px',
        margin: '0 auto',
        minHeight: '100dvh',
        overflow: 'visible',
        fontFamily: "var(--font-family, 'Inter', sans-serif)",
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ── */}
      <div
        className="other-memberships-header px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md"
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
        <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTheme?.textColor || 'var(--navbar-text)' }}>
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

      {/* ── Content ── */}
      <div className="other-memberships-content" style={{ width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
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
                type="button"
                onClick={handleCreateNewApp}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '14px 20px',
                  background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
                  color: colors.onPrimary,
                  border: 'none',
                  borderRadius: '16px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginBottom: '20px',
                  boxShadow: `0 8px 18px ${applyOpacity(colors.primary, 0.26)}`,
                  letterSpacing: 0,
                  animation: 'fadeUp 0.3s ease-out'
                }}
              >
                <Plus size={20} />
                Create New App
              </button>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {sortedOtherMems.map((m, idx) => (
                    <MembershipCard key={m.id} m={m} index={idx} showGoldenMembershipBadge={false} />
                  ))}
                </div>
              </div>
            )}

            {/* ── SECTION: Trust Links (from reg_members-backed user payload) ── */}
            {trustLinks.length > 0 && (
              <div
                className="other-memberships-grid"
                style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', columnGap: '14px', rowGap: '16px' }}
              >
                {sortedTrustLinks.map((link, index) => (
                  <TrustLinkTile
                    key={link.id || index}
                    link={link}
                    onClick={() => handleOpenTrustWebApp(link)}
                    onOpenCard={() => openTrustIdCard(link)}
                    isLoading={openingTrustId === normalizeText(link?.trust_id || link?.Trust?.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {otherMems.length === 0 && trustLinks.length === 0 && (
              <div
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

      {trustWebAppOverlay && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            background: 'var(--page-bg, var(--app-page-bg))',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '430px',
              minHeight: '100dvh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--page-bg, var(--app-page-bg))',
            }}
          >
            <div
              className="theme-navbar sticky top-0 z-20 flex-shrink-0"
              style={{
                background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
                backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
                WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
                borderBottom: '1px solid var(--navbar-border)',
              }}
            >
              <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
              <div className="px-4 pt-4 pb-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setTrustWebAppOverlay(null)}
                  className="p-2 rounded-xl transition-colors"
                  style={{ color: navbarTheme?.textColor, background: 'transparent' }}
                  aria-label="Back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <h1
                  className="text-base font-bold tracking-wide"
                  style={{ color: navbarTheme?.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'center', margin: '0 8px' }}
                >
                  {trustWebAppOverlay.name}
                </h1>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => window.open(trustWebAppOverlay.url, '_blank', 'noopener,noreferrer')}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: navbarTheme?.textColor, background: 'transparent' }}
                    aria-label="Open in new tab"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTrustWebAppOverlay(null); navigate(getAppHomePath()); }}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: navbarTheme?.textColor, background: 'transparent' }}
                    aria-label="Home"
                  >
                    <HomeIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <iframe
              title={trustWebAppOverlay.name}
              src={trustWebAppOverlay.url}
              className="flex-1 w-full border-0"
              style={{
                border: 'none',
                outline: 'none',
                display: 'block',
              }}
            />

            <BottomNav onNavigate={onNavigate} />
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
      `}</style>
    </div>
  );
};

export default OtherMemberships;
