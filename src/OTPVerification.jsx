import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBackNavigation } from './hooks';
import { verifyOTP } from './services/authService';
import { fetchDirectoryData } from './services/directoryService';
import { fetchMemberTrustMemberships, fetchTrustById } from './services/trustService';
import { logUserSessionEvent } from './services/sessionAuditService';
import { persistUserSession } from './utils/storageUtils';
import { setLoginTermsPromptPending } from './utils/legalContent';

const TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const LOGIN_TRUST_CACHE_KEY = 'cached_base_trust_info';
const TRUST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OTP_FLOW_KEY = 'otp_flow_allowed';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const SETU_POWERED_LOGO = '/assets/setu-logo.png';
const normalizeText = (value) => String(value || '').trim();

const resolveAuthDefaultTrust = () => {
  const defaultName = import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust';
  const selectedId = String(localStorage.getItem('selected_trust_id') || '').trim();
  const selectedName = String(localStorage.getItem('selected_trust_name') || '').trim();
  if (selectedId) return { id: selectedId, name: selectedName || defaultName };

  try {
    const cachedDefault = localStorage.getItem('default_trust_cache');
    if (cachedDefault) {
      const parsed = JSON.parse(cachedDefault);
      const id = parsed?.id ? String(parsed.id).trim() : '';
      const name = parsed?.name ? String(parsed.name).trim() : '';
      if (id) return { id, name: name || defaultName };
    }
  } catch {
    // ignore
  }
  if (TRUST_ID) return { id: TRUST_ID, name: defaultName };
  return { id: '', name: defaultName };
};

const getCachedBaseTrust = (expectedTrustId) => {
  if (!expectedTrustId) return null;
  try {
    const raw = localStorage.getItem(LOGIN_TRUST_CACHE_KEY);
    if (!raw) return null;
    const { data, ts, trustId } = JSON.parse(raw);
    if (trustId && trustId !== expectedTrustId) {
      localStorage.removeItem(LOGIN_TRUST_CACHE_KEY);
      return null;
    }
    if (Date.now() - ts > TRUST_CACHE_TTL_MS) {
      localStorage.removeItem(LOGIN_TRUST_CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
};

const setCachedBaseTrust = (trust, trustId) => {
  if (!trustId) return;
  try {
    localStorage.setItem(LOGIN_TRUST_CACHE_KEY, JSON.stringify({ data: trust, ts: Date.now(), trustId }));
  } catch {
    // ignore
  }
};

function OTPVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  useBackNavigation(() => navigate('/login'));
  const authDefaultTrust = resolveAuthDefaultTrust();

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const [trustInfo, setTrustInfo] = useState(() => getCachedBaseTrust(authDefaultTrust.id) || null);

  const user = location.state?.user || null;
  const accountCandidates = Array.isArray(location.state?.accounts) && location.state.accounts.length > 0
    ? location.state.accounts
    : (user ? [user] : []);
  const [otpVerified, setOtpVerified] = useState(false);
  const [verifiedLoginMethod, setVerifiedLoginMethod] = useState('otp');
  const [selectedAccountId, setSelectedAccountId] = useState(accountCandidates[0]?.members_id || accountCandidates[0]?.id || '');
  const phoneNumber = location.state?.phoneNumber || '';
  const isOtpFlowAllowed = sessionStorage.getItem(OTP_FLOW_KEY) === 'normal';
  const canRenderOtpPage = Boolean(user && phoneNumber && isOtpFlowAllowed);

  useEffect(() => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (isLoggedIn) {
      navigate('/', { replace: true });
      return;
    }
    if (!canRenderOtpPage) navigate('/login', { replace: true });
  }, [canRenderOtpPage, navigate]);

  useEffect(() => {
    try { localStorage.removeItem('cached_trust_info'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        if (!authDefaultTrust.id) return;
        const trust = await fetchTrustById(authDefaultTrust.id);
        if (!active || !trust) return;
        setTrustInfo(trust);
        setCachedBaseTrust(trust, authDefaultTrust.id);
      } catch (err) {
        console.warn('[OTP] Trust refresh failed:', err?.message || err);
      }
    };
    refresh();
    return () => { active = false; };
  }, [authDefaultTrust.id]);

  const resolveSelectedAccount = () => {
    if (!accountCandidates.length) return null;
    const selectedId = String(selectedAccountId || '');
    if (!selectedId) return accountCandidates[0];
    return accountCandidates.find((account) => String(account?.members_id || account?.id || '') === selectedId) || accountCandidates[0];
  };

  const completeLogin = async (selectedUser, loginMethod = 'otp') => {
    const allAccountMemberIds = Array.from(new Set(
      (Array.isArray(accountCandidates) ? accountCandidates : [])
        .map((account) => account?.members_id || account?.id || null)
        .filter(Boolean)
        .map((id) => String(id))
    ));

    const accountMembershipNo = normalizeText(
      selectedUser?.membership_number ||
      selectedUser?.['Membership number'] ||
      selectedUser?.membershipNumber
    );

    let enrichedUser = { ...selectedUser, member_ids: allAccountMemberIds };
    try {
      const refreshedMemberships = await fetchMemberTrustMemberships({
        membersId: selectedUser?.members_id || selectedUser?.id || null,
        membershipNumber: accountMembershipNo
      });

      if (Array.isArray(refreshedMemberships) && refreshedMemberships.length > 0) {
        enrichedUser = { ...enrichedUser, member_ids: allAccountMemberIds, hospital_memberships: refreshedMemberships };
        const preferredMembership = refreshedMemberships.find((membership) => membership?.is_active !== false) || refreshedMemberships[0];
        if (preferredMembership?.trust_id) {
          enrichedUser.trust = {
            id: preferredMembership.trust_id,
            name: preferredMembership.trust_name || null,
            icon_url: preferredMembership.trust_icon_url || null,
            remark: preferredMembership.trust_remark || null
          };
          enrichedUser.primary_trust = {
            id: preferredMembership.trust_id,
            name: preferredMembership.trust_name || null,
            icon_url: preferredMembership.trust_icon_url || null,
            remark: preferredMembership.trust_remark || null,
            is_active: preferredMembership?.is_active !== false
          };
          if (!accountMembershipNo && preferredMembership?.membership_number) {
            enrichedUser.membership_number = preferredMembership.membership_number;
            enrichedUser['Membership number'] = preferredMembership.membership_number;
            enrichedUser.membershipNumber = preferredMembership.membership_number;
          }
        }
      }
    } catch (membershipError) {
      console.warn('[OTP] Failed to refresh selected account memberships:', membershipError?.message || membershipError);
    }

    const persisted = persistUserSession(enrichedUser);
    if (!persisted.success) {
      setError(persisted.message || 'Unable to save session on this device. Please try again.');
      return false;
    }

    await logUserSessionEvent({
      user: enrichedUser,
      actionType: 'login',
      extra: {
        source: 'otp',
        login_method: loginMethod,
        trust_id: normalizeText(TRUST_ID || authDefaultTrust.id) || null
      }
    });

    const selectedMemberships = Array.isArray(enrichedUser?.hospital_memberships) ? enrichedUser.hospital_memberships : [];
    const baseTrustId = normalizeText(TRUST_ID || authDefaultTrust.id);
    const baseMembership = selectedMemberships.find((membership) => normalizeText(membership?.trust_id) === baseTrustId) || null;
    const selectedTrustId = baseTrustId;
    const selectedTrustName = normalizeText(
      baseMembership?.trust_name ||
      trustInfo?.name ||
      authDefaultTrust?.name ||
      localStorage.getItem('selected_trust_name')
    );

    localStorage.setItem('selected_trust_id', String(selectedTrustId));
    localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, String(selectedTrustId));
    if (selectedTrustName) localStorage.setItem('selected_trust_name', String(selectedTrustName));
    window.dispatchEvent(new CustomEvent('trust-changed', {
      detail: { trustId: String(selectedTrustId), trustName: selectedTrustName || null, source: 'otp-login-default-base' }
    }));

    fetchDirectoryData(selectedTrustId, selectedTrustName).catch((err) => console.warn('[OTP] Directory pre-fetch failed:', err));

    try { sessionStorage.removeItem('trust_selected_in_session'); } catch { /* ignore */ }
    try { sessionStorage.removeItem(OTP_FLOW_KEY); } catch { /* ignore */ }
    setLoginTermsPromptPending();

    navigate('/', { replace: true });
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (otpVerified) {
        setError('');
        const selectedUser = resolveSelectedAccount();
        if (!selectedUser) {
          setError('Please select an account to continue.');
          setLoading(false);
          return;
        }
        await completeLogin(selectedUser, verifiedLoginMethod);
        setLoading(false);
        return;
      }

      const result = await verifyOTP(phoneNumber, otp, {
        secretCode: otp,
        trustId: normalizeText(authDefaultTrust.id)
      });
      if (!result.success) {
        setError(result.message || 'Invalid OTP. Please try again.');
        setLoading(false);
        return;
      }
      setVerifiedLoginMethod(result?.loginMethod === 'secret_code' ? 'secret_code' : 'otp');

      if (!user) {
        setError('User data not found. Please go back and try again.');
        setLoading(false);
        return;
      }

      if (accountCandidates.length > 1) {
        setError('');
        setOtpVerified(true);
        const nextId = accountCandidates[0]?.members_id || accountCandidates[0]?.id || '';
        setSelectedAccountId(nextId);
        setLoading(false);
        return;
      }

      await completeLogin(accountCandidates[0] || user, result?.loginMethod === 'secret_code' ? 'secret_code' : 'otp');
    } catch (err) {
      console.error('[OTP] Verify error:', err);
      setError(
        otpVerified
          ? 'Failed to continue with selected account. Please try again.'
          : 'Failed to verify OTP. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (otpVerified) {
      setOtpVerified(false);
      setError('');
      return;
    }
    try { sessionStorage.removeItem(OTP_FLOW_KEY); } catch { /* ignore */ }
    navigate('/login', { replace: true });
  };

  if (!canRenderOtpPage) return null;

  const hasAnyInput = otp.trim().length > 0;
  const isSubmitDisabled = loading || (!otpVerified && !hasAnyInput);

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* Gold top bar */}
        <div style={styles.accentBar} />

        <div style={styles.cardBody}>

          {/* Heading */}
          <div style={styles.headingGroup}>
            <h1 style={styles.heading}>
              {otpVerified ? 'Select Account' : 'Verify OTP'}
            </h1>
            <p style={styles.subheading}>
              {otpVerified
                ? 'Choose the account you want to continue with'
                : <><span style={styles.subheadingMuted}>OTP sent to </span><span style={styles.subheadingPhone}>+91 {phoneNumber}</span></>
              }
            </p>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>

            {/* OTP Input */}
            {!otpVerified && (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>OTP CODE</label>
                <input
                  type="text"
                  placeholder="— — — — — —"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  required
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  style={{ ...styles.otpInput, ...(focused ? styles.otpInputFocus : {}) }}
                />
                <p style={styles.otpHint}>Enter the 6-digit code sent via SMS</p>
              </div>
            )}

            {/* Account selection */}
            {otpVerified && (
              <div style={styles.accountList}>
                {accountCandidates.map((account, index) => {
                  const accountId = String(account?.members_id || account?.id || `account-${index}`);
                  const name = account?.Name || account?.name || `Account ${index + 1}`;
                  const membershipNumber = account?.membership_number || account?.['Membership number'] || 'N/A';
                  const mobile = account?.mobile || account?.Mobile || phoneNumber;
                  const isSelected = String(selectedAccountId) === accountId;
                  return (
                    <label
                      key={accountId}
                      style={{ ...styles.accountItem, ...(isSelected ? styles.accountItemSelected : {}) }}
                    >
                      <input
                        type="radio"
                        name="selected-account"
                        value={accountId}
                        checked={isSelected}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        style={styles.radioInput}
                      />
                      <div style={styles.accountInfo}>
                        <div style={styles.accountName}>{name}</div>
                        <div style={styles.accountMeta}>
                          <span style={styles.accountMetaItem}>#{membershipNumber}</span>
                          <span style={styles.accountMetaDot} />
                          <span style={styles.accountMetaItem}>{mobile}</span>
                        </div>
                      </div>
                      {isSelected && <div style={styles.checkmark}>✓</div>}
                    </label>
                  );
                })}
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorIcon}>!</span>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div style={styles.btnRow}>
              <button type="button" onClick={handleBack} style={styles.backBtn}>
                ← Back
              </button>
              <button
                type="submit"
                disabled={isSubmitDisabled}
                style={{ ...styles.verifyBtn, ...(isSubmitDisabled ? styles.verifyBtnDisabled : {}) }}
              >
                {loading ? (
                  <span style={styles.btnLoading}>
                    <span style={styles.spinner} />
                    Verifying...
                  </span>
                ) : (
                  otpVerified ? 'Continue →' : 'Verify OTP →'
                )}
              </button>
            </div>
          </form>

          {/* Resend */}
          {!otpVerified && (
            <p style={styles.resendText}>
              Didn't receive OTP?{' '}
              <button onClick={handleBack} style={styles.resendBtn}>
                Try again
              </button>
            </p>
          )}

        </div>
      </div>

      <div style={styles.poweredBy}>
        <div style={styles.poweredDivider} />
        <span style={styles.poweredLabel}>Powered by</span>
        <div style={styles.poweredRow}>
          <div style={styles.poweredLogoRing}>
            <img
              src={SETU_POWERED_LOGO}
              alt="SETU"
              style={styles.poweredLogo}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
          <div style={styles.poweredTextGroup}>
            <span style={styles.poweredBrand}>S&nbsp;E&nbsp;T&nbsp;U</span>
            <span style={styles.poweredTagline}>Where AI connections create power</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
    gap: '0',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#222222',
    border: '1px solid #5c4a1e',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  accentBar: {
    height: '3px',
    background: 'linear-gradient(90deg, #7a5a10, #d4af37, #f5d07a, #d4af37, #7a5a10)',
  },
  cardBody: {
    padding: '32px 24px 28px',
  },
  headingGroup: {
    marginBottom: '28px',
    borderBottom: '1px solid #1e1a08',
    paddingBottom: '22px',
    textAlign: 'center',
  },
  heading: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
    color: '#f5d07a',
    letterSpacing: '-0.5px',
    fontFamily: "'Palatino Linotype', Palatino, Georgia, serif",
  },
  subheading: {
    margin: '6px 0 0',
    fontSize: '13px',
  },
  subheadingMuted: {
    color: '#7a7060',
  },
  subheadingPhone: {
    color: '#d4af37',
    fontWeight: 600,
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  label: {
    fontSize: '10px',
    color: '#c9a84c',
    fontWeight: 700,
    letterSpacing: '1.3px',
  },
  otpInput: {
    border: '1px solid #2e2710',
    borderRadius: '8px',
    background: '#080808',
    color: '#f5d07a',
    padding: '16px',
    fontSize: '26px',
    letterSpacing: '0.5em',
    outline: 'none',
    fontFamily: 'monospace',
    fontWeight: 600,
    transition: 'border-color 0.15s',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'center',
  },
  otpInputFocus: {
    borderColor: '#d4af37',
    background: '#0d0d0d',
  },
  otpHint: {
    margin: 0,
    fontSize: '11px',
    color: '#4a4030',
    textAlign: 'center',
  },
  accountList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  accountItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid #2e2710',
    borderRadius: '8px',
    padding: '13px',
    background: '#080808',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  accountItemSelected: {
    borderColor: '#d4af37',
    background: '#0d0d08',
  },
  radioInput: {
    accentColor: '#d4af37',
    width: '16px',
    height: '16px',
    flexShrink: 0,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontWeight: 700,
    color: '#f5d07a',
    fontSize: '14px',
  },
  accountMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '3px',
  },
  accountMetaItem: {
    color: '#7a7060',
    fontSize: '12px',
  },
  accountMetaDot: {
    display: 'inline-block',
    width: '3px',
    height: '3px',
    background: '#5a4010',
    borderRadius: '50%',
  },
  checkmark: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#d4af37',
    flexShrink: 0,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: '#1a1100',
    border: '1px solid #3a2800',
    color: '#f5c842',
    borderRadius: '7px',
    padding: '10px 13px',
    fontSize: '13px',
  },
  errorIcon: {
    display: 'inline-flex',
    width: '17px',
    height: '17px',
    border: '1.5px solid #d4af37',
    borderRadius: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 700,
    flexShrink: 0,
  },
  btnRow: {
    display: 'flex',
    gap: '10px',
  },
  backBtn: {
    flex: 1,
    border: '1px solid #2e2710',
    borderRadius: '8px',
    padding: '14px',
    background: '#080808',
    color: '#c9a84c',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.15s',
  },
  verifyBtn: {
    flex: 2,
    border: 'none',
    borderRadius: '8px',
    padding: '14px',
    background: '#d4af37',
    color: '#080808',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: "'Inter', sans-serif",
    transition: 'opacity 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  },
  verifyBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  btnLoading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  spinner: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid rgba(8,8,8,0.3)',
    borderTopColor: '#080808',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  resendText: {
    marginTop: '12px',
    fontSize: '12px',
    color: '#4a4030',
    textAlign: 'center',
  },
  resendBtn: {
    border: 'none',
    background: 'transparent',
    color: '#d4af37',
    fontWeight: 700,
    cursor: 'pointer',
    padding: 0,
    fontFamily: "'Inter', sans-serif",
    fontSize: '12px',
    borderBottom: '1px solid #5a4010',
  },
  poweredBy: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0 8px',
  },
  poweredDivider: {
    width: '180px',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, #5c4a1e 30%, #d4af37 50%, #5c4a1e 70%, transparent)',
    marginBottom: '2px',
  },
  poweredLabel: {
    fontSize: '8px',
    color: '#5a5040',
    letterSpacing: '3px',
    textTransform: 'uppercase',
    fontWeight: 600,
    fontFamily: "'Inter', sans-serif",
  },
  poweredRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  poweredLogoRing: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: '#1a1a1a',
    border: '1.5px solid #5c4a1e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  poweredLogo: {
    width: '34px',
    height: '34px',
    objectFit: 'contain',
    borderRadius: '50%',
    filter: 'brightness(2.2) contrast(1.1) saturate(1.3)',
  },
  poweredTextGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  poweredBrand: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#d4af37',
    letterSpacing: '3px',
    fontFamily: "'Palatino Linotype', Georgia, serif",
    lineHeight: 1,
    textShadow: '0 0 12px rgba(212,175,55,0.4)',
  },
  poweredTagline: {
    fontSize: '6.5px',
    color: '#7a6a4a',
    letterSpacing: '0.2px',
    fontStyle: 'italic',
    lineHeight: 1.4,
    maxWidth: '112px',
    fontFamily: "'Inter', sans-serif",
  },
};

export default OTPVerification;

