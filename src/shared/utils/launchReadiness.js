// Pure helpers behind the post-appinstalled "launch-ready" determination —
// see TenantLanding.jsx's LAUNCH-READINESS POLLING effect for the full
// context. Kept dependency-free (no React, no DOM beyond what's passed in)
// so they're unit-testable under plain `node --test`, the same way
// utils/installPendingState.js and utils/tenantNavigation.js are.
//
// Three explicit concepts, never collapsed into one:
//   A. install accepted        — the native prompt's 'accepted' outcome.
//   B. install confirmed       — a genuine `appinstalled` DOM event.
//   C. installed app launch-ready — Android's own registry actually
//      resolving an intent:// launch to the WebAPK, not just B having
//      happened, and not just time having passed since B.

// Requirement 3: match the tenant's real manifest/id/start-url; never
// accept a DIFFERENT tenant installed on the same origin as evidence this
// one is launch-ready. Mirrors the exact shape a
// navigator.getInstalledRelatedApps() result carries ({ id, url, ... }
// entries) and the manifest path applyTenantManifest (utils/pwaManifest.js)
// actually serves (/pwa-manifest/<slug>.webmanifest), so this can never
// drift from what's really being requested at runtime.
export const matchesTenantRelatedApp = (relatedApps, normalizedAppSlug) => {
  const slug = String(normalizedAppSlug || '').trim().toLowerCase();
  if (!slug) return false;
  const manifestPath = `/pwa-manifest/${slug}.webmanifest`.toLowerCase();
  return (Array.isArray(relatedApps) ? relatedApps : []).some((app) => {
    const url = String(app?.url || '').toLowerCase();
    const id = String(app?.id || '').toLowerCase();
    return url.includes(manifestPath) || id.includes(slug);
  });
};

// Requirement 5: once getInstalledRelatedApps confirms a match, the
// candidate launch-ready deadline is a short grace period AFTER that match
// — never immediate — so Android's intent resolver has a moment to catch
// up with the registry match itself.
export const computeLaunchReadyCandidate = (matchTimeMs, graceMs) => matchTimeMs + graceMs;

// THE hard guard a manual Open App launch (handleOpenApp in
// TenantLanding.jsx) must pass before it is allowed to fire the Android
// intent — never enforced only by whether the button happens to be
// rendered. `installPhase` only ever becomes 'installed' (with
// `isInstalled` true) via completeSettle(), which itself only ever runs
// once the persisted `readyAt` — confirmed (B) and, via the promotion this
// module's other two functions feed, launch-ready (C) — has actually
// elapsed. So this one check is simultaneously "is B done" and "is C done".
export const canAttemptOpenAppLaunch = ({ installPhase, isInstalled }) =>
  installPhase === 'installed' && isInstalled === true;
