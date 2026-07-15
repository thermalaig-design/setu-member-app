export const THEME_REFRESH_EVENT = 'theme-refresh';
export const THEME_TEMPLATE_APPLIED_EVENT = 'theme-template-applied';

export const dispatchThemeRefresh = (detail = {}) => {
  window.dispatchEvent(new CustomEvent(THEME_REFRESH_EVENT, { detail }));
};

export const dispatchThemeTemplateApplied = (detail = {}) => {
  window.dispatchEvent(new CustomEvent(THEME_TEMPLATE_APPLIED_EVENT, { detail }));
};