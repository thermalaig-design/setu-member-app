import React, { createContext, useContext } from 'react';
import { DEFAULT_THEME, getThemeToken } from '../utils/themeUtils';

/**
 * ThemeContext - makes the active trust theme + full theme_config available app-wide.
 *
 * App.jsx sets CSS variables on :root whenever appTheme changes.
 * Components can:
 *   a) Use CSS vars in styles: var(--page-bg), var(--navbar-bg), etc.
 *   b) Read raw values (including themeConfig) with useAppTheme().
 */
export const ThemeContext = createContext(DEFAULT_THEME);

/** Hook - call this inside any page/component to get the live theme object. */
export const useAppTheme = () => useContext(ThemeContext);

/** Token hook - resolves nested theme_config path with safe fallback. */
export const useThemeToken = (path, fallback) => {
  const theme = useAppTheme();
  return getThemeToken(theme, path, fallback);
};
