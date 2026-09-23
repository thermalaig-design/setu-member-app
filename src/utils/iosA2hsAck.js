// iOS-only "the user says they completed Add to Home Screen" acknowledgement
// — deliberately separate from installPendingState.js's pending/verified
// records.
//
// Those records are written ONLY from real Android evidence: a genuine
// `appinstalled` DOM event, or a navigator.getInstalledRelatedApps()/
// isStandaloneDisplay() match (see TenantLanding.jsx). They gate Android's
// own isInstalled/installPhase state machine and its "Open App" launch
// button, and resolveInstallUiState()'s priority rules assume every verified
// record represents that same kind of hard evidence.
//
// iOS gives a normal (non-standalone) browser tab no equivalent signal:
// Safari/Chrome for iOS never fire `appinstalled`, and
// navigator.getInstalledRelatedApps() doesn't exist there. There is no way
// for this codebase to *verify* an iOS Add to Home Screen the way an Android
// install is verified — only the user themselves knows whether they actually
// finished the Share -> Add to Home Screen -> Add steps. This module's
// record is that self-report (see IosInstallInstructionsModal's "I've Added
// It" button): weaker than the Android verified record on purpose, so it
// must never be written to, read from, or merged with
// installPendingState.js's records, and must never set
// isInstalled/installPhase or be passed to writeInstallVerified. It drives
// ONLY the presentational iOS post-A2HS card in TenantLanding.jsx.
import { normalizeSlugIdentity } from './installPendingState.js';

const IOS_A2HS_ACK_KEY_PREFIX = 'tenant_ios_a2hs_ack_v1:';

const getAckKey = (slug) => `${IOS_A2HS_ACK_KEY_PREFIX}${slug}`;

export const readIosA2hsAck = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return null;
  try {
    const raw = localStorage.getItem(getAckKey(normalizedSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.slug !== normalizedSlug || !parsed.acknowledgedAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const hasIosA2hsAck = (slug) => Boolean(readIosA2hsAck(slug));

export const writeIosA2hsAck = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return null;
  try {
    const value = { slug: normalizedSlug, acknowledgedAt: Date.now() };
    localStorage.setItem(getAckKey(normalizedSlug), JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
};

export const clearIosA2hsAck = (slug) => {
  const normalizedSlug = normalizeSlugIdentity(slug);
  if (!normalizedSlug) return;
  try {
    localStorage.removeItem(getAckKey(normalizedSlug));
  } catch {
    // ignore
  }
};
