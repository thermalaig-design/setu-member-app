// Tracks whether the backend is unreachable (network error / 5xx) so the app can
// show a full-screen "lost the connection" page. Fed by the Supabase fetch wrapper.

const FAILURES_BEFORE_SHOWING = 2;

let consecutiveFailures = 0;
let failed = false;
const listeners = new Set();

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener(failed);
    } catch {
      // listener errors must never break request handling
    }
  });
};

export const reportConnectionFailure = () => {
  consecutiveFailures += 1;
  if (!failed && consecutiveFailures >= FAILURES_BEFORE_SHOWING) {
    failed = true;
    notify();
  }
};

export const reportConnectionSuccess = () => {
  consecutiveFailures = 0;
  if (failed) {
    failed = false;
    notify();
  }
};

export const isConnectionFailed = () => failed;

export const subscribeConnectionStatus = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
