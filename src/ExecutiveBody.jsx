import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home as HomeIcon, Mail, Menu, Phone, Search, User, Users, X } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getExecutiveBodyMembers } from './services/supabaseService';
import { getProfilePhotos } from './services/api';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { MEMBER_PRIVACY_UPDATED_EVENT, matchesMemberIdentity } from './utils/memberIdentity';
import { getAppHomePath } from './utils/tenantNavigation';
import {
  buildExecutiveBodyCommitteeSearchResults,
  getExecutiveBodySearchFields,
  getSearchRankFromFields,
} from './utils/executiveBodySearch';
import Sidebar from './features/sidebar/Sidebar';

const TAB_OPTIONS = [
  
  { id: 'elected', label: 'Elected' },
  { id: 'committee', label: 'Committee' },
];
const MEMBERS_PER_PAGE = 20;
const EXEC_BODY_ACTIVE_TAB_KEY = 'executive_body_active_tab';
const normalizeCommitteeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const getCommitteeDisplayName = (item = {}) => {
  const englishName = normalizeCommitteeText(item?.committee_name_english || item?.title);
  const hindiName = normalizeCommitteeText(item?.committee_name_hindi || item?.subtitle);
  const roleName = normalizeCommitteeText(item?.member_role);
  return englishName || hindiName || roleName || 'Committee';
};

const getCommitteeGroupKey = (item = {}) => {
  return normalizeCommitteeText(getCommitteeDisplayName(item)).toLowerCase();
};

const normalizePriorityValue = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPrivacyRestricted = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';
const getExecutiveBodyResultKey = (item = {}, fallback = '') => String(
  item?.id || item?.reg_id || item?.members_id || item?.['S. No.'] || item?.['Membership number'] || fallback
);

const buildCommitteeGroups = (items = []) => {
  const groups = new Map();

  (items || []).forEach((item, index) => {
    const displayName = getCommitteeDisplayName(item);
    const normalizedDisplayName = normalizeCommitteeText(displayName).toLowerCase();
    const baseKey = getCommitteeGroupKey(item);
    const fallbackKey = `${normalizedDisplayName || 'committee'}__${String(item?.id || item?.reg_id || item?.original_id || index)}`;
    const key = normalizedDisplayName && normalizedDisplayName !== 'committee' ? baseKey : fallbackKey;
    const existing = groups.get(key);
    const committeeMembers = [...(existing?.committee_members || []), item];

    groups.set(key, {
      ...existing,
      id: existing?.id || key,
      Name: existing?.Name || displayName,
      committee_name_english: existing?.committee_name_english || normalizeCommitteeText(item?.committee_name_english || item?.title || displayName),
      committee_name_hindi: existing?.committee_name_hindi || normalizeCommitteeText(item?.committee_name_hindi || item?.subtitle || ''),
      member_role: existing?.member_role || item?.member_role || displayName,
      title: existing?.title || item?.title || null,
      subtitle: existing?.subtitle || item?.subtitle || null,
      priority: existing?.priority ?? item?.priority ?? null,
      type: 'Committee',
      role_type: 'committee',
      committee_members: committeeMembers,
      member_count: committeeMembers.length,
      created_at: existing?.created_at || item?.created_at || null,
    });
  });

  return Array.from(groups.values()).sort((a, b) => {
    const priorityA = normalizePriorityValue(a?.priority);
    const priorityB = normalizePriorityValue(b?.priority);
    const hasPriorityA = priorityA !== null;
    const hasPriorityB = priorityB !== null;

    if (hasPriorityA || hasPriorityB) {
      if (hasPriorityA !== hasPriorityB) return hasPriorityA ? -1 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;
    }

    return 0;
  });
};

export const ExecutiveBodyContent = ({ onNavigate, variant = 'page' }) => {
  const isPageVariant = variant === 'page';
  const navigate = useNavigate();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(() => {
    const saved = String(sessionStorage.getItem(EXEC_BODY_ACTIVE_TAB_KEY) || '').trim().toLowerCase();
    return TAB_OPTIONS.some((item) => item.id === saved) ? saved : 'committee';
  });
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [data, setData] = useState({ all: [], committee: [], elected: [] });
  const [profilePhotos, setProfilePhotos] = useState({});
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const secondaryColor = theme?.secondary || 'var(--brand-navy)';

  useEffect(() => {
    let mounted = true;
    const trustId = localStorage.getItem('selected_trust_id') || null;
    const trustName = localStorage.getItem('selected_trust_name') || null;

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await getExecutiveBodyMembers(trustId, trustName);
        if (!mounted) return;
        if (!response?.success) {
          setData({ all: [], committee: [], elected: [] });
          setError(response?.error || 'Unable to load executive body members.');
          return;
        }
        setData({
          all: response?.data?.all || [],
          committee: response?.data?.committee || [],
          elected: response?.data?.elected || [],
        });
      } catch (err) {
        if (!mounted) return;
        setData({ all: [], committee: [], elected: [] });
        setError(err?.message || 'Unable to load executive body members.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onPrivacyUpdated = (event) => {
      const detail = event?.detail || {};
      const patch = (items) => items.map((item) => (
        matchesMemberIdentity(item, detail) ? { ...item, privacy: Boolean(detail.privacy) } : item
      ));
      setData((prev) => ({
        all: patch(prev.all),
        committee: patch(prev.committee),
        elected: patch(prev.elected),
      }));
    };
    window.addEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
    return () => window.removeEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
  }, []);

  const committeeGroups = useMemo(() => buildCommitteeGroups(data.committee), [data.committee]);

  const activeResults = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();

    if (tab === 'committee') {
      return buildExecutiveBodyCommitteeSearchResults(committeeGroups, normalizedQuery);
    }

    const source = data[tab] || [];
    if (!normalizedQuery) {
      return source.map((item, index) => ({
        result_type: 'member',
        key: `member:${getExecutiveBodyResultKey(item, index)}`,
        item,
        rank: index,
      }));
    }

    return source
      .map((item, index) => {
        const fields = getExecutiveBodySearchFields(item, tab);
        return {
          result_type: 'member',
          key: `member:${getExecutiveBodyResultKey(item, index)}`,
          item,
          index,
          rank: getSearchRankFromFields(fields, normalizedQuery),
          fieldCount: fields.length,
        };
      })
      .filter((entry) => entry.rank < entry.fieldCount)
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        return left.index - right.index;
      })
      .map((entry) => ({
        result_type: entry.result_type,
        key: entry.key,
        item: entry.item,
        rank: entry.rank,
      }));
  }, [committeeGroups, data, query, tab]);

  const totalByTab = useMemo(
    () => ({
      committee: committeeGroups.length,
      elected: data.elected.length,
    }),
    [committeeGroups, data.elected]
  );

  const visibleTabs = useMemo(
    () => TAB_OPTIONS.filter((item) => totalByTab[item.id] > 0),
    [totalByTab]
  );

  useEffect(() => {
    if (loading) return;
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab(visibleTabs[0]?.id || 'committee');
    }
  }, [tab, visibleTabs, loading]);

  useEffect(() => {
    sessionStorage.setItem(EXEC_BODY_ACTIVE_TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [tab, query]);

  useEffect(() => {
    let active = true;

    const loadPhotos = async () => {
      try {
        const allMembers = data?.all || [];
        if (!allMembers.length) {
          if (active) setProfilePhotos({});
          return;
        }

        const memberIds = allMembers
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
        console.error('Failed to load executive profile photos:', err);
        setProfilePhotos({});
      }
    };

    loadPhotos();
    return () => {
      active = false;
    };
  }, [data]);

  const totalPages = Math.max(1, Math.ceil(activeResults.length / MEMBERS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * MEMBERS_PER_PAGE;
    return activeResults.slice(start, start + MEMBERS_PER_PAGE);
  }, [activeResults, currentPage]);

  const hasSearchQuery = Boolean(String(query || '').trim());

  const openCommitteeGroup = (item) => {
    sessionStorage.setItem(EXEC_BODY_ACTIVE_TAB_KEY, tab);
    const committeeData = {
      id: item?.id || item?.committee_name_english || item?.Name || 'committee',
      Name: item?.Name || item?.committee_name_english || 'Committee',
      type: 'Committee',
      committee_name_english: item?.committee_name_english || item?.Name || 'Committee',
      committee_name_hindi: item?.committee_name_hindi || '',
      committee_members: Array.isArray(item?.committee_members) ? item.committee_members : [],
      member_count: item?.member_count || (Array.isArray(item?.committee_members) ? item.committee_members.length : 0),
      is_committee_group: true,
      previousScreenName: 'executive-body',
      restoreExecutiveTab: tab,
    };

    if (typeof onNavigate === 'function') {
      onNavigate('committee-members', committeeData);
      return;
    }

    navigate('/committee-members', { state: { committeeData } });
  };

  const openMemberDetails = (item) => {
    sessionStorage.setItem(EXEC_BODY_ACTIVE_TAB_KEY, tab);
    const memberData = {
      'S. No.': item?.['S. No.'] || item?.original_id || item?.id || 'N/A',
      Name: item?.Name || item?.member_name_english || 'N/A',
      Mobile: item?.Mobile || 'N/A',
      Email: item?.Email || 'N/A',
      type: item?.type || 'N/A',
      role: item?.role || 'N/A',
      member_role: item?.member_role || item?.title || 'N/A',
      title: item?.title || 'N/A',
      subtitle: item?.subtitle || 'N/A',
      'Membership number': item?.['Membership number'] || 'N/A',
      'Company Name': item?.['Company Name'] || 'N/A',
      'Address Home': item?.['Address Home'] || 'N/A',
      'Address Office': item?.['Address Office'] || 'N/A',
      'Resident Landline': item?.['Resident Landline'] || 'N/A',
      'Office Landline': item?.['Office Landline'] || 'N/A',
      committee_name_english: item?.committee_name_english || item?.title || 'N/A',
      committee_name_hindi: item?.committee_name_hindi || item?.subtitle || 'N/A',
      position: item?.position || item?.title || 'N/A',
      location: item?.location || item?.subtitle || 'N/A',
      isCommitteeMember: item?.role_type === 'committee',
      isElectedMember: item?.role_type === 'elected',
      previousScreenName: 'executive-body',
      restoreExecutiveTab: tab,
    };

    if (typeof onNavigate === 'function') {
      onNavigate('executive-member-details', memberData);
      return;
    }
    navigate('/executive_members_details', { state: { memberData } });
  };

  return (
    <div className="executive-page min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div
        className="executive-navbar theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: `0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)`,
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="executive-navbar-inner px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="executive-icon-button p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label="Open menu"
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <h1 className="executive-title text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>Executive Body</h1>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="executive-icon-button p-2 rounded-xl transition-colors"
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
        <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="executive-body" />
      )}

      <div className="executive-search-wrap px-4 pt-4">
        <div className="executive-search rounded-2xl p-3 flex items-center gap-2" style={{ background: applyOpacity(primaryColor, 0.08), border: '1px solid var(--advertisement-card-border)' }}>
          <Search className="h-4 w-4" style={{ color: 'var(--advertisement-card-bg)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'committee' ? 'Search committees or members' : 'Search by name, role, membership, mobile'}
            className="w-full bg-transparent outline-none text-sm"
            style={{
                color: `${theme.primary || 'var(--brand-red)'}`,
                caretColor: primaryColor,
              }}
          />
          {hasSearchQuery ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-full"
              style={{ color: primaryColor, background: 'transparent' }}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="executive-tabs px-4 mt-4 flex gap-2 overflow-x-auto">
        {visibleTabs.map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="executive-tab px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
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
              {item.label} ({totalByTab[item.id] || 0})
            </button>
          );
        })}
      </div>

      <div className="executive-results px-4 py-4 space-y-2.5">
        {loading ? (
          <div className="executive-state-card rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              Loading {tab === 'committee' ? 'committees' : 'members'}...
            </p>
          </div>
        ) : error ? (
          <div className="executive-state-card rounded-2xl p-6 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid color-mix(in srgb, var(--brand-red) 20%, transparent)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
          </div>
        ) : activeResults.length === 0 ? (
          <div className="executive-state-card rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <Users className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--advertisement-subtitle)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              {hasSearchQuery
                ? tab === 'committee'
                  ? 'No committees or members match your search'
                  : 'No members match your search'
                : tab === 'committee'
                  ? 'No committees found'
                  : 'No members found'}
            </p>
          </div>
        ) : (
          <>
            {paginatedResults.map((result) => {
              const item = result?.item || {};
              const resultType = result?.result_type || (tab === 'committee' ? 'committee' : 'member');
              const privacyLocked = isPrivacyRestricted(item?.privacy);
              return resultType === 'committee' ? (
                <button
                  type="button"
                  key={result?.key || item?.id || item?.committee_name_english || item?.Name}
                  onClick={() => openCommitteeGroup(item)}
                  className="executive-card executive-committee-card w-full text-left rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: '1px solid var(--advertisement-card-border)',
                    boxShadow: `0 8px 18px ${applyOpacity(theme.secondary, 0.12)}`
                  }}
                >
                  <div
                    className="executive-card-accent h-[3px] rounded-t-2xl"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />
                  <div className="executive-card-body p-4">
                    <div className="executive-committee-icon">
                      <Users className="h-7 w-7" />
                    </div>
                    <div className="executive-card-meta flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-extrabold truncate min-w-0" style={{ color: 'var(--advertisement-title)' }}>
                          {item?.Name || item?.committee_name_english || 'N/A'}
                        </h3>
                        <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--advertisement-description)' }}>
                          {item?.member_count ? `${item.member_count} ${item.member_count === 1 ? 'member' : 'members'}` : 'Committee'}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  key={result?.key || item?.id || item?.reg_id || item?.['S. No.']}
                  onClick={() => openMemberDetails(item)}
                  disabled={privacyLocked}
                  className="executive-card executive-member-card w-full text-left rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: '1px solid var(--advertisement-card-border)',
                    boxShadow: `0 8px 18px ${applyOpacity(theme.secondary, 0.12)}`,
                    cursor: privacyLocked ? 'default' : 'pointer',
                  }}
                >
                  <div
                    className="executive-card-accent h-[3px] rounded-t-2xl"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />
                  <div className="executive-card-body p-3 flex items-start gap-3">
                    <div
                      className="executive-avatar h-[55px] w-[55px] rounded-2xl overflow-hidden shrink-0 flex items-center justify-center"
                      style={{ background: applyOpacity(theme.secondary, 0.16), border: `1px solid ${applyOpacity(theme.secondary, 0.22)}` }}
                    >
                      {(() => {
                        const candidateKeys = [
                          item?.['Membership number'],
                          item?.Mobile,
                          item?.members_id,
                          item?.['S. No.'],
                        ].filter(Boolean);
                        const photoUrl = item?.profile_photo_url || candidateKeys.map((key) => profilePhotos[key]).find(Boolean);
                        if (photoUrl) {
                          return (
                            <img
                              src={photoUrl}
                              alt={item?.Name || item?.member_name_english || 'Member'}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          );
                        }
                        return <User className="h-5 w-5" style={{ color: 'var(--advertisement-subtitle)' }} />;
                      })()}
                    </div>

                    <div className="executive-card-meta flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-extrabold truncate min-w-0" style={{ color: 'var(--advertisement-title)' }}>
                          {item?.Name || item?.member_name_english || 'N/A'}
                        </h3>
                        {privacyLocked ? (
                          <span
                            className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold"
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

                      <p className="text-[11px] leading-[1.2]" style={{ color: 'var(--advertisement-description)' }}>
                        {item?.member_role || item?.title || item?.type || 'N/A'}
                      </p>

                      {resultType === 'committee-member' && item?.parent_committee_name ? (
                        <p className="text-[10px] font-semibold leading-[1.2]" style={{ color: 'var(--advertisement-subtitle)' }}>
                          {item.parent_committee_name}
                        </p>
                      ) : null}

                      {/* {(item?.['Membership number'] || item?.subtitle) && (
                        <div className="flex flex-wrap gap-1 justify-start">
                          {item?.['Membership number'] ? (
                            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: applyOpacity(theme.secondary, 0.14), color: 'var(--advertisement-description)' }}>
                              M No: {item['Membership number']}
                            </span>
                          ) : null}
                          {item?.subtitle ? (
                            <span className="self-start text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: applyOpacity(theme.primary, 0.14), color: 'var(--advertisement-description)' }}>
                              {item.subtitle}
                            </span>
                          ) : null}
                        </div>
                      )} */}

                      <div className="flex items-center gap-2 text-[11px]">
                        {/* {item?.Mobile ? (
                          <span className="inline-flex items-center gap-1" style={{ color: 'var(--advertisement-description)' }}>
                            <Phone className="h-3 w-3" />
                            {item.Mobile}
                          </span>
                        ) : null} */}
                        {item?.Email &&
                          item.Email !== "null" &&
                          item.Email.trim() !== "" ? (
                          <span
                            className="inline-flex items-center gap-1 truncate"
                            style={{ color: "var(--advertisement-subtitle)" }}
                          >
                            <Mail className="h-3 w-3" />
                            {item.Email}
                          </span>
                        ) : <span
                            className="inline-flex items-center gap-1 truncate"
                            style={{ color: "var(--advertisement-subtitle)" }}
                          >
                            <Mail className="h-3 w-3" />
                            <i>No email provided</i>
                          </span>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
            {totalPages > 1 && (<div className="executive-pagination mt-2 pt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
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
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
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
            </div>)}
            
          </>
        )}
      </div>
      <style>{`
        @media (min-width: 1024px) {
          .executive-page {
            animation: executivePageIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .executive-navbar {
            animation: executiveNavbarIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .executive-navbar-inner {
            padding: 22px 28px !important;
          }

          .executive-title {
            opacity: 0;
            animation: executiveTitleIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 110ms both;
          }

          .executive-icon-button {
            transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease !important;
          }

          .executive-icon-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 22px color-mix(in srgb, var(--navbar-text) 12%, transparent);
          }

          .executive-search-wrap {
            padding: 20px clamp(20px, 2.4vw, 40px) 0 !important;
            animation: executiveControlsIn 540ms cubic-bezier(0.22, 1, 0.36, 1) 130ms both;
          }

          .executive-search {
            transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
          }

          .executive-search:focus-within {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px color-mix(in srgb, var(--brand-navy-dark) 12%, transparent);
            border-color: color-mix(in srgb, var(--advertisement-title) 32%, transparent) !important;
          }

          .executive-tabs {
            padding-left: clamp(20px, 2.4vw, 40px) !important;
            padding-right: clamp(20px, 2.4vw, 40px) !important;
          }

          .executive-tab {
            transition: none !important;
          }

          .executive-results {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            align-items: stretch;
            padding: 20px clamp(20px, 2.4vw, 40px) 48px !important;
            animation: executiveContentIn 560ms cubic-bezier(0.22, 1, 0.36, 1) 160ms both;
          }

          .executive-results > :not([hidden]) ~ :not([hidden]) {
            margin-top: 0 !important;
          }

          .executive-card {
            position: relative;
            overflow: hidden;
            min-height: 210px;
            opacity: 0;
            transform: translateY(18px) scale(0.985);
            animation: executiveCardIn 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
            transition:
              transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 240ms ease,
              border-color 240ms ease,
              filter 240ms ease !important;
            will-change: transform, opacity;
          }

          .executive-card:nth-child(1) { animation-delay: 190ms; }
          .executive-card:nth-child(2) { animation-delay: 260ms; }
          .executive-card:nth-child(3) { animation-delay: 330ms; }
          .executive-card:nth-child(4) { animation-delay: 400ms; }
          .executive-card:nth-child(5) { animation-delay: 470ms; }
          .executive-card:nth-child(6) { animation-delay: 540ms; }
          .executive-card:nth-child(7) { animation-delay: 610ms; }
          .executive-card:nth-child(8) { animation-delay: 680ms; }
          .executive-card:nth-child(9) { animation-delay: 750ms; }
          .executive-card:nth-child(n + 10) { animation-delay: 820ms; }

          .executive-card::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            background:
              radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--surface-color) 28%, transparent), transparent 40%),
              linear-gradient(180deg, color-mix(in srgb, var(--advertisement-title) 10%, transparent), transparent 54%);
            transition: opacity 240ms ease;
          }

          .executive-card::after {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            border-radius: inherit;
            box-shadow:
              inset 0 0 0 1px color-mix(in srgb, var(--surface-color) 20%, transparent),
              inset 0 -28px 48px color-mix(in srgb, var(--brand-navy-dark) 8%, transparent);
            transition: opacity 240ms ease;
          }

          .executive-card:not(:disabled):hover {
            transform: translateY(-6px);
            filter: saturate(1.06) brightness(1.02);
            border-color: color-mix(in srgb, var(--advertisement-title) 48%, var(--advertisement-card-border)) !important;
            box-shadow:
              0 22px 44px color-mix(in srgb, var(--brand-navy-dark) 20%, transparent),
              0 7px 16px color-mix(in srgb, var(--advertisement-title) 14%, transparent),
              0 0 0 1px color-mix(in srgb, var(--advertisement-title) 18%, transparent) !important;
          }

          .executive-card:not(:disabled):hover::before,
          .executive-card:not(:disabled):hover::after {
            opacity: 1;
          }

          .executive-card-accent {
            position: absolute;
            top: 0;
            left: 0;
            z-index: 3;
            width: 100%;
            height: 4px !important;
            border-radius: 0 !important;
            transition: height 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease;
          }

          .executive-card:not(:disabled):hover .executive-card-accent {
            height: 5px;
            filter: saturate(1.18);
          }

          .executive-card-body {
            display: flex !important;
            min-height: 204px;
            flex-direction: column;
            align-items: stretch !important;
            justify-content: flex-start;
            gap: 12px !important;
            padding: 18px 14px 14px !important;
            position: relative;
            z-index: 1;
          }

          .executive-committee-card .executive-card-body {
            min-height: 190px;
          }

          .executive-avatar,
          .executive-committee-icon {
            width: 100% !important;
            height: 132px !important;
            border-radius: 16px !important;
            background: linear-gradient(135deg, color-mix(in srgb, var(--advertisement-title) 14%, transparent), color-mix(in srgb, var(--advertisement-subtitle) 18%, transparent)) !important;
            border: 1px solid color-mix(in srgb, var(--surface-color) 28%, transparent) !important;
          }

          .executive-committee-icon {
            height: 108px !important;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--advertisement-subtitle);
          }

          .executive-committee-card .executive-card-meta {
            display: block !important;
            min-height: auto;
            margin-top: 12px;
          }

          .executive-committee-card .executive-card-meta > div {
            width: 100%;
          }

          .executive-committee-card .executive-card-meta h3 {
            margin-top: 0;
            min-height: auto;
          }

          .executive-committee-card .executive-card-meta p {
            margin-top: 6px !important;
          }

          .executive-avatar svg {
            width: 24px !important;
            height: 24px !important;
          }

          .executive-avatar img {
            object-fit: cover;
          }

          .executive-card-meta {
            width: 100%;
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          .executive-card-meta h3 {
            font-size: 14px !important;
            line-height: 1.25;
            white-space: normal !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }

          .executive-card-meta p,
          .executive-card-meta span {
            white-space: normal !important;
          }

          .executive-avatar,
          .executive-committee-icon {
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
          }

          .executive-card:not(:disabled):hover .executive-avatar,
          .executive-card:not(:disabled):hover .executive-committee-icon {
            transform: translateY(-3px);
            box-shadow:
              0 12px 22px color-mix(in srgb, var(--brand-navy-dark) 14%, transparent),
              0 0 0 2px color-mix(in srgb, var(--surface-color) 58%, transparent);
          }

          .executive-card:not(:disabled):hover .executive-card-meta {
            transform: translateY(-2px);
          }

          .executive-state-card,
          .executive-pagination {
            grid-column: 1 / -1;
            animation: executiveCardIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both;
          }
        }

        @media (min-width: 1280px) {
          .executive-results {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (min-width: 1600px) {
          .executive-results {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }

        @keyframes executivePageIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes executiveNavbarIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes executiveTitleIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes executiveControlsIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes executiveContentIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes executiveCardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (min-width: 1024px) and (prefers-reduced-motion: reduce) {
          .executive-page,
          .executive-navbar,
          .executive-title,
          .executive-search-wrap,
          .executive-tabs,
          .executive-results,
          .executive-card,
          .executive-state-card,
          .executive-pagination {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }

          .executive-icon-button,
          .executive-search,
          .executive-tab,
          .executive-card,
          .executive-card-accent,
          .executive-avatar,
          .executive-committee-icon,
          .executive-card-meta {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
};

const ExecutiveBody = ({ onNavigate }) => <ExecutiveBodyContent onNavigate={onNavigate} variant="page" />;

export default ExecutiveBody;
