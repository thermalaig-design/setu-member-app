const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeChannel = (value, max = 255) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.endsWith('%')) {
    const pct = Number(raw.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return clamp((pct / 100) * max, 0, max);
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return clamp(num, 0, max);
};

const parseHexColor = (input) => {
  const raw = String(input || '').trim().replace('#', '');
  if (!/^[\da-fA-F]{3,8}$/.test(raw)) return null;

  if (raw.length === 3 || raw.length === 4) {
    const expanded = raw.split('').map((part) => part + part).join('');
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  if (raw.length === 6 || raw.length === 8) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  return null;
};

const splitFunctionalArgs = (raw) =>
  raw
    .replace(/\s*\/\s*/g, ',')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const parseRgbColor = (input) => {
  const match = String(input || '').trim().match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const parts = splitFunctionalArgs(match[1]);
  if (parts.length < 3) return null;

  const r = normalizeChannel(parts[0], 255);
  const g = normalizeChannel(parts[1], 255);
  const b = normalizeChannel(parts[2], 255);
  if (r === null || g === null || b === null) return null;
  const alpha = parts.length >= 4 ? normalizeChannel(parts[3], 1) : 1;

  return {
    r,
    g,
    b,
    a: alpha === null ? 1 : alpha
  };
};

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s / 100, 0, 1);
  const light = clamp(l / 100, 0, 1);
  const chroma = (1 - Math.abs((2 * light) - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hue < 60) {
    rPrime = chroma; gPrime = x;
  } else if (hue < 120) {
    rPrime = x; gPrime = chroma;
  } else if (hue < 180) {
    gPrime = chroma; bPrime = x;
  } else if (hue < 240) {
    gPrime = x; bPrime = chroma;
  } else if (hue < 300) {
    rPrime = x; bPrime = chroma;
  } else {
    rPrime = chroma; bPrime = x;
  }

  return {
    r: (rPrime + m) * 255,
    g: (gPrime + m) * 255,
    b: (bPrime + m) * 255
  };
};

const parseHslColor = (input) => {
  const match = String(input || '').trim().match(/^hsla?\((.+)\)$/i);
  if (!match) return null;
  const parts = splitFunctionalArgs(match[1]);
  if (parts.length < 3) return null;

  const h = Number(String(parts[0]).replace('deg', '').trim());
  const s = normalizeChannel(parts[1], 100);
  const l = normalizeChannel(parts[2], 100);
  if (!Number.isFinite(h) || s === null || l === null) return null;

  const rgb = hslToRgb(h, s, l);
  const alpha = parts.length >= 4 ? normalizeChannel(parts[3], 1) : 1;
  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    a: alpha === null ? 1 : alpha
  };
};

const parseColorToRgba = (input) => (
  parseHexColor(input)
  || parseRgbColor(input)
  || parseHslColor(input)
);

export const applyOpacity = (color, opacity) => {
  const targetAlpha = clamp(Number(opacity), 0, 1);
  if (!Number.isFinite(targetAlpha)) return String(color || '');

  const parsed = parseColorToRgba(color);
  if (parsed) {
    const baseAlpha = Number.isFinite(parsed.a) ? parsed.a : 1;
    const finalAlpha = clamp(baseAlpha * targetAlpha, 0, 1);
    return `rgba(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)}, ${finalAlpha})`;
  }

  const raw = String(color || '').trim();
  if (!raw) return `rgba(0, 0, 0, ${targetAlpha})`;
  return `color-mix(in srgb, ${raw} ${Math.round(targetAlpha * 100)}%, transparent)`;
};

export const colorToHex = (color, fallback = '#4B5563') => {
  const parsed = parseColorToRgba(color);
  if (!parsed) return fallback;
  const toHex = (channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(parsed.r)}${toHex(parsed.g)}${toHex(parsed.b)}`;
};

