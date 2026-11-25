import { supabase } from '../services/supabaseClient';

// Checkout details: delivery address(es), personal/company, company GST.
// Addresses live on the Members row as address_1 / address_2 (jsonb); company name stays in
// "Company Name"; GST number in gst_number. A snapshot is stored per order in
// order_checkout_details (see backend/sql/order_checkout_details.sql).

export const MAX_ADDRESSES = 2;

export const ADDRESS_LABELS = ['home', 'office', 'other'];

export const addressLabelText = (label) => {
  const value = ADDRESS_LABELS.includes(label) ? label : 'home';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export const EMPTY_ADDRESS = Object.freeze({
  label: 'home',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
});

const text = (value) => {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  return ['null', 'undefined', 'nan'].includes(trimmed.toLowerCase()) ? '' : trimmed;
};

export const normalizeAddress = (raw) => {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const address = {
    label: ADDRESS_LABELS.includes(text(source.label).toLowerCase()) ? text(source.label).toLowerCase() : 'home',
    line1: text(source.line1),
    line2: text(source.line2),
    city: text(source.city),
    state: text(source.state),
    pincode: text(source.pincode).replace(/\D/g, '').slice(0, 6),
  };
  return address.line1 || address.city || address.state || address.pincode ? address : null;
};

export const isValidPincode = (value) => /^\d{6}$/.test(text(value));

export const getAddressErrors = (address) => {
  const errors = {};
  if (!text(address?.line1)) errors.line1 = 'Enter your address';
  if (!text(address?.city)) errors.city = 'Enter city';
  if (!text(address?.state)) errors.state = 'Enter state';
  if (!isValidPincode(address?.pincode)) errors.pincode = 'Enter a 6-digit pincode';
  return errors;
};

export const isAddressComplete = (address) => Object.keys(getAddressErrors(address)).length === 0;

export const formatAddress = (address) => {
  if (!address) return '';
  const cityLine = [address.city, address.state].filter(Boolean).join(', ');
  return [address.line1, address.line2, [cityLine, address.pincode].filter(Boolean).join(' - ')]
    .filter(Boolean)
    .join(', ');
};

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const normalizeGst = (value) => text(value).replace(/\s+/g, '').toUpperCase().slice(0, 15);

export const isValidGst = (value) => GST_RE.test(normalizeGst(value));

// A company order = "Need a GST invoice?" is on and a company name or GST number is given.
export const isCompanyOrder = (details) =>
  Boolean(details?.gstEnabled && (text(details?.companyName) || text(details?.gstNumber)));

export const buildInitialCheckoutDetails = () => ({
  loaded: false,
  editing: false, // an address form is open with unsaved changes
  gstEnabled: false,
  companyName: '',
  gstNumber: '',
  addresses: [null, null],
  selected: 0,
  homeAddressText: '', // legacy free-text "Address Home", used only to prefill a new address
  canPersist: true,
});

// ---- Local backup -----------------------------------------------------------------------------
// Keeps addresses / company / GST / an unsaved draft in this browser so nothing is lost on a refresh,
// even if the profile could not be written (e.g. before the SQL migration is applied).
const localKey = (memberId) => `checkout_details_${memberId || 'guest'}`;

export const readLocalCheckout = (memberId) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localKey(memberId)) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const writeLocalCheckout = (memberId, patch) => {
  try {
    const next = { ...readLocalCheckout(memberId), ...patch };
    window.localStorage.setItem(localKey(memberId), JSON.stringify(next));
  } catch {
    // storage unavailable (private mode etc.) - ignore
  }
};

// Loads the member's saved checkout data. Works before the SQL migration is applied
// (new columns missing) by falling back to the legacy columns.
export const loadMemberCheckoutProfile = async (memberId) => {
  if (!memberId) return null;

  const full = await supabase
    .from('Members')
    .select('address_1, address_2, gst_number, "Company Name", "Address Home"')
    .eq('members_id', memberId)
    .maybeSingle();

  const local = readLocalCheckout(memberId);
  const localAddresses = Array.isArray(local.addresses) ? local.addresses.map(normalizeAddress) : [];

  if (!full.error) {
    const row = full.data || {};
    return {
      addresses: [
        normalizeAddress(row.address_1) || localAddresses[0] || null,
        normalizeAddress(row.address_2) || localAddresses[1] || null,
      ],
      gstNumber: normalizeGst(row.gst_number) || normalizeGst(local.gstNumber),
      companyName: text(row['Company Name']) || text(local.companyName),
      homeAddressText: text(row['Address Home']),
      selected: Number.isInteger(local.selected) ? local.selected : null,
      draft: local.draft || null,
      canPersist: true,
    };
  }

  const legacy = await supabase
    .from('Members')
    .select('"Company Name", "Address Home"')
    .eq('members_id', memberId)
    .maybeSingle();
  if (legacy.error) throw legacy.error;

  const row = legacy.data || {};
  return {
    addresses: [localAddresses[0] || null, localAddresses[1] || null],
    gstNumber: normalizeGst(local.gstNumber),
    companyName: text(row['Company Name']) || text(local.companyName),
    homeAddressText: text(row['Address Home']),
    selected: Number.isInteger(local.selected) ? local.selected : null,
    draft: local.draft || null,
    canPersist: false,
  };
};

export const saveMemberAddress = async (memberId, slot, address) => {
  if (!memberId || slot < 0 || slot >= MAX_ADDRESSES) return;
  const { error } = await supabase
    .from('Members')
    .update({ [`address_${slot + 1}`]: normalizeAddress(address) })
    .eq('members_id', memberId);
  if (error) throw error;
};

export const saveMemberCompany = async (memberId, { companyName, gstNumber }) => {
  if (!memberId) return;
  const patch = {};
  if (text(companyName)) patch['Company Name'] = text(companyName);
  if (text(gstNumber)) patch.gst_number = normalizeGst(gstNumber);
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('Members').update(patch).eq('members_id', memberId);
  if (error) throw error;
};

export const saveOrderCheckoutDetails = async ({ memberId, trustId, purchaseIds, details }) => {
  const address = details.addresses[details.selected];
  const isCompany = isCompanyOrder(details);

  const { data, error } = await supabase.rpc('save_order_checkout_details', {
    p_member_id: memberId,
    p_trust_id: trustId,
    p_purchase_ids: purchaseIds,
    p_payload: {
      customer_type: isCompany ? 'company' : 'personal',
      company_name: isCompany ? text(details.companyName) : null,
      gst_number: isCompany ? normalizeGst(details.gstNumber) : null,
      address_label: addressLabelText(address?.label),
      address,
    },
  });
  if (error) throw error;
  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(text(data.error) || 'Unable to save checkout details.');
  }
  return data;
};

// Returns an error message, or '' when the details are good to place an order.
export const validateCheckoutDetails = (details) => {
  if (details?.editing) return 'Please save your address to continue.';
  const address = details?.addresses?.[details?.selected];
  if (!address) return 'Please add a delivery address to continue.';
  if (!isAddressComplete(address)) return 'Please complete your delivery address (address, city, state and a 6-digit pincode).';

  if (details.gstEnabled && text(details.gstNumber) && !isValidGst(details.gstNumber)) {
    return 'Please enter a valid 15-character GST number, or leave it empty.';
  }
  return '';
};

// Fills city / state from a 6-digit pincode (India Post public lookup). Best effort: returns null on any failure.
export const lookupPincode = async (pincode, signal) => {
  if (!/^\d{6}$/.test(text(pincode))) return null;
  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const office = payload?.[0]?.PostOffice?.[0];
    if (!office) return null;
    return { city: text(office.District) || text(office.Block), state: text(office.State) };
  } catch {
    return null;
  }
};
