import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBackNavigation } from './hooks';
import { fetchTrustById } from './services/trustService';
import { parseLegalSections, resolveLegalTrustId } from './utils/legalContent';

const LOGIN_TRUST_CACHE_KEY = 'cached_base_trust_info';

const getCachedTrust = (trustId) => {
  try {
    const raw = localStorage.getItem(LOGIN_TRUST_CACHE_KEY);
    if (!raw) return null;

    const { data, ts, trustId: cachedTrustId } = JSON.parse(raw);
    const expectedTrustId = String(trustId || '').trim();
    if (cachedTrustId && expectedTrustId && cachedTrustId !== expectedTrustId) {
      localStorage.removeItem(LOGIN_TRUST_CACHE_KEY);
      return null;
    }

    if (Date.now() - ts > 24 * 60 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
};

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  useBackNavigation();

  const resolvedTrustId = resolveLegalTrustId();
  const [trustInfo, setTrustInfo] = useState(() => getCachedTrust(resolvedTrustId));
  const [content, setContent] = useState(() => getCachedTrust(resolvedTrustId)?.privacy_content || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const trustId = resolveLegalTrustId();
        const cached = getCachedTrust(trustId);
        if (cached) {
          setTrustInfo(cached);
          setContent(cached.privacy_content || '');
          setLoading(false);
        }

        const trust = await fetchTrustById(trustId);
        if (!active || !trust) return;

        setTrustInfo(trust);
        setContent(trust.privacy_content || '');

        try {
          localStorage.setItem(
            LOGIN_TRUST_CACHE_KEY,
            JSON.stringify({ data: trust, ts: Date.now(), trustId })
          );
        } catch {
          // ignore cache write failures
        }
      } catch (err) {
        console.warn('[Privacy] Load error:', err);
        if (active) setError('Failed to load Privacy Policy. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const sections = parseLegalSections(content);
  const trustName = trustInfo?.name || '';

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <button type="button" onClick={() => navigate(-1)} style={styles.backButton} aria-label="Go back">
            &#8592;
          </button>
          <div>
            <h1 style={styles.title}>Privacy Policy</h1>
            {trustName ? <p style={styles.subtitle}>{trustName}</p> : null}
          </div>
        </div>

        {loading ? <p style={styles.message}>Loading privacy policy...</p> : null}
        {!loading && error ? <p style={styles.error}>{error}</p> : null}
        {!loading && !error && !content ? (
          <p style={styles.message}>Privacy Policy not available yet.</p>
        ) : null}

        {!loading && !error && content ? (
          <div style={styles.contentWrap}>
            {sections.map((sec, idx) => (
              <section key={idx} style={styles.section}>
                {sec.isHtml ? (
                  <div style={styles.sectionBody} dangerouslySetInnerHTML={{ __html: sec.body }} />
                ) : sec.num ? (
                  <>
                    <h2 style={styles.sectionTitle}>
                      {sec.num}. {sec.title}
                    </h2>
                    {sec.body ? <p style={styles.sectionBody}>{sec.body}</p> : null}
                  </>
                ) : (
                  <p style={styles.sectionBody}>{sec.body}</p>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--page-bg, var(--app-page-bg))',
    padding: '16px',
    boxSizing: 'border-box',
    color: 'var(--body-text-color)',
  },
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    background: 'var(--surface-color)',
    border: '1px solid color-mix(in srgb, var(--body-text-color) 12%, var(--surface-color))',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 10px 28px color-mix(in srgb, var(--body-text-color) 8%, transparent)',
  },
  headerRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  backButton: {
    border: '1px solid color-mix(in srgb, var(--body-text-color) 16%, var(--surface-color))',
    background: 'var(--app-button-bg)',
    color: 'var(--surface-color)',
    borderRadius: '10px',
    width: '42px',
    height: '42px',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: 1,
  },
  title: {
    margin: 0,
    fontSize: '24px',
    color: 'var(--app-button-bg)',
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: 'var(--subheading-color)',
    fontSize: '14px',
  },
  message: {
    color: 'var(--body-text-color)',
    fontSize: '15px',
  },
  error: {
    color: 'var(--brand-red-dark)',
    fontSize: '15px',
  },
  contentWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  section: {
    borderTop: '1px solid color-mix(in srgb, var(--body-text-color) 12%, var(--surface-color))',
    paddingTop: '14px',
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    color: 'var(--heading-color)',
  },
  sectionBody: {
    margin: 0,
    color: 'var(--body-text-color)',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
  },
};

export default PrivacyPolicy;
