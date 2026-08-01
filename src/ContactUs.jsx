import React, { useEffect, useState } from 'react';
import { ChevronLeft, Mail, PhoneCall, UserRound } from 'lucide-react';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { clearContactTrustCache, fetchContactTrustRows } from './services/contactTrustService';
import { fetchTrustById } from './services/trustService';

const ContactUs = ({ onNavigateBack }) => {
  const theme = useAppTheme();
  const [trustName, setTrustName] = useState(localStorage.getItem('selected_trust_name') || 'Trust');
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async (force = false) => {
      const trustId = localStorage.getItem('selected_trust_id') || '';
      const fallbackName = localStorage.getItem('selected_trust_name') || 'Trust';
      if (!active) return;

      if (!trustId) {
        setTrustName(fallbackName);
        setContacts([]);
        setError('Selected trust not found.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        const [trust, rows] = await Promise.all([
          fetchTrustById(trustId).catch(() => null),
          fetchContactTrustRows(trustId, { force }),
        ]);

        if (!active) return;
        setTrustName(trust?.name || fallbackName);
        setContacts(rows);
      } catch (err) {
        if (!active) return;
        console.error('[ContactUs] Failed to load trust contacts:', err);
        setContacts([]);
        setError('Unable to load contact details.');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    const handleTrustChange = (event) => {
      const nextTrustId = event?.detail?.trustId || localStorage.getItem('selected_trust_id') || null;
      const nextName = event?.detail?.trustName || localStorage.getItem('selected_trust_name') || 'Trust';
      if (nextTrustId) clearContactTrustCache(nextTrustId);
      setTrustName(nextName);
      load(true);
    };

    window.addEventListener('trust-changed', handleTrustChange);

    return () => {
      active = false;
      window.removeEventListener('trust-changed', handleTrustChange);
    };
  }, []);

  const buildWhatsAppHref = (contact) => {
    const rawNumber = String(contact?.whatsapp_number || contact?.contact_number || '').replace(/\D/g, '');
    if (!rawNumber) return '';
    let user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      user = {};
    }
    const memberName = String(user?.Name || user?.name || 'Unknown Member').trim();
    const membershipNumber = String(
      user?.['Membership number'] || user?.membership_number || user?.membershipNumber || 'N/A'
    ).trim();
    const memberRole = String(user?.role || user?.type || 'Member').trim();
    const appSourceName = String(trustName || 'this app').trim();
    const message = [
      `Hello ${contact?.contact_person || 'Team'},`,
      '',
      `This message has come through ${appSourceName}.`,
      '',
      `Name: ${memberName}`,
      `Membership Number: ${membershipNumber}`,
      `Role: ${memberRole}`,
      '',
      `This member has enquired regarding ${contact?.facility_name || 'this contact point'}.`,
    ].join('\n');
    return `https://wa.me/${rawNumber}?text=${encodeURIComponent(message)}`;
  };

  return (
    <div
      className="min-h-screen pb-8"
      style={{
        background: 'var(--page-bg, var(--app-page-bg))',
        color: 'var(--advertisement-description)',
      }}
    >
      <div
        className="theme-navbar border-b px-6 py-5 flex items-center sticky top-0 z-40 shadow-sm"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateBack}
            className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-all"
            style={{ background: `linear-gradient(135deg, ${applyOpacity(theme.accent, 0.65)}, ${theme.accentBg})` }}
          >
            <ChevronLeft className="h-5 w-5" style={{ color: theme.primary }} />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: theme.primary }}>
              Contact Us
            </p>
            <h1 className="text-lg font-extrabold truncate" style={{ color: 'var(--navbar-text)' }}>
              {trustName}
            </h1>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {error ? (
          <div
            className="rounded-3xl px-5 py-6"
            style={{
              background: `linear-gradient(135deg, ${applyOpacity('#ef4444', 0.08)}, ${applyOpacity(theme.accentBg, 0.9)})`,
              border: `1px solid ${applyOpacity('#ef4444', 0.18)}`,
            }}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--advertisement-description)' }}>{error}</p>
          </div>
        ) : contacts.length === 0 ? (
          <div
            className="rounded-3xl px-5 py-8 text-center"
            style={{
              background: 'var(--advertisement-card-bg)',
              border: `1px solid ${applyOpacity(theme.primary, 0.08)}`,
            }}
          >
            <p className="text-base font-bold" style={{ color: 'var(--advertisement-description)' }}>
              No contact details found
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="relative rounded-[28px] p-5"
                style={{
                  background: 'var(--advertisement-card-bg)',
                  border: '1px solid var(--advertisement-card-border)',
                  boxShadow: `0 10px 28px ${applyOpacity(theme.secondary, 0.08)}`,
                }}
              >
                {buildWhatsAppHref(contact) ? (
                  <a
                    href={buildWhatsAppHref(contact)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open WhatsApp"
                    className="absolute top-4 right-4 w-10 h-10 rounded-2xl flex items-center justify-center transition-transform active:scale-95"
                    style={{
                      background: '#25D366',
                      boxShadow: '0 6px 18px rgba(37, 211, 102, 0.28)',
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-white">
                      <path d="M20.52 3.48A11.79 11.79 0 0 0 12.06 0C5.38 0 .15 5.23.15 11.9c0 2.13.56 4.2 1.62 6.01L0 24l6.29-1.7a11.86 11.86 0 0 0 5.77 1.48h.01c6.67 0 11.9-5.23 11.9-11.9 0-3.23-1.26-6.27-3.45-8.4Zm-8.46 18.3a9.86 9.86 0 0 1-5.02-1.38l-.36-.21-3.73 1.01 1-3.63-.23-.37a9.82 9.82 0 0 1-1.5-5.25C2.22 6.47 6.5 2.2 12.06 2.2a9.67 9.67 0 0 1 6.92 2.87 9.67 9.67 0 0 1 2.86 6.83c0 5.56-4.28 9.88-9.78 9.88Zm5.7-7.57c-.31-.16-1.83-.9-2.11-1.01-.28-.1-.49-.16-.7.16-.21.31-.8 1.01-.98 1.22-.18.21-.36.23-.67.08-.31-.16-1.3-.48-2.48-1.54-.91-.81-1.52-1.82-1.7-2.13-.18-.31-.02-.48.13-.64.13-.13.31-.36.47-.54.16-.18.21-.31.31-.52.1-.21.05-.39-.02-.54-.08-.16-.7-1.68-.96-2.3-.25-.6-.5-.51-.7-.52-.18-.01-.39-.01-.6-.01-.21 0-.54.08-.83.39-.28.31-1.1 1.08-1.1 2.64 0 1.56 1.14 3.06 1.3 3.27.16.21 2.21 3.37 5.35 4.73.75.33 1.33.53 1.79.68.75.24 1.43.21 1.97.13.6-.09 1.83-.75 2.09-1.48.26-.73.26-1.34.18-1.47-.08-.13-.28-.21-.59-.37Z" />
                    </svg>
                  </a>
                ) : null}

                <div className="mb-4">
                  <p className="text-lg font-extrabold" style={{ color: 'var(--advertisement-title)' }}>
                    {contact.facility_name}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: theme.primary }}>
                    Contact Point
                  </p>
                </div>

                <div className="space-y-3">
                  {contact.contact_person && (
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: applyOpacity(theme.primary, 0.1) }}>
                        <UserRound className="h-5 w-5" style={{ color: theme.primary }} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>Contact Person</p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>{contact.contact_person}</p>
                      </div>
                    </div>
                  )}

                  {contact.contact_number && (
                    <a
                      href={`tel:${contact.contact_number}`}
                      className="flex items-start gap-3 rounded-2xl p-3 transition-all"
                      style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 78%, var(--app-page-bg))' }}
                    >
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: applyOpacity(theme.primary, 0.1) }}>
                        <PhoneCall className="h-5 w-5" style={{ color: theme.primary }} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>Phone</p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>{contact.contact_number}</p>
                      </div>
                    </a>
                  )}

                  {contact.email_id && (
                    <a
                      href={`mailto:${contact.email_id}`}
                      className="flex items-start gap-3 rounded-2xl p-3 transition-all"
                      style={{ background: 'color-mix(in srgb, var(--advertisement-card-bg) 78%, var(--app-page-bg))' }}
                    >
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: applyOpacity(theme.primary, 0.1) }}>
                        <Mail className="h-5 w-5" style={{ color: theme.primary }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>Email</p>
                        <p className="text-sm font-semibold break-all" style={{ color: 'var(--advertisement-description)' }}>{contact.email_id}</p>
                      </div>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContactUs;
