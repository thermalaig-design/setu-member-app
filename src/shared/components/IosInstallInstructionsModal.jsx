import React, { useEffect } from 'react';
import iosInstallStepsImage from '../assets/ios-install-steps.png';

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
//
// ios-install-steps.png (src/assets) is a real, static reference
// screenshot of the 3-step Share -> Add to Home Screen -> Add flow —
// deliberately generic/untenanted (it isn't re-rendered per tenant name or
// URL), so alt text carries the actual instruction copy for screen
// readers rather than the image's own baked-in labels.
function IosInstallInstructionsModal({ trustName, accent, palette, onClose, onAcknowledge }) {
  // Background scroll lock while the popup is open — restored on unmount
  // regardless of how it closes (X, "I've Added It", or backdrop tap).
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

        <div style={styles.scrollArea}>
          <h2 id="ios-install-modal-title" style={styles.srOnlyTitle}>
            Install {trustName || 'the app'}
          </h2>
          <img
            src={iosInstallStepsImage}
            alt={`Steps to add ${trustName || 'the app'} to your Home Screen: 1) Tap the Share button in your browser's toolbar, 2) Choose "Add to Home Screen", 3) Tap "Add" to confirm`}
            style={styles.stepsImage}
          />
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            className="ios-install-modal-got-it"
            style={{ ...styles.gotItBtn, background: `linear-gradient(135deg, ${accent?.from || '#2563eb'}, ${accent?.to || '#1d4ed8'})` }}
            onClick={onAcknowledge}
          >
            I've Added It
          </button>
        </div>
      </div>

      <style>{`
        @keyframes iosInstallModalIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to { opacity: 1; transform: none; }
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
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    borderRadius: '20px 20px 0 0',
    boxShadow: '0 -12px 40px rgba(15, 23, 42, 0.18)',
    marginBottom: 0,
    overflow: 'hidden'
  },
  scrollArea: {
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: '16px 16px 8px'
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
    justifyContent: 'center',
    zIndex: 1
  },
  // Visually hidden — the image already carries its own "Install App"
  // title/instructions, but a dialog still needs a real accessible name
  // for aria-labelledby rather than duplicating the image's baked-in text
  // on screen.
  srOnlyTitle: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0
  },
  stepsImage: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: '14px'
  },
  footer: {
    padding: '12px 24px 24px',
    borderTop: '1px solid #f1f5f9'
  },
  gotItBtn: {
    width: '100%',
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
