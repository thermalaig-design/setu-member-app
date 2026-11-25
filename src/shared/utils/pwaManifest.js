// Dynamically points <link rel="manifest"> at the tenant-specific manifest
// endpoint, and updates document title / theme-color for the resolved Trust.
// Never hardcode a slug here — it always comes from the resolved tenant.
export const applyTenantManifest = ({ slug, trust } = {}) => {
  if (typeof document === 'undefined') return;
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) return;

  let manifestLink = document.querySelector('link[rel="manifest"]');
  if (!manifestLink) {
    manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    document.head.appendChild(manifestLink);
  }
  manifestLink.setAttribute('href', `/pwa-manifest/${encodeURIComponent(normalizedSlug)}.webmanifest`);

  if (trust?.name) {
    document.title = trust.name;
  }

  if (trust?.pwa_theme_color) {
    let themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement('meta');
      themeMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute('content', trust.pwa_theme_color);
  }
};
