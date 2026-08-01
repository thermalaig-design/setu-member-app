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

    return committeeMembers.filter((member) => {
      const fields = [
        member?.member_name_english,
        member?.Name,
        member?.member_role,
        member?.title,
        member?.subtitle,
        member?.committee_name_english,
        member?.committee_name_hindi,
        member?.['Membership number'],
        member?.membership_number,
        member?.membership_no,
        member?.Mobile,
        member?.Email,
        member?.type,
        member?.role,
        member?.['Address Home'],
        member?.['Address Office'],
      ];

      return fields
        .filter(Boolean)
        .map((value) => normalizeText(value).toLowerCase())
        .some((value) => value.includes(query));
    });
  }, [committeeMembers, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

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
      member_role: member?.member_role || member?.title || 'N/A',
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
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onNavigateBack}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label={`Back to ${getScreenName()}`}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <h1 className="text-lg font-extrabold tracking-wide truncate" style={{ color: navbarTextColor }}>
              {committeeName}  
              </h1>
              
            </div>

            <div className="h-10 w-10" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        <div className="flex flex-col gap-3">
          

          <div className="rounded-2xl p-3 flex items-center gap-2"
            style={{
              background: applyOpacity(primaryColor, 0.08),
              border: `1px solid ${applyOpacity(cardBg, 0.16)}`,
            }}
          >
            <Search className="h-4 w-4" style={{ color: cardBg }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, role, membership, email, phone"
              className="w-full bg-transparent outline-none text-sm"
              style={{
                color: titleColor,
                caretColor: primaryColor,
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
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

      <div className="px-4 py-1 space-y-3">
        {committeeMembers.length > 0 ? (
          <div className="space-y-3">
            {paginatedMembers.map((member, index) => {
              const memberName = normalizeText(member.member_name_english || member.Name || 'N/A');
              const memberCommitteeName = normalizeText(member.committee_name_english || committeeData.committee_name_english || committeeName || 'N/A');
              const memberRole = normalizeText(member.member_role || member.title || member.subtitle || '');
              const membershipNumber = normalizeText(member['Membership number'] || member.membership_number || member.membership_no || '');
              // const phoneNumber = normalizeText(member.Mobile || member.phone1 || member.phone2 || '');
              const emailAddress = normalizeText(member.Email || '');
              const privacyLocked = isPrivacyRestricted(member?.privacy);

              return (
                <button
                  type="button"
                  key={member['S. No.'] || member.id || `member-${index}`}
                  onClick={() => openMemberDetails(member)}
                  disabled={privacyLocked}
                  className="w-full appearance-none border-0 p-0 text-left overflow-hidden rounded-2xl disabled:opacity-100 disabled:cursor-default"
                  style={{
                    background: cardBg,
                    border: `1px solid ${cardBorder}`,
                    boxShadow: `0 8px 18px ${applyOpacity(secondaryColor, 0.12)}`,
                    cursor: privacyLocked ? 'default' : 'pointer',
                  }}
                >
                  <div
                    className="h-[3px]"
                    style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                  />

                  <div className="flex items-start gap-3 px-3 py-3">
                    <div
                      className="h-[55px] w-[55px] rounded-2xl overflow-hidden shrink-0 flex items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${applyOpacity(primaryColor, 0.14)}, ${applyOpacity(secondaryColor, 0.18)})`,
                        border: `1px solid ${applyOpacity(secondaryColor, 0.22)}`
                      }}
                    >
                      <User className="h-5 w-5" style={{ color: subtitleColor }} />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
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

                      {/* <div className="flex flex-wrap gap-1.5 justify-start">
                        {membershipNumber ? (
                          <span
                            className="self-start text-[10px] font-semibold px-2 py-1 rounded-full"
                            style={{
                              background: applyOpacity(primaryColor, 0.14),
                              color: descriptionColor,
                            }}
                          >
                            M No: {membershipNumber}
                          </span>
                        ) : null}

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
                      </div> */}

                      <div className="flex items-center gap-2 text-[11px] flex-wrap">
                        {/* {phoneNumber ? (
                          <span className="inline-flex items-center gap-1" style={{ color: descriptionColor }}>
                            <Phone className="h-3 w-3" style={{ color: primaryColor }} />
                            {phoneNumber}
                          </span>
                        ) : null} */}
                        {emailAddress && emailAddress !== null && emailAddress !== 'N/A' && emailAddress !== undefined  && emailAddress !== 'null' && emailAddress !== 'NULL' ? (
                          <span className="inline-flex items-center gap-1 truncate" style={{ color: subtitleColor }}>
                            <Mail className="h-3 w-3" style={{ color: secondaryColor }} />
                            {emailAddress}
                          </span>
                        ) : <span className="inline-flex items-center w-full gap-1 truncate" style={{ color: subtitleColor }}>
                            <Mail className="h-3 w-3" style={{ color: secondaryColor }} />
                            <i>No Email Provided</i>
                          </span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {committeeMembers.length > 1 ? (
          <div className="mt-2 pt-2 flex items-center justify-between gap-2">
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
          <div className="text-center py-20" style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: '1rem' }}>
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
    </div>
  );
};

export default CommitteeMembers;
