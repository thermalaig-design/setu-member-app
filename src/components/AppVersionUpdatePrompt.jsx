import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AlertTriangle, Clock3, Download } from 'lucide-react';
import { fetchShareAppLinksByTrustId } from '../services/trustService';
import { getShareAppTargetLink } from '../utils/shareApp';
import { TRUST_APP_VERSION } from '../constants/appVersion';

const APP_UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;
const APP_UPDATE_SNOOZE_PREFIX = 'app_update_snooze_v1_';

const normalizeVersionNumber = (value) => {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTrustId = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined' || lowered === 'nan') return '';
  return raw;
};

const getSnoozeKey = (trustId) => `${APP_UPDATE_SNOOZE_PREFIX}${normalizeTrustId(trustId)}`;

const readSnoozeState = (trustId) => {
  const key = getSnoozeKey(trustId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const version = normalizeVersionNumber(parsed?.version);
    const snoozeUntil = Number(parsed?.snoozeUntil) || 0;
    if (version === null || snoozeUntil <= 0) return null;
    return { version, snoozeUntil };
  } catch {
    return null;
  }
};

const writeSnoozeState = (trustId, version, snoozeUntil) => {
  const key = getSnoozeKey(trustId);
  try {
    localStorage.setItem(key, JSON.stringify({ version, snoozeUntil }));
  } catch {
    // Ignore storage failures; the prompt will simply reappear later.
  }
};

const clearSnoozeState = (trustId) => {
  try {
    localStorage.removeItem(getSnoozeKey(trustId));
  } catch {
    // Ignore storage failures.
  }
};

const AppVersionUpdatePrompt = ({ trustId }) => {
  const normalizedTrustId = normalizeTrustId(trustId);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const refreshCallbackRef = useRef(null);
  const [state, setState] = useState({
    visible: false,
    remoteVersion: null,
    updateLink: '',
  });

  const clearRefreshTimer = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const evaluateUpdateState = useCallback(async () => {
    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;

    if (!normalizedTrustId) {
      clearRefreshTimer();
      setState({ visible: false, remoteVersion: null, updateLink: '' });
      return;
    }

    try {
      const links = await fetchShareAppLinksByTrustId(normalizedTrustId);
      if (requestIdRef.current !== currentRequestId) return;

      const remoteVersion = normalizeVersionNumber(links?.version);
      const localVersion = normalizeVersionNumber(TRUST_APP_VERSION);
      const updateLink = getShareAppTargetLink(links || {}, Capacitor.getPlatform(), '');

      if (remoteVersion === null || localVersion === null || remoteVersion <= localVersion) {
        clearRefreshTimer();
        clearSnoozeState(normalizedTrustId);
        setState({ visible: false, remoteVersion, updateLink });
        return;
      }

      const snooze = readSnoozeState(normalizedTrustId);
      const now = Date.now();
      const stillSnoozed = snooze?.version === remoteVersion && snooze.snoozeUntil > now;

      if (stillSnoozed) {
        clearRefreshTimer();
        refreshTimerRef.current = setTimeout(() => {
          refreshCallbackRef.current?.();
        }, Math.max(snooze.snoozeUntil - now, 1000));
        setState({ visible: false, remoteVersion, updateLink });
        return;
      }

      if (snooze && snooze.version !== remoteVersion) {
        clearSnoozeState(normalizedTrustId);
      }

      clearRefreshTimer();
      setState({ visible: true, remoteVersion, updateLink });
    } catch (error) {
      console.warn('[AppVersionUpdatePrompt] Failed to load app version:', error?.message || error);
      clearRefreshTimer();
      setState({ visible: false, remoteVersion: null, updateLink: '' });
    }
  }, [normalizedTrustId, clearRefreshTimer]);

  useEffect(() => {
    refreshCallbackRef.current = evaluateUpdateState;
  }, [evaluateUpdateState]);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      evaluateUpdateState();
    }, 0);
    return () => {
      clearTimeout(initTimer);
      clearRefreshTimer();
    };
  }, [evaluateUpdateState, clearRefreshTimer]);

  useEffect(() => {
    const onFocus = () => {
      evaluateUpdateState();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        evaluateUpdateState();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [evaluateUpdateState]);

  useEffect(() => {
    if (!state.visible) return undefined;

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [state.visible]);

  const handleLater = () => {
    if (!normalizedTrustId || state.remoteVersion === null) {
      setState((prev) => ({ ...prev, visible: false }));
      return;
    }

    const snoozeUntil = Date.now() + APP_UPDATE_SNOOZE_MS;
    writeSnoozeState(normalizedTrustId, state.remoteVersion, snoozeUntil);
    setState((prev) => ({ ...prev, visible: false }));

    clearRefreshTimer();
    refreshTimerRef.current = setTimeout(() => {
      refreshCallbackRef.current?.();
    }, APP_UPDATE_SNOOZE_MS);
  };

  const handleUpdateNow = () => {
    if (!state.updateLink) return;
    window.open(state.updateLink, '_blank', 'noopener,noreferrer');
  };

  if (!state.visible) return null;

  const currentVersion = TRUST_APP_VERSION;
  const availableVersion = state.remoteVersion === null ? '' : String(state.remoteVersion);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      style={styles.backdrop}
    >
      <div style={styles.card}>
        <div style={styles.badgeRow}>
          <div style={styles.iconWrap}>
            <AlertTriangle size={18} />
          </div>
          <span style={styles.badgeText}>Update available</span>
        </div>

        <h2 id="app-update-title" style={styles.title}>
          A newer version is ready
        </h2>

        <p style={styles.description}>
          You are using version <strong>{currentVersion}</strong>. Version <strong>{availableVersion}</strong> is available for this trust.
          Update now for the latest fixes and improvements, or tap Later to be reminded again.
        </p>

        <div style={styles.versionRow}>
          <div style={styles.versionPill}>
            <span style={styles.versionLabel}>Current</span>
            <span style={styles.versionValue}>{currentVersion}</span>
          </div>
          <div style={styles.versionPill}>
            <span style={styles.versionLabel}>Available</span>
            <span style={styles.versionValue}>{availableVersion}</span>
          </div>
        </div>

        <div style={styles.actions}>
          <button type="button" onClick={handleLater} style={styles.laterButton}>
            <Clock3 size={16} />
            Later
          </button>
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={!state.updateLink}
            style={{
              ...styles.updateButton,
              ...(state.updateLink ? {} : styles.updateButtonDisabled),
            }}
          >
            <Download size={16} />
            Update now
          </button>
        </div>

        {!state.updateLink && (
          <p style={styles.helperText}>
            Update link is not configured for this trust yet.
          </p>
        )}
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'rgba(10, 14, 25, 0.62)',
    backdropFilter: 'blur(12px)',
  },
  card: {
    width: 'min(100%, 380px)',
    borderRadius: '24px',
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 94%, white) 0%, var(--surface-color) 100%)',
    border: '1px solid color-mix(in srgb, var(--border-color) 72%, white)',
    boxShadow: '0 30px 80px rgba(0, 0, 0, 0.35)',
    padding: '22px',
    color: 'var(--body-text-color)',
  },
  badgeRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '999px',
    background: 'color-mix(in srgb, var(--brand-red) 12%, transparent)',
    color: 'var(--brand-red)',
    marginBottom: '14px',
  },
  iconWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: '0.78rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    margin: 0,
    fontSize: '1.4rem',
    lineHeight: 1.2,
    color: 'var(--body-text-color)',
  },
  description: {
    margin: '12px 0 0',
    fontSize: '0.96rem',
    lineHeight: 1.6,
    color: 'color-mix(in srgb, var(--body-text-color) 88%, white)',
  },
  versionRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
    marginTop: '18px',
  },
  versionPill: {
    borderRadius: '16px',
    padding: '12px 14px',
    background: 'color-mix(in srgb, var(--app-page-bg) 72%, white)',
    border: '1px solid color-mix(in srgb, var(--border-color) 62%, white)',
  },
  versionLabel: {
    display: 'block',
    fontSize: '0.74rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--body-muted-text-color)',
    marginBottom: '4px',
  },
  versionValue: {
    display: 'block',
    fontSize: '1rem',
    fontWeight: 700,
    color: 'var(--body-text-color)',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '22px',
  },
  laterButton: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '46px',
    borderRadius: '14px',
    border: '1px solid color-mix(in srgb, var(--border-color) 82%, white)',
    background: 'transparent',
    color: 'var(--body-text-color)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  updateButton: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '46px',
    borderRadius: '14px',
    border: 'none',
    background: 'linear-gradient(135deg, var(--brand-red), color-mix(in srgb, var(--brand-red) 72%, black))',
    color: 'white',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 12px 24px color-mix(in srgb, var(--brand-red) 35%, transparent)',
  },
  updateButtonDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  helperText: {
    margin: '12px 0 0',
    fontSize: '0.8rem',
    color: 'var(--body-muted-text-color)',
  },
};

export default AppVersionUpdatePrompt;
