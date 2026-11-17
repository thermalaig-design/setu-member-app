// Central, ref-counted page scroll lock.
//
// Previously every page/modal/sidebar locked the document on its own by
// writing body/html inline styles (position: fixed, overflow: hidden,
// touch-action: none) and "unlocked" by blindly clearing them. With several
// overlays (page sidebar + Sidebar component + a modal) these fought each
// other: a nested lock captured scrollY = 0, one overlay's unlock cleared
// another's lock, or a "previous overflow" snapshot captured 'hidden' and
// restored it forever — leaving pages that could not scroll on Android and
// iOS until the app was restarted.
//
// Usage inside an effect:
//   useEffect(() => {
//     if (!isOpen) return undefined;
//     return lockBodyScroll();
//   }, [isOpen]);

let lockCount = 0;
let savedScrollY = 0;
// Bumped by forceUnlockBodyScroll so releases from before a forced reset
// become no-ops instead of re-unlocking/scrolling a newer page.
let generation = 0;

const clearLockStyles = () => {
  const html = document.documentElement;
  const { body } = document;
  html.style.overflow = '';
  html.style.position = '';
  html.style.overscrollBehavior = '';
  body.style.overflow = '';
  body.style.position = '';
  body.style.width = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.touchAction = '';
  body.style.overscrollBehavior = '';
  body.style.pointerEvents = '';
};

export const lockBodyScroll = () => {
  if (typeof document === 'undefined') return () => {};

  if (lockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    const html = document.documentElement;
    const { body } = document;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${savedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  }
  lockCount += 1;

  const lockGeneration = generation;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (lockGeneration !== generation) return;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      const y = savedScrollY;
      clearLockStyles();
      window.scrollTo(0, y);
    }
  };
};

// Drops every lock and clears any stale inline styles. Used as a safety net
// on route changes so a leaked lock can never leave a page unscrollable.
export const forceUnlockBodyScroll = () => {
  if (typeof document === 'undefined') return;
  lockCount = 0;
  generation += 1;
  clearLockStyles();
};

// Clears stale inline lock styles only when no overlay currently holds a lock.
export const releaseStaleScrollLock = () => {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) clearLockStyles();
};

export const isBodyScrollLocked = () => lockCount > 0;
