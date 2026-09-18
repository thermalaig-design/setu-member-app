import React, { useEffect, useMemo, useState } from 'react';
import { Crown, HandHeart, Home as HomeIcon, IndianRupee, Menu, ShieldCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { fetchDonationsByTrust, getDonationFormPrefill } from './services/donationService';
import { TRUST_VERSION_UPDATED_EVENT } from './services/trustVersionService';
import Sidebar from './features/sidebar/Sidebar';
const formatCurrency = (amount) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(numeric);
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
};

const normalizeAttachment = (value) => {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
};

const normalizeAttachments = (attachments) => {
  if (Array.isArray(attachments)) {
    return attachments.map(normalizeAttachment).filter(Boolean);
  }
  if (typeof attachments === 'string') {
    const value = attachments.trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeAttachment).filter(Boolean);
      }
      if (parsed && typeof parsed === 'object') {
        const candidate = normalizeAttachment(parsed.url || parsed.public_url || parsed.path);
        return candidate ? [candidate] : [];
      }
    } catch {
      // not JSON, continue fallback
    }
    return value
      .split(',')
      .map((item) => normalizeAttachment(item))
      .filter(Boolean);
  }
  if (attachments && typeof attachments === 'object') {
    const candidate = normalizeAttachment(attachments.url || attachments.public_url || attachments.path);
    return candidate ? [candidate] : [];
  }
  return [];
};

export const DonationContent = ({ onNavigate, variant = 'page' }) => {
  const isPageVariant = variant === 'page';
  const theme = useAppTheme();
  const navigate = useNavigate();
  const [prefill, setPrefill] = useState(() => getDonationFormPrefill());
  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const loadDonationScreen = async () => {
    const nextPrefill = getDonationFormPrefill();
    setPrefill(nextPrefill);

    if (!nextPrefill.trustId) {
      setDonations([]);
      setError('Selected trust not found.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const rows = await fetchDonationsByTrust(nextPrefill.trustId);
      setDonations(rows);
    } catch (err) {
      setDonations([]);
      setError(err?.message || 'Unable to load donations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDonationScreen();

    const handleTrustChange = () => {
      loadDonationScreen();
    };

    const handleTrustVersionUpdated = (event) => {
      const changedTrustId = String(event?.detail?.trustId || '').trim();
      const selectedTrustId = String(localStorage.getItem('selected_trust_id') || '').trim();
      if (!changedTrustId || changedTrustId !== selectedTrustId) return;
      loadDonationScreen();
    };

    window.addEventListener('trust-changed', handleTrustChange);
    window.addEventListener(TRUST_VERSION_UPDATED_EVENT, handleTrustVersionUpdated);
    return () => {
      window.removeEventListener('trust-changed', handleTrustChange);
      window.removeEventListener(TRUST_VERSION_UPDATED_EVENT, handleTrustVersionUpdated);
    };
  }, []);

  const donationSummary = (row) => {
    const amountLabel = formatCurrency(row?.amount);
    const amountType = String(row?.amount_type || '').trim();
    if (amountLabel && amountType) return `${amountLabel} • ${amountType}`;
    if (amountLabel) return amountLabel;
    if (amountType) return amountType;
    return 'Open contribution';
  };

  const selectedDonation = useMemo(() => donations[0] || null, [donations]);

  const openDonationFormPage = (donation = null) => {
    const target = donation || selectedDonation || null;
    navigate('/donation-form', {
      state: {
        selectedDonationId: target?.id || '',
      },
    });
  };

  return (
    <div
      className={isPageVariant ? 'min-h-screen pb-8' : undefined}
      style={isPageVariant ? {
        background: 'var(--page-bg, var(--app-page-bg))',
        color: 'var(--advertisement-description)',
      } : undefined}
    >
      {isPageVariant && (
        <div
          className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}
        >
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
            style={{
              background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
            }}
          >
            {isMenuOpen ? <X className="h-[22px] w-[22px]" style={{ color: 'var(--navbar-text)' }} /> : <Menu className="h-[22px] w-[22px]" style={{ color: 'var(--navbar-text)' }} />}
          </button>
          <div className="min-w-0 text-center flex-1 px-3">
            <h1 className="text-lg font-extrabold truncate" style={{ color: 'var(--navbar-text)' }}>
              Donation
            </h1>
          </div>
          <button
            onClick={() => onNavigate?.('home')}
            className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
            style={{
              background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))',
            }}
          >
            <HomeIcon className="h-[22px] w-[22px]" style={{ color: 'var(--navbar-text)' }} />
          </button>
        </div>
      )}

      {isPageVariant && isMenuOpen && <div className="fixed inset-0 z-25" style={{ background: applyOpacity('var(--brand-navy-dark)', 0.12) }} onClick={() => setIsMenuOpen(false)} />}
      {isPageVariant && (
        <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="donation" />
      )}

      <div className={isPageVariant ? 'px-5 pt-5 space-y-5' : 'space-y-5'}>
        <section
          className="rounded-[22px] p-4"
          style={{
            background: `linear-gradient(145deg, ${applyOpacity(theme.secondary, 0.2)} 0%, ${applyOpacity(theme.primary, 0.16)} 100%)`,
            border: `1px solid ${applyOpacity(theme.primary, 0.24)}`,
            boxShadow: `0 14px 28px ${applyOpacity(theme.secondary, 0.14)}`,
          }}
        >
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--advertisement-description)' }}>
            Every contribution makes a real difference for our community.
          </p>
          <button
            onClick={() => openDonationFormPage()}
            className="w-full px-4 py-3 rounded-2xl text-sm font-extrabold active:scale-95 transition-all"
            style={{
              background: `linear-gradient(135deg, ${applyOpacity(theme.primary, 0.96)} 0%, ${applyOpacity(theme.secondary, 0.92)} 100%)`,
              color: '#fff',
              boxShadow: `0 12px 24px ${applyOpacity(theme.primary, 0.3)}`,
            }}
          >
            Donate Now, Spread Hope
          </button>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
                Donation Options
              </p>
              <h2 className="text-lg font-extrabold" style={{ color: 'var(--advertisement-title)' }}>
                Active Donations
              </h2>
            </div>
            <span
              className="px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: applyOpacity(theme.primary, 0.1), color: theme.primary }}
            >
              {donations.length} items
            </span>
          </div>

          {loading ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: 'var(--advertisement-card-bg)', color: 'var(--advertisement-description)', border: '1px solid var(--advertisement-card-border)' }}>
              Loading donations...
            </div>
          ) : error ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: applyOpacity('#ef4444', 0.08), color: '#b91c1c' }}>
              {error}
            </div>
          ) : donations.length === 0 ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: 'var(--advertisement-card-bg)', color: 'var(--advertisement-description)', border: '1px solid var(--advertisement-card-border)' }}>
              No donations found for this trust.
            </div>
          ) : (
            donations.map((row) => {
              const isVip = String(row?.type || '').trim().toLowerCase() === 'vip';
              const attachmentPreview = normalizeAttachments(row?.attachments).slice(0, 1);

              return (
                <div
                  key={row.id}
                  className="rounded-[26px] overflow-hidden"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: `1px solid ${isVip ? '#E0A11B' : 'var(--advertisement-card-border)'}`,
                    boxShadow: `0 14px 30px ${applyOpacity(theme.secondary, 0.12)}`,
                  }}
                >
                  <div style={{ height: '4px', background: isVip ? 'linear-gradient(90deg, #FFE7A3 0%, #F5B700 100%)' : `linear-gradient(90deg, ${theme.primary} 0%, ${theme.secondary} 100%)` }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold" style={{ color: 'var(--advertisement-title)' }}>
                          {row.name}
                        </h3>
                        <p className="text-xs mt-1 leading-5" style={{ color: 'var(--advertisement-description)' }}>
                          {row.description || 'Donation support entry'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-[0.12em]"
                          style={{
                            color: isVip ? '#8A5A00' : theme.primary,
                            background: isVip ? 'linear-gradient(135deg, #FFE7A3 0%, #FFD36A 52%, #F5B700 100%)' : applyOpacity(theme.primary, 0.1),
                            border: `1px solid ${isVip ? '#E0A11B' : applyOpacity(theme.primary, 0.15)}`,
                          }}
                        >
                          {isVip ? 'VIP' : (row.type || 'General')}
                        </span>
                        <span className="text-[11px] font-bold" style={{ color: theme.primary }}>
                          {formatDate(row.updated_at || row.created_at)}
                        </span>
                      </div>
                    </div>

                    {attachmentPreview.length > 0 ? (
                      <div
                        className="w-full mt-3 rounded-[20px] overflow-hidden aspect-[16/9]"
                        style={{ background: 'color-mix(in srgb, var(--brand-navy) 10%, var(--surface-color))' }}
                      >
                        <img
                          src={attachmentPreview[0]}
                          alt={row.name}
                          className="w-full h-full object-cover object-center"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3 mt-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <IndianRupee className="h-4 w-4 flex-shrink-0" style={{ color: theme.primary }} />
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--advertisement-description)' }}>
                          {donationSummary(row)}
                        </p>
                      </div>
                      <button
                        onClick={() => openDonationFormPage(row)}
                        className="px-4 py-2 rounded-2xl text-xs font-extrabold active:scale-95 transition-all"
                        style={{
                          background: `linear-gradient(135deg, ${applyOpacity(theme.primary, 0.88)} 0%, ${applyOpacity(theme.secondary, 0.82)} 100%)`,
                          color: '#fff',
                          boxShadow: `0 8px 18px ${applyOpacity(theme.primary, 0.25)}`,
                        }}
                      >
                        Select
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
};

const Donation = ({ onNavigate }) => <DonationContent onNavigate={onNavigate} variant="page" />;

export default Donation;
