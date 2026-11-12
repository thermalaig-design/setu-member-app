#!/usr/bin/env node
// Builds twa-build/twa-manifest.json (Bubblewrap input) from a tenant's
// dynamic PWA manifest.
// Usage: node scripts/make-twa-manifest.mjs <origin> <slug> <packageId> <keystorePath> <keyAlias>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

const [originArg, slug, packageId, keystorePath, keyAlias] = process.argv.slice(2);
if (!originArg || !slug || !packageId || !keystorePath || !keyAlias) {
  fail('Usage: make-twa-manifest.mjs <origin> <slug> <packageId> <keystorePath> <keyAlias>');
}
if (!/^[a-z0-9-]{1,60}$/.test(slug)) fail(`Invalid slug: ${slug}`);
if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageId)) fail(`Invalid packageId: ${packageId}`);

let originUrl;
try {
  originUrl = new URL(originArg);
} catch {
  fail(`Invalid origin: ${originArg}`);
}
if (originUrl.protocol !== 'https:') fail('Origin must be https (TWA requires HTTPS).');
const origin = originUrl.origin;

const manifestUrl = `${origin}/pwa-manifest/${slug}.webmanifest`;
let manifest;
try {
  const res = await fetch(manifestUrl, { headers: { accept: 'application/manifest+json, application/json' } });
  if (!res.ok) fail(`Manifest fetch failed: HTTP ${res.status} for ${manifestUrl}`);
  manifest = JSON.parse(await res.text());
} catch (err) {
  fail(`Could not fetch/parse manifest ${manifestUrl}: ${err.message}`);
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const resolve = (src) => new URL(src, manifestUrl).toString();
const hasSize = (icon, size) => String(icon.sizes || '').split(/\s+/).includes(size);
const isMaskable = (icon) => String(icon.purpose || '').split(/\s+/).includes('maskable');

const icon512 =
  icons.find((i) => hasSize(i, '512x512') && !isMaskable(i)) ||
  icons.find((i) => hasSize(i, '512x512'));
if (!icon512?.src) {
  fail(
    `Manifest ${manifestUrl} has no 512x512 icon (found sizes: ${
      icons.map((i) => i.sizes).join(', ') || 'none'
    }).`,
  );
}
const maskable = icons.find((i) => hasSize(i, '512x512') && isMaskable(i));

const name = String(manifest.name || manifest.short_name || slug).trim();
const launcherName = String(manifest.short_name || name).trim().slice(0, 30);
const start = manifest.start_url ? new URL(manifest.start_url, manifestUrl) : null;
const startUrl = start ? start.pathname + start.search : `/app/${slug}`;

const runNumber = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
const color = (v, d) =>
  typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d;
const theme = color(manifest.theme_color, '#ffffff');

const twa = {
  packageId,
  host: originUrl.host,
  name,
  launcherName,
  display: 'standalone',
  orientation: 'portrait',
  startUrl,
  iconUrl: resolve(icon512.src),
  ...(maskable ? { maskableIconUrl: resolve(maskable.src) } : {}),
  themeColor: theme,
  themeColorDark: theme,
  navigationColor: theme,
  navigationColorDark: theme,
  navigationDividerColor: theme,
  navigationDividerColorDark: theme,
  backgroundColor: color(manifest.background_color, '#ffffff'),
  enableNotifications: false,
  webManifestUrl: manifestUrl,
  fullScopeUrl: `${origin}/app/${slug}`,
  appVersionCode: runNumber,
  appVersion: `1.0.${runNumber}`,
  appVersionName: `1.0.${runNumber}`,
  signingKey: { path: keystorePath, alias: keyAlias },
  fallbackType: 'customtabs',
  minSdkVersion: 21,
  isChromeOSOnly: false,
  isMetaQuest: false,
  splashScreenFadeOutDuration: 300,
  generatorApp: 'bubblewrap-cli',
  features: {},
  alphaDependencies: { enabled: false },
  enableSiteSettingsShortcut: true,
  shortcuts: [],
  retainedBundles: [],
};

await mkdir('twa-build', { recursive: true });
const out = path.join('twa-build', 'twa-manifest.json');
await writeFile(out, JSON.stringify(twa, null, 2) + '\n');
console.log(`Wrote ${out} for ${packageId} (${launcherName}), versionCode ${runNumber}`);
