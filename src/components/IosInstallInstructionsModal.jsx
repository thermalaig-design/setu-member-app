import React, { useEffect } from 'react';

// Shown from TenantLanding.jsx when handleInstallClick resolves
// installOutcome to 'ios-instructions' — i.e. iOS Safari OR iOS Chrome
// (CriOS), since neither ever fires beforeinstallprompt and both only
// offer the OS-level "Add to Home Screen" step via the Share sheet. Pure
// presentation: closing it never navigates or hands off to another
// browser. The × just dismisses (onClose, installOutcome back to '') —
// "I've Added It" additionally calls onAcknowledge, the user's own
// confirmation that they finished the steps, which TenantLanding.jsx
// persists as a separate, self-reported record (see utils/iosA2hsAck.js)
// and never as Android's verified-install evidence.
const STEPS = [
  {
    label: 'Tap the Share button',
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12" />
        <path d="M7 8l5-5 5 5" />
        <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
    )
  },
  {
    label: 'Choose "Add to Home Screen"',
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </svg>
    )
  },
  {
    label: 'Tap "Add" to confirm',
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )
  }
];

function IosInstallInstructionsModal({ trustName, accent, palette, onClose, onAcknowledge }) {
  // Background scroll lock while the popup is open — restored on unmount
  // regardless of how it closes (X, Got it, or backdrop tap).
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const accentColor = accent?.from || '#2563eb';

  return (
    <div
      className="ios-install-modal-overlay"
      style={styles.overlay}
      onClick={onClose}
    >
      <div
        className="ios-install-modal-card"
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-install-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          className="ios-install-modal-close"
          style={styles.closeBtn}
          onClick={onClose}
        >
          ×
        </button>

        <h2 id="ios-install-modal-title" style={styles.title}>Install App</h2>
        <p style={styles.subtitle}>
          Follow these steps to add {trustName ? `${trustName} ` : 'the app '}to your Home Screen.
        </p>

        <ol style={styles.stepList}>
          {STEPS.map((step, index) => (
            <li key={step.label} className="ios-install-modal-step" style={styles.stepRow}>
              <span
                className="ios-install-modal-icon"
                style={{ ...styles.stepIcon, color: accentColor, borderColor: `${accentColor}33`, animationDelay: `${index * 0.25}s` }}
              >
                {step.icon}
              </span>
              <span style={styles.stepText}>{step.label}</span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="ios-install-modal-got-it"
          style={{ ...styles.gotItBtn, background: `linear-gradient(135deg, ${accent?.from || '#2563eb'}, ${accent?.to || '#1d4ed8'})` }}
          onClick={onAcknowledge}
        >
          I've Added It
        </button>
      </div>

      <style>{`
        @keyframes iosInstallModalIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to { opacity: 1; transform: none; }
        }
        @keyframes iosInstallStepPulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          50% { box-shadow: 0 0 0 6px transparent; opacity: 0.75; }
        }
        .ios-install-modal-overlay {
          animation: iosInstallOverlayIn 0.2s ease;
        }
        @keyframes iosInstallOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ios-install-modal-card {
          animation: iosInstallModalIn 0.28s cubic-bezier(0.2, 0.8, 0.3, 1);
        }
        .ios-install-modal-icon {
          animation: iosInstallStepPulse 1.8s ease-in-out infinite;
        }
        .ios-install-modal-close:hover { opacity: 0.7; }
        .ios-install-modal-got-it:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.35)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '0 16px'
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: '420px',
    background: '#ffffff',
    borderRadius: '20px 20px 0 0',
    padding: '28px 24px 24px',
    boxShadow: '0 -12px 40px rgba(15, 23, 42, 0.18)',
    marginBottom: 0
  },
  closeBtn: {
    position: 'absolute',
    top: '14px',
    right: '14px',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: '#f1f5f9',
    color: '#475569',
    fontSize: '20px',
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    margin: '0 0 6px',
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a'
  },
  subtitle: {
    margin: '0 0 20px',
    fontSize: '14px',
    color: '#64748b',
    lineHeight: 1.5
  },
  stepList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '14px'
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  stepIcon: {
    flexShrink: 0,
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f8fafc'
  },
  stepText: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1e293b'
  },
  gotItBtn: {
    width: '100%',
    marginTop: '24px',
    padding: '14px',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer'
  }
};

export default IosInstallInstructionsModal;
