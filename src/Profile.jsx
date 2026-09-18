import React, { useState, useEffect, useRef } from 'react';
import {
  User, Mail, Calendar, MapPin, Briefcase, Pencil, Save,
  Shield, BadgeCheck, Phone, Droplet, UserCircle,
  Home as HomeIcon, Menu, X, Award, CheckCircle, AlertCircle,
} from 'lucide-react';
import Sidebar from './features/sidebar/Sidebar';
import { getProfile, saveProfile } from './services/api';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';

// Classy input field — label on top, styled bordered input
const RowField = ({ label, type = 'text', value, onChange, placeholder, disabled = false, icon: Icon }) => (
  <div className={`flex flex-col gap-1 ${disabled ? 'opacity-70' : ''}`}>
    <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5 flex items-center gap-1" style={{ color: 'var(--brand-navy)' }}>
      {Icon && <Icon className="h-3 w-3" />}{label}
      {disabled && <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-1 font-semibold" style={{ background: 'color-mix(in srgb, var(--surface-color) 78%, var(--app-accent-bg))', color: 'color-mix(in srgb, var(--body-text-color) 60%, var(--surface-color))' }}>AUTO</span>}
    </label>
    <div
      className="relative rounded-2xl border-2 transition-all"
      style={{
        boxShadow: 'none',
        borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)',
        background: disabled ? 'color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg))' : 'var(--surface-color)'
      }}
      onFocusCapture={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
      onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        disabled={disabled}
        className="w-full px-4 py-3 text-sm font-medium bg-transparent focus:outline-none placeholder:opacity-65 disabled:cursor-not-allowed rounded-2xl"
        style={{ color: 'var(--body-text-color)' }}
      />
    </div>
  </div>
);

// Date field
const RowDate = ({ label, value, onChange, icon: Icon }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5 flex items-center gap-1" style={{ color: 'var(--brand-navy)' }}>
      {Icon && <Icon className="h-3 w-3" />}{label}
    </label>
    <div className="relative rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }} onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }} onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 text-sm font-medium bg-transparent focus:outline-none rounded-2xl"
        style={{ color: 'var(--body-text-color)' }}
      />
    </div>
  </div>
);

// Select field
const RowSelect = ({ label, value, onChange, options, placeholder, icon: Icon }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5 flex items-center gap-1" style={{ color: 'var(--brand-navy)' }}>
      {Icon && <Icon className="h-3 w-3" />}{label}
    </label>
    <div className="relative rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }} onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }} onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 text-sm font-medium bg-transparent focus:outline-none appearance-none rounded-2xl pr-8"
        style={{ color: 'var(--body-text-color)' }}
      >
        <option value="">{placeholder || 'Select'}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
        <svg className="h-4 w-4" style={{ color: 'color-mix(in srgb, var(--body-text-color) 45%, var(--surface-color))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
    </div>
  </div>
);

// Section header with colored left pill
const SectionHeader = ({ title, color = 'var(--brand-red)' }) => (
  <div className="flex items-center gap-2.5 pt-7 pb-3">
    <div className="w-1 h-5 rounded-full" style={{ background: color }} />
    <span className="text-xs font-extrabold uppercase tracking-widest" style={{ color: 'color-mix(in srgb, var(--body-text-color) 58%, var(--surface-color))' }}>{title}</span>
  </div>
);

const resolveNameValue = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const trimmed = String(candidate).trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const normalizeTrustId = (value) => String(value || '').trim().toLowerCase();
const resolveMembershipNo = (...sources) => {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    const val = src.membership_number || src.membershipNumber || src['Membership number'];
    if (String(val || '').trim()) return String(val).trim();
  }
  return '';
};
const resolvePhotoUrl = (...candidates) => {
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (v) return v;
  }
  return '';
};
const getCurrentUserPhotoCacheKey = (user = {}) => {
  const userId = String(user?.Mobile || user?.mobile || user?.id || user?.['Membership number'] || 'default').trim();
  return `last_profile_photo_url_${userId || 'default'}`;
};

const getScopedProfilePhoto = (user = {}) => {
  try {
    const scopedPhoto = localStorage.getItem(getCurrentUserPhotoCacheKey(user));
    const direct = resolvePhotoUrl(
      scopedPhoto,
      user?.profile_photo_url,
      user?.profilePhotoUrl
    );
    if (direct) return direct;
    const currentUserProfileKey = `userProfile_${user?.Mobile || user?.mobile || user?.id || 'default'}`;
    const row = JSON.parse(localStorage.getItem(currentUserProfileKey) || '{}');
    const url = resolvePhotoUrl(row?.profile_photo_url, row?.profilePhotoUrl);
    if (url) return url;
  } catch {
    // ignore cache errors
  }
  return '';
};

const parseTimestamp = (value) => {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};

const getUserProfileSnapshot = (user = {}) => {
  try {
    const key = `userProfile_${user?.Mobile || user?.mobile || user?.id || 'default'}`;
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};

const removeLocalStorageByPrefix = (prefixes = []) => {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key.startsWith(prefix))) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore cache cleanup failures
  }
};

const setLocalStorageWithQuotaRecovery = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (err?.name !== 'QuotaExceededError') return false;
    removeLocalStorageByPrefix([
      'gallery_normalized_cache_',
      'gallery_persistent_cache_',
      'sponsors_cache_',
      'sponsors_list_cache_',
      'marquee_cache_',
      'memberTrustLinks_',
      'trust_list_cache',
      'theme_cache_',
      'directory_cache_',
      'noticeboard_store_',
      'facilities_store_',
      'events_store_',
    ]);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
};
const buildInitialProfileData = () => {
  const base = {
    name: '', role: '', memberId: '', mobile: '', email: '',
    members_id: '',
    address_home: '', address_office: '', company_name: '',
    resident_landline: '', office_landline: '',
    gender: '', marital_status: '', nationality: 'Indian', aadhaar_id: '',
    blood_group: '', dob: '',
    emergency_contact_name: '', emergency_contact_number: '',
    profile_photo_url: '',
    spouse_name: '', spouse_contact_number: '', children_count: '',
    facebook: '', twitter: '', instagram: '', linkedin: '', whatsapp: '',
    position: '', location: '', isElectedMember: false, name_locked: false
  };
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const trustId = normalizeTrustId(localStorage.getItem('selected_trust_id') || '');
    const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
    const selectedMembership = memberships.find((m) => normalizeTrustId(m?.trust_id) === trustId) || null;
    const selectedMember = JSON.parse(sessionStorage.getItem('selectedMember') || '{}');
    const key = `userProfile_${user.Mobile || user.mobile || user.id || 'default'}`;
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      ...base,
      ...saved,
      name: saved?.name || user?.Name || user?.name || '',
      role: selectedMembership?.role || saved?.role || '',
      memberId: resolveMembershipNo(selectedMembership, selectedMember, saved, user) || saved?.memberId || '',
      members_id: saved?.members_id || user?.members_id || user?.member_id || user?.id || '',
      mobile: saved?.mobile || user?.Mobile || user?.mobile || '',
      email: saved?.email || user?.Email || user?.email || '',
      address_home: saved?.address_home || user?.['Address Home'] || '',
      address_office: saved?.address_office || user?.['Address Office'] || '',
      company_name: saved?.company_name || user?.['Company Name'] || '',
      resident_landline: saved?.resident_landline || user?.['Resident Landline'] || '',
      office_landline: saved?.office_landline || user?.['Office Landline'] || '',
      name_locked: Boolean(saved?.name_locked ?? String(user?.Name || user?.name || '').trim())
    };
  } catch {
    return base;
  }
};
const SectionCard = ({ title, subtitle, isOpen, onToggle = () => { }, children }) => (
  <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--advertisement-card-border)', background: 'var(--advertisement-card-bg)' }}>
    <button type="button" onClick={onToggle} className="w-full px-4 py-3.5 flex items-center justify-between text-left">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--advertisement-title)' }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--advertisement-subtitle)' }}>{subtitle}</p>
      </div>
      <span className="text-lg font-bold" style={{ color: 'var(--brand-navy)' }}>{isOpen ? '−' : '+'}</span>
    </button>
    {isOpen && <div className="px-4 pb-4 space-y-3">{children}</div>}
  </div>
);

const DetailRow = ({ label, value, icon: Icon }) => (
  <div className="flex items-start gap-2.5 py-2.5">
    {Icon ? (
      <span className="mt-0.5 p-1.5 rounded-lg" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 82%, var(--app-accent-bg))' }}>
        <Icon className="h-3.5 w-3.5" style={{ color: 'var(--advertisement-title)' }} />
      </span>
    ) : null}
    <div className="min-w-0">
      <p className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--advertisement-subtitle)' }}>
        {label}
      </p>
      <p className="text-[15px] font-semibold break-words" style={{ color: 'var(--advertisement-description)' }}>
        {value}
      </p>
    </div>
  </div>
);

const DetailSummaryCard = ({ title, subtitle, children }) => (
  <div
    className="rounded-3xl p-4 border shadow-sm"
    style={{
      borderColor: 'var(--advertisement-card-border)',
      background: 'var(--advertisement-card-bg)',
      boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 34%, transparent)'
    }}
  >
    <div className="mb-2.5">
      <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--advertisement-title)' }}>{title}</p>
      {subtitle ? (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--advertisement-subtitle)' }}>
          {subtitle}
        </p>
      ) : null}
    </div>
    <div className="divide-y" style={{ borderColor: 'color-mix(in srgb, var(--advertisement-card-border) 62%, transparent)' }}>
      {children}
    </div>
  </div>
);

const Profile = ({ onNavigate, onProfileUpdate }) => {
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  const TABS = ['Details'];

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const mainContainerRef = useRef(null);
  const hasLoadedProfileRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showUnderReviewPopup, setShowUnderReviewPopup] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNavWarning, setShowNavWarning] = useState(false);
  const [navTarget, setNavTarget] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [activeTab, setActiveTab] = useState('Details');
  const [isEditMode, setIsEditMode] = useState(false);
  const [allowManualNameEntry, setAllowManualNameEntry] = useState(false);
  const [selectedTrustId, setSelectedTrustId] = useState(() => localStorage.getItem('selected_trust_id') || '');

  const [profileData, setProfileData] = useState(() => buildInitialProfileData());

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(() => {
    const boot = buildInitialProfileData();
    return boot.profile_photo_url || null;
  });

  const set = (field) => (val) => setProfileData(prev => ({ ...prev, [field]: val }));

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log('[NavbarText][Profile]', {
      selectedTrustId: localStorage.getItem('selected_trust_id') || null,
      templateId: theme?.templateId || null,
      resolvedNavbarTextColor: navbarTextColor,
      finalAppliedNavbarTextColor: navbarTextColor,
      source: theme?.themeLoadSource || 'unknown',
      previouslyHardcodedOverridesRemoved: ['Menu text-white', 'Title text-white', 'Home icon text-white']
    });
  }, [navbarTextColor, theme?.templateId, theme?.themeLoadSource]);

  // Detect unsaved changes
  useEffect(() => {
    if (!loading && profileData.name) setOriginalData(JSON.parse(JSON.stringify(profileData)));
  }, [loading]);

  useEffect(() => {
    if (originalData) setHasUnsavedChanges(JSON.stringify(profileData) !== JSON.stringify(originalData) || photoFile !== null);
  }, [profileData, photoFile, originalData]);

  // Scroll lock
  useEffect(() => {
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0') * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, y);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen]);

  // Outside click close sidebar
  useEffect(() => {
    if (!isMenuOpen) return;
    const h = (e) => { if (!e.target.closest('[data-sidebar="true"]') && !e.target.closest('[data-sidebar-overlay="true"]')) setIsMenuOpen(false); };
    document.addEventListener('click', h, true);
    return () => document.removeEventListener('click', h, true);
  }, [isMenuOpen]);

  useEffect(() => {
    const syncTrustId = () => {
      const next = localStorage.getItem('selected_trust_id') || '';
      setSelectedTrustId((prev) => (prev === next ? prev : next));
    };
    const onTrustChanged = (event) => {
      const next = event?.detail?.trustId || localStorage.getItem('selected_trust_id') || '';
      setSelectedTrustId((prev) => (prev === next ? prev : next));
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
    if (hasLoadedProfileRef.current) return;
    hasLoadedProfileRef.current = true;
    try { localStorage.removeItem('last_profile_photo_url'); } catch { /* ignore */ }
    loadProfile();
  }, []);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const selectedMembership = getSelectedMembershipFromUser(user);
    if (!selectedMembership) return;
    setProfileData((prev) => ({
      ...prev,
      role: selectedMembership?.role || prev.role || '',
      memberId: resolveMembershipNo(selectedMembership, prev) || prev.memberId || '',
    }));
  }, [selectedTrustId]);

  const getSelectedMembershipFromUser = (user) => {
    const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
    const currentTrustId = normalizeTrustId(selectedTrustId || localStorage.getItem('selected_trust_id') || '');
    if (currentTrustId) {
      const byTrustId = memberships.find((membership) => normalizeTrustId(membership?.trust_id) === currentTrustId);
      if (byTrustId) return byTrustId;
    }
    const selectedTrustName = String(localStorage.getItem('selected_trust_name') || '').trim().toLowerCase();
    if (selectedTrustName) {
      const byName = memberships.find((membership) => String(membership?.trust_name || '').trim().toLowerCase() === selectedTrustName);
      if (byName) return byName;
    }
    return null;
  };

  const loadProfile = async () => {
    setLoading(true);
    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      const response = await getProfile();
      const p = response?.profile;
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const localSnapshot = getUserProfileSnapshot(user);
      const selectedMembership = getSelectedMembershipFromUser(user);
      if (response?.success && p) {
        const profileIsStaleComparedToLocal =
          parseTimestamp(localSnapshot?.updated_at || localSnapshot?.client_saved_at) >
          parseTimestamp(p?.updated_at);
        const effectiveProfile = profileIsStaleComparedToLocal ? { ...p, ...localSnapshot } : p;
        const resolvedName = resolveNameValue(
          effectiveProfile.name,
          effectiveProfile.full_name,
          effectiveProfile['Full Name'],
          user.name,
          user.Name,
          user.full_name,
          user['Full Name']
        );
        const nameLocked = Boolean(effectiveProfile.name_locked ?? String(effectiveProfile.name || '').trim());
        const trustRole = selectedMembership?.role || '';
        const selectedMember = JSON.parse(sessionStorage.getItem('selectedMember') || '{}');
        const trustMemberId = resolveMembershipNo(selectedMembership, selectedMember, effectiveProfile, user) || '';
        setAllowManualNameEntry(!nameLocked);
        let resolvedPhotoUrl = resolvePhotoUrl(
          effectiveProfile.profile_photo_url,
          effectiveProfile.profilePhotoUrl,
          effectiveProfile.photo_url
        );
        if (!resolvedPhotoUrl) {
          try {
            const membersIdForPhoto = effectiveProfile.members_id || user.members_id || user.member_id || user.id || '';
            if (membersIdForPhoto) {
              const { supabase } = await import('./services/supabaseClient.js');
              const { data: directPhotoRow } = await supabase
                .from('member_profiles')
                .select('profile_photo_url')
                .eq('members_id', membersIdForPhoto)
                .maybeSingle();
              resolvedPhotoUrl = resolvePhotoUrl(directPhotoRow?.profile_photo_url);
            }
          } catch {
            // ignore photo fallback errors
          }
        }
        if (!resolvedPhotoUrl) {
          resolvedPhotoUrl = getScopedProfilePhoto(user);
        }
        setProfileData({
          name: resolvedName,
          role: trustRole || '',
          memberId: trustMemberId || '',
          members_id: effectiveProfile.members_id || user.members_id || user.member_id || user.id || '',
          mobile: effectiveProfile.mobile || user.mobile || user.Mobile || '', email: effectiveProfile.email || user.email || user.Email || '',
          address_home: effectiveProfile.address_home || '', address_office: effectiveProfile.address_office || '',
          company_name: effectiveProfile.company_name || '', resident_landline: effectiveProfile.resident_landline || '',
          office_landline: effectiveProfile.office_landline || '', gender: effectiveProfile.gender || '',
          marital_status: effectiveProfile.marital_status || '', nationality: effectiveProfile.nationality || '',
          aadhaar_id: effectiveProfile.aadhaar_id || '', blood_group: effectiveProfile.blood_group || '',
          dob: effectiveProfile.dob || '', emergency_contact_name: effectiveProfile.emergency_contact_name || '',
          emergency_contact_number: effectiveProfile.emergency_contact_number || '',
          profile_photo_url: resolvedPhotoUrl || '',
          spouse_name: effectiveProfile.spouse_name || '', spouse_contact_number: effectiveProfile.spouse_contact_number || '',
          children_count: effectiveProfile.children_count ?? '',
          facebook: effectiveProfile.facebook || '', twitter: effectiveProfile.twitter || '', instagram: effectiveProfile.instagram || '',
          linkedin: effectiveProfile.linkedin || '', whatsapp: effectiveProfile.whatsapp || '',
          position: effectiveProfile.position || '', location: effectiveProfile.location || '',
          isElectedMember: effectiveProfile.isElectedMember || false,
          name_locked: nameLocked
        });
        if (resolvedPhotoUrl) {
          setPhotoPreview(resolvedPhotoUrl);
          localStorage.setItem(getCurrentUserPhotoCacheKey(user), resolvedPhotoUrl);
        }
      } else {
        loadFromLS();
      }
    } catch { loadFromLS(); }
    finally {
      if (import.meta.env.DEV) {
        const endedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        console.log(`[Perf][Profile] loadProfile completed in ${Math.round(endedAt - startedAt)}ms`);
      }
      setLoading(false);
    }
  };


  const loadFromLS = () => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const selectedMembership = getSelectedMembershipFromUser(user);
    const key = `userProfile_${user.Mobile || user.mobile || user.id || 'default'}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const p = JSON.parse(saved);
      const resolvedName = resolveNameValue(
        p?.name,
        p?.full_name,
        p?.['Full Name'],
        user.name,
        user['Name'],
        user.full_name,
        user['Full Name']
      );
      const nameLocked = Boolean(p?.name_locked ?? String(user?.Name || user?.name || '').trim());
      const trustRole = selectedMembership?.role || '';
      const selectedMember = JSON.parse(sessionStorage.getItem('selectedMember') || '{}');
      const trustMemberId = resolveMembershipNo(selectedMembership, selectedMember, p, user) || '';
      setAllowManualNameEntry(!nameLocked);
      setProfileData(prev => ({
        ...prev,
        ...p,
        name: resolvedName,
        role: trustRole || '',
        memberId: trustMemberId || '',
        name_locked: nameLocked
      }));
      const fallbackPhoto = resolvePhotoUrl(p.profile_photo_url, getScopedProfilePhoto(user));
      if (fallbackPhoto) {
        setPhotoPreview(fallbackPhoto);
        localStorage.setItem(getCurrentUserPhotoCacheKey(user), fallbackPhoto);
      }
    } else {
      const resolvedName = resolveNameValue(
        user.name,
        user['Name'],
        user.full_name,
        user['Full Name']
      );
      const nameLocked = Boolean(String(user?.Name || user?.name || '').trim());
      const trustRole = selectedMembership?.role || '';
      const selectedMember = JSON.parse(sessionStorage.getItem('selectedMember') || '{}');
      const trustMemberId = resolveMembershipNo(selectedMembership, selectedMember, user) || '';
      setAllowManualNameEntry(!nameLocked);
      setProfileData(prev => ({
        ...prev,
        name: resolvedName,
        role: trustRole || '',
        memberId: trustMemberId || '',
        members_id: user.members_id || user.member_id || user.id || '',
        mobile: user.Mobile || user.mobile || '', email: user.Email || user.email || '',
        address_home: user['Address Home'] || '', address_office: user['Address Office'] || '',
        company_name: user['Company Name'] || '',
        resident_landline: user['Resident Landline'] || '', office_landline: user['Office Landline'] || '',
        name_locked: nameLocked
      }));
      const fallbackPhoto = getScopedProfilePhoto(user);
      if (fallbackPhoto) {
        setPhotoPreview(fallbackPhoto);
        localStorage.setItem(getCurrentUserPhotoCacheKey(user), fallbackPhoto);
      }
    }
  };

  // Optimization: elected_members lookup removed.
  // Profile screen now relies only on getProfile()/local profile payload.

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Please select an image file' }); return; }
    if (file.size > 5 * 1024 * 1024) { setMessage({ type: 'error', text: 'Image must be under 5MB' }); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!profileData.name) { setMessage({ type: 'error', text: 'Please enter your name' }); return; }
    setSaving(true); setMessage({ type: '', text: '' });
    try {
      const response = await saveProfile(profileData, photoFile);
      if (!response?.success) throw new Error(response?.message || 'Failed to save');

      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const selectedMembership = getSelectedMembershipFromUser(user);
      const shouldTreatAsTrustMember = Boolean(selectedMembership?.trust_id);

      const mergedProfile = {
        ...profileData,
        ...(response?.profile || {}),
        name: resolveNameValue(response?.profile?.name, profileData.name),
        role: selectedMembership?.role || '',
        memberId: resolveMembershipNo(selectedMembership, response?.profile, profileData) || profileData.memberId || '',
        mobile: response?.profile?.mobile || profileData.mobile,
        email: response?.profile?.email || profileData.email,
      };

      // Also save to localStorage backup
      const userId = user['Mobile'] || user.mobile || user.id || user['Membership number'] || '';
      const key = `userProfile_${userId || 'default'}`;
      const profileSnapshot = {
        ...mergedProfile,
        bloodGroup: mergedProfile.bloodGroup || mergedProfile.blood_group || '',
        profile_photo_url: mergedProfile.profile_photo_url || mergedProfile.profilePhotoUrl || '',
        profilePhotoUrl: mergedProfile.profilePhotoUrl || mergedProfile.profile_photo_url || '',
        name_locked: Boolean(mergedProfile.name_locked),
        client_saved_at: new Date().toISOString()
      };
      setLocalStorageWithQuotaRecovery(key, JSON.stringify(profileSnapshot));

      const updatedUser = {
        ...user,
        Name: mergedProfile.name || user.Name || '',
        name: mergedProfile.name || user.name || '',
        Email: mergedProfile.email || user.Email || '',
        email: mergedProfile.email || user.email || '',
      };
      setLocalStorageWithQuotaRecovery('user', JSON.stringify(updatedUser));
      window.dispatchEvent(new Event('user-profile-updated'));

      setProfileData(mergedProfile);
      const nameLocked = Boolean(mergedProfile.name_locked ?? String(mergedProfile.name || '').trim());
      setAllowManualNameEntry(!nameLocked);
      setOriginalData(JSON.parse(JSON.stringify(mergedProfile)));
      setHasUnsavedChanges(false); setPhotoFile(null);
      setIsEditMode(false);
      if (response?.profile?.profile_photo_url) {
        setPhotoPreview(response.profile.profile_photo_url);
        localStorage.setItem(getCurrentUserPhotoCacheKey(user), response.profile.profile_photo_url);
      }
      if (onProfileUpdate) onProfileUpdate(mergedProfile);
      if (!shouldTreatAsTrustMember) {
        // Non-member: show "under review" message
        setShowUnderReviewPopup(true);
      } else {
        setShowSuccessPopup(true);
        setTimeout(() => {
          setShowSuccessPopup(false);
          const returnFlag = localStorage.getItem('returnToAppointments');
          if (returnFlag) {
            localStorage.removeItem('returnToAppointments');
            onNavigate('appointments');
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Profile save error:', err);
      setMessage({ type: 'error', text: err?.message || 'Failed to save. Please try again.' });
    }
    finally { setSaving(false); }
  };

  const handleNavigate = (target) => {
    if (hasUnsavedChanges) { setNavTarget(target); setShowNavWarning(true); }
    else { onNavigate(target); }
  };

  const SaveProfileButton = ({ className = '', style = {} }) => (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className={`py-4 rounded-2xl font-bold text-base active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${className}`}
      style={{
        color: 'var(--surface-color)',
        background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 40%, var(--brand-navy) 100%)',
        boxShadow: '0 8px 24px color-mix(in srgb, var(--brand-red) 30%, transparent)',
        ...style
      }}
    >
      {saving ? <><div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" /> Saving...</> : <><Save className="h-5 w-5" /> Save Profile</>}
    </button>
  );

  return (
    <div ref={mainContainerRef} className="min-h-screen font-sans" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>

      {/* Navbar - Brand */}
      <div
        className="px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          color: navbarTextColor
        }}
      >
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2 rounded-xl transition-colors" style={{ color: navbarTextColor, background: 'transparent' }}>
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTextColor }}>Profile</h1>
        <button onClick={() => handleNavigate('home')} className="p-2 rounded-xl transition-colors" style={{ color: navbarTextColor, background: 'transparent' }}>
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={handleNavigate} currentPage="profile" />

      {/* Error/success banner */}
      {message.text && (
        <div className="mx-4 mt-3 rounded-xl p-3 flex items-center gap-2" style={message.type === 'error'
          ? { background: 'var(--brand-red-light)', border: '1px solid color-mix(in srgb, var(--brand-red) 20%, transparent)' }
          : { background: 'color-mix(in srgb, var(--brand-navy-light) 68%, var(--surface-color))', border: '1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent)' }}>
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--brand-red)' }} />
            : <CheckCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--brand-navy)' }} />}
          <p className="text-sm" style={{ color: message.type === 'error' ? 'var(--brand-red-dark)' : 'var(--brand-navy)' }}>{message.text}</p>
        </div>
      )}

      {/* Profile Header */}
      <div className="px-5 pt-7 pb-5 border-b" style={{ borderColor: 'color-mix(in srgb, var(--advertisement-card-border) 62%, transparent)' }}>
        {(() => {
          return (
            <div className="relative rounded-[28px] p-4 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)', boxShadow: '0 10px 28px color-mix(in srgb, var(--advertisement-card-shadow) 30%, transparent)' }}>
              <div className="relative w-fit mx-auto mb-2">
                <div className="w-20 h-20 rounded-full border-2 overflow-hidden mx-auto shadow-sm" style={{ borderColor: 'var(--advertisement-card-border)', background: 'color-mix(in srgb, var(--advertisement-card-bg) 80%, var(--app-accent-bg))' }}>
                  {photoPreview ? (
                    <img src={photoPreview} alt="Profile" className="w-full h-full object-cover"
                      onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${profileData.name || 'U'}&background=e5e7eb&color=374151&size=80`; }} />
                  ) : profileData.name ? (
                    <div className="w-full h-full flex items-center justify-center text-2xl font-bold" style={{ color: 'var(--brand-navy)' }}>
                      {profileData.name.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <UserCircle className="h-12 w-12" style={{ color: 'color-mix(in srgb, var(--body-text-color) 42%, var(--surface-color))' }} />
                    </div>
                  )}
                </div>
                <button onClick={() => document.getElementById('photo-upload').click()}
                  className="absolute -bottom-1 -right-1 p-2 rounded-full shadow-sm active:scale-95 transition-all"
                  style={{ background: 'var(--surface-color)', border: '1px solid color-mix(in srgb, var(--brand-navy) 14%, transparent)' }}>
                  <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--app-button-icon)' }} />
                </button>
                <input id="photo-upload" type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </div>
              <h2 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--advertisement-description)' }}>{profileData.name || 'Your Name'}</h2>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-xs">
                {profileData.mobile && <span className="px-2 py-1 rounded-full" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 76%, var(--app-accent-bg))', color: 'var(--advertisement-subtitle)', border: '1px solid color-mix(in srgb, var(--advertisement-card-border) 55%, transparent)' }}>Mobile: {profileData.mobile}</span>}
              </div>
                <button
                onClick={() => {
                  setIsEditMode((prev) => !prev);
                  if (isEditMode) setMessage({ type: '', text: '' });
                }}
                className="mt-4 w-full max-w-[240px] mx-auto flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-base font-extrabold transition-all active:scale-[0.98] border"
                style={{
                  color: 'var(--app-button-text)',
                  background: 'var(--app-button-bg)',
                  borderColor: 'color-mix(in srgb, var(--app-button-text) 24%, transparent)',
                  boxShadow: '0 10px 24px color-mix(in srgb, var(--app-button-icon) 26%, transparent)',
                  position: 'relative',
                  zIndex: 5
                }}
              >
                <Pencil className="h-4 w-4" />
                {isEditMode ? 'View Profile' : 'Edit Profile'}
              </button>
            </div>
          );
        })()}
      </div>

      {/* Tabs */}
      <div className="flex border-b top-[64px] z-40" style={{ borderColor: 'color-mix(in srgb, var(--advertisement-card-border) 62%, transparent)', background: 'color-mix(in srgb, var(--page-bg) 70%, var(--advertisement-card-bg))' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="flex-1 py-4 text-sm font-bold transition-all border-b-2"
            style={activeTab === tab
              ? { borderColor: 'var(--advertisement-title)', color: 'var(--advertisement-title)' }
              : { borderColor: 'transparent', color: 'var(--advertisement-subtitle)' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ─── Tab: Details ─────────────────────────────── */}
      {activeTab === 'Details' && (
        <div className="px-4 pb-32">
          {!isEditMode ? (
            <div className="space-y-4 pt-4">
              <DetailSummaryCard title="Basic Info" subtitle="Primary account information">
                {String(profileData.name || '').trim() && <DetailRow label="Name" value={profileData.name} icon={User} />}
                {String(profileData.mobile || '').trim() && <DetailRow label="Mobile" value={profileData.mobile} icon={Phone} />}
                {String(profileData.email || '').trim() && <DetailRow label="Email" value={profileData.email} icon={Mail} />}
                {!String(profileData.name || '').trim() && !String(profileData.mobile || '').trim() && !String(profileData.email || '').trim() && (
                  <p className="py-2 text-sm" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>Abhi koi basic info add nahi ki gayi.</p>
                )}
              </DetailSummaryCard>

              <DetailSummaryCard title="Personal" subtitle="Identity and personal details">
                {String(profileData.gender || '').trim() && <DetailRow label="Gender" value={profileData.gender} icon={UserCircle} />}
                {String(profileData.dob || '').trim() && <DetailRow label="Date of Birth" value={profileData.dob} icon={Calendar} />}
                {String(profileData.blood_group || '').trim() && <DetailRow label="Blood Group" value={profileData.blood_group} icon={Droplet} />}
                {String(profileData.marital_status || '').trim() && <DetailRow label="Marital Status" value={profileData.marital_status} icon={BadgeCheck} />}
                {String(profileData.nationality || '').trim() && <DetailRow label="Nationality" value={profileData.nationality} icon={Shield} />}
                {String(profileData.aadhaar_id || '').trim() && <DetailRow label="Aadhaar" value={profileData.aadhaar_id} icon={Award} />}
                {String(profileData.emergency_contact_name || '').trim() && <DetailRow label="Emergency Contact Name" value={profileData.emergency_contact_name} icon={User} />}
                {String(profileData.emergency_contact_number || '').trim() && <DetailRow label="Emergency Contact Number" value={profileData.emergency_contact_number} icon={Phone} />}
              </DetailSummaryCard>

              <DetailSummaryCard title="Address & Work" subtitle="Home, office and company">
                {String(profileData.address_home || '').trim() && <DetailRow label="Home Address" value={profileData.address_home} icon={HomeIcon} />}
                {String(profileData.address_office || '').trim() && <DetailRow label="Office Address" value={profileData.address_office} icon={MapPin} />}
                {String(profileData.company_name || '').trim() && <DetailRow label="Company" value={profileData.company_name} icon={Briefcase} />}
                {String(profileData.resident_landline || '').trim() && <DetailRow label="Resident Landline" value={profileData.resident_landline} icon={Phone} />}
                {String(profileData.office_landline || '').trim() && <DetailRow label="Office Landline" value={profileData.office_landline} icon={Phone} />}
              </DetailSummaryCard>

              <DetailSummaryCard title="Family & Social" subtitle="Family and social presence">
                {String(profileData.spouse_name || '').trim() && <DetailRow label="Spouse Name" value={profileData.spouse_name} icon={User} />}
                {String(profileData.spouse_contact_number || '').trim() && <DetailRow label="Spouse Contact" value={profileData.spouse_contact_number} icon={Phone} />}
                {(profileData.children_count !== '' && profileData.children_count !== null && profileData.children_count !== undefined) && (
                  <DetailRow label="No. of Children" value={profileData.children_count} icon={UserCircle} />
                )}
                {String(profileData.facebook || '').trim() && <DetailRow label="Facebook" value={profileData.facebook} icon={Mail} />}
                {String(profileData.instagram || '').trim() && <DetailRow label="Instagram" value={profileData.instagram} icon={Mail} />}
                {String(profileData.linkedin || '').trim() && <DetailRow label="LinkedIn" value={profileData.linkedin} icon={Mail} />}
                {String(profileData.twitter || '').trim() && <DetailRow label="Twitter" value={profileData.twitter} icon={Mail} />}
                {String(profileData.whatsapp || '').trim() && <DetailRow label="WhatsApp" value={profileData.whatsapp} icon={Phone} />}
              </DetailSummaryCard>
            </div>
          ) : (
            <div className="space-y-3">
              <SectionCard title="Name" subtitle="Basic profile identity" isOpen={true}>
                <RowField
                  label="Full Name"
                  value={profileData.name}
                  onChange={set('name')}
                  placeholder="Enter your full name"
                  disabled={!allowManualNameEntry}
                  icon={User}
                />
              </SectionCard>
              <SectionCard title="Personal" subtitle="Contact and personal details" isOpen={true}>
                <RowField label="Email Address" type="email" value={profileData.email} onChange={set('email')} placeholder="Add your email" />
                <RowSelect label="Gender" value={profileData.gender} onChange={set('gender')} placeholder="Select gender" options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]} />
                <RowDate label="Date of Birth" value={profileData.dob} onChange={set('dob')} />
                <RowSelect label="Blood Group" value={profileData.blood_group} onChange={set('blood_group')} placeholder="Select blood group" options={['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(v => ({ value: v, label: v }))} />
              </SectionCard>
              <SectionCard title="Address" subtitle="Home and office location" isOpen={true}>
                <RowField label="Home Address" value={profileData.address_home} onChange={set('address_home')} placeholder="Enter home address" />
                <RowField label="Office Address" value={profileData.address_office} onChange={set('address_office')} placeholder="Enter office address" />
              </SectionCard>
              <SectionCard title="Work" subtitle="Professional information" isOpen={true}>
                <RowField label="Company Name" value={profileData.company_name} onChange={set('company_name')} placeholder="Enter company name" />
              </SectionCard>
              <SectionCard title="Identity" subtitle="KYC and verification" isOpen={true}>
                <RowField label="Aadhaar ID" value={profileData.aadhaar_id} onChange={(val) => {
                  const d = val.replace(/\D/g, '').slice(0, 16);
                  set('aadhaar_id')(d.replace(/(\d{4})(?=\d)/g, '$1 '));
                }} placeholder="0000 0000 0000 0000" />
              </SectionCard>
              <SectionCard title="Emergency" subtitle="Emergency contact details" isOpen={true}>
                <RowField label="Contact Name" value={profileData.emergency_contact_name} onChange={set('emergency_contact_name')} placeholder="Full name" />
                <RowField label="Contact Number" value={profileData.emergency_contact_number} onChange={set('emergency_contact_number')} placeholder="Phone number" />
              </SectionCard>
              <SectionCard title="Family" subtitle="Spouse and children details" isOpen={true}>
                <RowField label="Spouse Name" value={profileData.spouse_name} onChange={set('spouse_name')} placeholder="Enter spouse name" />
                <RowField label="Spouse Contact" value={profileData.spouse_contact_number} onChange={set('spouse_contact_number')} placeholder="Enter contact number" />
                <RowField label="No. of Children" type="number" value={profileData.children_count} onChange={set('children_count')} placeholder="0" />
              </SectionCard>
              <SectionCard title="Social" subtitle="Social media links" isOpen={true}>
                <RowField label="Facebook" value={profileData.facebook} onChange={set('facebook')} placeholder="Facebook URL or username" />
                <RowField label="Instagram" value={profileData.instagram} onChange={set('instagram')} placeholder="Instagram handle" />
                <RowField label="LinkedIn" value={profileData.linkedin} onChange={set('linkedin')} placeholder="LinkedIn URL" />
              </SectionCard>
              <div className="hidden lg:flex justify-end pt-2 pb-8">
                <SaveProfileButton
                  className="px-8 min-w-[220px]"
                  style={{ paddingTop: '14px', paddingBottom: '14px' }}
                />
              </div>
            </div>
          )}

          {/* Elected position (show only if applicable) */}
          {(profileData.position || profileData.location || profileData.isElectedMember) && (
            <>
              <SectionHeader title="Elected Position" color="color-mix(in srgb, var(--brand-navy) 60%, var(--brand-red))" />
              <div className="space-y-3">
                <RowField label="Position" value={profileData.position} onChange={set('position')} placeholder="Enter position" />
                <RowField label="Location" value={profileData.location} onChange={set('location')} placeholder="Enter location" />
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Tab: Family Members ───────────────────────── */}
      {activeTab === 'Family Members' && (
        <div className="px-5 pb-32 pt-5">
          {/* Add member button */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-base font-bold" style={{ color: 'var(--heading-color)' }}>Members</p>
              <p className="text-xs" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>Add to book appointments for them</p>
            </div>
            <button onClick={addMember}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all"
              style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 40%, var(--brand-navy) 100%)' }}>
              <Plus className="h-4 w-4" /> Add Member
            </button>
          </div>

          {profileData.family_members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <Users className="h-12 w-12" style={{ color: 'color-mix(in srgb, var(--body-text-color) 30%, var(--surface-color))' }} />
              <p className="font-semibold" style={{ color: 'var(--body-text-color)' }}>No family members yet</p>
              <p className="text-sm px-8" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>Add members so you can book appointments for them</p>
              <button onClick={addMember}
                className="mt-2 px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 active:scale-95 transition-all"
                style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 40%, var(--brand-navy) 100%)' }}>
                <Plus className="h-4 w-4" /> Add First Member
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {profileData.family_members.map((member, idx) => {
                const isOpen = expandedMember === idx;
                const initials = (member.name || '?').charAt(0).toUpperCase();
                return (
                  <div key={member.id || idx} className="border rounded-2xl overflow-hidden" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)', background: 'var(--surface-color)' }}>
                    {/* Member row header */}
                    <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer" onClick={() => setExpandedMember(isOpen ? null : idx)}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg))', color: 'var(--brand-navy)' }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm" style={{ color: 'var(--heading-color)' }}>{member.name || 'New Member'}</p>
                        <p className="text-xs" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>{[member.relation, member.gender, member.age ? `Age ${member.age}` : ''].filter(Boolean).join(' · ') || 'Tap to fill details'}</p>
                      </div>
                      {isOpen ? <ChevronUp className="h-4 w-4" style={{ color: 'color-mix(in srgb, var(--body-text-color) 45%, var(--surface-color))' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'color-mix(in srgb, var(--body-text-color) 45%, var(--surface-color))' }} />}
                    </div>

                    {/* Expanded form */}
                    {isOpen && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))' }}>
                        {/* Name & Relation */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Name *</label>
                            <div className="rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                              onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                              onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                              <input type="text" value={member.name} onChange={e => updateMember(idx, 'name', e.target.value)}
                                placeholder="Full name"
                                className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none rounded-2xl" style={{ color: 'var(--body-text-color)' }} />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Relation *</label>
                            <div className="relative rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                              onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                              onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                              <select value={member.relation} onChange={e => updateMember(idx, 'relation', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none appearance-none rounded-2xl pr-7" style={{ color: 'var(--body-text-color)' }}>
                                <option value="">Select</option>
                                {['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
                                <svg className="h-3.5 w-3.5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 45%, var(--surface-color))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Gender chips */}
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5 block mb-2" style={{ color: 'var(--brand-red)' }}>Gender</label>
                          <div className="flex gap-2">
                            {['Male', 'Female', 'Other'].map(g => (
                              <button key={g} type="button" onClick={() => updateMember(idx, 'gender', g)}
                                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold border-2 transition-all"
                                style={member.gender === g
                                  ? { background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)', color: 'var(--surface-color)', borderColor: 'var(--brand-red)' }
                                  : { background: 'var(--surface-color)', color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}>
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Age & Blood Group */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Age</label>
                            <div className="rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                              onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                              onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                              <input type="number" value={member.age} min="0" max="120" onChange={e => updateMember(idx, 'age', e.target.value)}
                                placeholder="Years"
                                className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none rounded-2xl" style={{ color: 'var(--body-text-color)' }} />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Blood Group</label>
                            <div className="relative rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                              onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; }}
                              onBlurCapture={e => { e.currentTarget.style.borderColor = ''; }}>
                              <select value={member.blood_group} onChange={e => updateMember(idx, 'blood_group', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none appearance-none rounded-2xl pr-7" style={{ color: 'var(--body-text-color)' }}>
                                <option value="">Select</option>
                                {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                              </select>
                              <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
                                <svg className="h-3.5 w-3.5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 45%, var(--surface-color))' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Contact No */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Contact No</label>
                          <div className="rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                            onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                            onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                            <input type="tel" value={member.contact_no} onChange={e => updateMember(idx, 'contact_no', e.target.value)}
                              placeholder="Optional"
                              className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none rounded-2xl" style={{ color: 'var(--body-text-color)' }} />
                          </div>
                        </div>

                        {/* Email */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Email</label>
                          <div className="rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                            onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                            onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                            <input type="email" value={member.email} onChange={e => updateMember(idx, 'email', e.target.value)}
                              placeholder="email@example.com"
                              className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none rounded-2xl" style={{ color: 'var(--body-text-color)' }} />
                          </div>
                        </div>

                        {/* Address */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Address</label>
                          <div className="rounded-2xl border-2 transition-all" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)' }}
                            onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-red)'; e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--brand-red) 8%, transparent)'; }}
                            onBlurCapture={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}>
                            <input type="text" value={member.address} onChange={e => updateMember(idx, 'address', e.target.value)}
                              placeholder="Full address"
                              className="w-full px-3 py-2.5 text-sm font-medium bg-transparent focus:outline-none rounded-2xl" style={{ color: 'var(--body-text-color)' }} />
                          </div>
                        </div>

                        {/* Remove */}
                        <button type="button" onClick={() => removeMember(idx)}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 text-sm font-semibold active:scale-95 transition-all"
                          style={{ borderColor: 'color-mix(in srgb, var(--brand-red) 15%, transparent)', color: 'var(--brand-red)', background: 'color-mix(in srgb, var(--brand-red-light) 68%, var(--surface-color))' }}>
                          <Trash2 className="h-4 w-4" /> Remove Member
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sticky Save Button */}
      {isEditMode && (
        <div className="profile-save-bar fixed bottom-0 left-0 right-0 z-40 px-4 pb-5 pt-4 max-w-full md:max-w-[430px] md:mx-auto pointer-events-none lg:hidden" style={{ background: 'linear-gradient(to top, var(--surface-color), color-mix(in srgb, var(--surface-color) 82%, transparent), transparent)' }}>
          <SaveProfileButton className="pointer-events-auto w-full" />
        </div>
      )}

      {/* Success Popup */}
      {showSuccessPopup && (
        <div className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4">
          <div className="rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center" style={{ background: 'var(--surface-color)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'color-mix(in srgb, var(--brand-navy-light) 72%, var(--surface-color))' }}>
              <CheckCircle className="h-10 w-10" style={{ color: 'var(--brand-navy)' }} />
            </div>
            <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--heading-color)' }}>Saved!</h2>
            <p className="text-sm mb-6" style={{ color: 'color-mix(in srgb, var(--body-text-color) 65%, var(--surface-color))' }}>Profile saved successfully.</p>
            <button onClick={() => setShowSuccessPopup(false)} className="w-full py-3 rounded-xl font-semibold active:scale-95 transition-all" style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }}>Done</button>
          </div>
        </div>
      )}

      {/* Under Review Popup — for non-registered members */}
      {showUnderReviewPopup && (
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-center justify-center p-4">
          <div className="rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center" style={{ background: 'var(--surface-color)' }}>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: 'color-mix(in srgb, var(--brand-red-light) 72%, var(--surface-color))' }}>
              <Shield className="h-10 w-10" style={{ color: 'var(--brand-red)' }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--heading-color)' }}>Profile Submitted!</h2>
            <div className="rounded-2xl px-4 py-3 mb-5" style={{ background: 'color-mix(in srgb, var(--brand-red-light) 72%, var(--surface-color))', border: '1px solid color-mix(in srgb, var(--brand-red) 16%, transparent)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-red-dark)' }}>Your Profile has been updated</p>
            </div>
            <button
              onClick={() => setShowUnderReviewPopup(false)}
              className="w-full py-3 rounded-xl font-semibold active:scale-95 transition-all"
              style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}

      {/* Unsaved Changes Warning */}
      {showNavWarning && (
        <div className="fixed inset-0 bg-black/40 z-[999] flex items-center justify-center p-4">
          <div className="rounded-3xl shadow-2xl p-8 max-w-sm w-full" style={{ background: 'var(--surface-color)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'color-mix(in srgb, var(--brand-red-light) 72%, var(--surface-color))' }}>
              <AlertCircle className="h-10 w-10" style={{ color: 'var(--brand-red)' }} />
            </div>
            <h2 className="text-xl font-bold mb-1 text-center" style={{ color: 'var(--heading-color)' }}>Unsaved Changes</h2>
            <p className="text-sm text-center mb-6" style={{ color: 'color-mix(in srgb, var(--body-text-color) 65%, var(--surface-color))' }}>Your changes will be lost if you leave now.</p>
            <div className="flex gap-3">
              <button onClick={() => { setShowNavWarning(false); setNavTarget(null); if (navTarget) onNavigate(navTarget); }}
                className="flex-1 py-3 rounded-xl font-semibold active:scale-95 transition-all" style={{ background: 'color-mix(in srgb, var(--surface-color) 76%, var(--app-accent-bg))', color: 'var(--body-text-color)' }}>Discard</button>
              <button onClick={async () => { await handleSave(); setShowNavWarning(false); if (navTarget) onNavigate(navTarget); }}
                disabled={saving}
                className="flex-1 py-3 rounded-xl font-semibold active:scale-95 transition-all disabled:opacity-50"
                style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }}>
                {saving ? 'Saving...' : 'Save & Go'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;

