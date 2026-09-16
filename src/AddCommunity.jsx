import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Home as HomeIcon, Menu, Rocket, Upload, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import Sidebar from './features/sidebar/Sidebar';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import { fetchFeatureFlags } from './services/featureFlags';

const DEFAULT_PAGE_TITLE = 'Add Community';
const LAST_SELECTED_TRUST_ID_KEY = 'last_selected_trust_id';
const PENDING_CREATED_APP_URL_KEY = 'pending_created_app_install_url';
const PENDING_CREATED_APP_TS_KEY = 'pending_created_app_install_url_ts';

const toTitleCase = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

// Translates known Postgres/PostgREST errors into user-facing copy instead
// of surfacing raw constraint/SQLSTATE text (e.g. `duplicate key value
// violates unique constraint "Trust_name_key"`).
const getFriendlySubmitError = (error, trustName) => {
  const code = error?.code || '';
  const message = String(error?.message || '');

  if (code === '23505' || /duplicate key value/i.test(message)) {
    if (/trust_name_key/i.test(message)) {
      return `An app named "${trustName}" already exists. Please choose a different name.`;
    }
    return 'This already exists. Please try different details.';
  }

  return message || 'Failed to create trust. Please try again.';
};

// Friendlier labels for known sample_app.name values (DB rows are keyed by
// this raw "keyword" — see apply_sample_app_theme()/create_trust_via_whatsapp
// in Supabase, which clone that sample app's template/features onto the new
// Trust). Any sample app added later without an entry here just falls back
// to its raw name, so the picker never breaks for new rows.
const SAMPLE_APP_LABELS = {
  default: 'Standard (General Trust App)',
  digital_directory_app: 'Digital Directory (Member Directory Only)',
};
const getSampleAppLabel = (sampleApp) =>
  SAMPLE_APP_LABELS[sampleApp?.name] || sampleApp?.name || 'Untitled';

// Minimum time the launch overlay stays up before navigating, so the
// animation has room to play out even when generate-webApp-link resolves
// almost instantly. The status-line and progress-fill CSS animations below
// are keyed to this same duration.
const LAUNCH_ANIMATION_MS = 10000;
const APP_SLUG_POLL_INTERVAL_MS = 1000;
const APP_SLUG_POLL_TIMEOUT_MS = 20000;

const LAUNCH_STARS = [
  { top: '12%', left: '18%', size: '3px', delay: '0s', duration: '2.2s' },
  { top: '20%', left: '82%', size: '4px', delay: '0.4s', duration: '2.6s' },
  { top: '32%', left: '8%', size: '3px', delay: '0.8s', duration: '2s' },
  { top: '38%', left: '68%', size: '3px', delay: '1.1s', duration: '2.4s' },
  { top: '58%', left: '14%', size: '4px', delay: '0.2s', duration: '2.8s' },
  { top: '62%', left: '88%', size: '3px', delay: '1.4s', duration: '2.1s' },
  { top: '74%', left: '30%', size: '3px', delay: '0.6s', duration: '2.5s' },
  { top: '78%', left: '62%', size: '4px', delay: '1.7s', duration: '2.3s' },
  { top: '10%', left: '48%', size: '3px', delay: '1s', duration: '2.7s' },
  { top: '86%', left: '46%', size: '3px', delay: '0.3s', duration: '2.4s' },
];

const FieldLabel = ({ children, required = false }) => (
  <div className="mb-2">
    <label className="block text-[15px] font-extrabold tracking-[0.01em]" style={{ color: 'var(--advertisement-title)' }}>
      {children}
      {required ? <span style={{ color: 'var(--brand-red)' }}> *</span> : null}
    </label>
  </div>
);

const textInputStyle = {
  width: '100%',
  borderRadius: '18px',
  border: '1px solid var(--advertisement-card-border)',
  background: 'color-mix(in srgb, var(--advertisement-card-bg) 96%, black 4%)',
  color: 'var(--advertisement-title)',
  outline: 'none',
  fontSize: '16px',
  lineHeight: 1.4,
  boxShadow: '0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 20%, transparent)',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeText = (value) => String(value || '').trim();

const waitForTenantAppSlug = async (supabase, trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return null;

  const startedAt = Date.now();
  while (Date.now() - startedAt <= APP_SLUG_POLL_TIMEOUT_MS) {
    const { data, error } = await supabase
      .from('Trust')
      .select('id,name,legal_name,remark,icon_url,app_slug,pwa_enabled,version')
      .eq('id', normalizedTrustId)
      .maybeSingle();

    if (error) throw error;

    const appSlug = normalizeText(data?.app_slug).toLowerCase();
    if (appSlug && data?.pwa_enabled === true) {
      return { ...data, app_slug: appSlug };
    }

    await delay(APP_SLUG_POLL_INTERVAL_MS);
  }

  return null;
};

const cacheCreatedTrust = ({ trustId, trustName, legalName, description, iconUrl, trustRow }) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return;

  const cachedTrust = {
    ...(trustRow || {}),
    id: normalizedTrustId,
    name: normalizeText(trustRow?.name) || trustName,
    legal_name: normalizeText(trustRow?.legal_name) || normalizeText(legalName) || null,
    remark: normalizeText(trustRow?.remark) || normalizeText(description) || null,
    icon_url: iconUrl || trustRow?.icon_url || null,
    is_active: true,
  };

  localStorage.setItem('selected_trust_id', normalizedTrustId);
  localStorage.setItem(LAST_SELECTED_TRUST_ID_KEY, normalizedTrustId);
  localStorage.setItem('selected_trust_name', cachedTrust.name || trustName);

  try {
    const cached = JSON.parse(localStorage.getItem('trust_list_cache') || '[]');
    const list = Array.isArray(cached) ? cached : [];
    const next = [
      cachedTrust,
      ...list.filter((trust) => normalizeText(trust?.id) !== normalizedTrustId),
    ];
    localStorage.setItem('trust_list_cache', JSON.stringify(next));
  } catch {
    localStorage.setItem('trust_list_cache', JSON.stringify([cachedTrust]));
  }
};

const AddCommunity = ({ onNavigateBack, variant = 'page' }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isHomeVariant = variant === 'home';
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const [form, setForm] = useState({
    trustName: '',
    legalName: '',
    description: '',
    sampleAppId: '',
  });
  const [isFocused, setIsFocused] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sampleApps, setSampleApps] = useState([]);
  const [pageTitle, setPageTitle] = useState(DEFAULT_PAGE_TITLE);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchCycle, setLaunchCycle] = useState(0);
  const [submitError, setSubmitError] = useState('');
  // Live "is this name taken" check, run on blur of the Trust Name field —
  // status: 'idle' | 'checking' | 'taken' | 'available'; checkedValue tracks
  // which exact value the current status applies to, so a stale "taken"
  // result never lingers after the user edits the field again.
  const [nameCheck, setNameCheck] = useState({ status: 'idle', checkedValue: '' });
  const fileInputRef = useRef(null);

  const panelBorder = 'var(--advertisement-card-border)';
  const muted = 'var(--advertisement-subtitle)';
  const heading = 'var(--advertisement-title)';
  const cardBg = 'var(--advertisement-card-bg)';
  const accentTint = 'color-mix(in srgb, var(--advertisement-card-bg) 78%, var(--app-accent-bg))';
  const pageShellBg = getThemeToken(theme, 'page.background', 'var(--page-bg, var(--app-page-bg))');

  const handleBack = () => {
    if (typeof onNavigateBack === 'function') {
      onNavigateBack();
      return;
    }
    navigate(getAppHomePath());
  };

  const handleChange = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    // Editing the name again invalidates whatever "taken"/"available"
    // result we last checked, so it never shows stale next to a value the
    // user hasn't actually checked yet.
    if (key === 'trustName') setNameCheck({ status: 'idle', checkedValue: '' });
  };

  // Real-time "is this name already taken" check, run when the Trust Name
  // field loses focus — mirrors the Trust.name UNIQUE constraint (a plain
  // case-sensitive exact match) so it warns for the same names the actual
  // create_trust_via_whatsapp call would reject, without waiting for submit.
  const checkTrustNameAvailability = async () => {
    const trustName = String(form.trustName || '').trim();
    if (!trustName) {
      setNameCheck({ status: 'idle', checkedValue: '' });
      return;
    }
    setNameCheck({ status: 'checking', checkedValue: trustName });
    try {
      const { supabase } = await import('./services/supabaseClient.js');
      const { data, error } = await supabase
        .from('Trust')
        .select('id')
        .eq('name', trustName)
        .limit(1);
      if (error) throw error;
      setNameCheck({ status: data?.length ? 'taken' : 'available', checkedValue: trustName });
    } catch (err) {
      console.warn('[AddCommunity] Name availability check failed:', err?.message || err);
      setNameCheck({ status: 'idle', checkedValue: '' });
    }
  };

  // Sample apps double as the "Type" picker: each row's `name` is the
  // keyword create_trust_via_whatsapp forwards to apply_sample_app_theme(),
  // which clones that sample app's template/feature flags onto the new
  // Trust. Default to the 'default' row so submitting without touching this
  // field behaves the same as before this field existed.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { supabase } = await import('./services/supabaseClient.js');
        const { data, error } = await supabase
          .from('sample_app')
          .select('id, name, purpose')
          .order('name');
        if (!active || error || !Array.isArray(data)) return;
        setSampleApps(data);
        const defaultApp = data.find((app) => app.name === 'default') || data[0];
        if (defaultApp) {
          setForm((prev) => (prev.sampleAppId ? prev : { ...prev, sampleAppId: defaultApp.id }));
        }
      } catch (err) {
        console.warn('[AddCommunity] Failed to load sample app types:', err?.message || err);
      }
    })();
    return () => { active = false; };
  }, []);

  // Navbar title follows the "Add Community" feature flag's own
  // display_name (feature_flags.display_name for feature_add_community)
  // instead of a hardcoded string, so renaming it per-Trust in the flag
  // config is reflected here automatically. Falls back to the default
  // label while loading or if no override is configured.
  useEffect(() => {
    let active = true;
    const trustId = localStorage.getItem('selected_trust_id') || null;
    if (!trustId) return undefined;
    (async () => {
      try {
        const result = await fetchFeatureFlags(trustId);
        if (!active || !result?.success) return;
        const displayName = result.flagsData?.feature_add_community?.display_name;
        if (displayName) setPageTitle(toTitleCase(displayName));
      } catch (err) {
        console.warn('[AddCommunity] Failed to load feature flag display name:', err?.message || err);
      }
    })();
    return () => { active = false; };
  }, []);

  // Dev-only preview hook: visiting /add-community?preview=launch shows the
  // launch overlay for a few seconds without creating a Trust or calling
  // Supabase, so the animation can be eyeballed on demand. No-ops outside
  // local dev builds and doesn't affect the real submit flow.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    if (searchParams.get('preview') !== 'launch') return undefined;
    setLaunching(true);
    const timer = setTimeout(() => setLaunching(false), LAUNCH_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [searchParams]);

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const nextPreview = URL.createObjectURL(file);
    setLogoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextPreview;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');

    const trustName = String(form.trustName || '').trim();
    if (!trustName) {
      setSubmitError('Trust name is required.');
      return;
    }

    if (!form.sampleAppId) {
      setSubmitError('Please select a Type.');
      return;
    }

    let parsedUser = {};
    try {
      parsedUser = JSON.parse(localStorage.getItem('user') || '{}') || {};
    } catch {
      parsedUser = {};
    }

    const memberMobile = String(parsedUser?.mobile || parsedUser?.Mobile || '')
      .replace(/\D/g, '')
      .slice(-10);
    const memberName = String(parsedUser?.name || parsedUser?.Name || '').trim();

    if (!memberMobile) {
      setSubmitError('Member identity not found. Please login again and retry.');
      return;
    }

    const selectedSampleApp = sampleApps.find((app) => app.id === form.sampleAppId) || null;

    setSubmitting(true);
    // Show the launch animation immediately. After the install link is ready,
    // restart this cycle so the final launch screen gets its full duration.
    setLaunching(true);
    setLaunchCycle((prev) => prev + 1);
    const { supabase } = await import('./services/supabaseClient.js');
    let nextTrustId = '';
    let uploadedIconUrl = null;
    let tenantTrust = null;
    try {
      // create_trust_via_whatsapp already handles the full "new trust"
      // pipeline (superuser + Trust row + async web-app-link generation).
      // Passing the selected sample app's `name` as p_keyword is what makes
      // the existing apply_sample_app_theme() trigger clone that sample
      // app's template/feature flags onto the new trust.
      const { data, error } = await supabase.rpc('create_trust_via_whatsapp', {
        p_mobile: memberMobile,
        p_name: memberName || trustName,
        p_trust_name: trustName,
        p_keyword: selectedSampleApp?.name || null,
      });

      if (error) throw error;

      nextTrustId = String(data || '').trim();
      if (nextTrustId) {
        if (logoFile) {
          const extension = String(logoFile.name || '').split('.').pop()?.toLowerCase() || 'png';
          const safeExtension = extension.replace(/[^a-z0-9]/g, '') || 'png';
          const storagePath = `${nextTrustId}/${Date.now()}-community-logo.${safeExtension}`;

          const { error: uploadError } = await supabase
            .storage
            .from('trust-icons')
            .upload(storagePath, logoFile, {
              cacheControl: '3600',
              upsert: true,
            });

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase
            .storage
            .from('trust-icons')
            .getPublicUrl(storagePath);

          uploadedIconUrl = publicUrlData?.publicUrl || null;
        }

        const trustUpdates = {
          legal_name: String(form.legalName || '').trim() || null,
          remark: String(form.description || '').trim() || null,
        };

        if (uploadedIconUrl) {
          trustUpdates.icon_url = uploadedIconUrl;
        }

        const hasTrustUpdates = Object.values(trustUpdates).some((value) => value !== null && value !== '');
        if (hasTrustUpdates) {
          const { error: trustUpdateError } = await supabase
            .from('Trust')
            .update(trustUpdates)
            .eq('id', nextTrustId);

          if (trustUpdateError) throw trustUpdateError;
        }

        cacheCreatedTrust({
          trustId: nextTrustId,
          trustName,
          legalName: form.legalName,
          description: form.description,
          iconUrl: uploadedIconUrl,
        });
        window.dispatchEvent(new CustomEvent('trust-changed', {
          detail: {
            trustId: nextTrustId,
            trustName,
            iconUrl: uploadedIconUrl || null,
          }
        }));

        tenantTrust = await waitForTenantAppSlug(supabase, nextTrustId);
        if (tenantTrust) {
          cacheCreatedTrust({
            trustId: nextTrustId,
            trustName,
            legalName: form.legalName,
            description: form.description,
            iconUrl: uploadedIconUrl,
            trustRow: tenantTrust,
          });
        }
      }
    } catch (error) {
      setSubmitError(getFriendlySubmitError(error, trustName));
      setSubmitting(false);
      setLaunching(false);
      return;
    }

    setSubmitting(false);

    if (!nextTrustId) {
      setSubmitError('Trust was created but could not be confirmed. Please check again.');
      setLaunching(false);
      return;
    }

    // Open the tenant install landing after the backend has generated the
    // slug and enabled PWA metadata for this newly created Trust.
    if (!tenantTrust?.app_slug) {
      setSubmitError('App was created, but the install page link is still getting ready. Please try again in a moment.');
      setLaunching(false);
      return;
    }

    setLaunchCycle((prev) => prev + 1);
    await delay(LAUNCH_ANIMATION_MS);
    const installUrl = `${window.location.origin}/app/${encodeURIComponent(tenantTrust.app_slug)}?install=1&created=1`;
    try {
      sessionStorage.setItem(PENDING_CREATED_APP_URL_KEY, installUrl);
      sessionStorage.setItem(PENDING_CREATED_APP_TS_KEY, String(Date.now()));
      localStorage.setItem(PENDING_CREATED_APP_URL_KEY, installUrl);
      localStorage.setItem(PENDING_CREATED_APP_TS_KEY, String(Date.now()));
    } catch {
      // ignore storage failures
    }
    window.location.href = installUrl;
    window.location.replace(installUrl);
  };

  const hasTrustName = String(form.trustName || '').trim().length > 0;
  const hasType = Boolean(form.sampleAppId);
  const isNameTaken = nameCheck.status === 'taken' && nameCheck.checkedValue === form.trustName.trim();
  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen, isHomeVariant]);

  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen, isHomeVariant]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  return (
    <div className={isHomeVariant ? '' : 'min-h-screen'} style={isHomeVariant ? { color: 'var(--body-text-color)' } : { background: pageShellBg, color: 'var(--body-text-color)' }}>
      {!isHomeVariant && (
        <>
          <div
            className="sticky top-0 z-30 flex items-center justify-between px-4 py-4"
            style={{
              background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
              backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
              WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
              borderBottom: '1px solid var(--navbar-border)',
              color: navbarTheme?.textColor || 'var(--navbar-text)',
            }}
          >
            <button
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTheme?.textColor || 'var(--navbar-text)' }}>
              {pageTitle}
            </h1>
            <button
              onClick={handleBack}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
              aria-label="Go back"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>

          <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)} currentPage="add-community" />
        </>
      )}

      <div className={isHomeVariant ? 'space-y-5' : 'px-4 pt-5 pb-10 space-y-5'}>
        <section
          className="rounded-[28px] border p-5"
          style={{
            background: cardBg,
            borderColor: panelBorder,
            boxShadow: '0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)',
          }}
        >
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <FieldLabel required>Your App Name</FieldLabel>
              <input
                type="text"
                value={form.trustName}
                onChange={handleChange('trustName')}
                onFocus={() => setIsFocused('trustName')}
                onBlur={() => { setIsFocused(''); checkTrustNameAvailability(); }}
                className="px-4 py-4 font-semibold placeholder:font-medium"
                style={{
                  ...textInputStyle,
                  borderColor: nameCheck.status === 'taken' && nameCheck.checkedValue === form.trustName.trim()
                    ? 'var(--brand-red)'
                    : (isFocused === 'trustName' ? 'var(--app-button-icon)' : panelBorder),
                  boxShadow: isFocused === 'trustName'
                    ? `0 0 0 3px ${applyOpacity(theme.primary || '#d4a017', 0.18)}, 0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)`
                    : textInputStyle.boxShadow,
                }}
              />
              {nameCheck.checkedValue === form.trustName.trim() && nameCheck.status === 'checking' && (
                <p className="mt-2 text-xs" style={{ color: muted }}>Checking availability…</p>
              )}
              {nameCheck.checkedValue === form.trustName.trim() && nameCheck.status === 'taken' && (
                <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--brand-red)' }}>
                  This name is already taken. Please choose another name.
                </p>
              )}
              {nameCheck.checkedValue === form.trustName.trim() && nameCheck.status === 'available' && (
                <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--brand-green, #2e9e5b)' }}>
                  This name is available.
                </p>
              )}
            </div>

            <div>
              <FieldLabel>Organisation Name</FieldLabel>
              <input
                type="text"
                value={form.legalName}
                onChange={handleChange('legalName')}
                onFocus={() => setIsFocused('legalName')}
                onBlur={() => setIsFocused('')}
                className="px-4 py-4 font-medium placeholder:font-medium"
                style={{
                  ...textInputStyle,
                  borderColor: isFocused === 'legalName' ? 'var(--app-button-icon)' : panelBorder,
                  boxShadow: isFocused === 'legalName'
                    ? `0 0 0 3px ${applyOpacity(theme.primary || '#d4a017', 0.18)}, 0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)`
                    : textInputStyle.boxShadow,
                }}
              />
            </div>

            <div>
              <FieldLabel required>Type</FieldLabel>
              <div className="relative">
                <select
                  required
                  value={form.sampleAppId}
                  onChange={handleChange('sampleAppId')}
                  onFocus={() => setIsFocused('sampleAppId')}
                  onBlur={() => setIsFocused('')}
                  className="w-full appearance-none px-4 py-4 pr-11 font-medium"
                  style={{
                    ...textInputStyle,
                    borderColor: isFocused === 'sampleAppId' ? 'var(--app-button-icon)' : panelBorder,
                    boxShadow: isFocused === 'sampleAppId'
                      ? `0 0 0 3px ${applyOpacity(theme.primary || '#d4a017', 0.18)}, 0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)`
                      : textInputStyle.boxShadow,
                  }}
                >
                  {sampleApps.length === 0 ? (
                    <option value="">Standard (General Trust App)</option>
                  ) : (
                    sampleApps.map((app) => (
                      <option key={app.id} value={app.id}>
                        {getSampleAppLabel(app)}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{ color: muted }}
                />
              </div>
              {(() => {
                const selectedPurpose = sampleApps.find((app) => app.id === form.sampleAppId)?.purpose;
                return selectedPurpose ? (
                  <p className="mt-2 text-xs" style={{ color: muted }}>
                    {selectedPurpose}
                  </p>
                ) : null;
              })()}
            </div>

            <div>
              <FieldLabel>Logo Upload</FieldLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left transition-all active:scale-[0.99]"
                style={textInputStyle}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0"
                    style={{ background: accentTint, color: heading }}
                  >
                    <Upload className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium" style={{ color: logoFile ? 'var(--advertisement-title)' : muted }}>
                      {logoFile ? logoFile.name : 'Logo'}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: muted }}>
                      JPG, PNG, or WebP
                    </p>
                  </div>
                </div>
                <span className="text-xs font-bold" style={{ color: heading }}>
                  Choose
                </span>
              </button>
            </div>

            <div>
              <FieldLabel>Description</FieldLabel>
              <textarea
                value={form.description}
                onChange={handleChange('description')}
                onFocus={() => setIsFocused('description')}
                onBlur={() => setIsFocused('')}
                rows={5}
                className="resize-none px-4 py-4 font-medium placeholder:font-medium"
                style={{
                  ...textInputStyle,
                  borderColor: isFocused === 'description' ? 'var(--app-button-icon)' : panelBorder,
                  boxShadow: isFocused === 'description'
                    ? `0 0 0 3px ${applyOpacity(theme.primary || '#d4a017', 0.18)}, 0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)`
                    : textInputStyle.boxShadow,
                }}
              />
              <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: muted }}>
                <span>{form.description.length}/240</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!hasTrustName || !hasType || submitting || isNameTaken}
              className="w-full rounded-[20px] px-5 py-4 text-sm font-extrabold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                color: 'var(--app-button-text)',
                background: 'var(--app-button-bg)',
                boxShadow: '0 16px 34px color-mix(in srgb, var(--app-button-icon) 22%, transparent)',
              }}
            >
              {submitting ? 'Launching...' : 'Launch'}
            </button>
          </form>
        </section>

      </div>

      {submitError && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSubmitError('')}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border p-6 text-center"
            style={{ background: cardBg, borderColor: panelBorder, boxShadow: '0 20px 44px rgba(0,0,0,0.4)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--brand-red) 16%, transparent)', color: 'var(--brand-red)' }}
            >
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h3 className="text-base font-extrabold" style={{ color: heading }}>
              {/already exists/i.test(submitError) ? 'Name already in use' : 'Something went wrong'}
            </h3>
            <p className="mt-2 text-sm" style={{ color: muted }}>
              {submitError}
            </p>
            <button
              type="button"
              onClick={() => setSubmitError('')}
              className="mt-5 w-full rounded-2xl px-5 py-3 text-sm font-extrabold transition-all active:scale-[0.99]"
              style={{ color: 'var(--app-button-text)', background: 'var(--app-button-bg)' }}
            >
              {/already exists/i.test(submitError) ? 'Choose Another Name' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {launching && (
        <div
          className="tenant-launch-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden px-6"
          style={{ background: pageShellBg }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 38%, var(--app-accent-bg), transparent 62%)', opacity: 0.45 }}
          />

          {LAUNCH_STARS.map((star, index) => (
            <span
              key={index}
              className="tenant-star"
              style={{
                top: star.top,
                left: star.left,
                width: star.size,
                height: star.size,
                background: heading,
                animationDelay: star.delay,
                animationDuration: star.duration,
              }}
            />
          ))}

          <div key={launchCycle} className="tenant-launch-content relative flex flex-col items-center">
            <div className="relative flex h-40 w-40 items-center justify-center">
              <div
                className="tenant-orbit-ring tenant-orbit-ring--inner absolute inset-0 rounded-full"
                style={{ borderColor: `color-mix(in srgb, ${heading} 28%, transparent)` }}
              />
              <div
                className="tenant-orbit-ring tenant-orbit-ring--outer absolute rounded-full"
                style={{ inset: '-14px', borderColor: `color-mix(in srgb, ${heading} 14%, transparent)` }}
              />
              <div
                className="absolute h-20 w-20 rounded-full"
                style={{ background: 'var(--app-accent-bg)', opacity: 0.35, filter: 'blur(22px)' }}
              />

              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '0s' }} />
              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '0.5s' }} />
              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '1s' }} />

              <div className="tenant-rocket-wrap relative">
                <div
                  className="tenant-rocket-flame absolute"
                  style={{ background: 'linear-gradient(180deg, #ffd27a, #ff8a3d 55%, transparent)' }}
                />
                <div
                  className="tenant-rocket-trail absolute"
                  style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${heading} 65%, transparent), transparent)` }}
                />
                <Rocket className="tenant-rocket-fly relative h-14 w-14" style={{ color: heading }} />
              </div>
            </div>

            <p className="mt-8 text-center text-lg font-extrabold" style={{ color: heading }}>
              Launching {form.trustName || 'your app'}
              <span className="tenant-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
            </p>

            <div className="tenant-status-stack relative mt-2 h-5 w-64 text-center text-sm" style={{ color: muted }}>
              <span className="tenant-status-line tenant-status-line--1">Setting things up...</span>
              <span className="tenant-status-line tenant-status-line--2">Preparing your workspace...</span>
              <span className="tenant-status-line tenant-status-line--3">Configuring your community...</span>
              <span className="tenant-status-line tenant-status-line--4">Almost there...</span>
            </div>

            <div className="tenant-progress-track mt-6" style={{ background: `color-mix(in srgb, ${heading} 14%, transparent)` }}>
              <div className="tenant-progress-fill" style={{ background: 'var(--app-button-bg)' }} />
            </div>
          </div>

          <style>{`
            @keyframes tenantOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes tenantContentIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
            @keyframes tenantRocketFly {
              0%, 100% { transform: translateY(10px) rotate(-45deg); }
              50% { transform: translateY(-22px) rotate(-42deg); }
            }
            @keyframes tenantOrbitSpin { to { transform: rotate(360deg); } }
            @keyframes tenantOrbitSpinReverse { to { transform: rotate(-360deg); } }
            @keyframes tenantTrailPulse {
              0%, 100% { opacity: 0.35; transform: scaleY(0.6); }
              50% { opacity: 0.9; transform: scaleY(1); }
            }
            @keyframes tenantFlamePulse {
              0%, 100% { opacity: 0.6; transform: scale(0.85); }
              50% { opacity: 1; transform: scale(1.15); }
            }
            @keyframes tenantSmokeRise {
              0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
              20% { opacity: 0.7; }
              100% { opacity: 0; transform: translate(var(--smoke-x, 14px), 46px) scale(1.4); }
            }
            @keyframes tenantStarTwinkle {
              0%, 100% { opacity: 0.15; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1.2); }
            }
            @keyframes tenantDotBlink {
              0%, 80%, 100% { opacity: 0.2; }
              40% { opacity: 1; }
            }
            @keyframes tenantProgressFill {
              from { width: 4%; }
              to { width: 96%; }
            }
            @keyframes tenantStatusCycle1 {
              0%, 20% { opacity: 1; transform: translateY(0); }
              25%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle2 {
              0%, 20% { opacity: 0; transform: translateY(6px); }
              25%, 45% { opacity: 1; transform: translateY(0); }
              50%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle3 {
              0%, 50% { opacity: 0; transform: translateY(6px); }
              55%, 75% { opacity: 1; transform: translateY(0); }
              80%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle4 {
              0%, 80% { opacity: 0; transform: translateY(6px); }
              85%, 100% { opacity: 1; transform: translateY(0); }
            }
            .tenant-launch-overlay { animation: tenantOverlayIn 0.25s ease-out; }
            .tenant-launch-content { animation: tenantContentIn 0.35s ease-out; }
            .tenant-orbit-ring { border: 1.5px dashed; animation: tenantOrbitSpin 6s linear infinite; }
            .tenant-orbit-ring--outer { border-style: dotted; animation: tenantOrbitSpinReverse 10s linear infinite; }
            .tenant-rocket-wrap { animation: tenantRocketFly 1.6s ease-in-out infinite; }
            .tenant-rocket-fly { display: block; }
            .tenant-rocket-flame {
              width: 8px;
              height: 20px;
              left: 50%;
              bottom: 28%;
              margin-left: -4px;
              border-radius: 999px;
              filter: blur(3px);
              transform-origin: top center;
              animation: tenantFlamePulse 0.5s ease-in-out infinite;
            }
            .tenant-rocket-trail {
              width: 10px;
              height: 34px;
              left: 50%;
              bottom: 26%;
              margin-left: -5px;
              border-radius: 999px;
              filter: blur(2px);
              animation: tenantTrailPulse 1.6s ease-in-out infinite;
            }
            .tenant-smoke {
              position: absolute;
              left: 50%;
              bottom: 22%;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              filter: blur(3px);
              animation: tenantSmokeRise 2.4s ease-out infinite;
            }
            .tenant-star {
              position: absolute;
              border-radius: 50%;
              animation-name: tenantStarTwinkle;
              animation-timing-function: ease-in-out;
              animation-iteration-count: infinite;
            }
            .tenant-dots span {
              display: inline-block;
              animation: tenantDotBlink 1.2s infinite;
            }
            .tenant-dots span:nth-child(2) { animation-delay: 0.2s; }
            .tenant-dots span:nth-child(3) { animation-delay: 0.4s; }
            .tenant-status-stack { display: grid; }
            .tenant-status-line {
              grid-area: 1 / 1;
              opacity: 0;
              animation-duration: ${LAUNCH_ANIMATION_MS}ms;
              animation-timing-function: ease-in-out;
              animation-iteration-count: 1;
              animation-fill-mode: forwards;
            }
            .tenant-status-line--1 { animation-name: tenantStatusCycle1; }
            .tenant-status-line--2 { animation-name: tenantStatusCycle2; }
            .tenant-status-line--3 { animation-name: tenantStatusCycle3; }
            .tenant-status-line--4 { animation-name: tenantStatusCycle4; }
            .tenant-progress-track {
              position: relative;
              width: 200px;
              height: 5px;
              border-radius: 999px;
              overflow: hidden;
            }
            .tenant-progress-fill {
              position: absolute;
              inset: 0;
              width: 4%;
              border-radius: 999px;
              animation: tenantProgressFill ${LAUNCH_ANIMATION_MS}ms ease-out forwards;
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export const AddCommunityContent = () => <AddCommunity variant="home" />;

export default AddCommunity;
