const coachMarkKey = (trustId) => `coachmark_add_products_${trustId || 'default'}`;

export const isCoachMarkDismissed = (trustId) => {
  try {
    return localStorage.getItem(coachMarkKey(trustId)) === '1';
  } catch {
    return false;
  }
};

export const dismissCoachMark = (trustId) => {
  try {
    localStorage.setItem(coachMarkKey(trustId), '1');
  } catch { /* ignore */ }
};
