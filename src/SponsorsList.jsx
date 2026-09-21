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

export const SponsorsContent = ({ onNavigate, onBack, variant = 'page' }) => {
  const isPageVariant = variant === 'page';
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
    <div className="sponsors-list-page min-h-screen" style={{ background: 'var(--page-bg, var(--app-page-bg))' }}>
      <div className="sponsors-list-navbar theme-navbar backdrop-blur border-b px-5 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={onBack} className="sponsors-list-back p-2 rounded-xl transition-colors" style={{ background: 'color-mix(in srgb, var(--app-accent-bg) 45%, transparent)' }}>
          <ArrowLeft className="h-5 w-5" style={{ color: 'var(--navbar-text)' }} />
        </button>
        <div className="sponsors-list-title">
          <h1 className="text-lg font-extrabold" style={{ color: 'var(--navbar-text)' }}>Sponsors</h1>
          <p className="text-[11px] font-medium" style={{ color: 'var(--advertisement-subtitle)' }}>
            {trustName}{list.length > 0 ? ` · ${list.length} sponsors` : ''}
          </p>
        </div>
      </div>

      <div className="sponsors-list-content px-4 py-4">
        {list.length === 0 ? (
          <div className="sponsors-list-empty rounded-2xl p-8 text-center" style={{ background: 'var(--advertisement-card-bg)', border: '1px solid var(--advertisement-card-border)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--advertisement-description)' }}>
              {isRefreshing ? 'Refreshing sponsors...' : 'No active sponsors available'}
            </p>
          </div>
        ) : (
          <div className="sponsors-list-stack space-y-2">
            {list.map((sponsor) => (
              <button
                key={sponsor.id}
                onClick={() => openSponsor(sponsor)}
                className="sponsors-list-card w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all active:scale-[0.985]"
                style={{
                  background: 'var(--advertisement-card-bg)',
                  border: '1px solid var(--advertisement-card-border)',
                  boxShadow: '0 10px 24px color-mix(in srgb, var(--advertisement-card-shadow) 28%, transparent)',
                }}
              >
                <div className="sponsors-list-avatar w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center bg-white border border-slate-100 shadow-sm flex-shrink-0">
                  {(sponsor.photo_url || sponsor.photo_thumb_url) ? (
                    <img src={sponsor.photo_url || sponsor.photo_thumb_url} alt={sponsor.name} className="w-full h-full object-cover bg-white" style={{ objectPosition: '50% 20%' }} loading="lazy" />
                  ) : (
                    <Star className="h-4 w-4" style={{ color: theme.primary }} />
                  )}
                </div>
                <div className="sponsors-list-meta min-w-0 flex-1">
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
                  className="sponsors-list-arrow w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)` }}
                >
                  <ChevronRight className="h-3.5 w-3.5 text-white" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @media (min-width: 1024px) {
          .sponsors-list-page {
            animation: sponsorsListPageIn 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .sponsors-list-navbar {
            min-height: 96px;
            padding: 24px 28px !important;
            animation: sponsorsListNavbarIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .sponsors-list-back {
            transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease !important;
          }

          .sponsors-list-back:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 22px color-mix(in srgb, var(--navbar-text) 12%, transparent);
          }

          .sponsors-list-title {
            opacity: 0;
            animation: sponsorsListTitleIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 120ms both;
          }

          .sponsors-list-content {
            padding: 20px clamp(20px, 2.4vw, 40px) 48px !important;
            animation: sponsorsListContentIn 560ms cubic-bezier(0.22, 1, 0.36, 1) 110ms both;
          }

          .sponsors-list-stack {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 16px;
            align-items: stretch;
          }

          .sponsors-list-card {
            position: relative;
            overflow: hidden;
            min-height: 230px;
            flex-direction: column;
            justify-content: flex-start;
            align-items: stretch;
            gap: 12px;
            padding: 16px !important;
            opacity: 0;
            transform: translateY(18px) scale(0.985);
            animation: sponsorsListCardIn 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
            transition:
              transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 240ms ease,
              border-color 240ms ease,
              filter 240ms ease !important;
            will-change: transform, opacity;
          }

          .sponsors-list-card:nth-child(1) { animation-delay: 180ms; }
          .sponsors-list-card:nth-child(2) { animation-delay: 250ms; }
          .sponsors-list-card:nth-child(3) { animation-delay: 320ms; }
          .sponsors-list-card:nth-child(4) { animation-delay: 390ms; }
          .sponsors-list-card:nth-child(5) { animation-delay: 460ms; }
          .sponsors-list-card:nth-child(6) { animation-delay: 530ms; }
          .sponsors-list-card:nth-child(7) { animation-delay: 600ms; }
          .sponsors-list-card:nth-child(8) { animation-delay: 670ms; }
          .sponsors-list-card:nth-child(9) { animation-delay: 740ms; }
          .sponsors-list-card:nth-child(10) { animation-delay: 810ms; }
          .sponsors-list-card:nth-child(n + 11) { animation-delay: 880ms; }

          .sponsors-list-card::after {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            border-radius: inherit;
            box-shadow:
              inset 0 0 0 1px color-mix(in srgb, var(--surface-color) 22%, transparent),
              inset 0 -36px 56px color-mix(in srgb, var(--brand-navy-dark) 10%, transparent);
            transition: opacity 240ms ease;
          }

          .sponsors-list-card::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            background:
              radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--surface-color) 34%, transparent), transparent 38%),
              linear-gradient(180deg, color-mix(in srgb, var(--advertisement-title) 14%, transparent), transparent 48%);
            transition: opacity 240ms ease;
          }

          .sponsors-list-card:hover {
            transform: translateY(-8px);
            filter: saturate(1.08) brightness(1.025);
            border-color: color-mix(in srgb, var(--advertisement-title) 58%, var(--advertisement-card-border)) !important;
            box-shadow:
              0 26px 54px color-mix(in srgb, var(--advertisement-card-shadow) 54%, transparent),
              0 8px 18px color-mix(in srgb, var(--advertisement-title) 18%, transparent),
              0 0 0 1px color-mix(in srgb, var(--advertisement-title) 24%, transparent),
              inset 0 1px 0 color-mix(in srgb, var(--surface-color) 38%, transparent) !important;
          }

          .sponsors-list-card:hover::after {
            opacity: 1;
          }

          .sponsors-list-card:hover::before {
            opacity: 1;
          }

          .sponsors-list-card .sponsors-list-avatar::after {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            border-radius: inherit;
            box-shadow: inset 0 0 0 0 color-mix(in srgb, var(--advertisement-title) 0%, transparent);
            transition: box-shadow 240ms ease;
          }

          .sponsors-list-avatar,
          .sponsors-list-avatar img,
          .sponsors-list-arrow {
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), filter 240ms ease, box-shadow 240ms ease;
          }

          .sponsors-list-avatar {
            position: relative;
            width: 100% !important;
            height: auto !important;
            aspect-ratio: 1 / 1;
            border-radius: 16px !important;
          }

          .sponsors-list-meta {
            width: 100%;
            text-align: left;
          }

          .sponsors-list-meta > p {
            font-size: 14px !important;
            line-height: 1.25;
            white-space: normal !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }

          .sponsors-list-meta > div {
            margin-top: 6px !important;
          }

          .sponsors-list-meta > div p {
            font-size: 11px !important;
            white-space: normal !important;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }

          .sponsors-list-arrow {
            position: absolute;
            right: 12px;
            bottom: 12px;
            width: 30px !important;
            height: 30px !important;
            border-radius: 12px !important;
            z-index: 2;
          }

          .sponsors-list-card:hover .sponsors-list-avatar {
            transform: translateY(-4px);
            box-shadow:
              0 12px 24px color-mix(in srgb, var(--advertisement-card-shadow) 34%, transparent),
              0 0 0 2px color-mix(in srgb, var(--surface-color) 76%, transparent);
          }

          .sponsors-list-card:hover .sponsors-list-avatar::after {
            box-shadow:
              inset 0 0 0 2px color-mix(in srgb, var(--advertisement-title) 42%, transparent),
              inset 0 -28px 34px color-mix(in srgb, var(--brand-navy-dark) 14%, transparent);
          }

          .sponsors-list-card:hover .sponsors-list-avatar img {
            transform: none;
            filter: saturate(1.12) contrast(1.04);
          }

          .sponsors-list-card:hover .sponsors-list-arrow {
            transform: translateX(4px) translateY(-2px) scale(1.1);
            box-shadow:
              0 12px 22px color-mix(in srgb, var(--advertisement-card-shadow) 34%, transparent),
              0 0 0 3px color-mix(in srgb, var(--surface-color) 18%, transparent);
          }

          .sponsors-list-card:hover .sponsors-list-meta {
            transform: translateY(-2px);
          }

          .sponsors-list-meta {
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          .sponsors-list-empty {
            animation: sponsorsListCardIn 560ms cubic-bezier(0.22, 1, 0.36, 1) 180ms both;
          }
        }

        @media (min-width: 1024px) and (max-width: 1279px) {
          .sponsors-list-stack {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (min-width: 1280px) and (max-width: 1535px) {
          .sponsors-list-stack {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }

        @keyframes sponsorsListPageIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes sponsorsListNavbarIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes sponsorsListTitleIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes sponsorsListContentIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes sponsorsListCardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (min-width: 1024px) and (prefers-reduced-motion: reduce) {
          .sponsors-list-page,
          .sponsors-list-navbar,
          .sponsors-list-title,
          .sponsors-list-content,
          .sponsors-list-card,
          .sponsors-list-empty {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }

          .sponsors-list-back,
          .sponsors-list-card,
          .sponsors-list-card::after,
          .sponsors-list-avatar,
          .sponsors-list-avatar img,
          .sponsors-list-arrow {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
};

const SponsorsList = ({ onNavigate, onBack }) => (
  <SponsorsContent onNavigate={onNavigate} onBack={onBack} variant="page" />
);

export default SponsorsList;
