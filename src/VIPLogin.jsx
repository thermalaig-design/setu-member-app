import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  UserPlus,
  ChevronRight,
  LogOut,
  Shield,
  Star,
  Crown,
  Bell,
  FileText,
  CheckCircle,
  Home,
  Calendar,
  BookOpen,
  Phone,
  ArrowLeft,
  Lock,
  Loader2,
  MapPin,
  Mail,
  Building2,
  Send,
  Clock,
  Sparkles
} from 'lucide-react';

import { useBackNavigation } from './hooks';
import { checkPhoneNumber, verifyOTP } from './services/authService';
import { fetchDirectoryData } from './services/directoryService';
import { fetchTrustById } from './services/trustService';
import { logUserSessionEvent } from './services/sessionAuditService';
import TermsModal from './components/TermsModal';
import { clearLoginTermsPromptPending, isLoginTermsPromptPending, resolveLegalTrustId, setLoginTermsPromptPending } from './utils/legalContent';
import logo from '../new_logo.png';

const DEFAULT_TRUST_NAME = import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust';
const BASE_TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';

// ── Step definitions ──────────────────────────────────────────────────────────
// step 'phone'     → enter phone number
// step 'otp'       → enter OTP
// step 'dashboard' → governance/VIP member dashboard
// step 'notmember' → phone verified but has NO trust membership at all (new user — show application form)
// step 'existingmember' → has trust membership but not a governance role (redirect info)

function VIPLogin({ onNavigate, onLogout }) {
  const navigate = useNavigate();

  // ── Auth state ──
  const [step, setStep] = useState(() => {
    // Only show VIP dashboard if user is a registered VIP/Trustee/Patron member
    try {
      const userStr = localStorage.getItem('user');
      const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
      if (userStr && isLoggedIn) {
        const parsed = JSON.parse(userStr);
        if (parsed?.isRegisteredMember) return 'dashboard';
        // Regular (non-VIP) member — redirect to profile handled in useEffect
      }
    } catch (_) {}
    return 'phone';
  });

  // ── Form state ──
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [pendingUser, setPendingUser] = useState(null);   // user from checkPhoneNumber
  const [loginLoading, setLoginLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [applicationForm, setApplicationForm] = useState({
    name: '',
    addressHome: '',
    companyName: '',
    addressOffice: '',
    residentLandline: '',
    officeLandline: '',
    mobile: '',
    email: ''
  });

  // ── Dashboard state ──
  const [user, setUser] = useState(null);
  const [memberData, setMemberData] = useState(null);
  const [trustInfo, setTrustInfo] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(() => isLoginTermsPromptPending());
  const [termsModalContent, setTermsModalContent] = useState('');
  const [termsModalTrustName, setTermsModalTrustName] = useState('');
  const [termsModalLoading, setTermsModalLoading] = useState(() => isLoginTermsPromptPending());
  const [termsModalError, setTermsModalError] = useState('');
  const [selectedTrustId, setSelectedTrustId] = useState(() => localStorage.getItem('selected_trust_id') || '');

  // Back: on dashboard → do nothing; on otp/notmember/existingmember → go back to phone entry
  useBackNavigation(() => {
    if (step === 'otp' || step === 'notmember' || step === 'existingmember') setStep('phone');
    else if (step === 'phone') navigate('/login');
    // dashboard: stay here
  });

  // ── If logged-in but not a registered member → go to Profile ─────────────────
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    if (userStr && isLoggedIn && step === 'phone') {
      try {
        const parsed = JSON.parse(userStr);
        if (parsed && !parsed.isRegisteredMember) {
          setPhoneNumber(String(parsed.mobile || parsed.Mobile || '').replace(/\D/g, '').slice(0, 10));
          setApplicationForm(prev => ({
            ...prev,
            name: parsed.name || parsed.Name || prev.name,
            mobile: parsed.mobile || parsed.Mobile || prev.mobile,
            email: parsed.email || parsed.Email || prev.email
          }));
          setStep('notmember');
        }
      } catch (_) {}
    }
  }, []);

  useEffect(() => {
    const syncTrustId = () => {
      const next = localStorage.getItem('selected_trust_id') || '';
      setSelectedTrustId((prev) => (prev === next ? prev : next));
    };
    const onTrustChanged = (event) => {
      const next = event?.detail?.trustId || localStorage.getItem('selected_trust_id') || '';
      setSelectedTrustId((prev) => (prev === next ? prev : next));
    };
    syncTrustId();
    window.addEventListener('trust-changed', onTrustChanged);
    window.addEventListener('focus', syncTrustId);
    window.addEventListener('storage', syncTrustId);
    document.addEventListener('visibilitychange', syncTrustId);
    return () => {
      window.removeEventListener('trust-changed', onTrustChanged);
      window.removeEventListener('focus', syncTrustId);
      window.removeEventListener('storage', syncTrustId);
      document.removeEventListener('visibilitychange', syncTrustId);
    };
  }, []);

  useEffect(() => {
    if (!showTermsModal) return undefined;

    let active = true;
    const loadTerms = async () => {
      const trustId = resolveLegalTrustId(selectedTrustId || BASE_TRUST_ID || '');
      if (!trustId) {
        setTermsModalContent('');
        setTermsModalTrustName(localStorage.getItem('selected_trust_name') || DEFAULT_TRUST_NAME);
        setTermsModalLoading(false);
        return;
      }

      try {
        setTermsModalLoading(true);
        setTermsModalError('');
        const trust = await fetchTrustById(trustId);
        if (!active || !trust) return;
        setTermsModalContent(trust.terms_content || '');
        setTermsModalTrustName(trust.name || localStorage.getItem('selected_trust_name') || DEFAULT_TRUST_NAME);
      } catch (err) {
        if (!active) return;
        console.warn('[VIPLogin] Failed to load terms content:', err?.message || err);
        setTermsModalError('Failed to load Terms & Conditions. Please try again.');
        setTermsModalContent('');
        setTermsModalTrustName(localStorage.getItem('selected_trust_name') || DEFAULT_TRUST_NAME);
      } finally {
        if (active) setTermsModalLoading(false);
      }
    };

    loadTerms();
    return () => {
      active = false;
    };
  }, [showTermsModal, selectedTrustId]);

  // ── Load dashboard data when step = 'dashboard' ──────────────────────────────
  useEffect(() => {
    if (step !== 'dashboard') return;
    setDashLoading(true);
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) { setStep('phone'); return; }
      const parsed = JSON.parse(userStr);
      // Safety check — non-VIP member should never reach dashboard
      if (!parsed?.isRegisteredMember) { navigate('/profile', { replace: true }); return; }
      setUser(parsed);

      const selectedMembership = selectedTrustId
        ? parsed.hospital_memberships?.find((m) => String(m?.trust_id || '') === String(selectedTrustId))
        : null;

      const membership =
        selectedMembership ||
        parsed.hospital_memberships?.find((m) => m.is_active && m.trust_id) ||
        parsed.hospital_memberships?.[0] ||
        null;

      const trust =
        (membership
          ? {
              id: membership.trust_id,
              name: membership.trust_name,
              icon_url: membership.trust_icon_url
            }
          : null) ||
        parsed.primary_trust ||
        parsed.trust ||
        null;
      if (trust) setTrustInfo(trust);

      setMemberData({
        name: parsed.name || parsed['Name'] || 'Member',
        membershipNumber:
          membership?.membership_number ||
          parsed.membershipNumber ||
          parsed['Membership number'] ||
          '',
        mobile: parsed.mobile || parsed['Mobile'] || '',
        role: membership?.role || parsed.type || '',
        trustName:
          trust?.name ||
          DEFAULT_TRUST_NAME,
        vip_status: parsed.vip_status || null,
        isRegisteredMember: parsed.isRegisteredMember || false
      });
    } catch (err) {
      console.error('Error loading user:', err);
      setStep('phone');
    } finally {
      setDashLoading(false);
    }
  }, [step, selectedTrustId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setLoginLoading(true);
    try {
      const result = await checkPhoneNumber(phoneNumber);
      if (!result.success) {
        setFormError(result.message || 'Unable to verify number.');
        return;
      }
      const userData = result.data.user;
      // Store pending user; OTP step decides final destination
      setPendingUser(userData);
      setStep('otp');
    } catch (err) {
      setFormError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setLoginLoading(true);
    try {
      const result = await verifyOTP(phoneNumber, otp);
      if (!result.success) {
        setFormError(result.message || 'Invalid OTP.');
        return;
      }
      // Save user
      localStorage.setItem('user', JSON.stringify(pendingUser));
      localStorage.setItem('isLoggedIn', 'true');
      setLoginTermsPromptPending();
      setTermsModalLoading(true);
      setTermsModalError('');
      setTermsModalContent('');
      setTermsModalTrustName('');
      setShowTermsModal(true);
      await logUserSessionEvent({
        user: pendingUser,
        actionType: 'login',
        extra: {
          source: 'vip-login',
          login_method: 'otp',
          trust_id: BASE_TRUST_ID || null
        }
      });
      try { sessionStorage.removeItem('trust_selected_in_session'); } catch (_) {}
      const memberships = Array.isArray(pendingUser?.hospital_memberships) ? pendingUser.hospital_memberships : [];
      const baseMembership = memberships.find((m) => String(m?.trust_id || '') === String(BASE_TRUST_ID)) || null;
      const selectedMembership =
        memberships.find((m) => m?.is_active && m?.trust_id) ||
        memberships.find((m) => m?.trust_id) ||
        baseMembership ||
        null;
      const tid = String(selectedMembership?.trust_id || BASE_TRUST_ID || '').trim();
      let tname = selectedMembership?.trust_name || '';
      if (tid && !tname) {
        try {
          const trustRow = await fetchTrustById(tid);
          tname = String(trustRow?.name || '').trim();
        } catch (_) {
          // ignore trust lookup failure and continue with available values
        }
      }
      if (!tname) {
        tname = String(localStorage.getItem('selected_trust_name') || '').trim();
      }
      localStorage.setItem('selected_trust_id', String(tid));
      localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, String(tid));
      if (tname) localStorage.setItem('selected_trust_name', String(tname));
      window.dispatchEvent(new CustomEvent('trust-changed', {
        detail: {
          trustId: String(tid),
          trustName: tname || null,
          source: 'vip-login-default-base'
        }
      }));
      fetchDirectoryData(tid || null, tname || null).catch(() => {});
      // Routing logic:
      // 1. Governance/VIP role → VIP dashboard
      // 2. Regular trust member (has memberships but not governance) → show info, go to profile
      // 3. No memberships at all (brand new user) → show application form
      if (pendingUser?.isRegisteredMember) {
        setStep('dashboard');
      } else if (pendingUser?.hospital_memberships?.length > 0) {
        // User is a regular member of a trust but NOT a governance-role member
        setStep('existingmember');
      } else {
        // User has no trust membership at all — show VIP application form
        setApplicationForm(prev => ({
          ...prev,
          name: pendingUser?.name || pendingUser?.Name || prev.name,
          mobile: pendingUser?.mobile || pendingUser?.Mobile || prev.mobile,
          email: pendingUser?.email || pendingUser?.Email || prev.email
        }));
        setStep('notmember');
      }
    } catch (err) {
      setFormError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (onLogout) {
      await onLogout('logout', user || pendingUser || null);
      return;
    }
    await logUserSessionEvent({
      user: user || pendingUser || null,
      actionType: 'logout',
      extra: { source: 'vip-manual-fallback' }
    });
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('user');
    clearLoginTermsPromptPending();
    sessionStorage.clear();
    setShowTermsModal(false);
    setTermsModalContent('');
    setTermsModalTrustName('');
    setTermsModalError('');
    setTermsModalLoading(false);
    setUser(null); setMemberData(null); setTrustInfo(null);
    setPendingUser(null); setPhoneNumber(''); setOtp('');
    setApplicationSubmitted(false);
    setApplicationForm({
      name: '',
      addressHome: '',
      companyName: '',
      addressOffice: '',
      residentLandline: '',
      officeLandline: '',
      mobile: '',
      email: ''
    });
    setStep('phone');
  };
  
  const handleApplicationChange = (field) => (e) => {
    setApplicationForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleApplicationSubmit = (e) => {
    e.preventDefault();
    setApplicationSubmitted(true);
  };

  // ── VIP colour config ──────────────────────────────────────────────────────
  const handleAcceptTerms = () => {
    clearLoginTermsPromptPending();
    setShowTermsModal(false);
    setTermsModalContent('');
    setTermsModalTrustName('');
    setTermsModalError('');
    setTermsModalLoading(false);
  };

  const termsPrompt = (
    <TermsModal
      isOpen={showTermsModal}
      onAccept={handleAcceptTerms}
      content={termsModalContent}
      trustName={termsModalTrustName}
      loading={termsModalLoading}
      error={termsModalError}
    />
  );

  const getVipConfig = (md) => {
    if (md?.vip_status === 'VVIP') return {
      label: 'VVIP Member', banner: 'VVIP Member',
      cardFrom: '#0f172a', cardTo: '#273657',
      badgeBg: 'linear-gradient(135deg,#f6dd8d,#c89b2b)',
      badgeText: 'VVIP', bannerBg: '#fff7df', bannerBorder: '#f0d28a',
      bannerText: '#b5851f', bannerIcon: <Crown className="h-4 w-4" style={{color:'#c89b2b'}} />,
      iconColor: '#c89b2b', iconBg: '#fbf2d1',
      accent: '#b5851f', soft: '#fbf5e5'
    };
    if (md?.vip_status === 'VIP') return {
      label: 'VIP Member', banner: 'VIP Member',
      cardFrom: '#0f172a', cardTo: '#273657',
      badgeBg: 'linear-gradient(135deg,#f1d27a,#b8860b)',
      badgeText: 'VIP', bannerBg: '#fff7e1', bannerBorder: '#f0d28a',
      bannerText: '#b8860b', bannerIcon: <Crown className="h-4 w-4" style={{color:'#b8860b'}} />,
      iconColor: '#b8860b', iconBg: '#fbf2d1',
      accent: '#b8860b', soft: '#fbf5e5'
    };
    return {
      label: 'Registered Member', banner: 'Registered Member',
      cardFrom: '#0f172a', cardTo: '#273657',
      badgeBg: 'linear-gradient(135deg,#60a5fa,#3b82f6)',
      badgeText: 'Member', bannerBg: '#eef4ff', bannerBorder: '#cfe0ff',
      bannerText: '#3b82f6', bannerIcon: <CheckCircle className="h-4 w-4" style={{color:'#3b82f6'}} />,
      iconColor: '#3b82f6', iconBg: '#e8f0ff',
      accent: '#3b82f6', soft: '#eef4ff'
    };
  };

  const getCategoryLabel = () => {
    if (!user) return 'Member';
    const type = (user.type || '').toLowerCase();
    if (type.includes('permanent')) return 'Permanent Member';
    if (type.includes('patron')) return 'Patron Member';
    if (type.includes('trustee')) return 'Trustee';
    if (memberData?.membershipNumber) return 'Registered Member';
    return 'Member';
  };

  const getDisplayName = () => {
    const name = (memberData?.name || '').trim();
    if (!name) return 'Member';
    if (/^(Mr\.|Mrs\.|Ms\.|Dr\.)/.test(name)) return name;
    return `Mr. ${name}`;
  };

  // ── Menu items for dashboard ───────────────────────────────────────────────
  const menuItems = (vip) => [
    { id: 'referral',       icon: <UserPlus  className="h-5 w-5" style={{ color: vip.iconColor }} />, label: 'Patient Referral',  sub: 'Refer patients to specialists',  onClick: () => navigate('/reference') },
    { id: 'notifications',  icon: <Bell      className="h-5 w-5" style={{ color: vip.iconColor }} />, label: 'Notices & Updates', sub: 'View latest announcements',        onClick: () => navigate('/notifications') },
    { id: 'profile',        icon: <FileText  className="h-5 w-5" style={{ color: vip.iconColor }} />, label: 'My Profile',       sub: 'View and edit profile',            onClick: () => navigate('/profile') },
    { id: 'appointments',   icon: <Calendar  className="h-5 w-5" style={{ color: vip.iconColor }} />, label: 'Appointments',     sub: 'Book OPD appointments',            onClick: () => navigate('/appointment') },
    { id: 'directory',      icon: <BookOpen  className="h-5 w-5" style={{ color: vip.iconColor }} />, label: 'Member Directory', sub: 'Find members and doctors',          onClick: () => navigate('/directory') },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Phone entry step
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'phone') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50 flex flex-col px-4 py-8">
        {/* Back to normal login */}
        <button
          onClick={() => navigate('/login')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 self-start"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Login
        </button>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            {/* Logo + heading */}
            <div className="text-center mb-8">
              <img src={logo} alt="Logo" className="h-16 w-auto mx-auto mb-4 object-contain" />
              <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full mb-3">
                <Crown className="h-3.5 w-3.5" /> VIP Member Login
              </div>
              <h1 className="text-2xl font-extrabold text-gray-800 mb-1">Welcome, VIP Member</h1>
              <p className="text-sm text-gray-500">Enter your registered mobile number to access your VIP dashboard</p>
            </div>

            {/* Phone form */}
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Mobile Number</label>
                <div className="flex items-center rounded-2xl border-2 border-amber-200 bg-white focus-within:border-amber-400 focus-within:shadow-lg focus-within:shadow-amber-100 transition-all">
                  <span className="pl-4 text-base font-bold text-gray-500">+91</span>
                  <input
                    type="tel"
                    name="phone"
                    placeholder="10-digit mobile number"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    maxLength={10}
                    required
                    autoComplete="tel-national"
                    inputMode="numeric"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="flex-1 bg-transparent px-3 py-4 text-lg text-gray-900 placeholder:text-gray-300 focus:outline-none"
                  />
                  <Phone className="h-5 w-5 text-amber-400 mr-4" />
                </div>
              </div>

              {formError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || phoneNumber.length < 10}
                className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)', boxShadow: '0 4px 16px rgba(180,83,9,0.25)' }}
              >
                {loginLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {loginLoading ? 'Checking...' : 'Continue'}
              </button>
            </form>

            <p className="text-center text-xs text-gray-400 mt-6">
              Not a VIP member?{' '}
              <button onClick={() => navigate('/login')} className="text-amber-700 font-semibold hover:underline">
                Regular Login
              </button>
            </p>
            {termsPrompt}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: OTP step
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'otp') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50 flex flex-col px-4 py-8">
        <button
          onClick={() => { setStep('phone'); setOtp(''); setFormError(''); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 self-start"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#b45309,#fbbf24)' }}
              >
                <Lock className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-extrabold text-gray-800 mb-1">Verify OTP</h1>
              <p className="text-sm text-gray-500">
                OTP sent to <span className="font-bold text-gray-700">+91 {phoneNumber}</span>
              </p>
            </div>

            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Enter OTP</label>
                <input
                  type="text"
                  placeholder="● ● ● ● ● ●"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  required
                  className="w-full px-5 py-4 text-2xl font-bold text-center tracking-[0.4em] border-2 border-amber-200 rounded-2xl bg-white focus:border-amber-400 focus:shadow-lg focus:shadow-amber-100 focus:outline-none transition-all text-gray-800"
                />
              </div>

              {formError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || otp.length !== 6}
                className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 4px 16px rgba(180,83,9,0.25)' }}
              >
                {loginLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {loginLoading ? 'Verifying...' : pendingUser?.isRegisteredMember ? 'Verify & Enter' : 'Verify & Continue'}
              </button>
            </form>

            <p className="text-center text-xs text-gray-400 mt-4">
              Didn't receive OTP?{' '}
              <button
                onClick={() => { setStep('phone'); setOtp(''); setFormError(''); }}
                className="text-amber-700 font-semibold hover:underline"
              >
                Try again
              </button>
            </p>
            {termsPrompt}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Already a member but NOT a governance/VIP role
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'existingmember') {
    const existingTrust = pendingUser?.hospital_memberships?.[0];
    const trustDisplayName = existingTrust?.trust_name || DEFAULT_TRUST_NAME;
    const memberRole = existingTrust?.role || 'Member';
    const memberNo = existingTrust?.membership_number || '';

    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50 flex flex-col px-4 py-8">
        <button
          onClick={() => { setStep('phone'); setOtp(''); setFormError(''); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 self-start"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            {/* Icon */}
            <div className="text-center mb-6">
              <div
                className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg,#dcfce7,#bbf7d0)' }}
              >
                <CheckCircle className="h-9 w-9 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-2">Already a Member!</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Your number <span className="font-semibold text-gray-700">+91 {phoneNumber}</span> is
                already registered as a member of{' '}
                <span className="font-semibold text-amber-700">{trustDisplayName}</span>.
              </p>
            </div>

            {/* Info card */}
            <div className="rounded-3xl bg-white border border-amber-100 shadow-[0_14px_40px_rgba(245,158,11,0.12)] overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-600" />
                  <p className="text-[13px] font-extrabold text-amber-800 uppercase tracking-wider">Your Membership</p>
                </div>
              </div>
              <div className="px-5 py-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">Trust</span>
                  <span className="text-sm font-bold text-gray-800">{trustDisplayName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">Role</span>
                  <span className="text-sm font-bold text-gray-800 capitalize">{memberRole}</span>
                </div>
                {memberNo && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">Membership No.</span>
                    <span className="text-sm font-bold text-gray-800">{memberNo}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-amber-50">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    VIP login is for <span className="font-semibold text-amber-700">Trustees, Patrons &amp; governance-role members</span> only.
                    To access your profile and membership details, please use the regular login.
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <button
              onClick={() => navigate('/profile')}
              className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 mb-3"
              style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 4px 16px rgba(180,83,9,0.25)' }}
            >
              <User className="h-5 w-5" />
              Go to My Profile
            </button>

            <button
              onClick={() => navigate('/')}
              className="w-full py-4 rounded-2xl font-bold text-base text-gray-700 bg-white border border-amber-200 hover:bg-amber-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Home className="h-5 w-5 text-amber-500" />
              Go to Home
            </button>
            {termsPrompt}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Not a registered member (truly new user, no memberships)
  // ═══════════════════════════════════════════════════════════════════════════
  if (step === 'notmember') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50 flex flex-col px-4 py-8">
        <button
          onClick={() => { setFormError(''); setApplicationSubmitted(false); navigate('/'); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 self-start"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md">
            <div className="text-center mb-6">
              <div
                className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
                style={{ background: '#fef3c7' }}
              >
                <Sparkles className="h-9 w-9 text-amber-500" />
              </div>
              <h2 className="text-2xl font-extrabold text-gray-800 mb-2">VIP Membership Application</h2>
              <p className="text-sm text-gray-500">
                Your number <span className="font-semibold text-gray-700">+91 {phoneNumber}</span> is not registered yet.
                Please fill the details below to start your VIP application.
              </p>
            </div>

            <div className="rounded-3xl bg-white border border-amber-100 shadow-[0_14px_40px_rgba(245,158,11,0.15)] overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-600" />
                  <p className="text-[13px] font-extrabold text-amber-800 uppercase tracking-wider">Member Details</p>
                </div>
              </div>

              {applicationSubmitted ? (
                <div className="px-6 py-10 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                    <CheckCircle className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-extrabold text-gray-800 mb-2">Application Submitted</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Thank you for your details. Your VIP application is under process and our team will get back to you soon.
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <Clock className="h-4 w-4" />
                    Expected review within 2–3 working days
                  </div>
                </div>
              ) : (
                <form onSubmit={handleApplicationSubmit} className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Name</label>
                    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <User className="h-4 w-4 text-amber-500" />
                      <input
                        type="text"
                        value={applicationForm.name}
                        onChange={handleApplicationChange('name')}
                        required
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                        placeholder="Full name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Address (Home)</label>
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <Home className="h-4 w-4 text-amber-500 mt-0.5" />
                      <textarea
                        value={applicationForm.addressHome}
                        onChange={handleApplicationChange('addressHome')}
                        rows={2}
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none resize-none"
                        placeholder="Home address"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Company Name</label>
                    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <Building2 className="h-4 w-4 text-amber-500" />
                      <input
                        type="text"
                        value={applicationForm.companyName}
                        onChange={handleApplicationChange('companyName')}
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                        placeholder="Company / organization"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Address (Office)</label>
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <MapPin className="h-4 w-4 text-amber-500 mt-0.5" />
                      <textarea
                        value={applicationForm.addressOffice}
                        onChange={handleApplicationChange('addressOffice')}
                        rows={2}
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none resize-none"
                        placeholder="Office address"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-2">Resident Landline</label>
                      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                        <Phone className="h-4 w-4 text-amber-500" />
                        <input
                          type="text"
                          value={applicationForm.residentLandline}
                          onChange={handleApplicationChange('residentLandline')}
                          className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                          placeholder="Resident landline"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-600 mb-2">Office Landline</label>
                      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                        <Phone className="h-4 w-4 text-amber-500" />
                        <input
                          type="text"
                          value={applicationForm.officeLandline}
                          onChange={handleApplicationChange('officeLandline')}
                          className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                          placeholder="Office landline"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Mobile</label>
                    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <Phone className="h-4 w-4 text-amber-500" />
                      <input
                        type="tel"
                        name="mobile"
                        value={applicationForm.mobile}
                        onChange={handleApplicationChange('mobile')}
                        autoComplete="tel-national"
                        inputMode="numeric"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                        placeholder="Mobile number"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-600 mb-2">Email</label>
                    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3 focus-within:border-amber-400 focus-within:shadow-[0_0_0_4px_rgba(251,191,36,0.15)] transition-all">
                      <Mail className="h-4 w-4 text-amber-500" />
                      <input
                        type="email"
                        value={applicationForm.email}
                        onChange={handleApplicationChange('email')}
                        className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-300 focus:outline-none"
                        placeholder="Email address"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', boxShadow: '0 6px 20px rgba(180,83,9,0.25)' }}
                  >
                    <Send className="h-4 w-4" />
                    Submit Application
                  </button>
                </form>
              )}
            </div>

            <div className="mt-5 text-center">
              <button
                onClick={() => navigate('/login')}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Go to Regular Login
              </button>
            </div>
            {termsPrompt}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Dashboard (authenticated registered member)
  // ═══════════════════════════════════════════════════════════════════════════
  if (dashLoading || !memberData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Loading your dashboard...</p>
        </div>
        {termsPrompt}
      </div>
    );
  }

  const vip = getVipConfig(memberData);
  const items = menuItems(vip);
  const categoryLabel = getCategoryLabel();
  const showVipBadge = !!memberData.vip_status &&
    memberData.vip_status.toLowerCase() !== categoryLabel.toLowerCase();

  return (
    <div className="min-h-screen bg-[#f6f8fc] relative overflow-x-hidden">
      <style>{`
        @keyframes vip-marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
      {termsPrompt}

      {/* ── Hero Profile Section (dark navy card) ── */}
      <div className="relative overflow-hidden px-0 pb-7 pt-3"
        style={{ background: `linear-gradient(145deg, ${vip.cardFrom} 0%, ${vip.cardTo} 100%)` }}>

        {/* Decorative circles */}
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-10 bg-white" />
        <div className="absolute top-4 right-10 w-20 h-20 rounded-full opacity-[0.06] bg-white" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full opacity-[0.07] bg-white" />

        {/* Top nav row inside hero */}
        <div className="relative flex items-center justify-between px-5 pt-8 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5 text-white" />
            </button>
            <div>
              <p className="text-[11px] text-white/60 font-medium leading-none">Welcome back</p>
              <p className="text-[16px] font-extrabold text-white leading-tight mt-0.5">{memberData.name || 'Member'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate('/notifications')}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
              <Bell className="h-5 w-5 text-white" />
            </button>
          </div>
        </div>

        {/* Profile card inside hero */}
        <div className="mx-5 mt-2 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <div className="relative flex items-center gap-4">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/25 to-white/5 border border-white/25 flex items-center justify-center">
                <User className="h-9 w-9 text-white" />
              </div>
              <div className="absolute -bottom-1.5 -right-1.5 flex items-center justify-center w-7 h-7 rounded-xl border-2 border-white shadow-lg"
                style={{ background: vip.badgeBg }}>
                {memberData.vip_status ? <Crown className="h-3.5 w-3.5 text-white" /> : <Star className="h-3.5 w-3.5 text-white" />}
              </div>
            </div>

            {/* Member info */}
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-extrabold text-white leading-tight truncate">{getDisplayName()}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[11px] font-bold px-3 py-0.5 rounded-full text-white"
                  style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)' }}>
                  {categoryLabel}
                </span>
                {showVipBadge && (
                  <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full text-white shadow-sm"
                    style={{ background: vip.badgeBg }}>
                    {memberData.vip_status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-white/70 font-medium">
                {memberData.membershipNumber && (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-white/70" />
                    ID: {memberData.membershipNumber}
                  </span>
                )}
                {memberData.mobile && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-white/70" />
                    {memberData.mobile}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Hospital chip */}
          {!bannerDismissed && (
            <div className="mt-4">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
                {vip.bannerIcon}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-white leading-none">{vip.banner}</p>
                  <p className="text-[10px] text-white/50 mt-0.5 truncate font-medium">{memberData.trustName}</p>
                </div>
                <button onClick={() => setBannerDismissed(true)} className="text-white/40 hover:text-white/70 text-base leading-none pl-2">×</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Demo stats */}
      <div className="px-5 mt-4">
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200/70 p-4 shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
            style={{ background: 'linear-gradient(160deg, #f8fbff 0%, #eef4ff 55%, #e9f1ff 100%)' }}>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#dbeafe,#bfdbfe)' }}>
              <UserPlus className="h-5 w-5" style={{ color: '#2563eb' }} />
            </div>
            <p className="mt-3 text-[22px] font-extrabold text-slate-900">124</p>
            <p className="text-[12px] font-semibold text-slate-500">Patients referred</p>
            <p className="text-[12px] font-bold" style={{ color: vip.accent || '#3b82f6' }}>+12 this month</p>
          </div>
          <div className="rounded-2xl border border-white/60 p-4 shadow-[0_8px_20px_rgba(15,23,42,0.08)] backdrop-blur-md"
            style={{ background: 'linear-gradient(160deg, rgba(239,246,255,0.9) 0%, rgba(219,234,254,0.7) 55%, rgba(191,219,254,0.7) 100%)' }}>
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#e0f2fe,#bfdbfe)' }}>
              <Calendar className="h-5 w-5" style={{ color: '#2563eb' }} />
            </div>
            <p className="mt-3 text-[22px] font-extrabold text-slate-900">3</p>
            <p className="text-[12px] font-semibold text-slate-500">Appointments</p>
            <p className="text-[12px] font-bold" style={{ color: vip.accent || '#3b82f6' }}>2 upcoming</p>
          </div>
        </div>
      </div>

      {/* ── Quick Access ── */}
      <div className="px-5 mt-6 mb-3">
        <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Quick Access</p>
      </div>

      <div className="px-4 space-y-3 pb-10">
        {items.map(item => (
          <button
            key={item.id}
            onClick={item.onClick}
            className="w-full rounded-2xl px-4 py-4 flex items-center gap-4 shadow-[0_8px_24px_rgba(15,23,42,0.1)] active:scale-[0.98] transition-all border border-slate-200/80 hover:shadow-[0_12px_30px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 group bg-gradient-to-br from-white to-slate-50"
          >
            {/* Icon box */}
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all group-hover:scale-105"
              style={{ background: vip.iconBg }}>
              {item.icon}
            </div>

            {/* Text */}
            <div className="flex-1 text-left min-w-0">
              <p className="text-[14px] font-bold text-slate-800 leading-tight truncate">{item.label}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium truncate">{item.sub}</p>
            </div>

            {/* Arrow */}
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors" style={{ background: vip.iconBg }}>
              <ChevronRight className="h-3.5 w-3.5" style={{ color: vip.iconColor }} />
            </div>
          </button>
        ))}
      </div>

      {/* ── Logout Confirm Modal ── */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-8 pb-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4 shadow-sm">
                <LogOut className="h-7 w-7 text-red-500" />
              </div>
              <h3 className="text-slate-900 text-lg font-extrabold mb-1.5">Logout?</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Are you sure you want to logout from your{' '}
                <span className="font-bold" style={{ color: vip.bannerText }}>{vip.label}</span> account?
              </p>
            </div>
            <div className="flex gap-3 px-6 pb-8 pt-4">
              <button onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3.5 rounded-2xl font-bold text-sm bg-slate-100 text-slate-700 active:scale-95 transition-all">
                Cancel
              </button>
              <button onClick={handleLogout}
                className="flex-1 py-3.5 rounded-2xl font-bold text-sm text-white active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow: '0 6px 20px rgba(239,68,68,0.35)' }}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VIPLogin;
