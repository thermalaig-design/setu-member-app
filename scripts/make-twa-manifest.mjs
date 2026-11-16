#!/usr/bin/env node
// Builds twa-build/twa-manifest.json (Bubblewrap input) from a tenant's
// dynamic PWA manifest.
// Usage: node scripts/make-twa-manifest.mjs <origin> <slug> <packageId> <keystorePath> <keyAlias>
import { mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Local server (started by the workflow) that serves twa-build/assets.
const LOCAL_ICON_BASE = 'http://127.0.0.1:8765';

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

const area = (i) =>
  Math.max(0, ...String(i.sizes || '').split(/\s+/).map((z) => parseInt(z, 10) || 0));
const pickIcon = (list) =>
  list.find((i) => hasSize(i, '512x512')) || [...list].sort((a, b) => area(b) - area(a))[0];
const withSrc = icons.filter((i) => i && i.src);
const normalIcon = pickIcon(withSrc.filter((i) => !isMaskable(i))) || pickIcon(withSrc);
if (!normalIcon) fail(`Manifest ${manifestUrl} has no usable icons.`);
const maskableIcon = pickIcon(withSrc.filter(isMaskable));

// Bubblewrap's own fetch (tough-cookie) crashes on Set-Cookie headers for
// public-suffix domains such as .supabase.co. So download the icons here with
// Node's fetch, convert them to a real 512x512 PNG, and let Bubblewrap read
// them from a local server instead (started by the workflow).
const assetsDir = path.join('twa-build', 'assets');
await mkdir(assetsDir, { recursive: true });

const toPng = (input, output) => {
  const args = [`${input}[0]`, '-background', 'none', '-resize', '512x512', '-gravity', 'center', '-extent', '512x512', `PNG32:${output}`];
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, args, { stdio: 'pipe' });
      return;
    } catch (e) {
      if (e.code !== 'ENOENT') fail(`ImageMagick failed on ${input}: ${e.stderr || e.message}`);
    }
  }
  fail('ImageMagick (magick/convert) not found.');
};

const fetchIcon = async (icon, outName) => {
  const url = resolve(icon.src);
  let buf;
  try {
    const res = await fetch(url);
    if (!res.ok) fail(`Icon download failed: HTTP ${res.status} for ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    fail(`Icon download failed for ${url}: ${err.message}`);
  }
  const raw = path.join(assetsDir, `${outName}.src`);
  await writeFile(raw, buf);
  toPng(raw, path.join(assetsDir, outName));
  await rm(raw, { force: true });
};

await fetchIcon(normalIcon, 'icon-512.png');
if (maskableIcon) await fetchIcon(maskableIcon, 'icon-maskable-512.png');
else await copyFile(path.join(assetsDir, 'icon-512.png'), path.join(assetsDir, 'icon-maskable-512.png'));

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
  iconUrl: `${LOCAL_ICON_BASE}/icon-512.png`,
  maskableIconUrl: `${LOCAL_ICON_BASE}/icon-maskable-512.png`,
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
  minSdkVersion: 24,
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

const out = path.join('twa-build', 'twa-manifest.json');
await writeFile(out, JSON.stringify(twa, null, 2) + '\n');
console.log(`Wrote ${out} for ${packageId} (${launcherName}), versionCode ${runNumber}`);
