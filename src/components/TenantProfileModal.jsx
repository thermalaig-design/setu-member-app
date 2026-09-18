import React, { useState } from 'react';

// Tenant-branded "complete your profile" popup, shown from TenantLanding.jsx
// when the app-slug resolver reports needs_profile=true (new membership, or
// an existing one missing a Name). Styled to match the accent/palette
// TenantLanding already derives from the Trust's own theme colors, and
// reuses the same fixed-overlay modal shell pattern as the Safari
// install-instructions modal in that file, rather than the app's global
// --app-button-bg CSS vars (which reflect the *selected* Trust, not
// necessarily this not-yet-entered tenant Trust).
function TenantProfileModal({ trustName, mobile, initialName = '', initialEmail = '', isActive, accent, palette, onSubmit, onUseAnotherNumber }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const accentGradient = `linear-gradient(135deg, ${accent.from}, ${accent.to})`;
  const submitLabel = isActive ? 'Continue' : 'Request for Access';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ name: trimmedName, email: email.trim() });
    } catch (err) {
      setError(err?.message || 'Unable to save your details. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, background: palette.cardBackground, borderColor: palette.cardBorder }}>
        <div style={{ ...styles.accentBar, background: accentGradient }} />
        <div style={styles.body}>
          <p style={{ ...styles.eyebrow, color: palette.textMuted }}>Complete your profile</p>
          <h2 style={{ ...styles.title, color: palette.textPrimary }}>{trustName}</h2>
          <p style={{ ...styles.subtitle, color: palette.textSecondary }}>
            {isActive
              ? 'A few details before you continue.'
              : 'A few details to submit your access request.'}
          </p>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, color: palette.textMuted }}>MOBILE NUMBER</label>
              <input
                type="tel"
                value={mobile || ''}
                readOnly
                disabled
                style={{ ...styles.input, ...styles.inputDisabled, color: palette.textSecondary, borderColor: palette.cardBorder }}
              />
              {onUseAnotherNumber && (
                <button type="button" onClick={onUseAnotherNumber} style={{ ...styles.linkBtn, color: accent.from }}>
                  Use another mobile number
                </button>
              )}
            </div>

            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, color: palette.textMuted }}>NAME *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                required
                style={{ ...styles.input, color: palette.textPrimary, borderColor: palette.cardBorder }}
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={{ ...styles.label, color: palette.textMuted }}>EMAIL (OPTIONAL)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ ...styles.input, color: palette.textPrimary, borderColor: palette.cardBorder }}
              />
            </div>

            {error && <p style={styles.error}>{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              style={{
                ...styles.submitBtn,
                background: accentGradient,
                color: accent.text,
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              {submitting ? 'Saving…' : submitLabel}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: '380px',
    borderRadius: '18px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 20px 44px rgba(0,0,0,0.45)',
  },
  accentBar: {
    height: '5px',
    width: '100%',
  },
  body: {
    padding: '28px 24px 26px',
  },
  eyebrow: {
    margin: '0 0 4px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.5px',
    textAlign: 'center',
  },
  title: {
    margin: 0,
    fontSize: '19px',
    fontWeight: 800,
    textAlign: 'center',
  },
  subtitle: {
    margin: '6px 0 20px',
    fontSize: '12.5px',
    lineHeight: 1.5,
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '1px',
  },
  input: {
    border: '1px solid',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.18)',
    padding: '12px 13px',
    fontSize: '14px',
    outline: 'none',
    fontFamily: "'Inter', sans-serif",
    boxSizing: 'border-box',
  },
  inputDisabled: {
    opacity: 0.7,
  },
  linkBtn: {
    alignSelf: 'flex-start',
    border: 'none',
    background: 'transparent',
    padding: 0,
    marginTop: '2px',
    fontSize: '11.5px',
    fontWeight: 700,
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: "'Inter', sans-serif",
  },
  error: {
    margin: 0,
    fontSize: '12.5px',
    color: '#f5c842',
  },
  submitBtn: {
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: 700,
    fontSize: '14.5px',
    marginTop: '4px',
  },
};

export default TenantProfileModal;
