import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBackNavigation } from './hooks';
import { specialLogin } from './services/authService';
import { fetchDirectoryData } from './services/directoryService';
import { logUserSessionEvent } from './services/sessionAuditService';
import { persistUserSession } from './utils/storageUtils';
import { setLoginTermsPromptPending } from './utils/legalContent';
import { useAppTheme } from './context/ThemeContext';

const OTP_FLOW_KEY = 'otp_flow_allowed';
const TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';

function SpecialOTPVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  useAppTheme();
  useBackNavigation(() => navigate('/login'));
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);

  const user = location.state?.user || null;
  const phoneNumber = location.state?.phoneNumber || '';
  const isSpecialFlowAllowed = sessionStorage.getItem(OTP_FLOW_KEY) === 'special';
  const canRenderSpecialOtp = Boolean(user && phoneNumber && isSpecialFlowAllowed);

  React.useEffect(() => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (isLoggedIn) {
      navigate('/', { replace: true });
      return;
    }
    if (!canRenderSpecialOtp) {
      navigate('/login', { replace: true });
    }
  }, [canRenderSpecialOtp, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await specialLogin(
        phoneNumber,
        passcode,
        String(localStorage.getItem('selected_trust_id') || TRUST_ID || '')
      );
      if (!result.success) {
        setError(result.message || 'Invalid passcode. Please try again.');
        setLoading(false);
        return;
      }
      if (user) {
        const persisted = persistUserSession(user);
        if (!persisted.success) {
          setError(persisted.message || 'Unable to save session on this device. Please try again.');
          setLoading(false);
          return;
        }
        const selectedTrustId = String(localStorage.getItem('selected_trust_id') || TRUST_ID || '').trim();
        await logUserSessionEvent({
          user,
          actionType: 'login',
          extra: {
            source: 'special-otp',
            login_method: 'secret_code',
            trust_id: TRUST_ID || null
          }
        });
        const memberships = Array.isArray(user?.hospital_memberships) ? user.hospital_memberships : [];
        const baseMembership = memberships.find((m) => String(m?.trust_id || '') === String(TRUST_ID)) || null;
        const selectedTrustName =
          baseMembership?.trust_name ||
          import.meta.env.VITE_DEFAULT_TRUST_NAME ||
          localStorage.getItem('selected_trust_name');
        if (selectedTrustId) localStorage.setItem('selected_trust_id', String(selectedTrustId));
        if (selectedTrustId) localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, String(selectedTrustId));
        if (selectedTrustName) localStorage.setItem('selected_trust_name', String(selectedTrustName));
        window.dispatchEvent(new CustomEvent('trust-changed', {
          detail: {
            trustId: String(selectedTrustId),
            trustName: selectedTrustName || null,
            source: 'special-otp-login-default-base'
          }
        }));
        fetchDirectoryData(selectedTrustId || null, selectedTrustName || null).catch(err =>
          console.warn('Failed to pre-load directory data:', err)
        );
        try { sessionStorage.removeItem('trust_selected_in_session'); } catch { /* ignore */ }
        try { sessionStorage.removeItem(OTP_FLOW_KEY); } catch { /* ignore */ }
        setLoginTermsPromptPending();
        navigate('/', { replace: true });
      } else {
        setError('User data not found. Please try again.');
      }
    } catch (error) {
      console.error('❌ Error verifying special login:', error);
      setError('Failed to verify passcode. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    try { sessionStorage.removeItem(OTP_FLOW_KEY); } catch { /* ignore */ }
    navigate('/login', { replace: true });
  };

  if (!canRenderSpecialOtp) return null;

  return (
    <div className="brand-page min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="pointer-events-none absolute -top-20 -left-20 w-72 h-72 rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-red) 18%, transparent) 0%, transparent 70%)' }} />
      <div className="pointer-events-none absolute -bottom-24 -right-16 w-80 h-80 rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-navy) 14%, transparent) 0%, transparent 70%)' }} />

      <div className="relative w-full max-w-md" style={{ animation: 'fadeUp 0.5s ease-out both' }}>
        <div className="brand-card overflow-hidden">
          <div className="brand-accent-bar" />

          {/* Shield icon header */}
          <div className="flex justify-center mt-6 mb-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
              style={{ background: 'var(--brand-navy-light)' }}>
              🔐
            </div>
          </div>

          <div className="text-center px-6 mb-6">
            <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--heading-color, var(--brand-navy))' }}>
              Special Login
            </h2>
            <div className="flex items-center justify-center gap-2 mt-2 mb-3">
              <span className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--brand-red))' }} />
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--brand-red)' }} />
              <span className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, var(--brand-red))' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--body-text-color)' }}>Enter the special passcode for</p>
            <p className="font-bold text-base mt-1" style={{ color: 'var(--subheading-color, var(--brand-navy))' }}>+91 {phoneNumber}</p>

            <div className="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: 'var(--brand-navy-light)', color: 'var(--brand-navy)' }}>
              <span>🔧</span> Special Access Enabled
            </div>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--subheading-color, var(--brand-navy))' }}>
                Special Passcode
              </label>
              <input
                type="text"
                placeholder="— — — — — —"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="w-full px-5 py-4 text-2xl text-center tracking-[0.5em] font-bold rounded-2xl outline-none transition-all"
                style={{
                  border: focused ? '2px solid var(--brand-red)' : '2px solid color-mix(in srgb, var(--brand-navy) 16%, var(--surface-color))',
                  background: focused ? 'color-mix(in srgb, var(--surface-color) 84%, var(--brand-red-light))' : 'color-mix(in srgb, var(--app-accent-bg) 74%, var(--surface-color))',
                  color: 'var(--body-text-color)',
                  boxShadow: focused ? '0 0 0 4px color-mix(in srgb, var(--brand-red) 12%, transparent)' : 'none',
                }}
              />
            </div>

            {error && (
              <div className="rounded-2xl px-4 py-3 text-sm font-medium flex items-center gap-2"
                style={{ background: 'var(--brand-red-light)', border: '1.5px solid color-mix(in srgb, var(--brand-red) 26%, transparent)', color: 'var(--brand-red-dark)' }}>
                <span>⚠️</span><span>{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
                style={{ background: 'var(--brand-navy-light)', color: 'var(--brand-navy)' }}
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={loading || passcode.length !== 6}
                className="flex-[2] py-4 rounded-2xl font-bold text-base text-white transition-all active:scale-[0.98] btn-brand"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                      style={{ animation: 'spin 0.75s linear infinite' }} />
                    Verifying...
                  </span>
                ) : 'Verify Passcode ✓'}
              </button>
            </div>
          </form>

          <div className="border-t pb-5 pt-4 text-center" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color))' }}>
            <p className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 70%, var(--surface-color))' }}>Special access for authorized users only</p>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default SpecialOTPVerification;


