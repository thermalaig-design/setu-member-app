import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useBackNavigation } from './hooks';
import { useTrustDataVersion } from './hooks/useTrustDataVersion';
import { checkPhoneNumber } from './services/authService';
import { fetchTrustById } from './services/trustService';

const TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const LOGIN_TRUST_CACHE_KEY = 'cached_base_trust_info';
const TRUST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TRUST_NAME = import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust';
const OTP_FLOW_KEY = 'otp_flow_allowed';
const SETU_POWERED_LOGO = '/assets/setu-logo.png';

const resolveAuthDefaultTrust = () => {
  const selectedId = String(localStorage.getItem('selected_trust_id') || '').trim();
  const selectedName = String(localStorage.getItem('selected_trust_name') || '').trim();
  if (selectedId) return { id: selectedId, name: selectedName || DEFAULT_TRUST_NAME };

  try {
    const cachedDefault = localStorage.getItem('default_trust_cache');
    if (cachedDefault) {
      const parsed = JSON.parse(cachedDefault);
      const id = parsed?.id ? String(parsed.id).trim() : '';
      const name = parsed?.name ? String(parsed.name).trim() : '';
      if (id) return { id, name: name || DEFAULT_TRUST_NAME };
    }
  } catch {
    // ignore malformed cache
  }

  if (TRUST_ID) return { id: TRUST_ID, name: DEFAULT_TRUST_NAME };
  return { id: '', name: DEFAULT_TRUST_NAME };
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
    // ignore cache write
  }
};

function Login() {
  const navigate = useNavigate();
  useBackNavigation();
  const authDefaultTrust = resolveAuthDefaultTrust();
  const { displayTrustVersion } = useTrustDataVersion(authDefaultTrust.id);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const [_trustInfo, setTrustInfo] = useState(() => getCachedBaseTrust(authDefaultTrust.id) || null);

  useEffect(() => {
    const user = localStorage.getItem('user');
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (user && user !== 'null' && user !== 'undefined' && isLoggedIn) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    try { localStorage.removeItem('cached_trust_info'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let active = true;
    const loadTrust = async () => {
      try {
        if (!authDefaultTrust.id) return;
        const trust = await fetchTrustById(authDefaultTrust.id);
        if (!active || !trust) return;
        setTrustInfo(trust);
        setCachedBaseTrust(trust, authDefaultTrust.id);
      } catch (err) {
        console.warn('[Login] Failed to refresh base trust info:', err?.message || err);
      }
    };
    loadTrust();
    return () => { active = false; };
  }, [authDefaultTrust.id]);

  const handleCheckPhone = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const checkResult = await checkPhoneNumber(phoneNumber);
      if (!checkResult.success) {
        setError(checkResult.message);
        setLoading(false);
        return;
      }

      sessionStorage.setItem(OTP_FLOW_KEY, 'normal');
      navigate('/otp-verification', {
        state: { user: checkResult.data.user, accounts: checkResult.data.accounts || [checkResult.data.user], phoneNumber }
      });
    } catch (err) {
      console.error('[Login] Error checking phone:', err);
      setError('Failed to verify phone number. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = loading || phoneNumber.length < 10;

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* Gold top bar */}
        <div style={styles.accentBar} />

        <div style={styles.cardBody}>

          {/* Heading */}
          <div style={styles.headingGroup}>
            <h1 style={styles.heading}>Login</h1>
            <p style={styles.subheading}>Enter your mobile number to continue</p>
          </div>

          {/* Form */}
          <form onSubmit={handleCheckPhone} style={styles.form}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>MOBILE NUMBER</label>
              <div style={{ ...styles.inputRow, ...(focused ? styles.inputRowFocus : {}) }}>
                <div style={styles.codeBox}>
                  <span style={styles.flag}>🇮🇳</span>
                  <span style={styles.code}>+91</span>
                </div>
                <input
                  type="tel"
                  className="login-mobile-input"
                  name="phone"
                  placeholder="10-digit mobile number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  maxLength={10}
                  required
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  style={styles.input}
                  autoComplete="tel-national"
                  inputMode="numeric"
                />
              </div>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorIcon}>!</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isDisabled}
              style={{ ...styles.btn, ...(isDisabled ? styles.btnDisabled : {}) }}
            >
              {loading ? (
                <span style={styles.btnLoading}>
                  <span style={styles.spinner} />
                  Verifying...
                </span>
              ) : (
                <>
                  Continue
                  <span style={styles.btnArrow}>→</span>
                </>
              )}
            </button>
          </form>

          {/* Footer links */}
          <div style={styles.footer}>
            <div style={styles.footerLinks}>
              <Link to="/terms-and-conditions" style={styles.footerLink}>Terms</Link>
              <span style={styles.footerSep} />
              <Link to="/privacy-policy" style={styles.footerLink}>Privacy Policy</Link>
            </div>
            <p style={styles.versionText}>App Version {displayTrustVersion}</p>
          </div>

        </div>
      </div>

      {/* Powered by SETU */}
      <div style={styles.poweredBy}>
        {/* Elegant fading divider */}
        <div style={styles.poweredDivider} />

        <span style={styles.poweredLabel}>Powered by</span>

        {/* Logo + wordmark row */}
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
        .login-mobile-input:-webkit-autofill,
        .login-mobile-input:-webkit-autofill:hover,
        .login-mobile-input:-webkit-autofill:focus {
          -webkit-text-fill-color: #f0e8d0 !important;
          -webkit-box-shadow: 0 0 0px 1000px #1f1f1f inset !important;
          box-shadow: 0 0 0px 1000px #1f1f1f inset !important;
          transition: background-color 9999s ease-in-out 0s;
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
    gap: '20px',
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
    fontSize: '30px',
    fontWeight: 700,
    color: '#f5d07a',
    letterSpacing: '-0.5px',
    fontFamily: "'Palatino Linotype', Palatino, Georgia, serif",
  },
  subheading: {
    margin: '6px 0 0',
    color: '#7a7060',
    fontSize: '13px',
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
  inputRow: {
    display: 'flex',
    alignItems: 'stretch',
    border: '1px solid #2e2710',
    borderRadius: '8px',
    background: '#1f1f1f',
    overflow: 'hidden',
    transition: 'border-color 0.15s',
  },
  inputRowFocus: {
    border: '1px solid #d4af37',
    background: '#242424',
  },
  codeBox: {
    background: '#2a2415',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '0 14px',
    borderRight: '1px solid #5c4a1e',
  },
  flag: {
    fontSize: '15px',
    lineHeight: 1,
  },
  code: {
    fontWeight: 700,
    color: '#d4af37',
    fontSize: '15px',
    fontFamily: 'monospace',
  },
  input: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: '#1f1f1f',
    color: '#f0e8d0',
    padding: '14px 12px',
    fontSize: '16px',
    fontFamily: 'monospace',
    letterSpacing: '0.8px',
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
  btn: {
    border: 'none',
    borderRadius: '8px',
    padding: '15px',
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
    gap: '8px',
  },
  btnArrow: {
    fontSize: '16px',
  },
  btnDisabled: {
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
  footer: {
    marginTop: '22px',
    textAlign: 'center',
    borderTop: '1px solid #1e1a08',
    paddingTop: '16px',
  },
  footerLinks: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },
  footerLink: {
    color: '#d4af37',
    fontSize: '12px',
    textDecoration: 'none',
    borderBottom: '1px solid #5a4010',
    paddingBottom: '1px',
  },
  footerSep: {
    display: 'inline-block',
    width: '3px',
    height: '3px',
    background: '#5a4010',
    borderRadius: '50%',
  },
  versionText: {
    marginTop: '8px',
    fontSize: '11px',
    color: '#3a3020',
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

export default Login;
