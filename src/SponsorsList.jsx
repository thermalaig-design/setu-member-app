import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, Star } from 'lucide-react';
import { fetchTrustById } from './services/trustService';
import {
  buildOrderedSponsors,
  ensureAllSponsorsLoaded,
  setPinnedSponsor,
  setSelectedSponsorId
} from './services/sponsorStore';
import { useAppTheme } from './context/ThemeContext';

const SponsorsList = ({ onNavigate, onBack }) => {
  const theme = useAppTheme();
  const selectedTrustId = localStorage.getItem('selected_trust_id') || '';
  const hasTrust = Boolean(selectedTrustId);

  const [trustName, setTrustName] = useState(localStorage.getItem('selected_trust_name') || 'Trust Sponsors');
  const [items, setItems] = useState(() => (hasTrust ? buildOrderedSponsors(selectedTrustId) : []));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    if (!selectedTrustId) return;

    // Fetch trust name
    fetchTrustById(selectedTrustId).then((t) => {
      if (activeRef.current && t?.name) setTrustName(t.name);
    }).catch(() => {});

    const cached = buildOrderedSponsors(selectedTrustId);
    if (cached.length > 0) {
      setItems(cached);
      setIsRefreshing(true);
      ensureAllSponsorsLoaded(selectedTrustId, { force: true }).then((fresh) => {
        if (!activeRef.current) return;
        const data = Array.isArray(fresh) ? fresh : [];
        setItems(data.length > 0 ? buildOrderedSponsors(selectedTrustId) : []);
      }).catch(() => {}).finally(() => { if (activeRef.current) setIsRefreshing(false); });
      return;
    }

    setIsRefreshing(true);
    ensureAllSponsorsLoaded(selectedTrustId, { force: true }).then((fresh) => {
      if (!activeRef.current) return;
      const data = Array.isArray(fresh) ? fresh : [];
      setItems(data.length > 0 ? buildOrderedSponsors(selectedTrustId) : []);
    }).catch((err) => {
      console.error('[SponsorsList] fetch error:', err);
    }).finally(() => { if (activeRef.current) setIsRefreshing(false); });
  }, [selectedTrustId]);

  const list = useMemo(() => items, [items]);

  const openSponsor = (sponsor) => {
    if (!sponsor?.id) return;
    setSelectedSponsorId(sponsor.id);
    setPinnedSponsor(selectedTrustId, sponsor.id);
    onNavigate('sponsor-details');
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="theme-navbar backdrop-blur border-b px-5 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="p-2 rounded-xl transition-colors" style={{ background: 'color-mix(in srgb, var(--app-accent-bg) 45%, transparent)' }}>
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <div>
          <h1 className="text-lg font-extrabold" style={{ color: 'var(--navbar-text)' }}>Sponsors</h1>
          <p className="text-[11px] font-medium" style={{ color: 'var(--advertisement-subtitle)' }}>
            {trustName}{list.length > 0 ? ` · ${list.length} sponsors` : ''}
          </p>
        </div>
      </div>

      <div className="px-4 py-4">
        {list.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              {isRefreshing ? 'Refreshing sponsors...' : 'No active sponsors available'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((sponsor) => (
              <button
                key={sponsor.id}
                onClick={() => openSponsor(sponsor)}
                className="w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all active:scale-[0.985]"
                style={{
                  background: 'var(--advertisement-card-bg)',
                  border: '1px solid var(--advertisement-card-border)',
                  boxShadow: '0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)',
                }}
              >
                <div className="w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-slate-100 shadow-sm flex-shrink-0">
                  {(sponsor.photo_url || sponsor.photo_thumb_url) ? (
                    <img src={sponsor.photo_url || sponsor.photo_thumb_url} alt={sponsor.name} className="w-full h-full object-cover bg-white" style={{ objectPosition: '50% 20%' }} loading="lazy" />
                  ) : (
                    <Star className="h-4 w-4" style={{ color: theme.primary }} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold truncate" style={{ color: 'var(--advertisement-title)' }}>
                    {sponsor.name || sponsor.company_name || 'Sponsor'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                    <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: 'var(--advertisement-subtitle)' }} />
                    <p className="text-[10px] font-semibold truncate" style={{ color: 'var(--advertisement-subtitle)' }}>
                      {sponsor.company_name || sponsor.position || 'Community partner'}
                    </p>
                  </div>
                </div>
                <div
                  className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)` }}
                >
                  <ChevronRight className="h-3.5 w-3.5 text-white" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SponsorsList;



