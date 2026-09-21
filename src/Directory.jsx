import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, Building, Check, Home as HomeIcon, Mail, Menu, Search, User, Users, X } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getDirectoryMembers, getDirectoryViewRoles } from './services/supabaseService';
import { getProfilePhotos } from './services/api';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { MEMBER_PRIVACY_UPDATED_EVENT, matchesMemberIdentity } from './utils/memberIdentity';
import { getAppHomePath } from './utils/tenantNavigation';
import Sidebar from './features/sidebar/Sidebar';

const MEMBERS_PER_PAGE = 20;
const DIRECTORY_CACHE_TTL_MS = 10 * 60 * 1000;
const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => String(value || '').trim();
const getDirectoryCacheKey = (trustId) => `directory_cache_v3_${trustId || 'global'}`;
const DIRECTORY_SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name: A-Z' },
  { value: 'name-desc', label: 'Name: Z-A' },
  { value: 'membership-asc', label: 'Membership No: Low to High' },
  { value: 'membership-desc', label: 'Membership No: High to Low' },
];

const compareDirectoryText = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

const DIRECTORY_SEARCH_PRIORITY_FIELDS = [
  { key: 'name', getValue: (item) => item?.Name },
  { key: 'company', getValue: (item) => item?.['Company Name'] },
  { key: 'role', getValue: (item) => item?.role },
  { key: 'type', getValue: (item) => item?.type },
  { key: 'mobile', getValue: (item) => item?.Mobile },
  { key: 'email', getValue: (item) => item?.Email },
  { key: 'membership', getValue: (item) => item?.['Membership number'] },
];

const matchesQuery = (value, query) => {
  if (!query) return false;
  return String(value ?? '').toLowerCase().includes(query);
};

const getDirectorySearchRank = (item, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return DIRECTORY_SEARCH_PRIORITY_FIELDS.length;

  for (let index = 0; index < DIRECTORY_SEARCH_PRIORITY_FIELDS.length; index += 1) {
    const field = DIRECTORY_SEARCH_PRIORITY_FIELDS[index];
    if (matchesQuery(field.getValue(item), normalizedQuery)) {
      return index;
    }
  }

  return DIRECTORY_SEARCH_PRIORITY_FIELDS.length;
};

const readCurrentUserPhotoCache = () => {
  try {
    const userRaw = localStorage.getItem('user');
    if (!userRaw) return { photoUrl: '', identity: {} };
    const user = JSON.parse(userRaw);
    const userId = normalizeText(user?.members_id || user?.member_id || user?.id);
    const userMobile = normalizeText(user?.Mobile || user?.mobile || user?.phone);
    const userMembership = normalizeText(user?.['Membership number'] || user?.membership_number || user?.membershipNumber);

    const scopedPhotoKey = `last_profile_photo_url_${userId || 'default'}`;
    const profileSnapshotKey = `userProfile_${user?.Mobile || user?.mobile || user?.id || 'default'}`;
    const scopedPhoto = normalizeText(localStorage.getItem(scopedPhotoKey));
    let snapshotPhoto = '';
    try {
      const snapshot = JSON.parse(localStorage.getItem(profileSnapshotKey) || '{}');
      snapshotPhoto = normalizeText(snapshot?.profile_photo_url || snapshot?.profilePhotoUrl);
    } catch {
      snapshotPhoto = '';
    }

    return {
      photoUrl: scopedPhoto || snapshotPhoto,
      identity: { userId, userMobile, userMembership }
    };
  } catch {
    return { photoUrl: '', identity: {} };
  }
};

export const DirectoryContent = ({ onNavigate, variant = 'page' }) => {
  const isPageVariant = variant === 'page';
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState([]);
  const [profilePhotos, setProfilePhotos] = useState({});
  const [activeRole, setActiveRole] = useState('all');
  const [configuredDirectoryRoles, setConfiguredDirectoryRoles] = useState([]);
  const [sortMode, setSortMode] = useState('name-asc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentUserPhoto] = useState(() => readCurrentUserPhotoCache());
  const [selectedTrustId, setSelectedTrustId] = useState(() => localStorage.getItem('selected_trust_id') || null);
  const [selectedTrustName, setSelectedTrustName] = useState(() => localStorage.getItem('selected_trust_name') || null);
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const secondaryColor = theme?.secondary || 'var(--brand-navy)';
  const sortMenuRef = useRef(null);
  const selectedSortLabel = DIRECTORY_SORT_OPTIONS.find((option) => option.value === sortMode)?.label || 'Sort members';

  const resolveMemberPhotoUrl = (item) => {
    const candidateKeys = [
      item?.['Membership number'],
      item?.Mobile,
      item?.members_id,
      item?.['S. No.'],
    ].filter(Boolean);
    const rowUserId = normalizeText(item?.members_id);
    const rowMobile = normalizeText(item?.Mobile);
    const rowMembership = normalizeText(item?.['Membership number']);
    const isCurrentUser = Boolean(
      (currentUserPhoto.identity.userId && currentUserPhoto.identity.userId === rowUserId)
      || (currentUserPhoto.identity.userMobile && currentUserPhoto.identity.userMobile === rowMobile)
      || (currentUserPhoto.identity.userMembership && currentUserPhoto.identity.userMembership === rowMembership)
    );
    return item?.profile_photo_url
      || candidateKeys.map((key) => profilePhotos[key]).find(Boolean)
      || (isCurrentUser ? currentUserPhoto.photoUrl : '');
  };

  useEffect(() => {
    const onTrustChanged = (event) => {
      const nextId = event?.detail?.trustId || localStorage.getItem('selected_trust_id') || null;
      const nextName = event?.detail?.trustName || localStorage.getItem('selected_trust_name') || null;
      setSelectedTrustId(nextId);
      setSelectedTrustName(nextName);
      setCurrentPage(1);
    };
    window.addEventListener('trust-changed', onTrustChanged);
    return () => window.removeEventListener('trust-changed', onTrustChanged);
  }, []);

  useEffect(() => {
    let mounted = true;
    const trustId = selectedTrustId || null;
    const trustName = selectedTrustName || null;
    const cacheKey = getDirectoryCacheKey(trustId);

    const fetchAllMembers = async ({ background = false } = {}) => {
      try {
        if (!background) setLoading(true);
        setError('');
        const response = await getDirectoryMembers(trustId, trustName, { fullList: true });
        if (!mounted) return;
        if (!response?.success) {
          setError(response?.error || 'Unable to load directory members.');
          setMembers([]);
          setTotalCount(0);
          return;
        }

        const rows = Array.isArray(response?.data) ? response.data : [];
        setMembers(rows);
        setTotalCount(Number(response?.totalCount || rows.length || 0));
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            ts: Date.now(),
            members: rows,
            totalCount: Number(response?.totalCount || rows.length || 0)
          }));
        } catch {
          // ignore cache write failure
        }
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || 'Unable to load directory members.');
      } finally {
        if (mounted && !background) {
          setLoading(false);
        }
      }
    };

    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached?.members) && cached.members.length > 0) {
          setMembers(cached.members);
          setTotalCount(Number(cached?.totalCount || cached.members.length || 0));
          setLoading(false);
          if (Number(cached?.ts) > 0 && (Date.now() - Number(cached.ts)) < DIRECTORY_CACHE_TTL_MS) {
            void fetchAllMembers({ background: true });
            return () => { mounted = false; };
          }
        }
      }
    } catch {
      // ignore malformed cache
    }

    setMembers([]);
    setTotalCount(0);
    setLoading(true);
    void fetchAllMembers();
    return () => { mounted = false; };
  }, [selectedTrustId, selectedTrustName]);

  useEffect(() => {
    let active = true;

    const loadDirectoryViewRoles = async () => {
      const trustId = selectedTrustId || null;
      if (!trustId) {
        if (active) setConfiguredDirectoryRoles([]);
        return;
      }

      const response = await getDirectoryViewRoles(trustId);
      if (!active) return;

      if (!response?.success) {
        setConfiguredDirectoryRoles([]);
        return;
      }

      const normalizedRoles = (response.data || [])
        .map((item) => {
          const label = normalizeText(item?.role);
          const id = normalizeRole(label);
          if (!label || !id) return null;
          return { id, label };
        })
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);

      setConfiguredDirectoryRoles(normalizedRoles);
    };

    void loadDirectoryViewRoles();
    return () => {
      active = false;
    };
  }, [selectedTrustId]);

  useEffect(() => {
    const onPrivacyUpdated = (event) => {
      const detail = event?.detail || {};
      setMembers((prev) => prev.map((item) => (
        matchesMemberIdentity(item, detail) ? { ...item, Privacy: Boolean(detail.privacy) } : item
      )));
    };
    window.addEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
    return () => window.removeEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, activeRole, sortMode]);

  useEffect(() => {
    if (!isSortMenuOpen) return;

    const handlePointerDown = (event) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target)) {
        setIsSortMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSortMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortMenuOpen]);

  useEffect(() => {
    let active = true;

    const loadPhotos = async () => {
      try {
        if (!members.length) {
          if (active) setProfilePhotos({});
          return;
        }

        const memberIds = members
          .flatMap((item) => [
            item?.['Membership number'],
            item?.Mobile,
            item?.members_id,
            item?.['S. No.'],
          ])
          .filter(Boolean);

        if (memberIds.length === 0) {
          if (active) setProfilePhotos({});
          return;
        }

        const response = await getProfilePhotos(memberIds);
        if (!active) return;

        if (response?.success && response?.photos) {
          setProfilePhotos(response.photos);
        } else {
          setProfilePhotos({});
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to load directory profile photos:', err);
        setProfilePhotos({});
      }
    };

    loadPhotos();
    return () => {
      active = false;
    };
  }, [members]);

  const roleCounts = useMemo(() => {
    const counts = new Map();
    members.forEach((item) => {
      const rawRole = normalizeText(item?.role || item?.type);
      const roleKey = normalizeRole(rawRole) || 'member';
      counts.set(roleKey, {
        id: roleKey,
        label: rawRole || 'Member',
        count: (counts.get(roleKey)?.count || 0) + 1,
      });
    });
    return counts;
  }, [members]);

  const visibleRoleFilters = useMemo(() => {
    if (configuredDirectoryRoles.length > 0) {
      return [
        { id: 'all', label: 'All' },
        ...configuredDirectoryRoles,
      ];
    }

    const roles = Array.from(roleCounts.values())
      .sort((a, b) => a.label.localeCompare(b.label));
    return [
      { id: 'all', label: 'All' },
      ...roles,
    ];
  }, [configuredDirectoryRoles, roleCounts]);

  useEffect(() => {
    if (!visibleRoleFilters.some((item) => item.id === activeRole)) {
      setActiveRole('all');
    }
  }, [visibleRoleFilters, activeRole]);

  const filteredMembers = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    let roleFiltered = members;

    if (activeRole !== 'all') {
      roleFiltered = members.filter((item) => {
        const role = normalizeRole(item?.role || item?.type) || 'member';
        return role === activeRole;
      });
    }

    if (!normalizedQuery) return roleFiltered;

    return roleFiltered.filter((item) => {
      const haystack = [
        item?.Name,
        item?.['Company Name'],
        item?.role,
        item?.type,
        item?.Mobile,
        item?.Email,
        item?.['Membership number'],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [members, query, activeRole]);

  const sortedMembers = useMemo(() => {
    const items = [...filteredMembers];
    const isDesc = sortMode.endsWith('-desc');
    const isMembershipSort = sortMode.startsWith('membership');
    const sortField = isMembershipSort ? 'Membership number' : 'Name';
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const hasSearchQuery = Boolean(normalizedQuery);

    const compareBySelectedSort = (left, right) => {
      const primary = compareDirectoryText(left?.[sortField], right?.[sortField]);
      if (primary !== 0) {
        return isDesc ? -primary : primary;
      }
      const fallback = compareDirectoryText(left?.Name, right?.Name);
      return isDesc ? -fallback : fallback;
    };

    items.sort((left, right) => {
      if (hasSearchQuery) {
        const leftRank = getDirectorySearchRank(left, normalizedQuery);
        const rightRank = getDirectorySearchRank(right, normalizedQuery);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
      }

      return compareBySelectedSort(left, right);
    });

    return items;
  }, [filteredMembers, sortMode, query]);

  const isSearchActive = Boolean(String(query || '').trim()) || activeRole !== 'all';
  const effectiveTotalForPagination = isSearchActive
    ? sortedMembers.length
    : Math.max(totalCount, sortedMembers.length);
  const totalPages = Math.max(1, Math.ceil(effectiveTotalForPagination / MEMBERS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * MEMBERS_PER_PAGE;
    return sortedMembers.slice(start, start + MEMBERS_PER_PAGE);
  }, [sortedMembers, currentPage]);

  const openMemberDetails = (item) => {
    if (item?.Privacy === true) return;
    const resolvedPhotoUrl = resolveMemberPhotoUrl(item);
    const memberData = {
      'S. No.': item?.['S. No.'] || item?.id || 'N/A',
      Name: item?.Name || 'N/A',
      Mobile: item?.Mobile || 'N/A',
      Email: item?.Email || 'N/A',
      type: item?.type || item?.role || 'N/A',
      role: item?.role || 'N/A',
      'Membership number': item?.['Membership number'] || 'N/A',
      'Company Name': item?.['Company Name'] || 'N/A',
      'Address Home': item?.['Address Home'] || 'N/A',
      'Address Office': item?.['Address Office'] || 'N/A',
      'Resident Landline': item?.['Resident Landline'] || 'N/A',
      'Office Landline': item?.['Office Landline'] || 'N/A',
      members_id: item?.members_id || null,
      profile_photo_url: resolvedPhotoUrl || item?.profile_photo_url || '',
      previousScreenName: 'directory',
    };

    sessionStorage.setItem('restoreDirectoryTab', 'all');

    if (typeof onNavigate === 'function') {
      onNavigate('member-details', memberData);
      return;
    }

    navigate('/member-details', { state: { memberData } });
  };

  return (
    <div className="directory-page min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div
        className="directory-navbar theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: '0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)',
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="directory-navbar-inner px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="directory-icon-button p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label="Open menu"
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <h1 className="directory-title text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>Directory</h1>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="directory-icon-button p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'transparent' }}
              aria-label="Home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {isPageVariant && isMenuOpen && (
        <div
          className="fixed inset-0 z-25"
          style={{ background: applyOpacity('var(--brand-navy-dark)', 0.12) }}
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      {isPageVariant && (
        <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="directory" />
      )}

      {/* <div className="px-4 pt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]"> */}
      <div className="directory-search-row px-4 pt-4 flex items-center gap-2 w-full justify-between">
        <div className="directory-search rounded-2xl p-3 flex items-center gap-2 w-full" style={{ background: applyOpacity(primaryColor, 0.08), border: '1px solid var(--advertisement-card-border)'  }}>
          <Search className="h-4 w-4" style={{ color: 'var(--advertisement-card-bg)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, company, role, membership, mobile"
            className="w-full bg-transparent outline-none text-sm"
            style={{ color: 'var(--advertisement-description)' }}
          />
        </div>

        <div ref={sortMenuRef} className="directory-sort-wrap relative">
          <button
            type="button"
            onClick={() => setIsSortMenuOpen((prev) => !prev)}
            className="directory-sort-button h-full w-full rounded-2xl p-3 flex items-center justify-center gap-2 transition-colors"
            style={{ background: `color-mix(in srgb, var(--brand-navy-dark) 100%, transparent)`, border: '1px solid var(--advertisement-card-border)' }}
            aria-haspopup="menu"
            aria-expanded={isSortMenuOpen}
            aria-label={`Sort members. Current sort: ${selectedSortLabel}`}
            title={selectedSortLabel}
          >
            <ArrowUpDown className="h-4 w-4 shrink-0" style={{ color: 'var(--advertisement-description)' }} />
          </button>

          {isSortMenuOpen && (
            <div
              className="directory-sort-menu absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-2xl border shadow-lg"
              style={{
                background: 'var(--surface-color)',
                borderColor: 'var(--advertisement-card-border)',
                boxShadow: '0 14px 40px rgba(0, 0, 0, 0.14)',
              }}
              role="menu"
              aria-label="Sort members"
            >
              {DIRECTORY_SORT_OPTIONS.map((option) => {
                const isActive = sortMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSortMode(option.value);
                      setIsSortMenuOpen(false);
                    }}
                    className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-semibold transition-colors"
                    style={{
                      color: isActive ? theme.primary || 'var(--brand-red)' : theme.primary ,
                      background: isActive ? applyOpacity(theme.primary, 0.08) : 'transparent',
                    }}
                    role="menuitem"
                  >
                    <span>{option.label}</span>
                    {isActive ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      
      <div className="directory-filters px-4 mt-4 flex gap-2 overflow-x-auto">
        {visibleRoleFilters.map((item) => {
          const isActive = activeRole === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveRole(item.id)}
              className="directory-filter px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
              style={isActive
                ? {
                  background: `linear-gradient(135deg, ${theme.primary || 'var(--brand-red)'}, ${theme.secondary || 'var(--brand-navy)'})`,
                  color: 'var(--surface-color)',
                  border: '1px solid color-mix(in srgb, var(--brand-navy) 18%, transparent)',
                  boxShadow: '0 4px 10px color-mix(in srgb, var(--brand-navy) 20%, transparent)'
                }
                : {
                  background: 'var(--advertisement-card-bg)',
                  color: 'var(--advertisement-description)',
                  border: '1px solid var(--advertisement-card-border)'
                }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="directory-results px-4 py-4 space-y-2.5">
        {loading ? (
          <div className="directory-state-card rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>Loading members...</p>
          </div>
        ) : error ? (
          <div className="directory-state-card rounded-2xl p-6 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid color-mix(in srgb, var(--brand-red) 20%, transparent)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="directory-state-card rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <Users className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--advertisement-subtitle)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>No members found</p>
          </div>
        ) : (
          <>
            {paginatedMembers.map((item) => (
              <button
                type="button"
                key={item?.id || item?.reg_id || item?.['S. No.']}
                onClick={() => openMemberDetails(item)}
                disabled={item?.Privacy === true}
                className="directory-card w-full text-left rounded-2xl overflow-hidden disabled:cursor-default"
                style={{
                  background: 'var(--advertisement-card-bg)',
                  border: '1px solid var(--advertisement-card-border)',
                  boxShadow: `0 2px 12px ${applyOpacity(theme.secondary, 0.1)}`
                }}
              >
                {/* Top accent bar */}
                <div className="directory-card-accent" style={{ height: '3px', background: `linear-gradient(90deg, ${theme.primary || 'var(--brand-red)'}, ${theme.secondary || 'var(--brand-navy)'})` }} />

                <div className="directory-card-body flex items-center gap-3 px-3 py-3">
                  {/* Avatar */}
                  <div
                    className="directory-avatar h-12 w-12 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${applyOpacity(theme.primary, 0.15)}, ${applyOpacity(theme.secondary, 0.2)})`,
                      border: `2px solid ${applyOpacity(theme.primary, 0.3)}`
                    }}
                  >
                    {(() => {
                      const photoUrl = resolveMemberPhotoUrl(item);
                      if (photoUrl) {
                        return (
                          <img
                            src={photoUrl}
                            alt={item?.Name || 'Member'}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const icon = e.currentTarget.parentElement?.querySelector('[data-avatar-fallback]');
                              if (icon) icon.classList.remove('hidden');
                            }}
                          />
                        );
                      }
                      return <User data-avatar-fallback className="h-5 w-5" style={{ color: applyOpacity(theme.primary, 0.7) }} />;
                    })()}
                    <User data-avatar-fallback className="h-5 w-5 hidden" style={{ color: applyOpacity(theme.primary, 0.7) }} />
                  </div>

                  {/* Info */}
                  <div className="directory-card-meta flex-1 min-w-0">
                    <div className="directory-card-title-row flex items-start justify-between gap-2">
                      <h3 className="text-sm font-extrabold truncate min-w-0" style={{ color: 'var(--advertisement-title)' }}>
                        {item?.Name || 'N/A'}
                      </h3>
                      {item?.Privacy === true ? (
                        <span
                          className="directory-private-badge shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold"
                          style={{
                            background: applyOpacity(primaryColor, 0.28),
                            color: secondaryColor,
                            border: `1px solid ${applyOpacity(secondaryColor, 0.32)}`,
                          }}
                        >
                          Private
                        </span>
                      ) : null}
                    </div>

                    <div className="directory-card-tags flex items-center gap-[0.25rem] mt-1 flex-wrap">


                      {item?.['Membership number'] ? (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: `linear-gradient(90deg, ${applyOpacity(theme.primary, 0.12)}, ${applyOpacity(theme.secondary, 0.12)})`,
                            color: theme.primary || 'var(--brand-red)',
                            border: `1px solid ${applyOpacity(theme.primary, 0.2)}`
                          }}
                        >
                          {item['Membership number']}
                        </span>
                      ) : null}

                      {item?.['Company Name'] && item?.['Company Name'] !== 'null' && item?.['Company Name'] !== 'N/A' ? (
                        <span className="inline-flex items-center gap-[0.1rem] text-[11px]" style={{ color: 'var(--advertisement-description)' }}>
                          <Building className="h-3 w-3" />
                          {item['Company Name']}
                        </span>
                      ): null }
                    </div>

                    {item?.Email ? (
                      <span className="directory-email-row inline-flex items-center gap-1 text-[10px] mt-0.5 truncate" style={{ color: 'var(--advertisement-subtitle)' }}>
                        <Mail className="h-3 w-3" />
                        <span className="directory-email-text">{item.Email !== null && item.Email !== undefined && item.Email !== 'null' ? item.Email.toLowerCase() : <i>No email provided</i>}</span>
                      </span>
                    ) :<span className="directory-email-row inline-flex w-full items-center gap-1 text-[10px] mt-0.5 truncate" style={{ color: 'var(--advertisement-subtitle)' }}>
                        <Mail className="h-3 w-3" />
                        <span className="directory-email-text"><i>No email provided</i></span>
                      </span>}
                  </div>
                  {/* Arrow */}
                  {item?.Privacy !== true && <span className="directory-arrow text-lg font-bold shrink-0" style={{ color: applyOpacity(theme.primary, 0.5) }}>›</span>}

                </div>
              </button>
            ))}

            <div className="directory-pagination mt-2 pt-2 flex items-center justify-between gap-2">
                  <button
                type="button"
                onClick={async () => {
                  const nextPage = Math.max(1, currentPage - 1);
                  setCurrentPage(nextPage);
                }}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: applyOpacity(theme.secondary, 0.14),
                  color: 'var(--advertisement-description)',
                  border: `1px solid ${applyOpacity(theme.secondary, 0.24)}`,
                }}
              >
                Prev
              </button>
              <span className="text-xs font-semibold" style={{ color: 'var(--advertisement-subtitle)' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const nextPage = Math.min(totalPages, currentPage + 1);
                  setCurrentPage(nextPage);
                }}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: applyOpacity(theme.primary, 0.16),
                  color: 'var(--advertisement-description)',
                  border: `1px solid ${applyOpacity(theme.primary, 0.24)}`,
                }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @media (min-width: 1024px) {
          .directory-navbar {
            animation: directoryHeaderIn 520ms ease-out both;
          }

          .directory-navbar-inner,
          .directory-search-row,
          .directory-filters {
            opacity: 0;
            transform: translateY(14px);
            animation: directoryFadeUp 520ms ease-out both;
          }

          .directory-navbar-inner {
            animation-delay: 80ms;
          }

          .directory-search-row {
            position: relative;
            z-index: 40;
            padding: 20px clamp(20px, 2.4vw, 40px) 0 !important;
            animation-delay: 140ms;
          }

          .directory-sort-wrap {
            z-index: 50;
          }

          .directory-search {
            min-height: 54px;
            border-radius: 18px !important;
            transition: border-color 220ms ease, box-shadow 220ms ease, background 220ms ease;
          }

          .directory-search:focus-within {
            box-shadow: 0 16px 36px color-mix(in srgb, var(--brand-navy) 11%, transparent);
            border-color: color-mix(in srgb, var(--brand-red) 28%, var(--advertisement-card-border)) !important;
          }

          .directory-sort-button {
            min-width: 54px;
            min-height: 54px;
            transition: transform 220ms ease, box-shadow 220ms ease, background 220ms ease;
          }

          .directory-sort-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px color-mix(in srgb, var(--brand-navy) 14%, transparent);
          }

          .directory-sort-menu {
            z-index: 80;
            width: 268px !important;
            background: color-mix(in srgb, var(--surface-color) 96%, white) !important;
            border: 1px solid color-mix(in srgb, var(--brand-navy) 12%, var(--advertisement-card-border)) !important;
            box-shadow: 0 22px 54px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.42) !important;
          }

          .directory-sort-menu button {
            min-height: 50px;
            background-clip: padding-box;
          }

          .directory-sort-menu button + button {
            border-top: 1px solid color-mix(in srgb, var(--brand-navy) 9%, transparent);
          }

          .directory-filters {
            position: relative;
            z-index: 10;
            padding: 0 clamp(20px, 2.4vw, 40px) !important;
            margin-top: 20px !important;
            animation-delay: 200ms;
          }

          .directory-filter {
            min-height: 40px;
          }

          .directory-results {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 20px;
            padding: 22px clamp(20px, 2.4vw, 40px) 52px !important;
          }

          .directory-results > :not([hidden]) ~ :not([hidden]) {
            margin-top: 0 !important;
          }

          .directory-card {
            position: relative;
            min-height: 252px;
            border-radius: 16px !important;
            opacity: 0;
            transform: translateY(24px) scale(0.985);
            animation: directoryCardIn 560ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
            transition: transform 240ms ease, box-shadow 240ms ease, border-color 240ms ease, filter 240ms ease;
          }

          .directory-card:nth-of-type(1) { animation-delay: 40ms; }
          .directory-card:nth-of-type(2) { animation-delay: 90ms; }
          .directory-card:nth-of-type(3) { animation-delay: 140ms; }
          .directory-card:nth-of-type(4) { animation-delay: 190ms; }
          .directory-card:nth-of-type(5) { animation-delay: 240ms; }
          .directory-card:nth-of-type(6) { animation-delay: 290ms; }
          .directory-card:nth-of-type(n + 7) { animation-delay: 330ms; }

          .directory-card::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            border-radius: inherit;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -28px 54px rgba(255, 255, 255, 0.07);
            opacity: 0.58;
            transition: opacity 240ms ease;
          }

          .directory-card:hover:not(:disabled) {
            transform: translateY(-6px);
            border-color: color-mix(in srgb, var(--brand-red) 30%, var(--advertisement-card-border)) !important;
            box-shadow: 0 20px 42px color-mix(in srgb, var(--brand-navy) 16%, transparent), 0 10px 26px color-mix(in srgb, var(--brand-red) 18%, transparent) !important;
            filter: saturate(1.03);
          }

          .directory-card:hover:not(:disabled)::after {
            opacity: 0.88;
          }

          .directory-card-accent {
            position: absolute;
            top: 0;
            left: 0;
            z-index: 3;
            width: 100%;
            height: 4px !important;
            border-radius: 0;
            transition: height 220ms ease, filter 220ms ease;
          }

          .directory-card:hover:not(:disabled) .directory-card-accent {
            height: 6px !important;
            filter: saturate(1.2);
          }

          .directory-card-body {
            position: relative;
            z-index: 1;
            display: flex !important;
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
            min-height: 252px;
            padding: 20px 16px 16px !important;
          }

          .directory-avatar {
            width: 100% !important;
            height: 132px !important;
            border-radius: 16px !important;
            transition: transform 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
          }

          .directory-avatar svg {
            width: 24px;
            height: 24px;
          }

          .directory-card:hover:not(:disabled) .directory-avatar {
            transform: translateY(-2px);
            border-color: color-mix(in srgb, var(--surface-color) 58%, transparent) !important;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
          }

          .directory-card-meta {
            display: flex;
            flex-direction: column;
            min-width: 0;
            gap: 6px;
          }

          .directory-card-title-row {
            align-items: flex-start;
          }

          .directory-card-meta h3 {
            white-space: normal !important;
            overflow: visible !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            line-height: 1.2;
          }

          .directory-card-tags {
            align-items: center;
            min-height: 24px;
          }

          .directory-card-tags span {
            max-width: 100%;
          }

          .directory-card-tags span:not(:first-child) {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .directory-email-row {
            display: inline-flex !important;
            align-items: center;
            flex-wrap: nowrap;
            gap: 5px;
            max-width: 100%;
            min-width: 0;
          }

          .directory-email-row svg {
            flex: 0 0 auto;
          }

          .directory-email-text {
            display: block;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .directory-private-badge {
            position: static !important;
            z-index: 2;
            margin-top: 0;
          }

          .directory-arrow {
            position: absolute;
            right: 16px;
            bottom: 16px;
            display: inline-flex;
            width: 38px;
            height: 38px;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: color-mix(in srgb, var(--surface-color) 18%, transparent);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
            transition: transform 220ms ease, background 220ms ease, color 220ms ease;
          }

          .directory-card:hover:not(:disabled) .directory-arrow {
            transform: translateX(3px);
            background: color-mix(in srgb, var(--surface-color) 30%, transparent);
          }

          .directory-state-card,
          .directory-pagination {
            grid-column: 1 / -1;
          }

          .directory-pagination {
            opacity: 0;
            transform: translateY(12px);
            animation: directoryFadeUp 480ms ease-out 240ms both;
          }
        }

        @media (min-width: 1280px) {
          .directory-results {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (min-width: 1600px) {
          .directory-results {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .directory-navbar,
          .directory-navbar-inner,
          .directory-search-row,
          .directory-filters,
          .directory-card,
          .directory-pagination {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }

          .directory-card,
          .directory-avatar,
          .directory-arrow,
          .directory-search,
          .directory-sort-button,
          .directory-card-accent {
            transition: none !important;
          }
        }

        @keyframes directoryHeaderIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes directoryFadeUp {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes directoryCardIn {
          from {
            opacity: 0;
            transform: translateY(24px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
};

const Directory = ({ onNavigate }) => <DirectoryContent onNavigate={onNavigate} variant="page" />;

export default Directory;
