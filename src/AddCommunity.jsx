import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Home as HomeIcon, Menu, Rocket, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import Sidebar from './features/sidebar/Sidebar';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import { fetchFeatureFlags } from './services/featureFlags';

const DEFAULT_PAGE_TITLE = 'Add Community';

// shareApp_links.web_app_url is a full URL (e.g. https://www.teiltd.in/<slug>)
// generated asynchronously by the generate-webApp-link Edge Function once
// create_trust_via_whatsapp's Trust insert trigger fires it — so it isn't
// guaranteed to exist the instant the RPC call returns. We only need the
// slug itself (we build the in-app /app/<slug> path ourselves), so just take
// the last path segment regardless of the URL's exact host/prefix.
const extractSlugFromWebAppUrl = (url) => {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.split('/').pop() || '';
};

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

const pollForAppSlug = async (supabase, trustId, { attempts = 5, intervalMs = 1000 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { data } = await supabase
        .from('shareApp_links')
        .select('web_app_url')
        .eq('trust_id', trustId)
        .maybeSingle();
      const slug = extractSlugFromWebAppUrl(data?.web_app_url);
      if (slug) return slug;
    } catch {
      // ignore and retry — link generation may still be in flight
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return '';
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

const AddCommunity = ({ onNavigateBack }) => {
  const navigate = useNavigate();
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
        if (displayName) setPageTitle(displayName);
      } catch (err) {
        console.warn('[AddCommunity] Failed to load feature flag display name:', err?.message || err);
      }
    })();
    return () => { active = false; };
  }, []);

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
    const { supabase } = await import('./services/supabaseClient.js');
    let nextTrustId = '';
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
        let uploadedIconUrl = null;

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

        localStorage.setItem('selected_trust_id', nextTrustId);
        localStorage.setItem('selected_trust_name', trustName);
        window.dispatchEvent(new CustomEvent('trust-changed', {
          detail: {
            trustId: nextTrustId,
            trustName,
            iconUrl: uploadedIconUrl || null,
          }
        }));
      }
    } catch (error) {
      setSubmitError(getFriendlySubmitError(error, trustName));
      setSubmitting(false);
      return;
    }

    setSubmitting(false);

    if (!nextTrustId) {
      setSubmitError('Trust was created but could not be confirmed. Please check again.');
      return;
    }

    // Show the launch animation while generate-webApp-link (fired
    // asynchronously by the Trust insert trigger) finishes writing the
    // app_slug / shareApp_links row, then land the user on their new
    // tenant app at /app/<slug> instead of leaving them on this form.
    setLaunching(true);
    const slug = await pollForAppSlug(supabase, nextTrustId);
    navigate(slug ? `/app/${slug}` : getAppHomePath(), { replace: true });
  };

  const hasTrustName = String(form.trustName || '').trim().length > 0;
  const isNameTaken = nameCheck.status === 'taken' && nameCheck.checkedValue === form.trustName.trim();
  useEffect(() => {
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  return (
    <div className="min-h-screen" style={{ background: pageShellBg, color: 'var(--body-text-color)' }}>
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

      <div className="px-4 pt-5 pb-10 space-y-5">
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
                placeholder="e.g. Sunrise Healthcare"
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
                placeholder="e.g. Sunrise Healthcare Trust Foundation"
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
              <FieldLabel>Type</FieldLabel>
              <div className="relative">
                <select
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
              <FieldLabel>Icon/Logo Upload</FieldLabel>
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
                      {logoFile ? logoFile.name : 'Upload community logo'}
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
                placeholder="e.g. A non-profit organization focused on healthcare, support, and meaningful community growth."
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
                <span>Keep it crisp and trust-friendly.</span>
                <span>{form.description.length}/240</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!hasTrustName || submitting || isNameTaken}
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
            style={{ background: 'radial-gradient(circle at 50% 42%, var(--app-accent-bg), transparent 60%)', opacity: 0.5 }}
          />
          <span className="tenant-star" style={{ top: '18%', left: '22%', background: heading, animationDelay: '0s' }} />
          <span className="tenant-star" style={{ top: '28%', left: '76%', background: heading, animationDelay: '0.5s' }} />
          <span className="tenant-star" style={{ top: '64%', left: '16%', background: heading, animationDelay: '0.9s' }} />
          <span className="tenant-star" style={{ top: '70%', left: '80%', background: heading, animationDelay: '1.3s' }} />
          <span className="tenant-star" style={{ top: '40%', left: '50%', background: heading, animationDelay: '0.3s' }} />

          <div className="tenant-launch-content relative flex flex-col items-center">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <div
                className="tenant-orbit-ring absolute inset-0 rounded-full"
                style={{ borderColor: `color-mix(in srgb, ${heading} 30%, transparent)` }}
              />
              <div
                className="absolute h-16 w-16 rounded-full"
                style={{ background: 'var(--app-accent-bg)', opacity: 0.35, filter: 'blur(18px)' }}
              />
              <div
                className="tenant-rocket-trail absolute"
                style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${heading} 55%, transparent), transparent)` }}
              />
              <Rocket className="tenant-rocket-fly relative h-12 w-12" style={{ color: heading }} />
            </div>

            <p className="mt-7 text-center text-lg font-extrabold" style={{ color: heading }}>
              Launching {form.trustName || 'your app'}
              <span className="tenant-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
            </p>
            <p className="mt-2 text-center text-sm" style={{ color: muted }}>
              Setting things up, almost there.
            </p>

            <div className="tenant-progress-track mt-5" style={{ background: `color-mix(in srgb, ${heading} 14%, transparent)` }}>
              <div className="tenant-progress-bar" style={{ background: 'var(--app-button-bg)' }} />
            </div>
          </div>

          <style>{`
            @keyframes tenantOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes tenantContentIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
            @keyframes tenantRocketFly {
              0%, 100% { transform: translateY(8px) rotate(-45deg); }
              50% { transform: translateY(-16px) rotate(-45deg); }
            }
            @keyframes tenantOrbitSpin { to { transform: rotate(360deg); } }
            @keyframes tenantTrailPulse {
              0%, 100% { opacity: 0.35; transform: scaleY(0.6); }
              50% { opacity: 0.85; transform: scaleY(1); }
            }
            @keyframes tenantStarTwinkle {
              0%, 100% { opacity: 0.15; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1.2); }
            }
            @keyframes tenantDotBlink {
              0%, 80%, 100% { opacity: 0.2; }
              40% { opacity: 1; }
            }
            @keyframes tenantProgressSlide {
              0% { transform: translateX(-110%); }
              100% { transform: translateX(240%); }
            }
            .tenant-launch-overlay { animation: tenantOverlayIn 0.25s ease-out; }
            .tenant-launch-content { animation: tenantContentIn 0.35s ease-out; }
            .tenant-orbit-ring { border: 1.5px dashed; animation: tenantOrbitSpin 6s linear infinite; }
            .tenant-rocket-fly { animation: tenantRocketFly 1.4s ease-in-out infinite; }
            .tenant-rocket-trail {
              width: 10px;
              height: 30px;
              left: 50%;
              bottom: 30%;
              margin-left: -5px;
              border-radius: 999px;
              filter: blur(2px);
              animation: tenantTrailPulse 1.4s ease-in-out infinite;
            }
            .tenant-star {
              position: absolute;
              width: 4px;
              height: 4px;
              border-radius: 50%;
              animation: tenantStarTwinkle 2.2s ease-in-out infinite;
            }
            .tenant-dots span {
              display: inline-block;
              animation: tenantDotBlink 1.2s infinite;
            }
            .tenant-dots span:nth-child(2) { animation-delay: 0.2s; }
            .tenant-dots span:nth-child(3) { animation-delay: 0.4s; }
            .tenant-progress-track {
              position: relative;
              width: 160px;
              height: 4px;
              border-radius: 999px;
              overflow: hidden;
            }
            .tenant-progress-bar {
              position: absolute;
              inset: 0;
              width: 40%;
              border-radius: 999px;
              animation: tenantProgressSlide 1.1s ease-in-out infinite;
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default AddCommunity;
