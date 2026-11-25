// A page is "dark" when the theme's page-text colour (always computed to
// contrast with the page background) is light.
export const isPageDark = () => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('div');
  probe.style.color = 'var(--page-text-color, var(--body-text-color))';
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const match = getComputedStyle(probe).color.match(/rgba?\(([^)]+)\)/);
  document.body.removeChild(probe);
  if (!match) return false;
  const [r, g, b] = match[1].split(',').map((n) => parseFloat(n) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5;
};

// Text/icon accent that stays readable on the page: the theme primary on light
// pages (unchanged), the contrast-checked page accent on dark pages.
export const pageAccent = (primary, dark) => (dark ? 'var(--page-price-color, var(--page-text-color))' : primary);
