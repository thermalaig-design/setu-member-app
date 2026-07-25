import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Home as HomeIcon, Menu, QrCode, User, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { useAppTheme } from './context/ThemeContext';
import { getProfile } from './services/api';
import { fetchTrustById } from './services/trustService';
import { applyOpacity } from './utils/colorUtils';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';

const SecureScreen = registerPlugin('SecureScreen');

const TRUST_ID_CARD_STORAGE_KEY = 'trust_id_card_payload_v1';

const safeParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeText = (value) => String(value || '').trim();

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
};

const formatDisplayDate = (value) => {
  const text = normalizeText(value);
  if (!text) return '';

  const normalized = text.replace(/\s+/g, ' ').trim();
  const dmyMatch = normalized.match(/^(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})$/);
  if (dmyMatch) {
    const [, day, month, yearRaw] = dmyMatch;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${day.padStart(2, '0')} / ${month.padStart(2, '0')} / ${year}`;
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day} / ${month} / ${year}`;
  }

  return text;
};

const readStoredCardData = () => {
  try {
    const parsed = safeParse(sessionStorage.getItem(TRUST_ID_CARD_STORAGE_KEY) || '');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const TrustCardField = ({
  label,
  value,
  fullWidth = false,
  highlight = false,
  labelColor,
  valueColor,
  highlightBg,
  highlightBorder,
}) => (
  <div className={fullWidth ? 'col-span-2 min-w-0' : 'min-w-0'}>
    <p
      className="text-[7px] font-bold uppercase tracking-[0.12em] "
      style={{ color: labelColor }}
    >
      {label=='Scan to verify'? '': label}
    </p>
    <p
      className="mt-0.2 text-[10px] font-semibold leading-snug break-words rounded-md"
      style={
        highlight
          ? {
            color: valueColor,
            background: highlightBg,
            border: `1px solid ${highlightBorder}`,
            display: 'inline-block',
            padding: '2px 4px',
          }
          : { color: valueColor }
      }
    >
      {/* {value || '-'} */}
      {value=='null'? '': value || '-'}
    </p>
    {value=='null' && <div
                  className="hidden shrink-0 flex items-center justify-center rounded-[7px] absolute right-4 top-[37%]"
                  style={{ width: '74px', height: '74px', background: 'white'}}
                >
                  <QrCode className="h-12 w-12" style={{ color: 'black' }} />
                </div>}
  </div>
);

const TrustIdCard = ({ onNavigate, cardData: cardDataProp = null, embedded = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [memberProfile, setMemberProfile] = useState(null);
  const [footerTrustLogoUrl, setFooterTrustLogoUrl] = useState('');

  const pageBg = getThemeToken(theme, 'page_bg.background_color', 'var(--page-bg, var(--app-page-bg))');
  const primary = theme.primary || 'var(--brand-red)';
  const secondary = theme.secondary || 'var(--brand-navy)';
  const accent = theme.accent || 'var(--app-accent)';
  const surface = 'var(--surface-color)';
  // const cardBg = getThemeToken(theme, 'advertisement.card_bg_color', 'var(--advertisement-card-bg)');
  const cardBorder = getThemeToken(theme, 'advertisement.card_border_color', 'var(--advertisement-card-border)');
  const titleColor = getThemeToken(theme, 'advertisement.title_color', 'var(--advertisement-title)');
  // const descriptionColor = getThemeToken(theme, 'advertisement.description_color', 'var(--advertisement-description)');
  const bodyTextColor = getThemeToken(theme, 'typography.body_text_color', 'var(--body-text-color)');
  const fieldLabelColor = applyOpacity(primary, 0.84);
  const fieldValueColor = titleColor;
  const highlightBg = applyOpacity(primary, 0.12);
  const highlightBorder = applyOpacity(primary, 0.24);
  const mutedTextColor = applyOpacity(bodyTextColor, 0.72);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';

  useEffect(() => {
    if (embedded) return;
    const incoming = location.state?.cardData;
    if (!incoming || typeof incoming !== 'object') return;

    try {
      sessionStorage.setItem(TRUST_ID_CARD_STORAGE_KEY, JSON.stringify(incoming));
    } catch {
      // Ignore sessionStorage failures and keep rendering from in-memory state.
    }
  }, [embedded, location.state]);

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return undefined;

    SecureScreen.enable().catch(() => {});

    return () => {
      SecureScreen.disable().catch(() => {});
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const response = await getProfile();
        if (!isMounted) return;
        if (response?.success && response?.profile) {
          setMemberProfile(response.profile);
        }
      } catch {
        if (isMounted) setMemberProfile(null);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }

    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [embedded, isMenuOpen]);

  const cardData = useMemo(() => {
    if (cardDataProp && typeof cardDataProp === 'object') return cardDataProp;
    const incoming = location.state?.cardData;
    if (incoming && typeof incoming === 'object') return incoming;
    return readStoredCardData();
  }, [cardDataProp, location.state]);

  const profileData = memberProfile || {};
  const displayName = normalizeText(
    profileData.name
    || cardData.member_name
    || cardData.memberName
    || cardData.holder_name
    || cardData.display_name
    || cardData.name
  ) || 'Member Name';
  const trustName = normalizeText(
    cardData.Trust?.name
    || cardData.trust_name
    || cardData.organisation_name
  ) || 'Trust Name';
  const membershipNo = normalizeText(
    cardData.membership_no
    || cardData.membershipNumber
    || cardData['Membership number']
    || profileData.membership_number
    || profileData.memberId
  );
  const roleText = normalizeText(cardData.role || cardData.membership_type) || 'Member';
  const bloodGroup = pickFirstText(
    profileData.blood_group,
    cardData.blood_group,
    cardData.bloodGroup,
    cardData['Blood Group'],
    cardData.profile?.blood_group
  );
  const memberAddress = pickFirstText(
    profileData.address_home,
    profileData.address_office,
    cardData.address,
    cardData.address_home,
    cardData['Address Home'],
    cardData.member_address,
    cardData.address_office,
    cardData['Address Office'],
    cardData.profile?.address_home,
    cardData.profile?.address_office
  );
  const memberPhone = pickFirstText(
    profileData.mobile,
    cardData.member_phone,
    cardData.mobile,
    cardData.phone,
    cardData.Mobile
  );
  const joinedDate = pickFirstText(
    cardData.joined_date,
    cardData.joinedDate,
    cardData.created_at,
    profileData.joined_date,
    profileData.joinedDate
  );
  const joinedDateText = formatDisplayDate(joinedDate);
  const memberPhotoUrl = pickFirstText(
    profileData.profile_photo_url,
    cardData.member_photo_url,
    cardData.profile_photo_url,
    cardData.profilePhotoUrl
  );
  const trustLogoUrl = pickFirstText(
    cardData.Trust?.icon_url,
    cardData.trust_icon_url
  );
  const currentTrustId = normalizeText(cardData.Trust?.id || cardData.trust_id);
  const targetTrustLogoId = '7dfd3e03-7ff9-4543-9485-e169a4586738';
  const trustInitial = (trustName || 'S').charAt(0).toUpperCase();

  useEffect(() => {
    let isMounted = true;

    const loadFooterLogo = async () => {


      try {
        const trust = await fetchTrustById(targetTrustLogoId);
        if (!isMounted) return;
        setFooterTrustLogoUrl(normalizeText(trust?.icon_url));
      } catch {
        if (isMounted) setFooterTrustLogoUrl('');
      }
    };

    loadFooterLogo();

    return () => {
      isMounted = false;
    };
  }, [currentTrustId]);

  const handleHome = () => {
    if (typeof onNavigate === 'function') {
      onNavigate('home');
      return;
    }
    navigate('/');
  };

  return (
    <div
      className={embedded ? 'w-full' : 'min-h-screen pb-10'}
      style={{ background: applyOpacity(pageBg, 1), color: titleColor }}
    >
      {!embedded ? (
        <div
          className="sticky top-0 z-20"
          style={{
            borderBottom: `1px solid ${applyOpacity(cardBorder, 0.34)}`,
            background: applyOpacity(pageBg, 0.92),
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${applyOpacity(accent, 0.95)}, transparent)` }} />
          <div className="flex items-center justify-between px-4 pb-4 pt-4">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="rounded-xl p-2 transition-colors"
              style={{ color: navbarTextColor || titleColor, background: 'transparent' }}
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <button
              type="button"
              onClick={handleHome}
              className="rounded-xl p-2 transition-colors"
              style={{ color: navbarTextColor || titleColor, background: 'transparent' }}
              aria-label="Home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}

      {!embedded ? (
        <Sidebar
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onNavigate={onNavigate}
          currentPage="trust-id-card"
        />
      ) : null}

      <div className={embedded ? 'flex w-full justify-center' : 'flex justify-center px-4 pb-10 pt-8'} >
        <div className="w-full" style={{ maxWidth: '420px' }}>
          {/* <div className="mb-6 flex flex-col items-center text-center">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: '64px',
                height: '64px',
                border: `1.5px solid ${applyOpacity(primary, 0.95)}`,
                color: titleColor,
                background: applyOpacity(surface, 0.88),
              }}
            >
              <span style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'Georgia, serif' }}>{trustInitial}</span>
            </div>
            <h1
              className="mt-3"
              style={{
                fontFamily: 'Georgia, serif',
                fontWeight: 700,
                fontSize: '30px',
                letterSpacing: '0.06em',
                color: titleColor,
              }}
            >
              {trustName}
            </h1>
            <p
              className="mt-1"
              style={{ fontSize: '10px', letterSpacing: '0.22em', color: subtitleColor, textTransform: 'uppercase' }}
            >
              {trustTagline}
            </p>
            <div className="mt-3 flex w-full items-center gap-2">
              <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${applyOpacity(cardBorder, 0.5)})` }} />
              <span style={{ width: '4px', height: '4px', borderRadius: '9999px', background: primary }} />
              <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${applyOpacity(cardBorder, 0.5)}, transparent)` }} />
            </div>
          </div> */}

          <div
            className="relative overflow-hidden rounded-[10px]"
            style={{
              // background: `linear-gradient(180deg, ${applyOpacity(cardBg, 0.98)} 0%, ${applyOpacity(surface, 0.92)} 100%)`,
              background: 'var(--advertisement-card-bg)',
              border: `1px solid ${applyOpacity(cardBorder, 0.38)}`,
              boxShadow: `0 20px 50px ${applyOpacity(secondary, 0.32)}`,
            }}
          >
            <div className="p-4">
              <div className="grid grid-cols-[76px_1fr] gap-2">
                <div
                  className="relative overflow-hidden rounded-[14px]"
                  style={{
                    border: `1px solid ${applyOpacity(cardBorder, 0.38)}`,
                    aspectRatio: '3 / 4',
                    background: applyOpacity(surface, 0.84),
                  }}
                >
                  {memberPhotoUrl ? (
                    <img
                      src={memberPhotoUrl}
                      alt={displayName}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {/* <User className="h-7 w-7" style={{ color: mutedTextColor }} /> */}
                      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'Georgia, serif', color: mutedTextColor, textAlign: 'center', padding: '0 4px' }}>
                        No Profile Photo
                      </span>
                    </div>
                  )}
                  {/* {idNumber ? (
                    <div
                      className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1"
                      style={{
                        background: applyOpacity(primary, 0.14),
                        borderTop: `1px solid ${applyOpacity(cardBorder, 0.42)}`,
                      }}
                    >
                      <span style={{ fontSize: '8px', fontWeight: 700, color: titleColor, letterSpacing: '0.08em' }}>ID</span>
                      <span
                        className="truncate"
                        style={{ fontSize: '8px', fontWeight: 700, color: titleColor, letterSpacing: '0.03em' }}
                      >
                        {idNumber}
                      </span>
                    </div>
                  ) : null} */}
                </div>

                <div className="min-w-0 pt-0.5">
                  <h1
                    className="break-words leading-tight flex justify-between w-full"
                    style={{ fontWeight: 700, fontSize: '16px', color: titleColor }}
                  >
                    <span>{trustName}</span>
                    <span
                      className="ml-2 inline-flex h-[2.85rem] w-[2.85rem] shrink-0 items-center justify-center overflow-hidden rounded-full border "
                      style={{
                        borderColor: applyOpacity(cardBorder, 0.42),
                        background: applyOpacity(surface, 0.9),
                        boxShadow: `0 0 5px ${cardBorder}, 0 0 10px ${cardBorder}`
                      }}
                    >
                      {trustLogoUrl ? (
                        <img
                          src={trustLogoUrl}
                          alt={trustName}
                          className="h-full w-full rounded-full object-contain"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'Georgia, serif', color: titleColor }}>
                          {trustInitial}
                        </span>
                      )}
                    </span>
                  </h1>
                  <h2
                    className="break-words leading-tight mt-2"
                    style={{ fontWeight: 700, fontSize: '14px', color: titleColor }}
                  >
                    {displayName}
                  </h2>
                  <div
                    className="mt-2 inline-flex items-center rounded-full px-3 py-1"
                    style={{
                      border: `1px solid ${applyOpacity(primary, 0.92)}`,
                      color: primary,
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      background: applyOpacity(primary, 0.08),
                    }}
                  >
                    {roleText}
                  </div>
                </div>
                {/* <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: '40px',
                height: '40px',
                border: `1.5px solid ${applyOpacity(primary, 0.95)}`,
                color: titleColor,
                background: applyOpacity(surface, 0.88),
              }}
            >
            
              
            </div> */}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2">
                <TrustCardField
                  label="Trustee / Patron No."
                  value={membershipNo}
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                />
                <TrustCardField
                  label="Blood Group"
                  value={bloodGroup}
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                />
                
                <TrustCardField
                  label=""
                  value={'null'}
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                />
                <TrustCardField
                  label="Contact No."
                  value={memberPhone}
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                />
                <TrustCardField
                  label="Date of Joining"
                  value={joinedDateText}
                  highlight={Boolean(joinedDateText)}
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                  highlightBg={highlightBg}
                  highlightBorder={highlightBorder}
                />
                
                <TrustCardField
                  label="Address"
                  value={memberAddress}
                  fullWidth
                  labelColor={fieldLabelColor}
                  valueColor={fieldValueColor}
                />
              </div>
              
            </div>

   
                  
                  
                  {/* <p className="hidden mt-0.5 absolute bottom-[30%] right-3 text-[7px] font-bold uppercase tracking-[0.12em] " style={{ color: fieldLabelColor }}>
                    Scan to Verify
                  </p> */}


                  <div className='flex align-center justify-center absolute bottom-2 right-3 gap-2'>
                    <p className="mt-0.5 relative top-[25px] text-[7px] font-bold uppercase tracking-[0.12em] " style={{ color: fieldLabelColor }}>
                    POWERED BY
                  </p>
                    <p className="mt-0.5 " style={{ fontSize: '13px', fontWeight: 700, color: titleColor, }}>
                    {footerTrustLogoUrl ? (
                      <div className="h-9 w-9 object-contain rounded-full"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }} style={{borderRadius: '50%',
                            boxShadow: `0 0 5px ${cardBorder}, 0 0 10px ${cardBorder}`
                          }}>
                      <img
                        src={footerTrustLogoUrl}
                        alt={trustName}
                        className="setu-image h-full w-full object-contain rounded-full relat"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      /></div>
                    ) : (
                      <span style={{ color: titleColor }}>{trustInitial}</span>
                    )}
                  </p>
                  </div>
                  
            
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrustIdCard;
