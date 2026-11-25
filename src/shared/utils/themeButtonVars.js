import { useEffect, useState } from 'react';

// ---- Theme-safe button colours -------------------------------------------------------------
// The theme's app-button background can be a gradient (e.g. dark -> light pink) and a single text
// colour cannot be readable on both ends. These helpers read the *active theme's* resolved values
// and guarantee contrast: use the theme's own button + text when readable on every gradient stop,
// otherwise fall back to the theme's contrast-checked accent colour with a readable text colour.
export const parseCssColor = (value) => {
  const text = String(value || '').trim().toLowerCase();
  let match = text.match(/^#([0-9a-f]{3,8})$/);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  match = text.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
  }
  return null;
};

const relativeLuminance = ([r, g, b]) => {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const contrastBetween = (a, b) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const extractCssColors = (value) =>
  (String(value || '').match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [])
    .map(parseCssColor)
    .filter(Boolean);

export const resolveThemeButtonVars = () => {
  if (typeof document === 'undefined') return {};
  const styles = getComputedStyle(document.documentElement);
  const read = (name) => styles.getPropertyValue(name).trim();

  const pageStops = extractCssColors(read('--page-bg') || read('--app-page-bg'));
  // Text candidates, theme-first; plain white/black only as a last resort for guaranteed contrast.
  const textCandidates = [
    read('--app-button-text'),
    read('--navbar-text'),
    read('--page-strong-color'),
    'rgb(255, 255, 255)',
    'rgb(17, 17, 17)',
  ].filter((value) => parseCssColor(value));

  const evaluate = (bgValue, { requireDistinct }) => {
    const stops = extractCssColors(bgValue);
    if (stops.length === 0) return null;

    if (requireDistinct && pageStops.length > 0) {
      const distinct = Math.min(
        ...stops.flatMap((stop) => pageStops.map((page) => contrastBetween(stop, page)))
      ) >= 2;
      if (!distinct) return null;
    }

    const text = textCandidates.find((candidate) => {
      const parsed = parseCssColor(candidate);
      return Math.min(...stops.map((stop) => contrastBetween(parsed, stop))) >= 4.5;
    });
    return text ? { '--pd-btn-bg': bgValue, '--pd-btn-text': text } : null;
  };

  // Walk the theme's own palette: its button style first, then primary / secondary / accent colours.
  const candidates = [
    '--app-button-bg',
    '--brand-red',
    '--brand-navy',
    '--app-accent',
    '--navbar-solid',
    '--page-price-color',
  ];
  for (const name of candidates) {
    const result = evaluate(read(name), { requireDistinct: true });
    if (result) return result;
  }
  for (const name of candidates) {
    const result = evaluate(read(name), { requireDistinct: false });
    if (result) return result;
  }
  return {};
};

export const useThemeButtonVars = (theme) => {
  const [vars, setVars] = useState(() => resolveThemeButtonVars());

  useEffect(() => {
    const update = () => setVars((prev) => {
      const next = resolveThemeButtonVars();
      const same = Object.keys({ ...prev, ...next }).every((key) => prev[key] === next[key]);
      return same ? prev : next;
    });
    update();

    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => observer.disconnect();
  }, [theme]);

  return vars;
};

