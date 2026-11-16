import net from 'net';
import maxmind from 'maxmind';

// Local IP -> approximate city lookup against the GeoLite2 City database on
// this server. Lookups never leave the machine: no MaxMind web service and no
// third-party geolocation API is called. Raw IPs are never logged or stored.

const DEFAULT_CITY_DB_PATH = '/var/lib/GeoIP/GeoLite2-City.mmdb';
const INIT_RETRY_COOLDOWN_MS = 60 * 1000;
const SOURCE = 'geoip-local';

const getCityDbPath = () => process.env.GEOIP_CITY_DB_PATH || DEFAULT_CITY_DB_PATH;

// Loopback, private, link-local, CGNAT and other non-routable ranges: a GeoIP
// answer for these would be misleading, so they are never looked up.
const NON_PUBLIC_RANGES = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
].forEach(([address, prefix]) => NON_PUBLIC_RANGES.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
].forEach(([address, prefix]) => NON_PUBLIC_RANGES.addSubnet(address, prefix, 'ipv6'));

let reader = null;
let initPromise = null;
let lastInitFailureAt = 0;

/**
 * Open the City database once. Safe to call repeatedly; never throws.
 * watchForUpdates reloads the reader when geoipupdate replaces the file.
 */
export const initGeoIp = () => {
  if (reader) return Promise.resolve(true);
  if (initPromise) return initPromise;

  const dbPath = getCityDbPath();
  initPromise = maxmind
    .open(dbPath, { watchForUpdates: true, watchForUpdatesNonPersistent: true })
    .then((openedReader) => {
      reader = openedReader;
      console.log(`[GeoIP] City database loaded from ${dbPath}`);
      return true;
    })
    .catch((error) => {
      lastInitFailureAt = Date.now();
      console.error(`[GeoIP] Unable to open City database at ${dbPath}:`, error?.code || error?.message || error);
      return false;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
};

// Retries a failed startup open at most once per cooldown, so installing the
// database later works without a restart and a missing file isn't hammered.
const getReader = async () => {
  if (reader) return reader;
  if (Date.now() - lastInitFailureAt < INIT_RETRY_COOLDOWN_MS) return null;
  await initGeoIp();
  return reader;
};

/**
 * Client IP as seen by Express (`trust proxy` must be enabled behind Nginx).
 * Never reads an IP from the request body or query string.
 */
export const resolveClientIp = (req) => {
  let ip = String(req?.ip || req?.socket?.remoteAddress || '').trim();
  if (ip.toLowerCase().startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return net.isIP(ip) ? ip : null;
};

export const isPublicIp = (ip) => {
  const family = net.isIP(ip);
  if (!family) return false;
  return !NON_PUBLIC_RANGES.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};

// Debug only: 49.36.x.x / 2401:4900:x:x...
export const maskIp = (ip) => {
  if (net.isIPv4(ip)) return ip.split('.').slice(0, 2).concat(['x', 'x']).join('.');
  if (net.isIPv6(ip)) return `${ip.split(':').slice(0, 2).join(':')}:x:x::`;
  return null;
};

const EMPTY_LOCATION = Object.freeze({
  city: null,
  state: null,
  country: null,
  countryName: null,
  accuracyRadiusKm: null,
});

const toLocation = (geo) => ({
  city: geo?.city?.names?.en || null,
  state: geo?.subdivisions?.[0]?.names?.en || null,
  country: geo?.country?.iso_code || null,
  countryName: geo?.country?.names?.en || null,
  accuracyRadiusKm: geo?.location?.accuracy_radius || null,
});

/**
 * Look up the requesting client's approximate location. Never throws.
 * status: 'ok' | 'not_found' | 'non_public_ip' | 'invalid_ip' | 'unavailable'
 * Missing fields in a GeoLite record are returned as null, not as an error.
 */
export const lookupClientLocation = async (req) => {
  const ip = resolveClientIp(req);
  const result = (status, location = EMPTY_LOCATION) => ({ status, source: SOURCE, ip, ...location });

  if (!ip) return result('invalid_ip');
  if (!isPublicIp(ip)) return result('non_public_ip');

  const activeReader = await getReader();
  if (!activeReader) return result('unavailable');

  try {
    const geo = activeReader.get(ip);
    if (!geo) return result('not_found');
    return result('ok', toLocation(geo));
  } catch (error) {
    console.error('[GeoIP] Lookup failed:', error?.message || error);
    return result('unavailable');
  }
};

/**
 * Location keys for member_session.metadata, or null when there is nothing
 * meaningful to store (non-public IP, database unavailable).
 */
export const toSessionLocationMetadata = (lookup) => {
  if (!lookup || !['ok', 'not_found'].includes(lookup.status)) return null;
  return {
    city: lookup.city,
    state: lookup.state,
    country: lookup.country,
    country_name: lookup.countryName,
    location_source: lookup.source,
    accuracy_radius_km: lookup.accuracyRadiusKm,
  };
};

export const SESSION_LOCATION_KEYS = [
  'city',
  'state',
  'country',
  'country_name',
  'location_source',
  'accuracy_radius_km',
];
