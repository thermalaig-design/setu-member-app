// Shared store for the browser's `beforeinstallprompt` event.
//
// The event is actually captured as early as possible — by an inline
// <script> in index.html's <head>, before any JS module (including this
// one) loads — because the browser can fire it before React has even
// mounted, let alone before TenantLanding's own listener existed. That
// inline script stashes the event on `window.__setuDeferredInstallPrompt`
// and, if this module has already registered a notifier, calls it
// immediately too. This module is the single place components should read
// from — never add a second `beforeinstallprompt` listener elsewhere.
const subscribers = new Set();

const notifySubscribers = (event) => {
  subscribers.forEach((callback) => {
    try {
      callback(event);
    } catch {
      // ignore a subscriber's own error — must not break other subscribers
    }
  });
};

if (typeof window !== 'undefined') {
  // Exposed so the inline bootstrap script in index.html can hand off an
  // event that fires after this module has loaded (the common case — the
  // inline script itself only stores the event, it doesn't know about
  // React component state).
  window.__setuNotifyInstallPrompt = notifySubscribers;
}

// Returns the event if one was already captured (e.g. before the calling
// component mounted) — check this first, then also subscribe for any event
// that arrives later.
export const getInstallPrompt = () => {
  if (typeof window === 'undefined') return null;
  return window.__setuDeferredInstallPrompt || null;
};

// Call once the event has been consumed via .prompt() (or is being
// discarded) — a BeforeInstallPromptEvent can only be prompted once, so a
// stale reference left in the shared store would be useless at best.
export const clearInstallPrompt = () => {
  if (typeof window === 'undefined') return;
  window.__setuDeferredInstallPrompt = null;
};

// Registers callback for any beforeinstallprompt event captured from now
// on. Returns an unsubscribe function. Does NOT call callback with an
// already-captured event — call getInstallPrompt() first for that.
export const subscribeInstallPrompt = (callback) => {
  if (typeof callback !== 'function') return () => {};
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};