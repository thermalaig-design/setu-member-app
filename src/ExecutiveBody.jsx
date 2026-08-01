import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home as HomeIcon, Mail, Menu, Phone, Search, User, Users, X } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getExecutiveBodyMembers } from './services/supabaseService';
import { getProfilePhotos } from './services/api';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { MEMBER_PRIVACY_UPDATED_EVENT, matchesMemberIdentity } from './utils/memberIdentity';
import Sidebar from './components/Sidebar';

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

const buildCommitteeGroups = (items = []) => {
  const groups = new Map();

  (items || []).forEach((item, index) => {
    const displayName = getCommitteeDisplayName(item);
    const baseKey = getCommitteeGroupKey(item);
    const fallbackKey = `${displayName.toLowerCase()}__${String(item?.id || item?.reg_id || item?.original_id || index)}`;
    const key = baseKey || fallbackKey;
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

const ExecutiveBody = ({ onNavigate }) => {
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
    const titleColor = 'var(--advertisement-title)';

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

  const activeMembers = useMemo(() => {
    const source = tab === 'committee' ? committeeGroups : (data[tab] || []);
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return source;
    return source.filter((item) => {
      const haystackParts = [
        item?.Name,
        item?.member_name_english,
        item?.committee_name_english,
        item?.committee_name_hindi,
        item?.member_role,
        item?.title,
        item?.subtitle,
        item?.position,
        item?.location,
        item?.Mobile,
        item?.Email,
        item?.['Membership number'],
      ];

      if (tab === 'committee' && Array.isArray(item?.committee_members)) {
        item.committee_members.forEach((member) => {
          haystackParts.push(
            member?.Name,
            member?.member_name_english,
            member?.member_role,
            member?.title,
            member?.subtitle,
            member?.Mobile,
            member?.Email,
            member?.['Membership number']
          );
        });
      }

      const haystack = haystackParts
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
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

  const totalPages = Math.max(1, Math.ceil(activeMembers.length / MEMBERS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * MEMBERS_PER_PAGE;
    return activeMembers.slice(start, start + MEMBERS_PER_PAGE);
  }, [activeMembers, currentPage]);

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
    <div className="min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div
        className="theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: `0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)`,
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label="Open menu"
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <h1 className="text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>Executive Body</h1>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'transparent' }}
              aria-label="Home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-25"
          style={{ background: applyOpacity('var(--brand-navy-dark)', 0.12) }}
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="executive-body" />

      <div className="px-4 pt-4">
        <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: applyOpacity(primaryColor, 0.08), border: '1px solid var(--advertisement-card-border)' }}>
          <Search className="h-4 w-4" style={{ color: 'var(--advertisement-card-bg)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, membership, mobile"
            className="w-full bg-transparent outline-none text-sm"
            style={{
                color: `${theme.primary || 'var(--brand-red)'}`,
                caretColor: primaryColor,
              }}
          />
        </div>
      </div>

      <div className="px-4 mt-4 flex gap-2 overflow-x-auto">
        {visibleTabs.map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
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

      <div className="px-4 py-4 space-y-2.5">
        {loading ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              Loading {tab === 'committee' ? 'committees' : 'members'}...
            </p>
          </div>
        ) : error ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid color-mix(in srgb, var(--brand-red) 20%, transparent)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--brand-red-dark)' }}>{error}</p>
          </div>
        ) : activeMembers.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <Users className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--advertisement-subtitle)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              {tab === 'committee' ? 'No committees found' : 'No members found'}
            </p>
          </div>
        ) : (
          <>
            {paginatedMembers.map((item) => {
              const privacyLocked = isPrivacyRestricted(item?.privacy);
              return tab === 'committee' ? (
                <button
                  type="button"
                  key={item?.id || item?.committee_name_english || item?.Name}
                  onClick={() => openCommitteeGroup(item)}
                  className="w-full text-left rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: '1px solid var(--advertisement-card-border)',
                    boxShadow: `0 8px 18px ${applyOpacity(theme.secondary, 0.12)}`
                  }}
                >
                  <div
                    className="h-[3px] rounded-t-2xl"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
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
                  key={item?.id || item?.reg_id || item?.['S. No.']}
                  onClick={() => openMemberDetails(item)}
                  disabled={privacyLocked}
                  className="w-full text-left rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: '1px solid var(--advertisement-card-border)',
                    boxShadow: `0 8px 18px ${applyOpacity(theme.secondary, 0.12)}`,
                    cursor: privacyLocked ? 'default' : 'pointer',
                  }}
                >
                  <div
                    className="h-[3px] rounded-t-2xl"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />
                  <div className="p-3 flex items-start gap-3">
                    <div
                      className="h-[55px] w-[55px] rounded-2xl overflow-hidden shrink-0 flex items-center justify-center"
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

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
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
            {totalPages > 1 && (<div className="mt-2 pt-2 flex items-center justify-between gap-2">
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
    </div>
  );
};

export default ExecutiveBody;
