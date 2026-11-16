// Resolves a possibly-local asset path against Vite's configured base
// ('/' in dev, '/_setu-app/' in production) instead of the hardcoded site
// root. Full remote URLs (Supabase storage, CDNs, data URIs) are left untouched.
export const resolveAssetUrl = (path) => {
  const value = String(path || '').trim();
  if (!value) return '';
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('data:')) return value;
  if (!value.startsWith('/')) return value;
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return `${base}${value}`;
};
