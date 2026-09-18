import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { RESERVED_APP_ROUTES } from './src/constants/reservedRoutes.js'

// Dev/preview-only convenience proxy: in production, Nginx forwards
// /pwa-manifest/<slug>.webmanifest to the generate-webApp-link Supabase Edge
// Function. Vite's local servers have no such backend, so without this the
// request falls through to the SPA's own index.html — invalid JSON, which
// makes Chrome report the manifest as unparsable and blocks installability
// locally. This only forwards the request; it does not change the Edge
// Function, Nginx, or the manifest itself.
const createPwaManifestProxy = (supabaseUrl) => ({
  '^/pwa-manifest/.+\\.webmanifest$': {
    target: supabaseUrl,
    changeOrigin: true,
    rewrite: (path) => {
      const match = path.match(/^\/pwa-manifest\/([a-z0-9-]+)\.webmanifest$/i);
      const slug = match ? match[1].toLowerCase() : '';
      return `/functions/v1/generate-webApp-link?slug=${encodeURIComponent(slug)}`;
    }
  }
});

// Replaces the __SETU_RESERVED_APP_ROUTES__ placeholder in index.html's
// early manifest-injection script with the real reserved-routes list, so
// that inline bootstrap script (which runs before any JS module, including
// src/constants/reservedRoutes.js itself, has loaded) uses the exact same
// list as isReservedSlug() rather than a hand-duplicated copy that could
// drift out of sync.
const injectReservedAppRoutes = () => ({
  name: 'inject-reserved-app-routes',
  transformIndexHtml(html) {
    return html.replace('__SETU_RESERVED_APP_ROUTES__', JSON.stringify(RESERVED_APP_ROUTES));
  }
});

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const pwaManifestProxy = env.VITE_SUPABASE_URL ? createPwaManifestProxy(env.VITE_SUPABASE_URL) : undefined;
  // The website is deployed under /_setu-app/ (Nginx serves the member app
  // from that subpath — see TenantLanding.jsx's SETU_POWERED_LOGO comment
  // and the generate-webApp-link Edge Function's APP_SHELL_URL). Capacitor's
  // Android/iOS WebView instead serves this same `dist` output from its own
  // root, so a build carrying that prefix leaves every asset URL 404ing —
  // the app installs and shows its native splash screen, then a permanently
  // blank WebView, since no JS ever loads. `npm run build:capacitor` (mode
  // "capacitor", see .env.capacitor) is the only thing that should ever set
  // this; the ordinary website build/deploy is untouched.
  const isCapacitorBuild = env.VITE_CAPACITOR_BUILD === 'true';

  return {
    base: (command === 'serve' || isCapacitorBuild) ? '/' : '/_setu-app/',
    server: {
      proxy: pwaManifestProxy
    },
    preview: {
      proxy: pwaManifestProxy
    },
    plugins: [
      react(),
      injectReservedAppRoutes(),
      VitePWA({
        registerType: 'autoUpdate',
        // The manifest is served dynamically per Trust at
        // /pwa-manifest/<slug>.webmanifest (see src/utils/pwaManifest.js) —
        // never let this plugin generate/link a static one.
        manifest: false,
        injectRegister: 'auto',
        // Assets are built with base '/_setu-app/', but the service worker
        // registration script itself is still served from the domain root
        // (base: '/', independent of the asset base). Tenant web apps are
        // intentionally grouped under /app/<slug> (e.g. /app/setu,
        // /app/abc-association), so the SW's effective scope is narrowed to
        // that prefix — it controls those tenant routes without reaching
        // into unrelated top-level routes (/login, /notices, etc.) or the
        // separate marketing site at '/'.
        base: '/',
        scope: '/app/',
        // Only ever register a service worker for production builds — never
        // during `npm run dev`.
        devOptions: {
          enabled: false
        },
        workbox: {
          // The app's main bundle exceeds workbox's default 2 MiB precache
          // limit; raise it so the build doesn't fail precaching that asset.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // Disable Workbox's navigation fallback. With scope '/app/',
          // generateSW otherwise auto-registers a NavigationRoute that
          // serves the cached index.html for every navigation under that
          // scope — including /app/<slug> routes like /app/setu, which
          // Nginx already resolves correctly to the member-app index.html.
          // Without this, the service worker hijacks those document
          // navigations and replaces them with the root site's (404)
          // index.html instead of letting them hit the network/Nginx
          // normally.
          navigateFallback: null
        }
      })
    ],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || 'dev')
    }
  };
})
