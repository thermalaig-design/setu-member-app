import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppTheme } from '../context/ThemeContext';
import { getThemeToken } from '../utils/themeUtils';
import { reportConnectionSuccess } from '../utils/connectionStatus';

// Hardcoded palette that looks fine on any theme; used whenever theme tokens are missing/unusable.
const FALLBACK = {
  primary: '#1E3350',
  accent: '#E0B35A',
  pageBg: '#E8F1FB',
  text: '#4A5568',
  circleBg: '#DCE7F3'
};

const RETRY_DELAYS = [5, 10, 20, 30];

const isHex = (value) => typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());

const luminance = (hex) => {
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Theme colour only when it is a plain hex with the right lightness; otherwise hardcoded.
const pickColor = (theme, path, fallback, { max = 1, min = 0 } = {}) => {
  try {
    const value = getThemeToken(theme, path, fallback);
    if (!isHex(value)) return fallback;
    const lum = luminance(value);
    return lum >= min && lum <= max ? value.trim() : fallback;
  } catch {
    return fallback;
  }
};

const resolveColors = (theme) => ({
  // Button/heading must contrast with white text, so only accept darker theme colours.
  primary: pickColor(theme, 'primary_color', FALLBACK.primary, { max: 0.35 }),
  accent: pickColor(theme, 'accent_color', FALLBACK.accent, { max: 0.85, min: 0.2 }),
  pageBg: pickColor(theme, 'accent_bg', FALLBACK.pageBg, { min: 0.6 }),
  text: FALLBACK.text,
  circleBg: FALLBACK.circleBg
});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Any HTTP response below 500 means the server is reachable again.
const probeServer = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
      cache: 'no-store'
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const ConnectionLostPage = () => {
  const theme = useAppTheme();
  let colors = FALLBACK;
  try {
    colors = resolveColors(theme);
  } catch {
    colors = FALLBACK;
  }

  const [secondsLeft, setSecondsLeft] = useState(RETRY_DELAYS[0]);
  const [retrying, setRetrying] = useState(false);
  const attemptRef = useRef(0);
  const busyRef = useRef(false);

  const retry = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRetrying(true);
    const ok = await probeServer();
    busyRef.current = false;
    if (ok) {
      reportConnectionSuccess();
      // Reload so every page re-runs its RPCs instead of keeping a stale error state.
      window.location.reload();
      return;
    }
    attemptRef.current += 1;
    setSecondsLeft(RETRY_DELAYS[Math.min(attemptRef.current, RETRY_DELAYS.length - 1)]);
    setRetrying(false);
  }, []);

  useEffect(() => {
    if (retrying) return undefined;
    const timer = setTimeout(() => {
      if (secondsLeft <= 1) {
        setSecondsLeft(0);
        retry();
      } else {
        setSecondsLeft(secondsLeft - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, retrying, retry]);

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: colors.pageBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
        overflowY: 'auto'
      }}
    >
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 164,
            height: 164,
            borderRadius: '50%',
            background: colors.circleBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 28
          }}
        >
          <svg width="132" height="132" viewBox="0 0 132 132" fill="none" aria-hidden="true">
            <circle cx="66" cy="66" r="62" stroke="#B9C6D6" strokeWidth="1.5" strokeDasharray="3 4" />
            <line x1="22" y1="66" x2="44" y2="66" stroke={colors.primary} strokeWidth="4" strokeLinecap="round" />
            <rect x="44" y="52" width="22" height="28" rx="5" fill={colors.primary} />
            <rect x="66" y="52" width="2" height="28" fill="none" />
            <rect x="68" y="52" width="22" height="28" rx="5" fill={colors.accent} />
            <line x1="90" y1="66" x2="110" y2="66" stroke={colors.accent} strokeWidth="4" strokeLinecap="round" />
            <path d="M58 40l-4-8M70 38l1-8M82 42l5-7" stroke="#D9772B" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M60 92l-3 7M74 94l1 7M86 90l5 6" stroke="#D9772B" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.primary, textAlign: 'center' }}>
          Oops! We lost the connection
        </h1>
        <p style={{ margin: '14px 0 20px', fontSize: 14, lineHeight: 1.5, color: colors.text, textAlign: 'center' }}>
          We couldn&apos;t reach our server to load your store. Don&apos;t worry, nothing is lost.
        </p>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 999,
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            fontSize: 13,
            fontWeight: 500,
            color: '#1F2937',
            marginBottom: 28
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {retrying ? 'Retrying now…' : `Retrying automatically in ${secondsLeft}s`}
        </div>

        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          style={{
            width: '100%',
            height: 52,
            border: 'none',
            borderRadius: 999,
            background: colors.primary,
            color: '#FFFFFF',
            fontSize: 16,
            fontWeight: 700,
            cursor: retrying ? 'default' : 'pointer',
            opacity: retrying ? 0.8 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
          Try now
        </button>
      </div>
    </div>
  );
};

export default ConnectionLostPage;
