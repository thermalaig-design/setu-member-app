import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, ChevronLeft, Phone, Mail, User, Search } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { MEMBER_PRIVACY_UPDATED_EVENT, matchesMemberIdentity } from './utils/memberIdentity';

const normalizeText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const normalizePriorityValue = (value) => {
  if (value === null || value === undefined || value === '') return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const parsed = Number.parseInt(normalized, 10);
  return Number.isNaN(parsed) ? null : parsed;
};
const isPrivacyRestricted = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';
const MEMBERS_PER_PAGE = 20;
const EMPTY_MEMBERS = [];
const COMMITTEE_SEARCH_FIELDS = [
  (member) => member?.member_name_english,
  (member) => member?.Name,
  (member) => member?.member_role,
  (member) => member?.title,
  (member) => member?.subtitle,
  (member) => member?.committee_name_english,
  (member) => member?.committee_name_hindi,
  (member) => member?.['Membership number'],
  (member) => member?.membership_number,
  (member) => member?.membership_no,
  (member) => member?.Mobile,
  (member) => member?.Email,
  (member) => member?.type,
  (member) => member?.role,
  (member) => member?.['Address Home'],
  (member) => member?.['Address Office'],
];

const getCommitteeMemberSearchRank = (member, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return COMMITTEE_SEARCH_FIELDS.length;

  for (let index = 0; index < COMMITTEE_SEARCH_FIELDS.length; index += 1) {
    const fieldValue = COMMITTEE_SEARCH_FIELDS[index](member);
    if (String(fieldValue ?? '').toLowerCase().includes(normalizedQuery)) {
      return index;
    }
  }

  return COMMITTEE_SEARCH_FIELDS.length;
};

const CommitteeMembers = ({ committeeData, onNavigateBack, previousScreenName }) => {
  // Get screen name for back button
  const getScreenName = () => {
    if (!previousScreenName) return 'Directory';

    // Handle both route paths and screen names
    const screenName = previousScreenName.replace(/^\//, ''); // Remove leading slash if present

    const screenNames = {
      'directory': 'Directory',
      '/directory': 'Directory',
      'healthcare-trustee-directory': 'Directory',
      '/healthcare-trustee-directory': 'Directory',
      'healthcare': 'Healthcare Directory',
      'trustees': 'Trustees',
      'patrons': 'Patrons',
      'committee': 'Committee',
      'doctors': 'Doctors',
      'hospitals': 'Hospitals',
      'executive-body': 'Executive Body',
      '/executive-body': 'Executive Body',
      '/': 'Home'
    };

    return screenNames[previousScreenName] || screenNames[screenName] || 'Directory';
  };

  const theme = useAppTheme();
  const navigate = useNavigate();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const primaryColor = theme?.primary || 'var(--brand-red)';
  const secondaryColor = theme?.secondary || 'var(--brand-navy)';
  const cardBg = 'var(--advertisement-card-bg)';
  const cardBorder = 'var(--advertisement-card-border)';
  const titleColor = 'var(--advertisement-title)';
  const descriptionColor = 'var(--advertisement-description)';
  const subtitleColor = 'var(--advertisement-subtitle)';

  const [privacyOverrides, setPrivacyOverrides] = useState({});

  useEffect(() => {
    const onPrivacyUpdated = (event) => {
      const detail = event?.detail || {};
      const members = Array.isArray(committeeData?.committee_members) ? committeeData.committee_members : EMPTY_MEMBERS;
      const matched = members.find((member) => matchesMemberIdentity(member, detail));
      const key = matched?.members_id || matched?.reg_id || matched?.id || matched?.original_id || matched?.['S. No.'];
      if (!matched || !key) return;
      setPrivacyOverrides((prev) => ({ ...prev, [key]: Boolean(detail.privacy) }));
    };
    window.addEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
    return () => window.removeEventListener(MEMBER_PRIVACY_UPDATED_EVENT, onPrivacyUpdated);
  }, [committeeData?.committee_members]);

  const committeeMembers = useMemo(() => {
    const members = Array.isArray(committeeData?.committee_members) ? committeeData.committee_members : EMPTY_MEMBERS;
    const withOverrides = members.map((member) => {
      const key = member?.members_id || member?.reg_id || member?.id || member?.original_id || member?.['S. No.'];
      return key && Object.prototype.hasOwnProperty.call(privacyOverrides, key)
        ? { ...member, privacy: privacyOverrides[key] }
        : member;
    });

    return [...withOverrides].sort((a, b) => {
      const aPriority = normalizePriorityValue(a?.priority);
      const bPriority = normalizePriorityValue(b?.priority);
      const aHasPriority = aPriority !== null;
      const bHasPriority = bPriority !== null;

      if (aHasPriority || bHasPriority) {
        if (aHasPriority !== bHasPriority) return aHasPriority ? -1 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
      }

      return normalizeText(a?.member_name_english || a?.Name || '').localeCompare(
        normalizeText(b?.member_name_english || b?.Name || '')
      );
    });
  }, [committeeData?.committee_members, privacyOverrides]);
  const committeeName = normalizeText(committeeData?.Name || committeeData?.committee_name_english || committeeData?.committee_name_hindi || 'Committee');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const filteredMembers = useMemo(() => {
    const query = normalizeText(searchQuery).toLowerCase();
    if (!query) return committeeMembers;

    return committeeMembers
      .map((member, index) => ({
        member,
        index,
        rank: getCommitteeMemberSearchRank(member, query),
      }))
      .filter((item) => item.rank < COMMITTEE_SEARCH_FIELDS.length)
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        return left.index - right.index;
      })
      .map((item) => item.member);
  }, [committeeMembers, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / MEMBERS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedMembers = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * MEMBERS_PER_PAGE;
    return filteredMembers.slice(startIndex, startIndex + MEMBERS_PER_PAGE);
  }, [filteredMembers, safeCurrentPage]);

  const openMemberDetails = (member) => {
    if (isPrivacyRestricted(member?.privacy)) return;

    const memberData = {
      'S. No.': member?.['S. No.'] || member?.original_id || member?.id || 'N/A',
      Name: member?.member_name_english || member?.Name || 'N/A',
      Mobile: member?.Mobile || 'N/A',
      Email: member?.Email || 'N/A',
      type: member?.type || 'N/A',
      role: member?.role || 'N/A',
      member_role: member?.subtitle || member?.role_type || 'N/A',
      title: member?.title || 'N/A',
      subtitle: member?.subtitle || 'N/A',
      'Membership number': member?.['Membership number'] || member?.membership_number || member?.membership_no || 'N/A',
      'Company Name': member?.['Company Name'] || 'N/A',
      'Address Home': member?.['Address Home'] || 'N/A',
      'Address Office': member?.['Address Office'] || 'N/A',
      'Resident Landline': member?.['Resident Landline'] || 'N/A',
      'Office Landline': member?.['Office Landline'] || 'N/A',
      committee_name_english: member?.committee_name_english || committeeData?.committee_name_english || committeeName || 'N/A',
      committee_name_hindi: member?.committee_name_hindi || committeeData?.committee_name_hindi || 'N/A',
      member_name_english: member?.member_name_english || member?.Name || 'N/A',
      member_name_hindi: member?.member_name_hindi || 'N/A',
      privacy: member?.privacy ?? null,
      profile_photo_url: member?.profile_photo_url || '',
      members_id: member?.members_id || null,
      reg_id: member?.reg_id || null,
      original_id: member?.original_id || member?.['S. No.'] || null,
      source: 'committee-members',
      isHealthcareMember: false,
      isCommitteeMember: true,
      is_committee_member: true,
      previousScreen: '/committee-members',
      previousScreenName: '/committee-members',
    };

    sessionStorage.setItem('selectedDetailMember', JSON.stringify(memberData));
    navigate('/executive_members_details', { state: { memberData } });
  };

  return (
    <div className="committee-page min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div
        className="committee-navbar theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: `0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)`,
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="committee-navbar-inner px-4 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onNavigateBack}
              className="committee-back p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label={`Back to ${getScreenName()}`}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="committee-title min-w-0 flex-1 text-center">
              <h1 className="text-lg font-extrabold tracking-wide truncate" style={{ color: navbarTextColor }}>
              {committeeName}  
              </h1>
              
            </div>

            <div className="h-10 w-10" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="committee-controls px-4 pt-4 space-y-3">
        <div className="flex flex-col gap-3">
          

          <div className="committee-search rounded-2xl p-3 flex items-center gap-2"
            style={{
              background: applyOpacity(primaryColor, 0.08),
              border: `1px solid ${applyOpacity(cardBg, 0.16)}`,
            }}
          >
            <Search className="h-4 w-4" style={{ color: cardBg }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by name, role, membership, email, phone"
              className="w-full bg-transparent outline-none text-sm"
              style={{
                color: 'var(--advertisement-description)',
                caretColor: primaryColor,
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span
              className="committee-count inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
              style={{
                background: applyOpacity(secondaryColor, 0.12),
                color: descriptionColor,
                border: `1px solid ${applyOpacity(secondaryColor, 0.18)}`
              }}
            >
              Members ({filteredMembers.length})
            </span>
            
          </div>
        </div>
      </div>

      <div className="committee-list-content px-4 py-1 space-y-3">
        {committeeMembers.length > 0 ? (
          <div className="committee-member-grid space-y-3">
            {paginatedMembers.map((member, index) => {
              const memberName = normalizeText(member.member_name_english || member.Name || 'N/A');
              const memberCommitteeName = normalizeText(member.committee_name_english || committeeData.committee_name_english || committeeName || 'N/A');
              const memberRole = normalizeText(member.subtitle || member.title || member.subtitle || '');
              // const phoneNumber = normalizeText(member.Mobile || member.phone1 || member.phone2 || '');
              const emailAddress = normalizeText(member.Email || '');
              const privacyLocked = isPrivacyRestricted(member?.privacy);

              return (
                <button
                  type="button"
                  key={member['S. No.'] || member.id || `member-${index}`}
                  onClick={() => openMemberDetails(member)}
                  disabled={privacyLocked}
                  className="committee-member-card w-full appearance-none border-0 p-0 text-left overflow-hidden rounded-2xl disabled:opacity-100 disabled:cursor-default"
                  style={{
                    background: cardBg,
                    border: `1px solid ${cardBorder}`,
                    boxShadow: `0 8px 18px ${applyOpacity(secondaryColor, 0.12)}`,
                    cursor: privacyLocked ? 'default' : 'pointer',
                  }}
                >
                  <div
                    className="committee-card-accent h-[3px]"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />

                  <div className="committee-card-body flex items-start gap-3 px-3 py-3">
                    <div
                      className="committee-avatar h-[55px] w-[55px] rounded-2xl overflow-hidden shrink-0 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${applyOpacity(primaryColor, 0.14)}, ${applyOpacity(secondaryColor, 0.18)})`,
                        border: `1px solid ${applyOpacity(secondaryColor, 0.22)}`
                      }}
                    >
                      <User className="h-5 w-5" style={{ color: subtitleColor }} />
                    </div>

                    <div className="committee-card-meta flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-extrabold truncate min-w-0" style={{ color: titleColor }}>
                            {memberName}
                          </h3>
                        </div>

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

                      <div className="flex flex-wrap gap-1.5 justify-start">
                        {/* {membershipNumber ? (
                          <span
                            className="self-start text-[10px] font-semibold px-2 py-1 rounded-full"
                            style={{
                              background: applyOpacity(primaryColor, 0.14),
                              color: descriptionColor,
                            }}
                          >
                            M No: {membershipNumber}
                          </span>
                        ) : null} */}

                        {memberRole && memberRole.toLowerCase() !== memberCommitteeName.toLowerCase() ? (
                          <span
                            className="self-start text-[10px] font-semibold px-2 py-1 rounded-full"
                            style={{
                              background: applyOpacity(secondaryColor, 0.12),
                              color: descriptionColor,
                            }}
                          >
                            {memberRole}
                          </span>
                        ) : null}
                      </div> 

                      <div className="flex items-center gap-2 text-[11px] flex-wrap">
                        {/* {phoneNumber ? (
                          <span className="inline-flex items-center gap-1" style={{ color: descriptionColor }}>
                            <Phone className="h-3 w-3" style={{ color: primaryColor }} />
                            {phoneNumber}
                          </span>
                        ) : null} */}
                        {emailAddress && emailAddress !== null && emailAddress !== 'N/A' && emailAddress !== undefined  && emailAddress !== 'null' && emailAddress !== 'NULL' ? (
                          <span className="committee-email-row inline-flex items-center gap-1 truncate" style={{ color: subtitleColor }}>
                            <Mail className="h-3 w-3" style={{ color: secondaryColor }} />
                            <span className="committee-email-text">{emailAddress}</span>
                          </span>
                        ) : <span className="committee-email-row inline-flex items-center w-full gap-1 truncate" style={{ color: subtitleColor }}>
                            <Mail className="h-3 w-3" style={{ color: secondaryColor }} />
                            <i className="committee-email-text">No Email Provided</i>
                          </span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {paginatedMembers.length > 1 ? (
          <div className="committee-pagination mt-2 pt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={safeCurrentPage <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: applyOpacity(secondaryColor, 0.14),
                color: descriptionColor,
                border: `1px solid ${applyOpacity(secondaryColor, 0.24)}`,
              }}
            >
              Prev
            </button>

            <span className="text-xs font-semibold" style={{ color: subtitleColor }}>
              Page {safeCurrentPage} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={safeCurrentPage >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: applyOpacity(primaryColor, 0.16),
                color: descriptionColor,
                border: `1px solid ${applyOpacity(primaryColor, 0.24)}`,
              }}
            >
              Next
            </button>
          </div>
        ) : (
          <div className="committee-empty text-center py-20" style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: '1rem' }}>
            <div
              className="h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-4 border border-dashed"
              style={{ background: applyOpacity(secondaryColor, 0.08), borderColor: applyOpacity(secondaryColor, 0.24) }}
            >
              <Users className="h-8 w-8" style={{ color: subtitleColor }} />
            </div>
            <h3 className="font-bold" style={{ color: titleColor }}>No members found</h3>
            <p className="text-sm mt-1" style={{ color: subtitleColor }}>This committee has no members</p>
          </div>
        )}
      </div>
      <style>{`
        @media (min-width: 1024px) {
          .committee-page {
            animation: committeePageIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .committee-navbar {
            animation: committeeNavbarIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .committee-navbar-inner {
            padding: 22px 28px !important;
          }

          .committee-back {
            transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease !important;
          }

          .committee-back:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 22px color-mix(in srgb, var(--navbar-text) 12%, transparent);
          }

          .committee-title {
            opacity: 0;
            animation: committeeTitleIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 110ms both;
          }

          .committee-controls {
            padding: 20px clamp(20px, 2.4vw, 40px) 8px !important;
            animation: committeeControlsIn 540ms cubic-bezier(0.22, 1, 0.36, 1) 130ms both;
          }

          .committee-search {
            transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease;
          }

          .committee-search:focus-within {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px color-mix(in srgb, var(--brand-navy-dark) 12%, transparent);
            border-color: color-mix(in srgb, var(--advertisement-title) 32%, transparent) !important;
          }

          .committee-count {
            animation: committeeCountIn 460ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both;
          }

          .committee-list-content {
            padding: 8px clamp(20px, 2.4vw, 40px) 48px !important;
            animation: committeeContentIn 560ms cubic-bezier(0.22, 1, 0.36, 1) 150ms both;
          }

          .committee-member-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            align-items: stretch;
          }

          .committee-member-card {
            position: relative;
            overflow: hidden;
            min-height: 210px;
            opacity: 0;
            transform: translateY(18px) scale(0.985);
            animation: committeeCardIn 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
            transition:
              transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 240ms ease,
              border-color 240ms ease,
              filter 240ms ease !important;
            will-change: transform, opacity;
          }

          .committee-member-card:nth-child(1) { animation-delay: 190ms; }
          .committee-member-card:nth-child(2) { animation-delay: 260ms; }
          .committee-member-card:nth-child(3) { animation-delay: 330ms; }
          .committee-member-card:nth-child(4) { animation-delay: 400ms; }
          .committee-member-card:nth-child(5) { animation-delay: 470ms; }
          .committee-member-card:nth-child(6) { animation-delay: 540ms; }
          .committee-member-card:nth-child(7) { animation-delay: 610ms; }
          .committee-member-card:nth-child(8) { animation-delay: 680ms; }
          .committee-member-card:nth-child(9) { animation-delay: 750ms; }
          .committee-member-card:nth-child(n + 10) { animation-delay: 820ms; }

          .committee-member-card::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            background:
              radial-gradient(circle at 22% 0%, color-mix(in srgb, var(--surface-color) 26%, transparent), transparent 40%),
              linear-gradient(180deg, color-mix(in srgb, var(--advertisement-title) 10%, transparent), transparent 54%);
            transition: opacity 240ms ease;
          }

          .committee-member-card::after {
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

          .committee-member-card:not(:disabled):hover {
            transform: translateY(-6px);
            filter: saturate(1.06) brightness(1.02);
            border-color: color-mix(in srgb, var(--advertisement-title) 48%, var(--advertisement-card-border)) !important;
            box-shadow:
              0 22px 44px color-mix(in srgb, var(--brand-navy-dark) 20%, transparent),
              0 7px 16px color-mix(in srgb, var(--advertisement-title) 14%, transparent),
              0 0 0 1px color-mix(in srgb, var(--advertisement-title) 18%, transparent) !important;
          }

          .committee-member-card:not(:disabled):hover::before,
          .committee-member-card:not(:disabled):hover::after {
            opacity: 1;
          }

          .committee-card-accent {
            position: absolute;
            top: 0;
            left: 0;
            z-index: 3;
            width: 100%;
            height: 4px !important;
            border-radius: 0 !important;
            transition: height 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease;
          }

          .committee-member-card:not(:disabled):hover .committee-card-accent {
            height: 5px;
            filter: saturate(1.18);
          }

          .committee-card-body {
            min-height: 204px;
            flex-direction: column;
            align-items: stretch !important;
            justify-content: flex-start;
            gap: 12px !important;
            padding: 18px 14px 14px !important;
            position: relative;
            z-index: 1;
          }

          .committee-avatar {
            width: 100% !important;
            height: 132px !important;
            aspect-ratio: auto;
            border-radius: 16px !important;
          }

          .committee-avatar svg {
            width: 24px !important;
            height: 24px !important;
          }

          .committee-card-meta {
            width: 100%;
          }

          .committee-card-meta h3 {
            font-size: 14px !important;
            line-height: 1.25;
            white-space: normal !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }

          .committee-card-meta > div:first-child {
            min-height: 38px;
          }

          .committee-card-meta > div:first-child > div:first-child {
            min-width: 0;
          }

          .committee-card-meta > div:nth-child(2) {
            min-height: 26px;
          }

          .committee-card-meta > div:last-child {
            min-height: 32px;
          }

          .committee-card-meta > div:last-child {
            min-width: 0;
          }

          .committee-email-row {
            display: inline-flex !important;
            align-items: center !important;
            flex-wrap: nowrap !important;
            max-width: 100%;
            min-width: 0;
            white-space: nowrap !important;
          }

          .committee-email-row svg {
            flex: 0 0 auto;
          }

          .committee-email-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .committee-avatar,
          .committee-card-meta {
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
          }

          .committee-member-card:not(:disabled):hover .committee-avatar {
            transform: translateY(-3px);
            box-shadow:
              0 12px 22px color-mix(in srgb, var(--brand-navy-dark) 14%, transparent),
              0 0 0 2px color-mix(in srgb, var(--surface-color) 58%, transparent);
          }

          .committee-member-card:not(:disabled):hover .committee-card-meta {
            transform: translateY(-2px);
          }

          .committee-pagination,
          .committee-empty {
            animation: committeeCardIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 240ms both;
          }
        }

        @media (min-width: 1280px) {
          .committee-member-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (min-width: 1600px) {
          .committee-member-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }

        @keyframes committeePageIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes committeeNavbarIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes committeeTitleIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes committeeControlsIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes committeeCountIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes committeeContentIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes committeeCardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (min-width: 1024px) and (prefers-reduced-motion: reduce) {
          .committee-page,
          .committee-navbar,
          .committee-title,
          .committee-controls,
          .committee-count,
          .committee-list-content,
          .committee-member-card,
          .committee-pagination,
          .committee-empty {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }

          .committee-back,
          .committee-search,
          .committee-member-card,
          .committee-card-accent,
          .committee-avatar,
          .committee-card-meta {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default CommitteeMembers;
