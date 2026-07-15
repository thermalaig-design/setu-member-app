const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const toPathSegments = (path) =>
  String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

const readPath = (source, path) => {
  const segments = Array.isArray(path) ? path : toPathSegments(path);
  if (!segments.length) return undefined;
  let current = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
};

const hasTokenValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const readConfigToken = (config, path) => {
  const value = readPath(config, path);
  return hasTokenValue(value) ? value : undefined;
};

const readRawThemeConfigToken = (theme, path) => {
  const selectedConfig = theme?.selectedThemeConfigRaw || null;
  const baseConfig = theme?.baseThemeConfigRaw || null;

  const selectedValue = readConfigToken(selectedConfig, path);
  if (selectedValue !== undefined) {
    return {
      value: selectedValue,
      source: `selected.${path}`
    };
  }

  const baseValue = readConfigToken(baseConfig, path);
  if (baseValue !== undefined) {
    return {
      value: baseValue,
      source: `base.${path}`
    };
  }

  return {
    value: undefined,
    source: null
  };
};

const deepMerge = (base, override) => {
  if (!isPlainObject(base)) return isPlainObject(override) ? { ...override } : base;
  if (!isPlainObject(override)) return { ...base };
  const next = { ...base };
  Object.keys(override).forEach((key) => {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      next[key] = deepMerge(baseValue, overrideValue);
      return;
    }
    next[key] = overrideValue;
  });
  return next;
};

const parseJsonObject = (value, fallback = {}) => {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const sanitizeArrayOfStrings = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
};

export const sanitizeCustomCss = (css) => {
  const text = typeof css === 'string' ? css : '';
  if (!text.trim()) return '';
  const blockedPatterns = [
    /@import/gi,
    /javascript:/gi,
    /expression\s*\(/gi,
    /<\/?script/gi,
    /behavior\s*:/gi
  ];
  const isBlocked = blockedPatterns.some((pattern) => pattern.test(text));
  return isBlocked ? '' : text;
};

export const DEFAULT_HOME_LAYOUT = ['gallery', 'quickActions', 'sponsors'];
export const AVAILABLE_HOME_SECTIONS = ['trustList', 'marquee', 'gallery', 'quickActions', 'sponsors'];
export const DEFAULT_THEME_ANIMATIONS = { cards: 'fadeUp', navbar: 'fadeSlideDown', gallery: 'zoomIn' };
export const AVAILABLE_THEME_ANIMATIONS = ['none', 'fadeUp', 'fadeSlideDown', 'zoomIn', 'fadeIn'];
export const LEGACY_THEME_ANIMATION_ALIASES = {
  slideUp: 'fadeUp'
};

export const normalizeHomeLayout = (value, fallback = DEFAULT_HOME_LAYOUT) => {
  const source = Array.isArray(value) ? value : fallback;
  const unique = [];
  const seen = new Set();

  source.forEach((item) => {
    const key = String(item || '').trim();
    if (!AVAILABLE_HOME_SECTIONS.includes(key) || seen.has(key)) return;
    seen.add(key);
    unique.push(key);
  });

  return unique.length > 0 ? unique : [...fallback];
};

export const normalizeThemeAnimations = (value, fallback = DEFAULT_THEME_ANIMATIONS) => {
  const safeFallback = isPlainObject(fallback) ? fallback : DEFAULT_THEME_ANIMATIONS;
  if (!isPlainObject(value)) return { ...safeFallback };

  const normalized = { ...safeFallback };
  Object.keys(value).forEach((slot) => {
    const rawAnimation = String(value[slot] || '').trim();
    const nextAnimation = LEGACY_THEME_ANIMATION_ALIASES[rawAnimation] || rawAnimation;
    if (!nextAnimation) return;
    normalized[slot] = AVAILABLE_THEME_ANIMATIONS.includes(nextAnimation)
      ? nextAnimation
      : (safeFallback[slot] || 'none');
  });

  return normalized;
};

const scopeSelectorList = (selectorText, scopeSelector) =>
  selectorText
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean)
    .map((selector) => {
      if (selector.includes(scopeSelector)) return selector;
      if (selector === ':root' || selector === 'html' || selector === 'body') {
        return scopeSelector;
      }
      if (selector.startsWith('html ') || selector.startsWith('body ')) {
        return `${scopeSelector} ${selector.replace(/^(html|body)\s+/, '')}`.trim();
      }
      return `${scopeSelector} ${selector}`;
    })
    .join(', ');

const scopeCssContent = (css, scopeSelector) => {
  let cursor = 0;
  let result = '';

  while (cursor < css.length) {
    const openIndex = css.indexOf('{', cursor);
    if (openIndex === -1) {
      result += css.slice(cursor);
      break;
    }

    const prelude = css.slice(cursor, openIndex).trim();
    let depth = 1;
    let closeIndex = openIndex + 1;

    while (closeIndex < css.length && depth > 0) {
      const char = css[closeIndex];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      closeIndex += 1;
    }

    const blockContent = css.slice(openIndex + 1, closeIndex - 1);

    if (!prelude) {
      result += css.slice(cursor, closeIndex);
      cursor = closeIndex;
      continue;
    }

    if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face')) {
      result += `${prelude}{${blockContent}}`;
      cursor = closeIndex;
      continue;
    }

    if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@layer')) {
      result += `${prelude}{${scopeCssContent(blockContent, scopeSelector)}}`;
      cursor = closeIndex;
      continue;
    }

    result += `${scopeSelectorList(prelude, scopeSelector)}{${blockContent}}`;
    cursor = closeIndex;
  }

  return result;
};

export const scopeCustomCss = (css, scopeSelector = '[data-theme-scope="trust-app"]') => {
  const safeCss = sanitizeCustomCss(css);
  if (!safeCss) return '';
  return scopeCssContent(safeCss, scopeSelector).trim();
};

export const DEFAULT_THEME_CONFIG = {
  footer: { bg_color_1: '#1F3A8A', bg_color_2: '#1E40AF', text_color: '#ffffff', gradient_type: 'linear', gradient_angle: 90 },
  navbar: { blur: 8, opacity: 0.94, bg_color_1: '#FFF7ED', bg_color_2: '#FEE2E2', text_color: '#111827', gradient_type: 'linear', gradient_angle: 120 },
  marquee: { bg_color_1: '#EF4444', bg_color_2: '#1E3A8A', text_color: '#ffffff', gradient_type: 'linear', gradient_angle: 90 },
  page_bg: { bg_color_1: '#FFF7ED', bg_color_2: '#FEE2E2', gradient_type: 'linear', gradient_angle: 160 },
  sidebar: {
    blur: 12,
    opacity: 0.97,
    bg_color_1: '#FFFFFF',
    bg_color_2: '#FFF1F2',
    text_color: '#111827',
    contact_us_text_color: '#111827',
    button_color: '#EF4444',
    gradient_type: 'linear',
    button_text_color: '#ffffff'
  },
  typography: {
    font_family: 'Inter',
    heading_color: '#111827',
    body_text_color: '#374151',
    subheading_color: '#1F2937',
    component_overrides: {
      footer_text: null,
      navbar_text: '#111827',
      marquee_text: '#ffffff',
      sidebar_text: '#111827'
    }
  },
  app_buttons: { bg_color_1: '#EF4444', bg_color_2: '#1E3A8A', icon_color: '#ffffff', text_color: '#ffffff', gradient_type: 'linear' },
  advertisement: {
    bg_color: '#FFF1F2',
    bg_color_1: '#FFF1F2',
    bg_color_2: '#FFE4E6',
    bg_opacity: 1,
    gradient_type: 'linear',
    gradient_angle: 135,
    text_color: '#1F2937',
    title_color: '#1F2937',
    subtitle_color: '#475569',
    description_color: '#64748B',
    border_color_1: '#EF4444',
    border_color_2: '#1E3A8A',
    card_bg_color: '#FFFFFF',
    card_bg_opacity: 0.93,
    badge_bg_color: '#E2E8F0',
    badge_text_color: '#1E3A8A',
    badge_dot_color: '#EF4444',
    pattern_color: '#E2E8F0',
    glow_color_1: '#EF4444',
    glow_color_2: '#1E3A8A',
    photo_ring_color_1: '#EF4444',
    photo_ring_color_2: '#1E3A8A',
    indicator_active_color_1: '#EF4444',
    indicator_active_color_2: '#1E3A8A',
    indicator_inactive_color: '#94A3B8',
    empty_text_color: '#64748B',
    skeleton_color: '#E2E8F0'
  },
  quick_actions: { bg_color_1: '#EF4444', bg_color_2: '#1E3A8A', text_color: '#ffffff', gradient_type: 'linear', icon_bg_color: '#ffffff' }
};

export const DEFAULT_THEME = {
  primary: '#EF4444',
  secondary: '#1E3A8A',
  accent: '#FEE2E2',
  accentBg: '#FFF7ED',
  navbarBg: 'linear-gradient(120deg, rgba(255,247,237,0.94), rgba(254,226,226,0.94))',
  pageBg: 'linear-gradient(160deg,#FFF7ED 0%,#FEE2E2 100%)',
  sidebarBg: '#FFFFFF',
  marqueeBg: 'linear-gradient(90deg,#EF4444,#1E3A8A)',
  homeLayout: DEFAULT_HOME_LAYOUT,
  animations: DEFAULT_THEME_ANIMATIONS,
  customCss: '',
  templateKey: 'mahila',
  themeConfig: DEFAULT_THEME_CONFIG,
  template: null,
  trustId: null
};

export const mergeResolvedThemes = (baseTheme, selectedTheme) => {
  const safeBase = baseTheme || DEFAULT_THEME;
  if (!selectedTheme) return { ...safeBase };

  const merged = deepMerge(safeBase, selectedTheme);
  merged.homeLayout = normalizeHomeLayout(
    selectedTheme.homeLayout,
    normalizeHomeLayout(safeBase.homeLayout, DEFAULT_THEME.homeLayout)
  );
  merged.animations = normalizeThemeAnimations(
    isPlainObject(selectedTheme.animations)
      ? deepMerge(safeBase.animations || DEFAULT_THEME.animations, selectedTheme.animations)
      : (safeBase.animations || DEFAULT_THEME.animations),
    safeBase.animations || DEFAULT_THEME.animations
  );
  merged.customCss = selectedTheme.customCss || safeBase.customCss || '';
  merged.template = selectedTheme.template || safeBase.template || null;
  merged.templateId = selectedTheme.templateId || safeBase.templateId || null;
  merged.templateUpdatedAt = selectedTheme.templateUpdatedAt || safeBase.templateUpdatedAt || null;
  merged.trustId = selectedTheme.trustId || safeBase.trustId || null;
  return merged;
};

const hexToRgb = (hex) => {
  const value = String(hex || '').trim().replace('#', '');
  if (!/^[\da-fA-F]{3,8}$/.test(value)) return null;
  const normalized = value.length === 3
    ? value.split('').map((part) => part + part).join('')
    : value.slice(0, 6);
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) return null;
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
};

const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;

const mixHex = (base, target, ratio) => {
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);
  if (!baseRgb || !targetRgb) return base;
  const t = clamp(Number(ratio) || 0, 0, 1);
  return rgbToHex({
    r: baseRgb.r + (targetRgb.r - baseRgb.r) * t,
    g: baseRgb.g + (targetRgb.g - baseRgb.g) * t,
    b: baseRgb.b + (targetRgb.b - baseRgb.b) * t
  });
};

const shiftHex = (base, amount) => {
  const rgb = hexToRgb(base);
  if (!rgb) return base;
  return rgbToHex({
    r: rgb.r + amount,
    g: rgb.g + amount,
    b: rgb.b + amount
  });
};

const withOpacity = (color, opacity) => {
  if (opacity === null || opacity === undefined) return color;
  const alpha = clamp(Number(opacity), 0, 1);
  if (Number.isNaN(alpha)) return color;
  const rgb = hexToRgb(color);
  if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  return color;
};

export const buildGradient = ({
  bg_color_1,
  bg_color_2,
  gradient_type,
  gradient_angle
} = {}) => {
  if (typeof bg_color_1 === 'string' && bg_color_1.trim().startsWith('linear-gradient(')) {
    return bg_color_1.trim();
  }
  if (typeof bg_color_1 === 'string' && bg_color_1.trim().startsWith('radial-gradient(')) {
    return bg_color_1.trim();
  }
  if (typeof bg_color_1 === 'string' && bg_color_1.trim().startsWith('conic-gradient(')) {
    return bg_color_1.trim();
  }

  // Support legacy/simple direct string shape:
  // page_bg: "linear-gradient(...)"
  if (typeof bg_color_1 === 'string' && !bg_color_2 && !gradient_type && !gradient_angle && bg_color_1.trim()) {
    return bg_color_1.trim();
  }

  const color1 = bg_color_1 || bg_color_2 || '#ffffff';
  const color2 = bg_color_2 || bg_color_1 || color1;
  const type = String(gradient_type || 'none').trim().toLowerCase();
  const angle = Number.isFinite(Number(gradient_angle)) ? Number(gradient_angle) : 135;

  if (type === 'linear') return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
  if (type === 'radial') return `radial-gradient(circle, ${color1}, ${color2})`;
  if (type === 'conic') return `conic-gradient(from ${angle}deg, ${color1}, ${color2})`;
  return color1;
};

const buildSurfaceBackground = (config, fallback) => {
  const gradient = buildGradient(config);
  const type = String(config?.gradient_type || 'none').trim().toLowerCase();
  if (type !== 'none') return gradient || fallback;
  if (config?.bg_color_1 && config?.opacity !== undefined && config?.opacity !== null) {
    return withOpacity(config.bg_color_1, config.opacity);
  }
  return gradient || fallback;
};

export const buildThemeFromTemplate = ({
  templateRow,
  trustOverrides,
  trustId
} = {}) => {
  if (!templateRow) {
    return {
      ...DEFAULT_THEME,
      trustId: trustId || null
    };
  }

  const baseConfig = parseJsonObject(templateRow.theme_config, DEFAULT_THEME_CONFIG);
  const overrideConfig = parseJsonObject(trustOverrides, {});
  const themeConfig = deepMerge(DEFAULT_THEME_CONFIG, deepMerge(baseConfig, overrideConfig));

  const navbar = themeConfig.navbar || {};
  const pageBg = themeConfig.page_bg || {};
  const sidebar = themeConfig.sidebar || {};
  const marquee = themeConfig.marquee || {};
  const quickActions = themeConfig.quick_actions || {};
  const appButtons = themeConfig.app_buttons || {};
  const footer = themeConfig.footer || {};
  const primary = themeConfig.primary_color
    || quickActions.bg_color_1
    || appButtons.bg_color_1
    || marquee.bg_color_1
    || DEFAULT_THEME.primary;
  const secondary = themeConfig.secondary_color
    || navbar.bg_color_1
    || footer.bg_color_1
    || DEFAULT_THEME.secondary;
  const accent = themeConfig.accent_color
    || pageBg.bg_color_2
    || DEFAULT_THEME.accent;
  const accentBg = themeConfig.accent_bg
    || pageBg.bg_color_1
    || DEFAULT_THEME.accentBg;

  const resolvedHomeLayout = sanitizeArrayOfStrings(
    templateRow.home_layout,
    DEFAULT_THEME.homeLayout
  );
  const resolvedAnimations = normalizeThemeAnimations(
    isPlainObject(templateRow.animations)
      ? templateRow.animations
      : DEFAULT_THEME.animations,
    DEFAULT_THEME.animations
  );

  const resolvedPageBg = typeof pageBg === 'string'
    ? pageBg
    : buildGradient(pageBg);

  return {
    primary,
    secondary,
    accent,
    accentBg,
    navbarBg: buildSurfaceBackground(navbar, DEFAULT_THEME.navbarBg),
    pageBg: resolvedPageBg,
    sidebarBg: buildSurfaceBackground(sidebar, DEFAULT_THEME.sidebarBg),
    marqueeBg: buildGradient(marquee),
    homeLayout: normalizeHomeLayout(resolvedHomeLayout, DEFAULT_THEME.homeLayout),
    animations: resolvedAnimations,
    customCss: sanitizeCustomCss(templateRow.custom_css || ''),
    templateKey: templateRow.template_key || 'mahila',
    themeConfig,
    template: templateRow,
    templateId: templateRow.id || null,
    templateUpdatedAt: templateRow.updated_at || null,
    trustId: trustId || templateRow.trust_id || null
  };
};

export const getThemeToken = (theme, path, fallback, baseTheme = DEFAULT_THEME) => {
  const safeTheme = theme || DEFAULT_THEME;
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) return fallback;

  const configPath = normalizedPath.startsWith('theme_config.')
    ? normalizedPath.replace(/^theme_config\./, '')
    : normalizedPath;

  const selectedConfigValue = readConfigToken(safeTheme?.selectedThemeConfigRaw, configPath);
  if (selectedConfigValue !== undefined) return selectedConfigValue;

  const resolveFromTheme = (targetTheme) => {
    if (!targetTheme) return undefined;
    const configValue = readPath(targetTheme?.themeConfig, configPath);
    if (configValue !== undefined && configValue !== null && configValue !== '') return configValue;

    const topLevelMap = {
      primary_color: targetTheme.primary,
      secondary_color: targetTheme.secondary,
      accent_color: targetTheme.accent,
      accent_bg: targetTheme.accentBg
    };
    if (Object.prototype.hasOwnProperty.call(topLevelMap, configPath)) {
      const mapped = topLevelMap[configPath];
      if (mapped !== undefined && mapped !== null && mapped !== '') return mapped;
    }

    const directValue = readPath(targetTheme, normalizedPath);
    if (directValue !== undefined && directValue !== null && directValue !== '') return directValue;
    return undefined;
  };

  const currentValue = resolveFromTheme(safeTheme);
  if (currentValue !== undefined) return currentValue;

  const baseConfigValue = readConfigToken(safeTheme?.baseThemeConfigRaw, configPath);
  if (baseConfigValue !== undefined) return baseConfigValue;

  const baseValue = resolveFromTheme(baseTheme);
  if (baseValue !== undefined) return baseValue;

  return fallback;
};

export const getFooterThemeStyles = (theme, baseTheme = DEFAULT_THEME) => {
  const bgColor1 = getThemeToken(
    theme,
    'footer.bg_color_1',
    DEFAULT_THEME_CONFIG.footer.bg_color_1,
    baseTheme
  );
  const bgColor2 = getThemeToken(theme, 'footer.bg_color_2', null, baseTheme);
  const gradientType = getThemeToken(
    theme,
    'footer.gradient_type',
    DEFAULT_THEME_CONFIG.footer.gradient_type,
    baseTheme
  );
  const resolvedFooterText = resolveFooterTextColor(theme, baseTheme);

  const footerConfig = {
    bg_color_1: bgColor1,
    bg_color_2: bgColor2,
    text_color: getThemeToken(theme, 'footer.text_color', DEFAULT_THEME_CONFIG.footer.text_color, baseTheme),
    gradient_type: gradientType
  };

  return {
    footerConfig,
    backgroundStyle: buildGradient(footerConfig),
    textColor: resolvedFooterText.color,
    textColorSource: resolvedFooterText.source,
    usingTypographyOverride: String(resolvedFooterText.source || '').includes('typography.component_overrides.footer_text')
  };
};

export const resolveFooterTextColor = (theme, baseTheme = DEFAULT_THEME) => {
  const selectedConfig = theme?.selectedThemeConfigRaw || null;
  const baseConfig = theme?.baseThemeConfigRaw || null;

  const selectedFooterTextOverride = readConfigToken(selectedConfig, 'typography.component_overrides.footer_text');
  if (hasTokenValue(selectedFooterTextOverride)) {
    return {
      color: selectedFooterTextOverride,
      source: 'selected.typography.component_overrides.footer_text'
    };
  }

  const selectedFooterTextColor = readConfigToken(selectedConfig, 'footer.text_color');
  if (hasTokenValue(selectedFooterTextColor)) {
    return {
      color: selectedFooterTextColor,
      source: 'selected.footer.text_color'
    };
  }

  const baseFooterTextOverride = readConfigToken(baseConfig, 'typography.component_overrides.footer_text');
  if (hasTokenValue(baseFooterTextOverride)) {
    return {
      color: baseFooterTextOverride,
      source: 'base.typography.component_overrides.footer_text'
    };
  }

  const baseFooterTextColor = readConfigToken(baseConfig, 'footer.text_color');
  if (hasTokenValue(baseFooterTextColor)) {
    return {
      color: baseFooterTextColor,
      source: 'base.footer.text_color'
    };
  }

  return {
    color: getThemeToken(theme, 'footer.text_color', DEFAULT_THEME_CONFIG.footer.text_color || '#ffffff', baseTheme),
    source: 'fallback'
  };
};

export const getNavbarThemeStyles = (theme, baseTheme = DEFAULT_THEME) => {
  const effects = resolveNavbarEffects(theme, baseTheme);
  const background = resolveNavbarBackground(theme, baseTheme, effects.opacityValue);
  const text = resolveNavbarTextColor(theme, baseTheme);
  return {
    navbarConfig: background.navbarConfig,
    backgroundStyle: background.backgroundStyle,
    backgroundSource: background.source,
    textColor: text.color,
    textColorSource: text.source,
    blurPx: effects.blurPx,
    blurSource: effects.blurSource,
    opacity: effects.opacity,
    opacitySource: effects.opacitySource,
    opacityValue: effects.opacityValue
  };
};

export const resolveNavbarTextColor = (theme, baseTheme = DEFAULT_THEME) => {
  const explicitNavbarText = readRawThemeConfigToken(theme, 'navbar.text_color');
  if (hasTokenValue(explicitNavbarText.value)) {
    return {
      color: explicitNavbarText.value,
      source: explicitNavbarText.source
    };
  }

  const navbarTextColor = getThemeToken(
    theme,
    'navbar.text_color',
    null,
    baseTheme
  );
  if (hasTokenValue(navbarTextColor)) {
    return {
      color: navbarTextColor,
      source: 'navbar.text_color'
    };
  }

  return {
    color: '#111827',
    source: 'fallback'
  };
};

export const resolveNavbarEffects = (theme, baseTheme = DEFAULT_THEME) => {
  const blurToken = getThemeToken(theme, 'navbar.blur', null, baseTheme);
  const opacityToken = getThemeToken(theme, 'navbar.opacity', null, baseTheme);

  const blurValue = Number(blurToken);
  const opacityValue = Number(opacityToken);
  const safeBlur = Number.isFinite(blurValue) ? blurValue : DEFAULT_THEME_CONFIG.navbar.blur;
  const safeOpacity = clamp(Number.isFinite(opacityValue) ? opacityValue : DEFAULT_THEME_CONFIG.navbar.opacity, 0, 1);

  return {
    blurPx: `${safeBlur}px`,
    blurSource: hasTokenValue(blurToken) ? 'navbar.blur' : 'fallback',
    opacity: `${safeOpacity}`,
    opacitySource: hasTokenValue(opacityToken) ? 'navbar.opacity' : 'fallback',
    opacityValue: safeOpacity
  };
};

export const resolveNavbarBackground = (theme, baseTheme = DEFAULT_THEME, opacityValue = 1) => {
  const selectedConfig = theme?.selectedThemeConfigRaw || null;
  const baseConfig = theme?.baseThemeConfigRaw || null;
  const currentConfig = theme?.themeConfig || null;

  const readNavbarToken = (path) => {
    const selectedValue = readConfigToken(selectedConfig, path);
    if (selectedValue !== undefined) return { value: selectedValue, source: `selected.${path}` };
    const baseValue = readConfigToken(baseConfig, path);
    if (baseValue !== undefined) return { value: baseValue, source: `base.${path}` };
    const currentValue = readConfigToken(currentConfig, path);
    if (currentValue !== undefined) return { value: currentValue, source: `merged.${path}` };
    return { value: undefined, source: null };
  };

  const bg1Token = readNavbarToken('navbar.bg_color_1');
  const bg2Token = readNavbarToken('navbar.bg_color_2');
  const gradientTypeToken = readNavbarToken('navbar.gradient_type');
  const gradientAngleToken = readNavbarToken('navbar.gradient_angle');
  const hasCompleteNavbarConfig = hasTokenValue(bg1Token.value) && hasTokenValue(gradientTypeToken.value);

  if (hasCompleteNavbarConfig) {
    const navbarConfig = {
      bg_color_1: withOpacity(bg1Token.value, opacityValue),
      bg_color_2: hasTokenValue(bg2Token.value) ? withOpacity(bg2Token.value, opacityValue) : withOpacity(bg1Token.value, opacityValue),
      gradient_type: gradientTypeToken.value,
      gradient_angle: Number.isFinite(Number(gradientAngleToken.value)) ? Number(gradientAngleToken.value) : undefined
    };
    return {
      navbarConfig,
      backgroundStyle: buildGradient(navbarConfig),
      source: 'navbar.config'
    };
  }

  const navbarBgToken = getThemeToken(theme, 'navbar_bg', null, baseTheme);
  if (hasTokenValue(navbarBgToken)) {
    const navbarBgWithOpacity = withOpacity(navbarBgToken, opacityValue);
    return {
      navbarConfig: null,
      backgroundStyle: navbarBgWithOpacity,
      source: 'navbar_bg'
    };
  }

  return {
    navbarConfig: null,
    backgroundStyle: DEFAULT_THEME.navbarBg,
    source: 'fallback'
  };
};

export const getQuickActionsThemeStyles = (theme, baseTheme = DEFAULT_THEME) => {
  const quickActionsConfig = {
    bg_color_1: getThemeToken(theme, 'quick_actions.bg_color_1', DEFAULT_THEME_CONFIG.quick_actions.bg_color_1, baseTheme),
    bg_color_2: getThemeToken(theme, 'quick_actions.bg_color_2', DEFAULT_THEME_CONFIG.quick_actions.bg_color_2, baseTheme),
    gradient_type: getThemeToken(theme, 'quick_actions.gradient_type', DEFAULT_THEME_CONFIG.quick_actions.gradient_type, baseTheme)
  };
  const textColor = getThemeToken(theme, 'quick_actions.text_color', DEFAULT_THEME_CONFIG.quick_actions.text_color, baseTheme);
  const iconBgColor = getThemeToken(theme, 'quick_actions.icon_bg_color', DEFAULT_THEME_CONFIG.quick_actions.icon_bg_color, baseTheme);
  return {
    quickActionsConfig,
    backgroundStyle: buildGradient(quickActionsConfig),
    textColor,
    iconBgColor
  };
};

export const getAppButtonsThemeStyles = (theme, baseTheme = DEFAULT_THEME) => {
  const appButtonsConfig = {
    bg_color_1: getThemeToken(theme, 'app_buttons.bg_color_1', DEFAULT_THEME_CONFIG.app_buttons.bg_color_1, baseTheme),
    bg_color_2: getThemeToken(theme, 'app_buttons.bg_color_2', DEFAULT_THEME_CONFIG.app_buttons.bg_color_2, baseTheme),
    gradient_type: getThemeToken(theme, 'app_buttons.gradient_type', DEFAULT_THEME_CONFIG.app_buttons.gradient_type, baseTheme)
  };
  return {
    appButtonsConfig,
    backgroundStyle: buildGradient(appButtonsConfig),
    textColor: getThemeToken(theme, 'app_buttons.text_color', DEFAULT_THEME_CONFIG.app_buttons.text_color, baseTheme),
    iconColor: getThemeToken(theme, 'app_buttons.icon_color', DEFAULT_THEME_CONFIG.app_buttons.icon_color, baseTheme)
  };
};

export const applyThemeCssVariables = (theme, root = document.documentElement) => {
  const safeTheme = theme || DEFAULT_THEME;
  const config = safeTheme.themeConfig || DEFAULT_THEME_CONFIG;
  const pageBg = config.page_bg || {};
  const sidebar = config.sidebar || {};
  const marquee = config.marquee || {};
  const typography = config.typography || {};
  const advertisement = config.advertisement || {};
  const typographyOverrides = typography.component_overrides || {};
  const navbarTheme = getNavbarThemeStyles(safeTheme, DEFAULT_THEME);
  const footerTheme = getFooterThemeStyles(safeTheme, DEFAULT_THEME);
  const quickActionsTheme = getQuickActionsThemeStyles(safeTheme, DEFAULT_THEME);
  const appButtonsTheme = getAppButtonsThemeStyles(safeTheme, DEFAULT_THEME);
  const resolvedNavbarTextToken = getThemeToken(
    safeTheme,
    'navbar.text_color',
    DEFAULT_THEME_CONFIG.navbar.text_color,
    DEFAULT_THEME
  );

  const primary = safeTheme.primary || DEFAULT_THEME.primary;
  const secondary = safeTheme.secondary || DEFAULT_THEME.secondary;
  const accent = safeTheme.accent || DEFAULT_THEME.accent;
  const accentBg = safeTheme.accentBg || DEFAULT_THEME.accentBg;
  const navbarBg = navbarTheme.backgroundStyle || safeTheme.navbarBg || DEFAULT_THEME.navbarBg;
  const pageBackground = safeTheme.pageBg
    || (typeof pageBg === 'string' ? pageBg : buildGradient(pageBg));
  const sidebarBg = safeTheme.sidebarBg || buildSurfaceBackground(sidebar, DEFAULT_THEME.sidebarBg);
  const marqueeBg = safeTheme.marqueeBg || buildGradient(marquee);

  root.style.setProperty('--brand-red', primary);
  root.style.setProperty('--brand-red-dark', shiftHex(primary, -36));
  root.style.setProperty('--brand-red-mid', shiftHex(primary, 22));
  root.style.setProperty('--brand-red-light', mixHex(primary, '#ffffff', 0.86));
  root.style.setProperty('--brand-navy', secondary);
  root.style.setProperty('--brand-navy-dark', shiftHex(secondary, -32));
  root.style.setProperty('--brand-navy-light', mixHex(secondary, '#ffffff', 0.88));
  root.style.setProperty('--app-accent', accent);
  root.style.setProperty('--app-accent-bg', accentBg);
  root.style.setProperty('--app-navbar-bg', navbarBg);
  root.style.setProperty('--app-page-bg', pageBackground);

  root.style.setProperty('--page-bg', pageBackground);
  root.style.setProperty('--navbar-bg', navbarBg);
  root.style.setProperty('--navbar-text', navbarTheme.textColor);
  root.style.setProperty('--navbar-blur', navbarTheme.blurPx);
  root.style.setProperty('--navbar-opacity', navbarTheme.opacity);
  root.style.setProperty('--navbar-accent', `linear-gradient(90deg, ${secondary}, ${primary}, ${secondary})`);
  root.style.setProperty('--navbar-border', withOpacity(primary, 0.12));

  root.style.setProperty('--sidebar-bg', sidebarBg);
  root.style.setProperty('--sidebar-text', typographyOverrides.sidebar_text || sidebar.text_color || '#111827');
  root.style.setProperty('--sidebar-blur', `${Number(sidebar.blur) || 12}px`);
  root.style.setProperty('--sidebar-opacity', `${clamp(Number(sidebar.opacity ?? 1), 0, 1)}`);
  root.style.setProperty('--sidebar-button-bg', sidebar.button_color || primary);
  root.style.setProperty('--sidebar-button-text', sidebar.button_text_color || '#ffffff');
  root.style.setProperty('--sidebar-border', withOpacity(primary, 0.1));
  root.style.setProperty('--sidebar-accent', `linear-gradient(90deg, ${primary}, ${secondary}, ${primary})`);

  root.style.setProperty('--marquee-bg', marqueeBg);
  root.style.setProperty('--marquee-text', typographyOverrides.marquee_text || marquee.text_color || '#ffffff');

  root.style.setProperty('--footer-bg', footerTheme.backgroundStyle);
  root.style.setProperty('--footer-text', footerTheme.textColor);
  root.style.setProperty('--footer-border', withOpacity(footerTheme.textColor, 0.24));
  root.style.setProperty('--footer-accent', withOpacity(footerTheme.textColor, 0.45));
  root.style.setProperty('--quick-actions-bg', quickActionsTheme.backgroundStyle);
  root.style.setProperty('--quick-actions-text', quickActionsTheme.textColor);
  root.style.setProperty('--quick-actions-icon-bg', quickActionsTheme.iconBgColor);
  root.style.setProperty('--app-button-bg', appButtonsTheme.backgroundStyle);
  root.style.setProperty('--app-button-text', appButtonsTheme.textColor);
  root.style.setProperty('--app-button-icon', appButtonsTheme.iconColor);
  const advertisementBgBase = advertisement.bg_color_1 || advertisement.bg_color || accent;
  const advertisementBg2 = advertisement.bg_color_2 || advertisementBgBase;
  const advertisementGradientType = advertisement.gradient_type || 'none';
  const advertisementGradientAngle = Number.isFinite(Number(advertisement.gradient_angle)) ? Number(advertisement.gradient_angle) : 135;
  const advertisementBgStyle = advertisementGradientType !== 'none'
    ? buildGradient({
      bg_color_1: withOpacity(advertisementBgBase, advertisement.bg_opacity ?? 1),
      bg_color_2: withOpacity(advertisementBg2, advertisement.bg_opacity ?? 1),
      gradient_type: advertisementGradientType,
      gradient_angle: advertisementGradientAngle
    })
    : withOpacity(advertisementBgBase, advertisement.bg_opacity ?? 1);

  root.style.setProperty('--advertisement-bg', advertisementBgStyle);
  root.style.setProperty('--advertisement-text', advertisement.text_color || secondary);
  root.style.setProperty('--advertisement-title', advertisement.title_color || advertisement.text_color || secondary);
  root.style.setProperty('--advertisement-subtitle', advertisement.subtitle_color || advertisement.text_color || secondary);
  root.style.setProperty('--advertisement-description', advertisement.description_color || advertisement.text_color || secondary);
  root.style.setProperty('--advertisement-badge-bg', advertisement.badge_bg_color || accentBg);
  root.style.setProperty('--advertisement-badge-text', advertisement.badge_text_color || primary);
  root.style.setProperty('--advertisement-badge-dot', advertisement.badge_dot_color || primary);
  root.style.setProperty('--advertisement-card-bg', advertisement.card_bg_color || '#FFFFFF');
  root.style.setProperty('--advertisement-card-border', advertisement.card_border_color || advertisement.border_color_1 || primary);
  root.style.setProperty('--advertisement-card-shadow', advertisement.card_shadow_color || secondary);

  root.style.setProperty('--font-family', typography.font_family || DEFAULT_THEME_CONFIG.typography.font_family);
  root.style.setProperty('--heading-color', typography.heading_color || '#111827');
  root.style.setProperty('--subheading-color', typography.subheading_color || secondary);
  root.style.setProperty('--body-text-color', typography.body_text_color || '#374151');

  if (import.meta.env.DEV) {
    console.log('[Theme][AppliedCSSVars]', {
      selectedTrustId: safeTheme.selectedTrustId || safeTheme.trustId || null,
      templateId: safeTheme.templateId || null,
      templateUpdatedAt: safeTheme.templateUpdatedAt || null,
      baseTemplateUpdatedAt: safeTheme.baseTemplateUpdatedAt || null,
      selectedTemplateUpdatedAt: safeTheme.selectedTemplateUpdatedAt || null,
      source: safeTheme.themeLoadSource || 'unknown',
      navbar: {
        bg: navbarBg,
        bgSource: navbarTheme.backgroundSource,
        dbNavbarTextToken: resolvedNavbarTextToken,
        text: navbarTheme.textColor,
        textSource: navbarTheme.textColorSource,
        blur: navbarTheme.blurPx,
        blurSource: navbarTheme.blurSource,
        opacity: navbarTheme.opacity,
        opacitySource: navbarTheme.opacitySource
      },
      footer: {
        bg: footerTheme.backgroundStyle,
        text: footerTheme.textColor
      },
      quickActions: {
        bg: quickActionsTheme.backgroundStyle,
        text: quickActionsTheme.textColor
      },
      page: {
        background: pageBackground
      },
      appButtons: {
        bg: appButtonsTheme.backgroundStyle,
        text: appButtonsTheme.textColor,
        icon: appButtonsTheme.iconColor
      },
      advertisement: {
        background: advertisementBgStyle,
        title: advertisement.title_color || null,
        subtitle: advertisement.subtitle_color || null,
        description: advertisement.description_color || null
      },
      typography: {
        fontFamily: typography.font_family || DEFAULT_THEME_CONFIG.typography.font_family,
        heading: typography.heading_color || '#111827',
        body: typography.body_text_color || '#374151'
      }
    });
  }
};
