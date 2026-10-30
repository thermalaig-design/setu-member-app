import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Home as HomeIcon, Menu, Rocket, Upload, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import Sidebar from './features/sidebar/Sidebar';
import { getNavbarThemeStyles, getThemeToken } from './utils/themeUtils';
import { getAppHomePath } from './utils/tenantNavigation';
import { fetchFeatureFlags } from './services/featureFlags';
import { trackAction } from './services/pageTrackingService';

const DEFAULT_PAGE_TITLE = 'Add Community';

const toTitleCase = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

// Translates known Postgres/PostgREST errors into user-facing copy instead
// of surfacing raw constraint/SQLSTATE text (e.g. `duplicate key value
// violates unique constraint "Trust_name_key"`).
const getFriendlySubmitError = (error, trustName) => {
  const code = error?.code || '';
  const message = String(error?.message || '');

  if (code === '23505' || /duplicate key value/i.test(message)) {
    if (/trust_name_key/i.test(message)) {
      return `An app named "${trustName}" already exists. Please choose a different name.`;
    }
    return 'This already exists. Please try different details.';
  }

  return message || 'Failed to create trust. Please try again.';
};

const getSampleAppLabel = (sampleApp) => sampleApp?.name || 'Untitled';

// Minimum time the launch overlay stays up before navigating, so the
// animation has room to play out even when generate-webApp-link resolves
// almost instantly. The status-line and progress-fill CSS animations below
// are keyed to this same duration.
const LAUNCH_ANIMATION_MS = 10000;
const APP_SLUG_POLL_INTERVAL_MS = 1000;
const APP_SLUG_POLL_TIMEOUT_MS = 20000;

const LAUNCH_STARS = [
  { top: '12%', left: '18%', size: '3px', delay: '0s', duration: '2.2s' },
  { top: '20%', left: '82%', size: '4px', delay: '0.4s', duration: '2.6s' },
  { top: '32%', left: '8%', size: '3px', delay: '0.8s', duration: '2s' },
  { top: '38%', left: '68%', size: '3px', delay: '1.1s', duration: '2.4s' },
  { top: '58%', left: '14%', size: '4px', delay: '0.2s', duration: '2.8s' },
  { top: '62%', left: '88%', size: '3px', delay: '1.4s', duration: '2.1s' },
  { top: '74%', left: '30%', size: '3px', delay: '0.6s', duration: '2.5s' },
  { top: '78%', left: '62%', size: '4px', delay: '1.7s', duration: '2.3s' },
  { top: '10%', left: '48%', size: '3px', delay: '1s', duration: '2.7s' },
  { top: '86%', left: '46%', size: '3px', delay: '0.3s', duration: '2.4s' },
];

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DESCRIPTION_MAX_LENGTH = 240;

// Form card styles (dark card, gold accent). Everything is scoped under `.la-`
// so it cannot leak into the rest of the app.
const LAUNCH_FORM_CSS = `
.la-card{
  --la-card:#16161e; --la-field:#1c1c26; --la-field-hover:#21212c;
  --la-border:rgba(255,255,255,.09); --la-border-strong:rgba(255,255,255,.18);
  --la-text:#f2efe8; --la-label:#d9d4c7; --la-muted:#8d8999;
  --la-gold:#d9a441; --la-gold-hi:#ecc272; --la-ring:rgba(217,164,65,.22);
  --la-err:#ff7b7b; --la-err-bg:rgba(255,92,92,.10); --la-err-border:rgba(255,92,92,.45);
  --la-ok:#4fd1a1;
  width:100%; max-width:460px; margin:0 auto; padding:32px 28px 28px; box-sizing:border-box;
  color:var(--la-text); background:var(--la-card); border:1px solid var(--la-border); border-radius:20px;
  box-shadow:0 24px 64px rgba(0,0,0,.45);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.la-card *{box-sizing:border-box}
.la-heading{display:flex; align-items:center; gap:14px; margin:0 0 24px}
.la-heading-icon{
  width:48px; height:48px; flex:none; display:flex; align-items:center; justify-content:center;
  border-radius:14px; color:#2a1d05;
  background:linear-gradient(145deg,var(--la-gold-hi),var(--la-gold));
  box-shadow:0 6px 22px rgba(217,164,65,.35), inset 0 1px 0 rgba(255,255,255,.35);
  transition:box-shadow .3s ease, transform .3s ease;
}
.la-heading-icon:hover{
  transform:scale(1.06);
  box-shadow:0 0 14px rgba(240,190,90,.8), 0 0 34px rgba(217,164,65,.6), 0 0 60px rgba(217,164,65,.35), inset 0 1px 0 rgba(255,255,255,.45);
}
.la-heading h2{margin:0; font-size:22px; font-weight:800; letter-spacing:-.01em; color:var(--la-text)}
.la-field{margin-bottom:16px}
.la-row{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px}
.la-lbl{display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:var(--la-label); letter-spacing:.1px}
.la-step{
  width:22px; height:22px; flex:none; display:inline-flex; align-items:center; justify-content:center;
  border-radius:50%; font-size:11px; font-weight:800; color:var(--la-gold-hi);
  background:rgba(217,164,65,.28); border:1px solid rgba(217,164,65,.35);
}
.la-req{color:var(--la-gold); margin-left:2px}
.la-opt{font-size:12px; color:var(--la-muted); font-weight:500}
.la-wrap{position:relative}
.la-control{
  display:block; width:100%; height:42px; padding:0 14px; font:inherit; font-size:14px; color:var(--la-text);
  background:var(--la-field); border:1px solid var(--la-border); border-radius:12px; outline:none;
  transition:border-color .18s, box-shadow .18s, background .18s;
}
.la-control::placeholder{color:#656172}
.la-control:hover{background:var(--la-field-hover); border-color:var(--la-border-strong)}
.la-control:focus{border-color:var(--la-gold); box-shadow:0 0 0 4px var(--la-ring); background:var(--la-field-hover)}
textarea.la-control{height:auto; min-height:64px; padding:10px 14px; resize:vertical; line-height:1.5}
.la-control.has-status{padding-right:48px}
.la-select{position:relative}
.la-select-btn{display:flex; align-items:center; text-align:left; cursor:pointer; padding-right:44px}
.la-select-btn:disabled{cursor:wait; opacity:.7}
.la-select-btn span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.la-chev{position:absolute; right:16px; top:50%; width:16px; height:16px; color:var(--la-muted); pointer-events:none; transform:translateY(-50%); transition:transform .18s}
.la-select.open .la-chev{transform:translateY(-50%) rotate(180deg)}
.la-select.open .la-select-btn{border-color:var(--la-gold); box-shadow:0 0 0 4px var(--la-ring); background:var(--la-field-hover)}
.la-menu{
  position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:20; margin:0; padding:6px; list-style:none;
  max-height:240px; overflow-y:auto; background:var(--la-field); border:1px solid var(--la-border-strong);
  border-radius:12px; box-shadow:0 18px 40px rgba(0,0,0,.55); animation:la-fade .15s ease-out;
}
.la-option{
  display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 12px;
  border-radius:8px; font-size:14.5px; color:var(--la-text); cursor:pointer;
}
.la-option.active{background:rgba(217,164,65,.14)}
.la-option[aria-selected="true"]{color:var(--la-gold-hi); font-weight:600}
.la-option svg{flex:none; color:var(--la-gold)}
.la-hint{margin:8px 0 0; font-size:12px; color:var(--la-muted); line-height:1.45}
.la-status{position:absolute; right:14px; top:50%; transform:translateY(-50%); width:22px; height:22px; display:none}
.la-status svg{display:none}
.la-spinner{
  display:none; width:18px; height:18px; margin:2px; border-radius:50%;
  border:2px solid rgba(255,255,255,.15); border-top-color:var(--la-gold); animation:la-spin .7s linear infinite;
}
.la-field[data-state="checking"] .la-status,
.la-field[data-state="valid"] .la-status,
.la-field[data-state="invalid"] .la-status{display:block}
.la-field[data-state="checking"] .la-spinner{display:block}
.la-field[data-state="valid"] .la-ico-ok{display:block}
.la-field[data-state="invalid"] .la-ico-err{display:block}
.la-field[data-state="invalid"] .la-control{
  border-color:var(--la-err); box-shadow:0 0 0 4px rgba(255,92,92,.14); animation:la-shake .35s;
}
.la-field[data-state="valid"] .la-control{border-color:rgba(79,209,161,.7)}
.la-msg{display:none; margin-top:10px; padding:11px 13px; border-radius:10px; font-size:13px; line-height:1.45}
.la-line{display:flex; gap:9px; align-items:flex-start; font-weight:600}
.la-line svg{flex:none; margin-top:1px}
.la-field[data-state="invalid"] .la-msg.err{
  display:block; color:#ffc2c2; background:var(--la-err-bg); border:1px solid var(--la-err-border);
  animation:la-fade .25s ease-out;
}
.la-field[data-state="valid"] .la-msg.ok{
  display:block; padding:2px 2px 0; color:var(--la-ok); background:none; border:0; font-weight:600;
}
.la-suggest{display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:10px; padding-left:27px}
.la-suggest span{font-size:12px; color:#e6a9a9; font-weight:500}
.la-chip{
  padding:5px 11px; font:inherit; font-size:12.5px; font-weight:600; color:var(--la-gold-hi);
  background:rgba(217,164,65,.1); border:1px solid rgba(217,164,65,.35); border-radius:999px; cursor:pointer;
  transition:background .15s, transform .1s;
}
.la-chip:hover{background:rgba(217,164,65,.2)}
.la-chip:active{transform:scale(.96)}
.la-drop{
  display:flex; align-items:center; gap:12px; padding:10px 12px; cursor:pointer;
  background:var(--la-field); border:1.5px dashed var(--la-border-strong); border-radius:12px;
  transition:border-color .18s, background .18s;
}
.la-drop:hover,.la-drop.drag{border-color:var(--la-gold); background:var(--la-field-hover)}
.la-drop.bad{border-color:var(--la-err)}
.la-thumb{
  width:40px; height:40px; flex:none; border-radius:10px; overflow:hidden; display:grid; place-items:center;
  color:var(--la-gold); background:rgba(217,164,65,.1); border:1px solid rgba(217,164,65,.2);
}
.la-thumb img{width:100%; height:100%; object-fit:cover}
.la-drop-text{flex:1; min-width:0}
.la-drop-text b{display:block; font-size:14px; font-weight:600; color:var(--la-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.la-drop-text small{display:block; margin-top:2px; font-size:12px; color:var(--la-muted)}
.la-drop-text small.e{color:var(--la-err)}
.la-btn-sm{
  padding:7px 14px; font:inherit; font-size:12.5px; font-weight:600; color:var(--la-text);
  background:transparent; border:1px solid var(--la-border-strong); border-radius:8px; cursor:pointer;
  transition:background .15s;
}
.la-btn-sm:hover{background:rgba(255,255,255,.06)}
.la-file{display:none}
.la-count{margin-top:8px; font-size:12px; color:var(--la-muted); text-align:right; font-variant-numeric:tabular-nums}
.la-count.warn{color:var(--la-gold-hi)}
.la-launch{
  width:100%; height:52px; margin-top:8px; display:flex; justify-content:center; align-items:center; gap:10px;
  font:inherit; font-size:15px; font-weight:700; letter-spacing:.2px; color:#1a1409;
  background:linear-gradient(135deg,var(--la-gold-hi),var(--la-gold)); border:0; border-radius:12px; cursor:pointer;
  box-shadow:0 10px 24px rgba(217,164,65,.25);
  transition:transform .15s, box-shadow .2s, opacity .2s, filter .2s;
}
.la-launch:hover:enabled{transform:translateY(-1px); box-shadow:0 14px 30px rgba(217,164,65,.36)}
.la-launch:active:enabled{transform:translateY(0)}
.la-launch:disabled{opacity:.4; cursor:not-allowed; box-shadow:none; filter:saturate(.5)}
.la-launch .la-spinner{border-color:rgba(26,20,9,.25); border-top-color:#1a1409; margin:0}
.la-launch.loading .la-spinner{display:block}
.la-foot{margin:16px 0 0; text-align:center; font-size:12px; color:var(--la-muted)}
@keyframes la-spin{to{transform:rotate(360deg)}}
@keyframes la-shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes la-fade{from{opacity:0; transform:translateY(-4px)}to{opacity:1; transform:none}}
@media (max-width:420px){ .la-card{padding:26px 20px 22px} }
@media (prefers-reduced-motion:reduce){ .la-card *{animation:none!important; transition:none!important} }
`;

// Deterministic "Try:" suggestions for a taken name (no randomness, so they stay stable across renders).
const buildNameSuggestions = (name) => {
  const base = normalizeText(name);
  if (!base) return [];
  const suffix = 10 + ([...base].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 90);
  return [`${base}app`, `${base}-hq`, `${base}${suffix}`];
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeText = (value) => String(value || '').trim();

const normalizeAppName = (value = '') => normalizeText(value).toLowerCase();

// Escapes LIKE wildcards so a name such as "100%_App" is matched literally by ilike.
const escapeLikePattern = (value) => String(value).replace(/[\\%_]/g, (char) => `\\${char}`);

// Names nobody may take, whatever the casing, spacing or punctuation:
// "Setu AI", "setuai", "SetuAi", "SETU-AI" all collapse to "setuai".
// "Setu" is blocked only as the whole name; "Setu AI" is also blocked as a
// prefix, so "Setu AI Pro" is reserved too (while "Setup" / "Setu Store" are not).
const RESERVED_APP_NAMES = ['setu', 'setuai'];
const RESERVED_APP_PREFIXES = ['setuai'];

const isReservedAppName = (value = '') => {
  const collapsed = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return RESERVED_APP_NAMES.includes(collapsed)
    || RESERVED_APP_PREFIXES.some((prefix) => collapsed.startsWith(prefix));
};

// Apps the signed-in member already belongs to (same localStorage `user` this
// page already reads/writes in addTrustToUserMemberships).
const readOwnAppNames = () => {
  try {
    const parsedUser = JSON.parse(localStorage.getItem('user') || '{}') || {};
    const memberships = Array.isArray(parsedUser?.hospital_memberships) ? parsedUser.hospital_memberships : [];
    return memberships.map((m) => normalizeAppName(m?.trust_name)).filter(Boolean);
  } catch {
    return [];
  }
};

const waitForTenantAppSlug = async (supabase, trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return null;

  const startedAt = Date.now();
  while (Date.now() - startedAt <= APP_SLUG_POLL_TIMEOUT_MS) {
    const { data, error } = await supabase
      .from('Trust')
      .select('id,name,legal_name,remark,icon_url,app_slug,pwa_enabled,version')
      .eq('id', normalizedTrustId)
      .maybeSingle();

    if (error) throw error;

    const appSlug = normalizeText(data?.app_slug).toLowerCase();
    if (appSlug && data?.pwa_enabled === true) {
      return { ...data, app_slug: appSlug };
    }

    await delay(APP_SLUG_POLL_INTERVAL_MS);
  }

  return null;
}


// Deliberately does NOT touch selected_trust_id/selected_trust_name (or fire
// 'trust-changed') — this flow navigates straight to the new tenant's
// install landing at /app/<slug>, never through Home, so there is nothing
// here that needs the newly created Trust to become "currently selected".
// Making it selected here previously caused every already-mounted
// trust-aware component (most importantly Home's own theme-driven
// quick-action rendering) to switch to the brand-new Trust's identity while
// the launch loader was still up, which — for a Home theme configured to
// show Add Community as inline "content" — unmounted the loader/AddCommunity
// itself and exposed the underlying Home content before navigation ran.
// Only the trust list cache (read by Home's trust switcher UI) is updated
// here; whoever actually enters the tenant app later (TenantLanding's
// enterTenantTrust/grantTenantHome) is what sets selected_trust_id, exactly
// as it already does for every other "open a tenant app" entry point.
const cacheCreatedTrust = ({ trustId, trustName, legalName, description, iconUrl, trustRow }) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return;

  const cachedTrust = {
    ...(trustRow || {}),
    id: normalizedTrustId,
    name: normalizeText(trustRow?.name) || trustName,
    legal_name: normalizeText(trustRow?.legal_name) || normalizeText(legalName) || null,
    remark: normalizeText(trustRow?.remark) || normalizeText(description) || null,
    icon_url: iconUrl || trustRow?.icon_url || null,
    is_active: true,
  };

  try {
    const cached = JSON.parse(localStorage.getItem('trust_list_cache') || '[]');
    const list = Array.isArray(cached) ? cached : [];
    const next = [
      cachedTrust,
      ...list.filter((trust) => normalizeText(trust?.id) !== normalizedTrustId),
    ];
    localStorage.setItem('trust_list_cache', JSON.stringify(next));
  } catch {
    localStorage.setItem('trust_list_cache', JSON.stringify([cachedTrust]));
  }
};

// Home.jsx rebuilds its trust switcher from the `user` object's own
// hospital_memberships on every mount (e.g. a page refresh) — it never reads
// trust_list_cache/selected_trust_id for that list. Without this, a freshly
// created trust would stay invisible to that rebuild the next time the user
// opens Home, even though they now own it.
const addTrustToUserMemberships = ({ trustId, trustName, iconUrl, description }) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return;

  let parsedUser = {};
  try {
    parsedUser = JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    parsedUser = {};
  }

  const existingMemberships = Array.isArray(parsedUser?.hospital_memberships)
    ? parsedUser.hospital_memberships
    : [];
  if (existingMemberships.some((m) => normalizeText(m?.trust_id || m?.id) === normalizedTrustId)) return;

  const membersId = normalizeText(parsedUser?.members_id || parsedUser?.member_id);
  const newMembership = {
    trust_id: normalizedTrustId,
    trust_name: trustName,
    trust_icon_url: iconUrl || null,
    trust_remark: description || null,
    is_active: true,
    role: 'owner',
    membership_number: null,
    members_id: membersId || null,
  };

  const updatedUser = {
    ...parsedUser,
    hospital_memberships: [newMembership, ...existingMemberships],
  };

  try {
    localStorage.setItem('user', JSON.stringify(updatedUser));
  } catch {
    // ignore storage failures
  }
};

const AddCommunity = ({ onNavigateBack, variant = 'page' }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isHomeVariant = variant === 'home';
  const theme = useAppTheme();
  const navbarTheme = getNavbarThemeStyles(theme);
  const [form, setForm] = useState({
    trustName: '',
    legalName: '',
    description: '',
    sampleAppId: '',
  });
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeActiveIndex, setTypeActiveIndex] = useState(-1);
  const typeSelectRef = useRef(null);
  const [logoError, setLogoError] = useState('');
  const [logoDragging, setLogoDragging] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sampleApps, setSampleApps] = useState([]);
  const [pageTitle, setPageTitle] = useState(DEFAULT_PAGE_TITLE);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchCycle, setLaunchCycle] = useState(0);
  const [submitError, setSubmitError] = useState('');
  // Live "is this name taken" check, run on blur of the Trust Name field —
  // status: 'idle' | 'checking' | 'taken' | 'available'; checkedValue tracks
  // which exact value the current status applies to, so a stale "taken"
  // result never lingers after the user edits the field again.
  const [nameCheck, setNameCheck] = useState({ status: 'idle', checkedValue: '' });
  const fileInputRef = useRef(null);
  const externalHandoffRef = useRef(false);
  const returningFromHandoffRef = useRef(false);

  const panelBorder = 'var(--advertisement-card-border)';
  const muted = 'var(--advertisement-subtitle)';
  const heading = 'var(--advertisement-title)';
  const cardBg = 'var(--advertisement-card-bg)';
  const pageShellBg = getThemeToken(theme, 'page.background', 'var(--page-bg, var(--app-page-bg))');

  const handleBack = () => {
    if (typeof onNavigateBack === 'function') {
      onNavigateBack();
      return;
    }
    navigate(getAppHomePath());
  };

  const handleChange = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
    // Editing the name again invalidates whatever "taken"/"available"
    // result we last checked, so it never shows stale next to a value the
    // user hasn't actually checked yet.
    if (key === 'trustName') setNameCheck({ status: 'idle', checkedValue: '' });
  };

  // Case-insensitive: "SetuAi", "setuai" and "SETUAI" all count as the same name.
  // The DB's Trust.name UNIQUE constraint is case-sensitive, so this client-side
  // check is the only place such variants get caught.
  const isAppNameTaken = async (trustName) => {
    if (isReservedAppName(trustName)) return true;
    if (readOwnAppNames().includes(normalizeAppName(trustName))) return true;
    const { supabase } = await import('./services/supabaseClient.js');
    const { data, error } = await supabase
      .from('Trust')
      .select('id')
      .ilike('name', escapeLikePattern(trustName))
      .limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  };

  // Live "is this name already taken" check: runs shortly after the user stops
  // typing, so the status icon and message update without waiting for blur/submit.
  const isAppNameTakenRef = useRef(isAppNameTaken);
  isAppNameTakenRef.current = isAppNameTaken;
  useEffect(() => {
    const trustName = String(form.trustName || '').trim();
    if (!trustName) {
      setNameCheck({ status: 'idle', checkedValue: '' });
      return undefined;
    }
    setNameCheck({ status: 'checking', checkedValue: trustName });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const taken = await isAppNameTakenRef.current(trustName);
        if (cancelled) return;
        setNameCheck({ status: taken ? 'taken' : 'available', checkedValue: trustName });
      } catch (err) {
        if (cancelled) return;
        console.warn('[AddCommunity] Name availability check failed:', err?.message || err);
        setNameCheck({ status: 'idle', checkedValue: '' });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.trustName]);

  // Sample apps double as the "Type" picker: each row's `name` is the
  // keyword create_trust_via_whatsapp forwards to apply_sample_app_theme(),
  // which clones that sample app's template/feature flags onto the new
  // Trust. Default to the 'default' row so submitting without touching this
  // field behaves the same as before this field existed.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { supabase } = await import('./services/supabaseClient.js');
        const { data, error } = await supabase
          .from('sample_app')
          .select('id, name, purpose')
          .order('name');
        if (!active || error || !Array.isArray(data)) return;
        setSampleApps(data);
        const defaultApp = data.find((app) => app.name === 'default') || data[0];
        if (defaultApp) {
          setForm((prev) => (prev.sampleAppId ? prev : { ...prev, sampleAppId: defaultApp.id }));
        }
      } catch (err) {
        console.warn('[AddCommunity] Failed to load sample app types:', err?.message || err);
      }
    })();
    return () => { active = false; };
  }, []);

  // Navbar title follows the "Add Community" feature flag's own
  // display_name (feature_flags.display_name for feature_add_community)
  // instead of a hardcoded string, so renaming it per-Trust in the flag
  // config is reflected here automatically. Falls back to the default
  // label while loading or if no override is configured.
  useEffect(() => {
    let active = true;
    const trustId = localStorage.getItem('selected_trust_id') || null;
    if (!trustId) return undefined;
    (async () => {
      try {
        const result = await fetchFeatureFlags(trustId);
        if (!active || !result?.success) return;
        const displayName = result.flagsData?.feature_add_community?.display_name;
        if (displayName) setPageTitle(toTitleCase(displayName));
      } catch (err) {
        console.warn('[AddCommunity] Failed to load feature flag display name:', err?.message || err);
      }
    })();
    return () => { active = false; };
  }, []);

  // Dev-only preview hook: visiting /add-community?preview=launch shows the
  // launch overlay for a few seconds without creating a Trust or calling
  // Supabase, so the animation can be eyeballed on demand. No-ops outside
  // local dev builds and doesn't affect the real submit flow.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    if (searchParams.get('preview') !== 'launch') return undefined;
    setLaunching(true);
    const timer = setTimeout(() => setLaunching(false), LAUNCH_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [searchParams]);

  // If the production install URL handoff opens an external browser (e.g.
  // Chrome on a standalone/Capacitor install) instead of navigating this
  // page away, this page's React state — including the launch loader —
  // stays mounted in the background. externalHandoffRef is armed right
  // before that navigation; once this page is actually hidden afterward,
  // clear the local launch/submit UI state so returning to SETU doesn't
  // show a stuck loader. Never fires on ordinary backgrounding, since the
  // ref is only set true immediately before the handoff itself.
  useEffect(() => {
    const resetFormAfterHandoff = () => {
      if (!returningFromHandoffRef.current) return;
      returningFromHandoffRef.current = false;
      setForm({ trustName: '', legalName: '', description: '', sampleAppId: '' });
      setLogoFile(null);
      setLogoPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return '';
      });
      setSubmitError('');
      setNameCheck({ status: 'idle', checkedValue: '' });
    };
    const clearHandoffState = () => {
      if (!externalHandoffRef.current) return;
      externalHandoffRef.current = false;
      returningFromHandoffRef.current = true;
      setLaunching(false);
      setSubmitting(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearHandoffState();
      } else if (document.visibilityState === 'visible') {
        resetFormAfterHandoff();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', clearHandoffState);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', clearHandoffState);
    };
  }, []);

  const applyLogoFile = (file) => {
    if (!file) return;
    if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Only JPG, PNG or WebP files are allowed');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError('File must be smaller than 2 MB');
      return;
    }
    setLogoError('');
    setLogoFile(file);
    const nextPreview = URL.createObjectURL(file);
    setLogoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextPreview;
    });
  };

  const handleLogoInputChange = (event) => {
    applyLogoFile(event.target.files?.[0]);
    // Reset so picking the same file again still fires onChange.
    event.target.value = '';
  };

  const handleLogoDragOver = (event) => {
    event.preventDefault();
    setLogoDragging(true);
  };

  const handleLogoDragLeave = (event) => {
    event.preventDefault();
    setLogoDragging(false);
  };

  const handleLogoDrop = (event) => {
    event.preventDefault();
    setLogoDragging(false);
    applyLogoFile(event.dataTransfer?.files?.[0]);
  };

  // Custom "Type" dropdown (replaces the native <select>, whose option list can't be themed).
  const openTypeMenu = () => {
    if (sampleApps.length === 0) return;
    setTypeActiveIndex(Math.max(0, sampleApps.findIndex((app) => app.id === form.sampleAppId)));
    setTypeOpen(true);
  };

  const chooseType = (appId) => {
    setForm((prev) => ({ ...prev, sampleAppId: appId }));
    setTypeOpen(false);
  };

  const handleTypeKeyDown = (event) => {
    const lastIndex = sampleApps.length - 1;
    if (lastIndex < 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!typeOpen) openTypeMenu();
        else setTypeActiveIndex((index) => Math.min(index + 1, lastIndex));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!typeOpen) openTypeMenu();
        else setTypeActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
      case 'End':
        if (!typeOpen) break;
        event.preventDefault();
        setTypeActiveIndex(event.key === 'Home' ? 0 : lastIndex);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!typeOpen) openTypeMenu();
        else if (typeActiveIndex >= 0) chooseType(sampleApps[typeActiveIndex].id);
        break;
      case 'Escape':
        if (!typeOpen) break;
        event.preventDefault();
        setTypeOpen(false);
        break;
      case 'Tab':
        setTypeOpen(false);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!typeOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!typeSelectRef.current?.contains(event.target)) setTypeOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsidePress);
    document.addEventListener('touchstart', closeOnOutsidePress);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress);
      document.removeEventListener('touchstart', closeOnOutsidePress);
    };
  }, [typeOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');

    const trustName = String(form.trustName || '').trim();
    if (!trustName) {
      setSubmitError('Trust name is required.');
      return;
    }

    if (!form.sampleAppId) {
      setSubmitError('Please select a Type.');
      return;
    }

    let parsedUser = {};
    try {
      parsedUser = JSON.parse(localStorage.getItem('user') || '{}') || {};
    } catch {
      parsedUser = {};
    }

    const memberMobile = String(parsedUser?.mobile || parsedUser?.Mobile || '')
      .replace(/\D/g, '')
      .slice(-10);
    const memberName = String(parsedUser?.name || parsedUser?.Name || '').trim();

    if (!memberMobile) {
      setSubmitError('Member identity not found. Please login again and retry.');
      return;
    }

    // Re-check at submit so a duplicate is blocked even if the blur check never ran or hasn't finished.
    try {
      if (await isAppNameTaken(trustName)) {
        setNameCheck({ status: 'taken', checkedValue: trustName });
        return;
      }
    } catch (err) {
      console.warn('[AddCommunity] Name availability check failed:', err?.message || err);
    }

    const selectedSampleApp = sampleApps.find((app) => app.id === form.sampleAppId) || null;

    trackAction('app_creation_started', { sample_app_id: form.sampleAppId, sample_app_name: selectedSampleApp?.name || null });
    setSubmitting(true);
    // Show the launch animation immediately. After the install link is ready,
    // restart this cycle so the final launch screen gets its full duration.
    setLaunching(true);
    setLaunchCycle((prev) => prev + 1);
    const { supabase } = await import('./services/supabaseClient.js');
    let nextTrustId = '';
    let uploadedIconUrl = null;
    let tenantTrust = null;
    try {
      // create_trust_via_whatsapp already handles the full "new trust"
      // pipeline (superuser + Trust row + async web-app-link generation).
      // Passing the selected sample app's `name` as p_keyword is what makes
      // the existing apply_sample_app_theme() trigger clone that sample
      // app's template/feature flags onto the new trust.
      const { data, error } = await supabase.rpc('create_trust_via_whatsapp', {
        p_mobile: memberMobile,
        p_name: memberName || trustName,
        p_trust_name: trustName,
        p_keyword: selectedSampleApp?.name || null,
      });

      if (error) throw error;

      nextTrustId = String(data || '').trim();
      if (nextTrustId) {
        if (logoFile) {
          const extension = String(logoFile.name || '').split('.').pop()?.toLowerCase() || 'png';
          const safeExtension = extension.replace(/[^a-z0-9]/g, '') || 'png';
          const storagePath = `${nextTrustId}/${Date.now()}-community-logo.${safeExtension}`;

          const { error: uploadError } = await supabase
            .storage
            .from('trust-icons')
            .upload(storagePath, logoFile, {
              cacheControl: '3600',
              upsert: true,
            });

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase
            .storage
            .from('trust-icons')
            .getPublicUrl(storagePath);

          uploadedIconUrl = publicUrlData?.publicUrl || null;
        }

        const trustUpdates = {
          legal_name: String(form.legalName || '').trim() || null,
          remark: String(form.description || '').trim() || null,
        };

        if (uploadedIconUrl) {
          trustUpdates.icon_url = uploadedIconUrl;
        }

        const hasTrustUpdates = Object.values(trustUpdates).some((value) => value !== null && value !== '');
        if (hasTrustUpdates) {
          const { error: trustUpdateError } = await supabase
            .from('Trust')
            .update(trustUpdates)
            .eq('id', nextTrustId);

          if (trustUpdateError) throw trustUpdateError;
        }

        cacheCreatedTrust({
          trustId: nextTrustId,
          trustName,
          legalName: form.legalName,
          description: form.description,
          iconUrl: uploadedIconUrl,
        });
        addTrustToUserMemberships({
          trustId: nextTrustId,
          trustName,
          iconUrl: uploadedIconUrl,
          description: form.description,
        });
        // No 'trust-changed' dispatch here — this flow never makes the new
        // Trust "currently selected" before navigating (see cacheCreatedTrust's
        // own comment above), so there is nothing for any listener to react
        // to yet. Firing it here previously switched every mounted
        // trust-aware component (including Home's own quick-action rendering)
        // over to the new Trust while the launch loader was still showing.

        tenantTrust = await waitForTenantAppSlug(supabase, nextTrustId);
        if (tenantTrust) {
          cacheCreatedTrust({
            trustId: nextTrustId,
            trustName,
            legalName: form.legalName,
            description: form.description,
            iconUrl: uploadedIconUrl,
            trustRow: tenantTrust,
          });
        }
      }
    } catch (error) {
      trackAction('launch_failed', { reason: String(error?.message || error || '').slice(0, 200) });
      setSubmitError(getFriendlySubmitError(error, trustName));
      setSubmitting(false);
      setLaunching(false);
      return;
    }

    setSubmitting(false);

    if (!nextTrustId) {
      setSubmitError('Trust was created but could not be confirmed. Please check again.');
      setLaunching(false);
      return;
    }

    // Only proceed to the app once the backend has generated the slug and
    // enabled PWA metadata for this newly created Trust.
    if (!tenantTrust?.app_slug) {
      setSubmitError('App was created, but it is still getting ready. Please try again in a moment.');
      setLaunching(false);
      return;
    }

    trackAction('app_launched', { new_trust_id: nextTrustId, app_slug: tenantTrust.app_slug });
    setLaunchCycle((prev) => prev + 1);
    await delay(LAUNCH_ANIMATION_MS);
    // Full-page navigation to the canonical production tenant URL — the
    // exact /app/<slug> path the generate-webApp-link Edge Function writes
    // into shareApp_links.web_app_url. `install=1` is TenantLanding's
    // existing flag for its Install/Download landing card — this
    // intentionally does NOT auto-enter Home; the destination is the
    // tenant's install screen.
    
    const installUrl = `https://www.teiltd.in/app/${encodeURIComponent(tenantTrust.app_slug)}?install=1`;
    externalHandoffRef.current = true;
    window.location.replace(installUrl);
  };

  const hasTrustName = String(form.trustName || '').trim().length > 0;
  const hasType = Boolean(form.sampleAppId);
  const isNameTaken = nameCheck.status === 'taken' && nameCheck.checkedValue === form.trustName.trim();
  // Drives the name field's look (spinner / green tick / red alert) via data-state.
  const nameFieldState = nameCheck.checkedValue === form.trustName.trim()
    ? ({ checking: 'checking', available: 'valid', taken: 'invalid' }[nameCheck.status] || '')
    : '';
  // No "Try:" suggestions for reserved (Setu-related) names; they'd only be more variants of the same name.
  const nameSuggestions = isNameTaken && !isReservedAppName(form.trustName)
    ? buildNameSuggestions(form.trustName)
    : [];
  const selectedType = sampleApps.find((app) => app.id === form.sampleAppId) || null;
  const selectedPurpose = selectedType?.purpose;
  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen, isHomeVariant]);

  useEffect(() => {
    if (isHomeVariant) return undefined;
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen, isHomeVariant]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  return (
    <div className={isHomeVariant ? '' : 'min-h-screen'} style={isHomeVariant ? { color: 'var(--body-text-color)' } : { background: pageShellBg, color: 'var(--body-text-color)' }}>
      {!isHomeVariant && (
        <>
          <div
            className="sticky top-0 z-30 flex items-center justify-between px-4 py-4"
            style={{
              background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
              backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
              WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
              borderBottom: '1px solid var(--navbar-border)',
              color: navbarTheme?.textColor || 'var(--navbar-text)',
            }}
          >
            <button
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTheme?.textColor || 'var(--navbar-text)' }}>
              {pageTitle}
            </h1>
            <button
              onClick={handleBack}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTheme?.textColor || 'var(--navbar-text)', background: 'transparent' }}
              aria-label="Go back"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>

          <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={(target) => navigate(target === 'home' ? '/' : `/${target}`)} currentPage="add-community" />
        </>
      )}

      <div className={isHomeVariant ? 'space-y-5' : 'px-4 pt-5 pb-10 space-y-5'}>
        <style>{LAUNCH_FORM_CSS}</style>
        <form className="la-card" onSubmit={handleSubmit} noValidate>
          {isHomeVariant ? (
            <div className="la-heading">
              <span className="la-heading-icon" aria-hidden="true"><Rocket size={22} /></span>
              <h2>Launch my app</h2>
            </div>
          ) : null}
          <div className="la-field" data-state={nameFieldState}>
            <div className="la-row">
              <label className="la-lbl" htmlFor="la-app-name"><span className="la-step">1</span>App Name<span className="la-req">*</span></label>
            </div>
            <div className="la-wrap">
              <input
                id="la-app-name"
                type="text"
                className="la-control has-status"
                placeholder="Enter app name"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="la-name-err"
                value={form.trustName}
                onChange={handleChange('trustName')}
              />
              <div className="la-status">
                <div className="la-spinner" />
                <svg className="la-ico-ok" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4fd1a1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></svg>
                <svg className="la-ico-err" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff7b7b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              </div>
            </div>
            <div className="la-msg err" id="la-name-err" role="alert" aria-live="polite">
              <div className="la-line">
                <AlertTriangle width={16} height={16} strokeWidth={2.4} color="#ff7b7b" aria-hidden="true" />
                <span>This app name is already in use. Please choose another name.</span>
              </div>
              {nameSuggestions.length > 0 ? (
                <div className="la-suggest">
                  <span>Try:</span>
                  {nameSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="la-chip"
                      onClick={() => setForm((prev) => ({ ...prev, trustName: suggestion }))}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="la-msg ok"><div className="la-line"><span>Great, this name is available.</span></div></div>
          </div>

          <div className="la-field">
            <div className="la-row">
              <label className="la-lbl" htmlFor="la-org"><span className="la-step">2</span>Organisation Name</label>
              <span className="la-opt">Optional</span>
            </div>
            <input
              id="la-org"
              type="text"
              className="la-control"
              placeholder="Enter your organization name"
              autoComplete="organization"
              value={form.legalName}
              onChange={handleChange('legalName')}
            />
          </div>

          <div className="la-field">
            <div className="la-row">
              <label className="la-lbl" htmlFor="la-type"><span className="la-step">3</span>Type<span className="la-req">*</span></label>
            </div>
            <div className={`la-select${typeOpen ? ' open' : ''}`} ref={typeSelectRef}>
              <button
                id="la-type"
                type="button"
                className="la-control la-select-btn"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={typeOpen}
                aria-controls="la-type-list"
                aria-activedescendant={typeOpen && typeActiveIndex >= 0 ? `la-type-opt-${typeActiveIndex}` : undefined}
                disabled={sampleApps.length === 0}
                onClick={() => (typeOpen ? setTypeOpen(false) : openTypeMenu())}
                onKeyDown={handleTypeKeyDown}
              >
                <span>{sampleApps.length === 0 ? 'Loading...' : (selectedType ? getSampleAppLabel(selectedType) : 'Select a type')}</span>
              </button>
              <svg className="la-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 6 5 5 5-5" /></svg>
              {typeOpen ? (
                <ul className="la-menu" id="la-type-list" role="listbox" aria-labelledby="la-type">
                  {sampleApps.map((app, index) => (
                    <li
                      key={app.id}
                      id={`la-type-opt-${index}`}
                      role="option"
                      aria-selected={app.id === form.sampleAppId}
                      className={`la-option${index === typeActiveIndex ? ' active' : ''}`}
                      onMouseEnter={() => setTypeActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseType(app.id)}
                    >
                      <span>{getSampleAppLabel(app)}</span>
                      {app.id === form.sampleAppId ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {selectedPurpose ? <p className="la-hint">{selectedPurpose}</p> : null}
          </div>

          <div className="la-field">
            <div className="la-row">
              <span className="la-lbl"><span className="la-step">4</span>Logo</span>
              <span className="la-opt">Optional · max 2 MB</span>
            </div>
            <label
              className={`la-drop${logoDragging ? ' drag' : ''}${logoError ? ' bad' : ''}`}
              htmlFor="la-logo"
              onDragEnter={handleLogoDragOver}
              onDragOver={handleLogoDragOver}
              onDragLeave={handleLogoDragLeave}
              onDrop={handleLogoDrop}
            >
              <div className="la-thumb">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" />
                ) : (
                  <Upload width={22} height={22} aria-hidden="true" />
                )}
              </div>
              <div className="la-drop-text">
                <b>{logoFile ? logoFile.name : 'Upload your logo'}</b>
                <small className={logoError ? 'e' : ''}>
                  {logoError
                    || (logoFile
                      ? `${Math.round(logoFile.size / 1024)} KB · click to replace`
                      : 'JPG, PNG or WebP · drag & drop')}
                </small>
              </div>
              <span className="la-btn-sm">{logoFile ? 'Change' : 'Choose'}</span>
              <input
                ref={fileInputRef}
                id="la-logo"
                type="file"
                className="la-file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoInputChange}
              />
            </label>
          </div>

          <div className="la-field">
            <div className="la-row">
              <label className="la-lbl" htmlFor="la-desc"><span className="la-step">5</span>Description</label>
              <span className="la-opt">Optional</span>
            </div>
            <textarea
              id="la-desc"
              className="la-control"
              maxLength={DESCRIPTION_MAX_LENGTH}
              placeholder="What does your app do? Describe it in a line or two."
              value={form.description}
              onChange={handleChange('description')}
            />
            <div className={`la-count${form.description.length > 210 ? ' warn' : ''}`}>
              {form.description.length} / {DESCRIPTION_MAX_LENGTH}
            </div>
          </div>

          <button
            type="submit"
            className={`la-launch${submitting ? ' loading' : ''}`}
            disabled={!hasTrustName || !hasType || submitting || isNameTaken || nameCheck.status === 'checking'}
          >
            <span className="la-spinner" />
            <span>{submitting ? 'Launching…' : 'Launch'}</span>
          </button>
        </form>

      </div>

      {submitError && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSubmitError('')}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border p-6 text-center"
            style={{ background: cardBg, borderColor: panelBorder, boxShadow: '0 20px 44px rgba(0,0,0,0.4)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'color-mix(in srgb, var(--brand-red) 16%, transparent)', color: 'var(--brand-red)' }}
            >
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h3 className="text-base font-extrabold" style={{ color: heading }}>
              {/already exists/i.test(submitError) ? 'Name already in use' : 'Something went wrong'}
            </h3>
            <p className="mt-2 text-sm" style={{ color: muted }}>
              {submitError}
            </p>
            <button
              type="button"
              onClick={() => setSubmitError('')}
              className="mt-5 w-full rounded-2xl px-5 py-3 text-sm font-extrabold transition-all active:scale-[0.99]"
              style={{ color: 'var(--app-button-text)', background: 'var(--app-button-bg)' }}
            >
              {/already exists/i.test(submitError) ? 'Choose Another Name' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {launching && (
        <div
          className="tenant-launch-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden px-6"
          style={{ background: pageShellBg }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 38%, var(--app-accent-bg), transparent 62%)', opacity: 0.45 }}
          />

          {LAUNCH_STARS.map((star, index) => (
            <span
              key={index}
              className="tenant-star"
              style={{
                top: star.top,
                left: star.left,
                width: star.size,
                height: star.size,
                background: heading,
                animationDelay: star.delay,
                animationDuration: star.duration,
              }}
            />
          ))}

          <div key={launchCycle} className="tenant-launch-content relative flex flex-col items-center">
            <div className="relative flex h-40 w-40 items-center justify-center">
              <div
                className="tenant-orbit-ring tenant-orbit-ring--inner absolute inset-0 rounded-full"
                style={{ borderColor: `color-mix(in srgb, ${heading} 28%, transparent)` }}
              />
              <div
                className="tenant-orbit-ring tenant-orbit-ring--outer absolute rounded-full"
                style={{ inset: '-14px', borderColor: `color-mix(in srgb, ${heading} 14%, transparent)` }}
              />
              <div
                className="absolute h-20 w-20 rounded-full"
                style={{ background: 'var(--app-accent-bg)', opacity: 0.35, filter: 'blur(22px)' }}
              />

              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '0s' }} />
              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '0.5s' }} />
              <span className="tenant-smoke" style={{ background: `color-mix(in srgb, ${heading} 45%, transparent)`, animationDelay: '1s' }} />

              <div className="tenant-rocket-wrap relative">
                <div
                  className="tenant-rocket-flame absolute"
                  style={{ background: 'linear-gradient(180deg, #ffd27a, #ff8a3d 55%, transparent)' }}
                />
                <div
                  className="tenant-rocket-trail absolute"
                  style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${heading} 65%, transparent), transparent)` }}
                />
                <Rocket className="tenant-rocket-fly relative h-14 w-14" style={{ color: heading }} />
              </div>
            </div>

            <p className="mt-8 text-center text-lg font-extrabold" style={{ color: heading }}>
              Launching {form.trustName || 'your app'}
              <span className="tenant-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
            </p>

            <div className="tenant-status-stack relative mt-2 h-5 w-64 text-center text-sm" style={{ color: muted }}>
              <span className="tenant-status-line tenant-status-line--1">Setting things up...</span>
              <span className="tenant-status-line tenant-status-line--2">Preparing your workspace...</span>
              <span className="tenant-status-line tenant-status-line--3">Configuring your community...</span>
              <span className="tenant-status-line tenant-status-line--4">Almost there...</span>
            </div>

            <div className="tenant-progress-track mt-6" style={{ background: `color-mix(in srgb, ${heading} 14%, transparent)` }}>
              <div className="tenant-progress-fill" style={{ background: 'var(--app-button-bg)' }} />
            </div>
          </div>

          <style>{`
            @keyframes tenantOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes tenantContentIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
            @keyframes tenantRocketFly {
              0%, 100% { transform: translateY(10px) rotate(-45deg); }
              50% { transform: translateY(-22px) rotate(-42deg); }
            }
            @keyframes tenantOrbitSpin { to { transform: rotate(360deg); } }
            @keyframes tenantOrbitSpinReverse { to { transform: rotate(-360deg); } }
            @keyframes tenantTrailPulse {
              0%, 100% { opacity: 0.35; transform: scaleY(0.6); }
              50% { opacity: 0.9; transform: scaleY(1); }
            }
            @keyframes tenantFlamePulse {
              0%, 100% { opacity: 0.6; transform: scale(0.85); }
              50% { opacity: 1; transform: scale(1.15); }
            }
            @keyframes tenantSmokeRise {
              0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
              20% { opacity: 0.7; }
              100% { opacity: 0; transform: translate(var(--smoke-x, 14px), 46px) scale(1.4); }
            }
            @keyframes tenantStarTwinkle {
              0%, 100% { opacity: 0.15; transform: scale(0.8); }
              50% { opacity: 1; transform: scale(1.2); }
            }
            @keyframes tenantDotBlink {
              0%, 80%, 100% { opacity: 0.2; }
              40% { opacity: 1; }
            }
            @keyframes tenantProgressFill {
              from { width: 4%; }
              to { width: 96%; }
            }
            @keyframes tenantStatusCycle1 {
              0%, 20% { opacity: 1; transform: translateY(0); }
              25%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle2 {
              0%, 20% { opacity: 0; transform: translateY(6px); }
              25%, 45% { opacity: 1; transform: translateY(0); }
              50%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle3 {
              0%, 50% { opacity: 0; transform: translateY(6px); }
              55%, 75% { opacity: 1; transform: translateY(0); }
              80%, 100% { opacity: 0; transform: translateY(-6px); }
            }
            @keyframes tenantStatusCycle4 {
              0%, 80% { opacity: 0; transform: translateY(6px); }
              85%, 100% { opacity: 1; transform: translateY(0); }
            }
            .tenant-launch-overlay { animation: tenantOverlayIn 0.25s ease-out; }
            .tenant-launch-content { animation: tenantContentIn 0.35s ease-out; }
            .tenant-orbit-ring { border: 1.5px dashed; animation: tenantOrbitSpin 6s linear infinite; }
            .tenant-orbit-ring--outer { border-style: dotted; animation: tenantOrbitSpinReverse 10s linear infinite; }
            .tenant-rocket-wrap { animation: tenantRocketFly 1.6s ease-in-out infinite; }
            .tenant-rocket-fly { display: block; }
            .tenant-rocket-flame {
              width: 8px;
              height: 20px;
              left: 50%;
              bottom: 28%;
              margin-left: -4px;
              border-radius: 999px;
              filter: blur(3px);
              transform-origin: top center;
              animation: tenantFlamePulse 0.5s ease-in-out infinite;
            }
            .tenant-rocket-trail {
              width: 10px;
              height: 34px;
              left: 50%;
              bottom: 26%;
              margin-left: -5px;
              border-radius: 999px;
              filter: blur(2px);
              animation: tenantTrailPulse 1.6s ease-in-out infinite;
            }
            .tenant-smoke {
              position: absolute;
              left: 50%;
              bottom: 22%;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              filter: blur(3px);
              animation: tenantSmokeRise 2.4s ease-out infinite;
            }
            .tenant-star {
              position: absolute;
              border-radius: 50%;
              animation-name: tenantStarTwinkle;
              animation-timing-function: ease-in-out;
              animation-iteration-count: infinite;
            }
            .tenant-dots span {
              display: inline-block;
              animation: tenantDotBlink 1.2s infinite;
            }
            .tenant-dots span:nth-child(2) { animation-delay: 0.2s; }
            .tenant-dots span:nth-child(3) { animation-delay: 0.4s; }
            .tenant-status-stack { display: grid; }
            .tenant-status-line {
              grid-area: 1 / 1;
              opacity: 0;
              animation-duration: ${LAUNCH_ANIMATION_MS}ms;
              animation-timing-function: ease-in-out;
              animation-iteration-count: 1;
              animation-fill-mode: forwards;
            }
            .tenant-status-line--1 { animation-name: tenantStatusCycle1; }
            .tenant-status-line--2 { animation-name: tenantStatusCycle2; }
            .tenant-status-line--3 { animation-name: tenantStatusCycle3; }
            .tenant-status-line--4 { animation-name: tenantStatusCycle4; }
            .tenant-progress-track {
              position: relative;
              width: 200px;
              height: 5px;
              border-radius: 999px;
              overflow: hidden;
            }
            .tenant-progress-fill {
              position: absolute;
              inset: 0;
              width: 4%;
              border-radius: 999px;
              animation: tenantProgressFill ${LAUNCH_ANIMATION_MS}ms ease-out forwards;
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export const AddCommunityContent = () => <AddCommunity variant="home" />;

export default AddCommunity;
