import { useAppTheme } from './context/ThemeContext';
import React, { useState, useEffect } from 'react';
import { User, Users, Stethoscope, Building2, Star, Award, ChevronLeft, Phone, Mail, MapPin, FileText, Clock, HomeIcon } from 'lucide-react';
import { getProfilePhotos } from './services/api';
import { getNavbarThemeStyles } from './utils/themeUtils';
import { useNavigate } from 'react-router-dom';

const MemberDetails = ({ member, onNavigateBack, previousScreenName }) => {
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navigate = useNavigate();
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const [profilePhoto, setProfilePhoto] = useState(member?.profile_photo_url || null);
  const cleanValue = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'n/a') return '';
    return text;
  };
  const toPhoneText = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      const joined = value.map((item) => cleanValue(item)).filter(Boolean).join(', ');
      return cleanValue(joined);
    }
    if (typeof value === 'object') {
      const candidates = [
        value.mobile,
        value.phone,
        value.phone1,
        value.phone2,
        value.number,
        value.value,
      ];
      for (const candidate of candidates) {
        const normalized = cleanValue(candidate);
        if (normalized) return normalized;
      }
      return '';
    }
    return cleanValue(value);
  };
  const toDialableNumber = (value) => {
    const text = toPhoneText(value);
    if (!text) return '';
    return text.replace(/\s+/g, '').split(',')[0];
  };

  const displayName = cleanValue(member.member_name_english) || cleanValue(member.Name) || 'Member';
  const displayRole = cleanValue(member.member_role) || cleanValue(member.type);

  useEffect(() => {
    if (member?.profile_photo_url) {
      setProfilePhoto(member.profile_photo_url);
      return undefined;
    }

    const fetchPhoto = async () => {
      const memberIds = [];
      if (member['Membership number']) memberIds.push(member['Membership number']);
      if (member.membership_number) memberIds.push(member.membership_number);
      if (member.Mobile) memberIds.push(member.Mobile);
      if (member.mobile) memberIds.push(member.mobile);
      if (member.phone1) memberIds.push(member.phone1);
      if (member.phone2) memberIds.push(member.phone2);
      if (member.members_id) memberIds.push(member.members_id);
      if (member.member_id) memberIds.push(member.member_id);

      const idsToFetch = memberIds.filter(id => id && id !== 'N/A');
      if (idsToFetch.length === 0) return undefined;

      try {
        const response = await getProfilePhotos(idsToFetch);
        if (response.success && response.photos) {
          const photo = idsToFetch.map(id => response.photos[id]).find(p => p);
          if (photo) setProfilePhoto(photo);
        }
      } catch (err) {
        console.error('Error fetching member photo:', err);
      }
    };

    fetchPhoto();
    return undefined;
  }, [member]);

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
      '/': 'Home'
    };

    return screenNames[previousScreenName] || screenNames[screenName] || 'Directory';
  };

  return (
    <div className="min-h-screen member-details-theme" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      {/* Header Section */}
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
        <div className="px-6 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <button
              onClick={onNavigateBack}
              className="p-2 rounded-xl transition-colors flex items-center gap-1"
              style={{ color: navbarTextColor, background: 'transparent' }}
            >
              <ChevronLeft className="h-5 w-5" />
              
            </button>
            <h1 className="text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>Member Details</h1>
            {/* <h1 className="text-2xl font-bold flex-1 text-center pr-16" style={{ color: navbarTextColor }}>Member Details</h1> */}
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

      {/* Member Details Card */}
      <div className="p-6">
        <div className="rounded-2xl shadow-sm p-6" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)', boxShadow: '0 12px 28px color-mix(in srgb, var(--advertisement-card-shadow) 24%, transparent)' }}>
          <div className="flex items-center gap-4 mb-6" style={{ flexDirection: 'column'}}>
            <div className="h-20 w-20 rounded-2xl flex items-center justify-center overflow-hidden shadow-sm border" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 76%, var(--app-accent-bg))', color: 'var(--advertisement-title)', borderColor: 'var(--advertisement-card-border)' }}>
              {profilePhoto ? (
                <img
                  src={profilePhoto}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.style.display = 'none';
                    const iconContainer = e.target.parentElement;
                    if (member.type && member.type.toLowerCase().includes('doctor')) {
                      iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-stethoscope h-8 w-8 text-[color:var(--brand-navy)]"><path d="M4.8 2.3A.3.3 0 1 0 5 2a.3.3 0 0 0-.2.3Z"/><path d="M10 2a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/><path d="M10 7v10.5c0 .3.2.5.5.5h3c.3 0 .5-.2.5-.5V7"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>';
                    } else if (member.type && member.type.toLowerCase().includes('committee')) {
                      iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users h-8 w-8 text-[color:var(--brand-navy)]"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
                    } else if (member.type && (member.type.toLowerCase().includes('trustee') || member.type.toLowerCase().includes('patron'))) {
                      iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star h-8 w-8 text-[color:var(--brand-navy)]"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
                    } else {
                      iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user h-8 w-8 text-[color:var(--brand-navy)]"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
                    }
                  }}
                />
              ) : (
                member.type && member.type.toLowerCase().includes('doctor') ? <Stethoscope className="h-8 w-8 text-[color:var(--brand-navy)]" /> :
                  member.type && member.type.toLowerCase().includes('committee') ? <Users className="h-8 w-8 text-[color:var(--brand-navy)]" /> :
                    member.type && (member.type.toLowerCase().includes('trustee') || member.type.toLowerCase().includes('patron')) ? <Star className="h-8 w-8 text-[color:var(--brand-navy)]" /> :
                      <User className="h-8 w-8 text-[color:var(--brand-navy)]" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--advertisement-title)' }}>{displayName}</h2>
              {/* {!member.isHospitalMember && displayRole && (
                <p className="text-sm font-medium" style={{ color: theme.primary }}>{displayRole}</p>
              )} */}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* Determine if this is a healthcare member (from opd_schedule) or committee member */}
            {(() => {
              const isHealthcareMember = member.isHealthcareMember ||
                !!member.consultant_name ||
                (member.original_id && member.original_id.toString().startsWith('DOC')) ||
                (member['S. No.'] && member['S. No.'].toString().startsWith('DOC'));
              const isCommitteeMember = member.isCommitteeMember ||
                (member.original_id && member.original_id.toString().startsWith('CM')) ||
                (member['S. No.'] && member['S. No.'].toString().startsWith('CM'));
              const isElectedMember = member.isElectedMember ||
                (member.elected_id !== undefined && member.elected_id !== null) ||
                (member.original_id && member.original_id.toString().startsWith('ELECT')) ||
                (member['S. No.'] && member['S. No.'].toString().startsWith('ELECT'));

              // Show elected member fields (merged with Members Table) - Show ALL fields from both tables
              if (isElectedMember) {
                const electedName =
                  member['Name'] ||
                  member.member_name_english ||
                  member.member_name_hindi ||
                  'N/A';
                const electedRoleType = cleanValue(member.role_type);
                const electedCommitteeName = cleanValue(member.title);
                const electedPosition = cleanValue(member.subtitle);
                const electedPhone =
                  toPhoneText(member['Mobile']) ||
                  toPhoneText(member.phone1) ||
                  toPhoneText(member.phone2) ||
                  '';
                const electedAddress =
                  member['Address Home'] ||
                  member.address ||
                  member['Address Office'] ||
                  '';

                return (
                  <>
                    {electedName && electedName !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <User className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Name</p>
                          <p className="font-medium text-gray-800">{electedName}</p>
                        </div>
                      </div>
                    )}

                    {electedRoleType && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Users className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Role Type</p>
                          <p className="font-medium text-gray-800">{String(electedRoleType).toUpperCase()}</p>
                        </div>
                      </div>
                    )}

                    {electedCommitteeName && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Committee Name</p>
                          <p className="font-medium text-gray-800">{electedCommitteeName}</p>
                        </div>
                      </div>
                    )}

                    {electedPosition && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Award className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Position</p>
                          <p className="font-medium text-gray-800">{electedPosition}</p>
                        </div>
                      </div>
                    )}

                    {electedPhone && electedPhone !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Mobile</p>
                          <a href={`tel:${toDialableNumber(electedPhone)}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {electedPhone}
                          </a>
                        </div>
                      </div>
                    )}

                    {electedAddress && electedAddress !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <MapPin className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Address</p>
                          <p className="font-medium text-gray-800">{electedAddress}</p>
                        </div>
                      </div>
                    )}
                  </>
                );
              }

              // Show committee-specific fields if it's a committee member - Show ALL Supabase fields
              if (isCommitteeMember) {
                const committeeName =
                  member.member_name_english ||
                  member['Name'] ||
                  member.member_name_hindi ||
                  'N/A';
                const committeeRoleType = cleanValue(member.role_type);
                const committeeTitle = cleanValue(member.title);
                const committeePosition = cleanValue(member.subtitle);
                const committeePhone =
                  toPhoneText(member.Mobile) ||
                  toPhoneText(member.phone1) ||
                  toPhoneText(member.phone2) ||
                  '';
                const committeeAddress =
                  member['Address Home'] ||
                  member.address ||
                  member['Address Office'] ||
                  '';

                return (
                  <>
                    {committeeName && committeeName !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <User className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Name</p>
                          <p className="font-medium text-gray-800">{committeeName}</p>
                        </div>
                      </div>
                    )}

                    {committeeRoleType && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Users className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Role Type</p>
                          <p className="font-medium text-gray-800">{String(committeeRoleType).toUpperCase()}</p>
                        </div>
                      </div>
                    )}

                    {committeeTitle && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Committee Name</p>
                          <p className="font-medium text-gray-800">{committeeTitle}</p>
                        </div>
                      </div>
                    )}

                    {committeePosition && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Award className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Position</p>
                          <p className="font-medium text-gray-800">{committeePosition}</p>
                        </div>
                      </div>
                    )}

                    {committeePhone && committeePhone !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Mobile</p>
                          <a href={`tel:${toDialableNumber(committeePhone)}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {committeePhone}
                          </a>
                        </div>
                      </div>
                    )}

                    {committeeAddress && committeeAddress !== 'N/A' && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-2xl">
                        <MapPin className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Address</p>
                          <p className="font-medium text-gray-800">{committeeAddress}</p>
                        </div>
                      </div>
                    )}
                  </>
                );
              }

              // Show Members Table fields only if NOT a healthcare member, NOT a committee member, and NOT an elected member
              if (!isHealthcareMember && !isElectedMember) {
                return (
                  <>
                    {member['Membership number'] && member['Membership number'] !== 'N/A' && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Award className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Membership No</p>
                          <p className="font-medium text-gray-800">{member['Membership number']}</p>
                        </div>
                      </div>
                    )}

                    {/* {member['Name'] && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <User className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Name</p>
                          <p className="font-medium text-gray-800">{member['Name']}</p>
                        </div>
                      </div>
                    )} */}
                    {(member.role || member.type) && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Users className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Role</p>
                          <p className="font-medium text-gray-800">{displayRole || 'N/A'}</p>
                        </div>
                      </div>
                    )}
                    
                    {member['Company Name'] && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Building2 className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Company</p>
                          <p className="font-medium text-gray-800">{member['Company Name']}</p>
                        </div>
                      </div>
                    )}

                    {member['Address Home'] && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <MapPin className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Address Home</p>
                          <p className="font-medium text-gray-800">{member['Address Home']}</p>
                        </div>
                      </div>
                    )}

                    {member['Address Office'] && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <MapPin className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Office Address</p>
                          <p className="font-medium text-gray-800">{member['Address Office']}</p>
                        </div>
                      </div>
                    )}

                    {toPhoneText(member['Mobile']) && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Mobile</p>
                          <a href={`tel:${toDialableNumber(member['Mobile'])}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {toPhoneText(member['Mobile'])}
                          </a>
                        </div>
                      </div>
                    )}

                    {toPhoneText(member['Resident Landline']) && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Resident Landline</p>
                          <a href={`tel:${toDialableNumber(member['Resident Landline'])}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {toPhoneText(member['Resident Landline'])}
                          </a>
                        </div>
                      </div>
                    )}

                    {toPhoneText(member['Office Landline']) && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Office Landline</p>
                          <a href={`tel:${toDialableNumber(member['Office Landline'])}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {toPhoneText(member['Office Landline'])}
                          </a>
                        </div>
                      </div>
                    )}

                    {member['Email'] && member['Email'] !== 'N/A' && (
                      <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                        <Mail className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Email</p>
                          <a href={`mailto:${member['Email']}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                            {member['Email']}
                          </a>
                        </div>
                      </div>
                    )}

                  </>
                );
              }

              // Show healthcare-specific fields (from opd_schedule) only if this is a healthcare member
              return (
                <>
                  {member.consultant_name && member.consultant_name !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <User className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Consultant Name</p>
                        <p className="font-medium text-gray-800">{member.consultant_name}</p>
                      </div>
                    </div>
                  )}

                  {member.department && member.department !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Building2 className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Department</p>
                        <p className="font-medium text-gray-800">{member.department}</p>
                      </div>
                    </div>
                  )}

                  {member.designation && member.designation !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <User className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Designation</p>
                        <p className="font-medium text-gray-800">{member.designation}</p>
                      </div>
                    </div>
                  )}

                  {member.qualification && member.qualification !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Award className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Qualification</p>
                        <p className="font-medium text-gray-800">{member.qualification}</p>
                      </div>
                    </div>
                  )}

                  {member.unit && member.unit !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Building2 className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Unit</p>
                        <p className="font-medium text-gray-800">{member.unit}</p>
                      </div>
                    </div>
                  )}

                  {member.general_opd_days && member.general_opd_days !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Clock className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">General OPD Days</p>
                        <p className="font-medium text-gray-800">{member.general_opd_days}</p>
                      </div>
                    </div>
                  )}

                  {member.private_opd_days && member.private_opd_days !== 'N/A' && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Clock className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Private OPD Days</p>
                        <p className="font-medium text-gray-800">{member.private_opd_days}</p>
                      </div>
                    </div>
                  )}

                  {toPhoneText(member['Mobile']) && (
                    <div className="flex items-start gap-3 p-1 bg-gray-50 rounded-2xl">
                      <Phone className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Mobile</p>
                        <a href={`tel:${toDialableNumber(member['Mobile'])}`} className="font-medium hover:underline" style={{ color: theme.primary }}>
                          {toPhoneText(member['Mobile'])}
                        </a>
                      </div>
                    </div>
                  )}

                </>
              );
            })()}
          </div>
        </div>
      </div>
      <style>{`
        .member-details-theme .bg-gray-50 {
          background: color-mix(in srgb, var(--advertisement-card-bg) 86%, var(--page-bg)) !important;
        }
        .member-details-theme .text-gray-800 {
          color: var(--advertisement-description) !important;
        }
        .member-details-theme .text-gray-500 {
          color: var(--advertisement-subtitle) !important;
        }
      `}</style>
    </div>
  );
};

export default MemberDetails;
