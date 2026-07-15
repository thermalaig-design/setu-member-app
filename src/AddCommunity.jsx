import React, { useEffect, useRef, useState } from 'react';
import { Home as HomeIcon, Menu, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import Sidebar from './components/Sidebar';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';
import { applyOpacity } from './utils/colorUtils';

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
  });
  const [isFocused, setIsFocused] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
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
    navigate('/');
  };

  const handleChange = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

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
    setSubmitSuccess('');

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

    const membersId = String(
      parsedUser?.members_id
      || parsedUser?.member_id
      || parsedUser?.id
      || ''
    ).trim();

    if (!membersId) {
      setSubmitError('Member identity not found. Please login again and retry.');
      return;
    }

    setSubmitting(true);
    try {
      const { supabase } = await import('./services/supabaseClient.js');
      const { data, error } = await supabase.rpc('create_trust_from_member', {
        p_members_id: membersId,
        p_trust_name: trustName,
        p_secret_code: 0,
      });

      if (error) throw error;

      const nextTrustId = String(data || '').trim();
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

      setSubmitSuccess('Trust created successfully.');
      setForm({
        trustName: '',
        legalName: '',
        description: '',
      });
      setLogoFile(null);
      setLogoPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return '';
      });
    } catch (error) {
      setSubmitError(error?.message || 'Failed to create trust. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasTrustName = String(form.trustName || '').trim().length > 0;
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
          Add Community
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
          <div className="mb-5">
            <h2 className="text-xl font-extrabold" style={{ color: heading }}>
              Create Your Community
            </h2>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <FieldLabel required>Trust Name</FieldLabel>
              <input
                type="text"
                value={form.trustName}
                onChange={handleChange('trustName')}
                onFocus={() => setIsFocused('trustName')}
                onBlur={() => setIsFocused('')}
                placeholder="e.g. Sunrise Healthcare"
                className="px-4 py-4 font-semibold placeholder:font-medium"
                style={{
                  ...textInputStyle,
                  borderColor: isFocused === 'trustName' ? 'var(--app-button-icon)' : panelBorder,
                  boxShadow: isFocused === 'trustName'
                    ? `0 0 0 3px ${applyOpacity(theme.primary || '#d4a017', 0.18)}, 0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)`
                    : textInputStyle.boxShadow,
                }}
              />
            </div>

            <div>
              <FieldLabel>Legal Name</FieldLabel>
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
              disabled={!hasTrustName || submitting}
              className="w-full rounded-[20px] px-5 py-4 text-sm font-extrabold transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                color: 'var(--app-button-text)',
                background: 'var(--app-button-bg)',
                boxShadow: '0 16px 34px color-mix(in srgb, var(--app-button-icon) 22%, transparent)',
              }}
            >
              {submitting ? 'Creating Trust...' : 'Create Trust'}
            </button>

            {submitError ? (
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-red)' }}>
                {submitError}
              </p>
            ) : null}

            {submitSuccess ? (
              <p className="text-sm font-semibold" style={{ color: heading }}>
                {submitSuccess}
              </p>
            ) : null}
          </form>
        </section>

      </div>
    </div>
  );
};

export default AddCommunity;
