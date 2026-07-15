import React, { useEffect, useState } from 'react';
import { ChevronLeft, Mail, PhoneCall, QrCode, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { fetchDonationMembersByTrust, getDonationFormPrefill } from './services/donationService';
import { TRUST_VERSION_UPDATED_EVENT } from './services/trustVersionService';

const DonationForm = () => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const [prefill, setPrefill] = useState(() => getDonationFormPrefill());
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDonationMembers = async () => {
    const nextPrefill = getDonationFormPrefill();
    setPrefill(nextPrefill);

    if (!nextPrefill.trustId) {
      setMembers([]);
      setError('Selected trust not found.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const rows = await fetchDonationMembersByTrust(nextPrefill.trustId);
      setMembers(rows);
    } catch (err) {
      setMembers([]);
      setError(err?.message || 'Unable to load donation details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDonationMembers();

    const handleTrustChange = () => {
      loadDonationMembers();
    };
    const handleTrustVersionUpdated = (event) => {
      const changedTrustId = String(event?.detail?.trustId || '').trim();
      const selectedTrustId = String(localStorage.getItem('selected_trust_id') || '').trim();
      if (!changedTrustId || changedTrustId !== selectedTrustId) return;
      loadDonationMembers();
    };

    window.addEventListener('trust-changed', handleTrustChange);
    window.addEventListener(TRUST_VERSION_UPDATED_EVENT, handleTrustVersionUpdated);
    return () => {
      window.removeEventListener('trust-changed', handleTrustChange);
      window.removeEventListener(TRUST_VERSION_UPDATED_EVENT, handleTrustVersionUpdated);
    };
  }, []);

  return (
    <div
      className="min-h-screen pb-8"
      style={{
        background: 'var(--page-bg, var(--app-page-bg))',
        color: 'var(--advertisement-description)',
      }}
    >
      <div
        className="theme-navbar border-b px-6 py-5 flex items-center justify-between sticky top-0 z-40 shadow-sm"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/donation')}
            className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
            style={{ background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.65)}, ${theme.accentBg})` }}
          >
            <ChevronLeft className="h-5 w-5" style={{ color: theme.primary }} />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
              Donation
            </p>
            <h1 className="text-lg font-extrabold truncate" style={{ color: 'var(--navbar-text)' }}>
              Donation Details
            </h1>
          </div>
        </div>

        <button
          onClick={() => navigate('/donation')}
          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: applyOpacity(theme.primary, 0.08), color: theme.primary }}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-5 pt-5">
        <div
          className="rounded-[30px] px-5 py-5"
          style={{
            background: 'var(--advertisement-card-bg)',
            border: '1px solid var(--advertisement-card-border)',
            boxShadow: `0 20px 48px ${applyOpacity('#000', 0.12)}`,
          }}
        >
          {loading ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 80%, var(--page-bg))', color: 'var(--advertisement-description)' }}>
              Loading donation details...
            </div>
          ) : error ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: applyOpacity('#ef4444', 0.08), color: '#b91c1c' }}>
              {error}
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-[24px] p-5 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 80%, var(--page-bg))', color: 'var(--advertisement-description)' }}>
              No donation member details found for this trust.
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="rounded-[22px] p-4 text-sm leading-6"
                style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 82%, var(--page-bg))', color: 'var(--advertisement-description)', border: '1px solid var(--advertisement-card-border)' }}
              >
                Selected Trust: <span className="font-extrabold" style={{ color: 'var(--advertisement-title)' }}>{prefill.trustName}</span>
              </div>

              {members.map((member) => (
                <div
                  key={member.id}
                  className="rounded-[22px] p-4"
                  style={{
                    background: 'color-mix(in srgb, var(--advertisement-card-bg) 82%, var(--page-bg))',
                    color: 'var(--advertisement-description)',
                    border: '1px solid var(--advertisement-card-border)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <UserRound className="h-4 w-4" style={{ color: theme.primary }} />
                    <p className="text-sm font-extrabold" style={{ color: 'var(--advertisement-title)' }}>{member.name || '-'}</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <PhoneCall className="h-4 w-4" style={{ color: theme.primary }} />
                      <a href={`tel:${member.mobile || ''}`} style={{ color: 'var(--advertisement-description)' }}>
                        {member.mobile || '-'}
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4" style={{ color: theme.primary }} />
                      <span style={{ color: 'var(--advertisement-description)' }}>{member.email_id || '-'}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <QrCode className="h-4 w-4 mt-0.5" style={{ color: theme.primary }} />
                      <div className="min-w-0">
                        {String(member.qr || '').trim() ? (
                          <img
                            src={member.qr}
                            alt={`${member.name || 'Member'} QR`}
                            className="w-28 h-28 rounded-xl object-cover border"
                            style={{ borderColor: applyOpacity(theme.primary, 0.2) }}
                          />
                        ) : (
                          <span style={{ color: 'var(--advertisement-subtitle)' }}>Not available</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DonationForm;
