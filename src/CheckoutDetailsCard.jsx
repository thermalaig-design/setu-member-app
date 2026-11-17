import React, { useEffect, useRef, useState } from 'react';
import { Briefcase, Building2, Check, Home, Info, MapPin, Pencil, Plus } from 'lucide-react';
import {
  ADDRESS_LABELS,
  EMPTY_ADDRESS,
  MAX_ADDRESSES,
  addressLabelText,
  formatAddress,
  getAddressErrors,
  isValidGst,
  loadMemberCheckoutProfile,
  lookupPincode,
  normalizeAddress,
  normalizeGst,
  saveMemberAddress,
  writeLocalCheckout,
} from './utils/checkoutDetails';

const LABEL_ICONS = {
  home: <Home className="h-4 w-4" />,
  office: <Briefcase className="h-4 w-4" />,
  other: <MapPin className="h-4 w-4" />,
};

// "Delivery & billing" card on the confirm-order page. Everything is coloured from the active
// theme tokens (--page-text-color / --page-price-color / button vars) so it reads on any theme.
// Name and mobile are intentionally not asked again: they already show in the customer card above.
// Nothing typed here is lost on refresh: addresses are saved to the member profile and mirrored
// in local storage together with the unsaved draft, company name and GST number.
function CheckoutDetailsCard({ memberId, value, onChange, cardStyle, themePrimary, showErrors }) {
  const [editingSlot, setEditingSlot] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_ADDRESS });
  const [draftErrors, setDraftErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const lookupRef = useRef(null);

  // Load saved data once (profile first, local backup fills any gaps).
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const profile = await loadMemberCheckoutProfile(memberId);
        if (!active) return;

        if (!profile) {
          onChange({ loaded: true });
          setEditingSlot(0);
          return;
        }

        const firstSaved = profile.addresses.findIndex(Boolean);
        const selected = Number.isInteger(profile.selected) && profile.addresses[profile.selected]
          ? profile.selected
          : Math.max(firstSaved, 0);

        onChange({
          loaded: true,
          addresses: profile.addresses,
          selected,
          companyName: profile.companyName,
          gstNumber: profile.gstNumber,
          gstEnabled: Boolean(profile.gstNumber),
          homeAddressText: profile.homeAddressText,
          canPersist: profile.canPersist,
        });

        const savedDraft = profile.draft && typeof profile.draft === 'object' ? profile.draft : null;
        if (savedDraft?.address && Number.isInteger(savedDraft.slot)) {
          setDraft({ ...EMPTY_ADDRESS, ...savedDraft.address });
          setEditingSlot(savedDraft.slot);
        } else if (firstSaved < 0) {
          setDraft({ ...EMPTY_ADDRESS, line1: profile.homeAddressText });
          setEditingSlot(0);
        }
      } catch (loadError) {
        console.warn('[Checkout] Failed to load saved details:', loadError?.message || loadError);
        if (!active) return;
        onChange({ loaded: true, canPersist: false });
        setEditingSlot(0);
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // Mirror the unsaved draft so a refresh does not wipe a half-filled form.
  useEffect(() => {
    if (isLoading) return;
    writeLocalCheckout(memberId, { draft: editingSlot === null ? null : { slot: editingSlot, address: draft } });
  }, [memberId, isLoading, editingSlot, draft]);

  // Mirror company / GST / chosen address.
  useEffect(() => {
    if (isLoading) return;
    writeLocalCheckout(memberId, {
      companyName: value.companyName,
      gstNumber: value.gstNumber,
      selected: value.selected,
    });
  }, [memberId, isLoading, value.companyName, value.gstNumber, value.selected]);

  // Tell the page whether an address form is still open (so "Continue" can ask to save first).
  useEffect(() => {
    if (isLoading) return;
    onChange({ editing: editingSlot !== null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, editingSlot]);

  useEffect(() => () => lookupRef.current?.abort(), []);

  const addresses = value.addresses;
  const savedCount = addresses.filter(Boolean).length;
  const canAddMore = savedCount > 0 && savedCount < MAX_ADDRESSES && editingSlot === null;
  const gstInvalid = value.gstEnabled && Boolean(value.gstNumber) && !isValidGst(value.gstNumber);
  const noAddressSelected = showErrors && !addresses[value.selected] && editingSlot === null;

  const openEditor = (slot) => {
    setDraftErrors({});
    setSaveNote('');
    setLookupFailed(false);
    setDraft(
      addresses[slot]
        ? { ...EMPTY_ADDRESS, ...addresses[slot] }
        : { ...EMPTY_ADDRESS, label: slot === 1 ? 'office' : 'home', line1: slot === 0 ? value.homeAddressText || '' : '' }
    );
    setEditingSlot(slot);
  };

  const closeEditor = () => {
    setEditingSlot(null);
    setDraftErrors({});
  };

  const handleSaveAddress = async () => {
    const errors = getAddressErrors(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const slot = editingSlot;
    const address = normalizeAddress(draft);
    const nextAddresses = addresses.map((entry, index) => (index === slot ? address : entry));

    // Usable for this order straight away and backed up locally, even if the profile write fails.
    onChange({ addresses: nextAddresses, selected: slot });
    writeLocalCheckout(memberId, { addresses: nextAddresses, selected: slot, draft: null });

    setIsSaving(true);
    setSaveNote('');
    try {
      if (value.canPersist) {
        await saveMemberAddress(memberId, slot, address);
      }
      closeEditor();
    } catch (saveError) {
      console.warn('[Checkout] Failed to save address:', saveError?.message || saveError);
      setSaveNote('Saved on this device. We could not add it to your profile right now.');
      closeEditor();
    } finally {
      setIsSaving(false);
    }
  };

  const setDraftField = (key) => (event) => {
    const next = key === 'pincode' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value;
    setDraft((prev) => ({ ...prev, [key]: next }));
    if (draftErrors[key]) setDraftErrors((prev) => ({ ...prev, [key]: undefined }));

    if (key === 'pincode' && next.length < 6) setLookupFailed(false);

    if (key === 'pincode' && next.length === 6) {
      lookupRef.current?.abort();
      const controller = new AbortController();
      lookupRef.current = controller;
      setIsLookingUp(true);
      lookupPincode(next, controller.signal).then((place) => {
        if (controller.signal.aborted) return;
        setIsLookingUp(false);
        setLookupFailed(!place);
        if (!place) return;
        setDraft((prev) => ({
          ...prev,
          city: prev.city || place.city,
          state: prev.state || place.state,
        }));
        setDraftErrors((prev) => ({ ...prev, city: undefined, state: undefined }));
      });
    }
  };

  const renderField = ({ key, label, placeholder, optional, required, readOnly, inputMode, autoComplete, hint }) => (
    <label className="cd-field">
      <span className="cd-label">
        {label}
        {required ? <b className="cd-required"> *</b> : null}
        {optional ? <em> (optional)</em> : null}
      </span>
      <input
        className={`cd-input ${draftErrors[key] ? 'cd-input--error' : ''} ${readOnly ? 'cd-input--auto' : ''}`}
        readOnly={readOnly}
        value={draft[key]}
        onChange={setDraftField(key)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={key === 'pincode' ? 6 : 120}
      />
      {draftErrors[key] ? <span className="cd-error">{draftErrors[key]}</span> : hint ? <span className="cd-hint">{hint}</span> : null}
    </label>
  );

  return (
    <>
    <div id="checkout-details-card" className="cd-card rounded-[30px] p-5 sm:p-6" style={cardStyle}>
      <div className="mb-5 flex items-start gap-3">
        <div className="cd-icon-box" style={{ color: themePrimary }}>
          <MapPin className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="cd-eyebrow" style={{ color: themePrimary }}>Delivery &amp; billing</p>
          <h2 className="cd-title">Where should we deliver?</h2>
        </div>
      </div>

      {isLoading ? (
        <div className="cd-skeleton" aria-hidden="true" />
      ) : (
        <div className="cd-addresses">
          {addresses.map((address, slot) => {
            if (!address || editingSlot === slot) return null;
            const selected = value.selected === slot;
            return (
              <div
                key={slot}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                className={`cd-address ${selected ? 'cd-address--on' : ''}`}
                onClick={() => onChange({ selected: slot })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onChange({ selected: slot });
                  }
                }}
              >
                <span className="cd-radio" aria-hidden="true">
                  {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
                <div className="cd-address-body">
                  <div className="cd-address-tag">
                    {LABEL_ICONS[address.label] || LABEL_ICONS.home}
                    {addressLabelText(address.label)}
                  </div>
                  <div className="cd-address-text">{formatAddress(address)}</div>
                </div>
                <button
                  type="button"
                  className="cd-edit"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditor(slot);
                  }}
                  aria-label={`Edit ${addressLabelText(address.label)} address`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              </div>
            );
          })}

          {editingSlot !== null ? (
            <div className="cd-editor">
              <div className="cd-label">Save address as</div>
              <div className="cd-chips" role="radiogroup" aria-label="Address type">
                {ADDRESS_LABELS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={draft.label === label}
                    className={`cd-chip ${draft.label === label ? 'cd-chip--on' : ''}`}
                    onClick={() => setDraft((prev) => ({ ...prev, label }))}
                  >
                    {LABEL_ICONS[label]}
                    {addressLabelText(label)}
                  </button>
                ))}
              </div>

              <div className="cd-grid">
                {renderField({ key: 'line1', label: 'Address', required: true, placeholder: 'House / flat no., street, area', autoComplete: 'address-line1' })}
                {renderField({ key: 'line2', label: 'Landmark', optional: true, placeholder: 'e.g. near metro station, temple', autoComplete: 'address-line2' })}
                {renderField({ key: 'pincode', label: 'Pincode', required: true, placeholder: '6-digit pincode', inputMode: 'numeric', autoComplete: 'postal-code' })}
                <div className="cd-info">
                  <Info className="h-4 w-4" />
                  <span>
                    {isLookingUp
                      ? 'Finding your city and state...'
                      : lookupFailed
                        ? 'We could not find this pincode. Please enter your city and state.'
                        : 'City and state fill in automatically'}
                  </span>
                </div>
                <div className="cd-row">
                  {renderField({ key: 'city', label: 'City', placeholder: 'Auto-filled', readOnly: !lookupFailed, autoComplete: 'address-level2' })}
                  {renderField({ key: 'state', label: 'State', placeholder: 'Auto-filled', readOnly: !lookupFailed, autoComplete: 'address-level1' })}
                </div>
              </div>

              <div className="cd-actions">
                {savedCount > 0 ? (
                  <button type="button" className="cd-btn cd-btn--ghost" onClick={closeEditor} disabled={isSaving}>
                    Cancel
                  </button>
                ) : null}
                <button type="button" className="cd-btn cd-btn--primary" onClick={handleSaveAddress} disabled={isSaving}>
                  <Check className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save address'}
                </button>
              </div>
            </div>
          ) : null}

          {canAddMore ? (
            <button type="button" className="cd-add" onClick={() => openEditor(addresses.findIndex((entry) => !entry))}>
              <Plus className="h-4 w-4" />
              Add another address
            </button>
          ) : null}

          {saveNote ? <div className="cd-note">{saveNote}</div> : null}
          {noAddressSelected ? <div className="cd-error cd-error--block">Please add a delivery address to continue.</div> : null}
        </div>
      )}

    </div>

    {/* GST invoice - optional */}
    <div className="cd-card cd-gst rounded-[26px] p-5" style={cardStyle}>
      <div className="cd-gst-row">
        <div className="cd-icon-box cd-icon-box--sm" style={{ color: themePrimary }}>
          <Building2 className="h-5 w-5" />
        </div>
        <div className="cd-gst-text">
          <div className="cd-gst-title">Need a GST invoice?</div>
          <div className="cd-hint">Add company details to claim input tax credit</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.gstEnabled}
          aria-label="Need a GST invoice"
          className={`cd-switch ${value.gstEnabled ? 'cd-switch--on' : ''}`}
          onClick={() => onChange({ gstEnabled: !value.gstEnabled })}
        >
          <span className="cd-switch-knob" />
        </button>
      </div>

      {value.gstEnabled ? (
        <div className="cd-grid">
          <label className="cd-field">
            <span className="cd-label">Company name <em>(optional)</em></span>
            <input
              className="cd-input"
              value={value.companyName}
              onChange={(event) => onChange({ companyName: event.target.value })}
              placeholder="Your company name"
              autoComplete="organization"
              maxLength={120}
            />
          </label>
          <label className="cd-field">
            <span className="cd-label">GST number <em>(optional)</em></span>
            <input
              className={`cd-input ${gstInvalid ? 'cd-input--error' : ''}`}
              value={value.gstNumber}
              onChange={(event) => onChange({ gstNumber: normalizeGst(event.target.value) })}
              placeholder="22AAAAA0000A1Z5"
              autoCapitalize="characters"
              maxLength={15}
            />
            {gstInvalid ? <span className="cd-error">Enter a valid 15-character GST number</span> : null}
          </label>
        </div>
      ) : null}

      <style>{`
        .cd-card {
          --cd-ink: var(--page-text-color, var(--body-text-color));
          --cd-strong: var(--page-strong-color, var(--cd-ink));
          --cd-accent: var(--page-price-color, var(--cd-ink));
          --cd-soft: color-mix(in srgb, var(--cd-ink) 66%, transparent);
          --cd-line: color-mix(in srgb, var(--cd-ink) 18%, transparent);
          --cd-tint: color-mix(in srgb, var(--cd-ink) 7%, transparent);
          --cd-danger: #e5484d;
        }
        .cd-icon-box { width: 44px; height: 44px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; border-radius: 16px; background: var(--cd-tint); }
        .cd-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase; }
        .cd-card .cd-title { margin-top: 4px; font-size: 20px; font-weight: 800; color: var(--cd-strong); }
        .cd-grid { display: grid; gap: 12px; margin-top: 14px; }
        .cd-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .cd-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .cd-label { font-size: 12.5px; font-weight: 700; color: var(--cd-ink); }
        .cd-label em, .cd-company-head em { font-style: normal; font-weight: 500; color: var(--cd-soft); }
        .cd-hint { font-size: 12px; font-weight: 500; color: var(--cd-soft); }
        .cd-input { width: 100%; min-height: 48px; padding: 0 14px; border-radius: 14px; border: 1.5px solid var(--cd-line); background: var(--cd-tint); color: var(--cd-strong); font-size: 15px; font-weight: 600; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
        .cd-input::placeholder { color: color-mix(in srgb, var(--cd-ink) 42%, transparent); font-weight: 500; }
        .cd-input:focus { border-color: var(--cd-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cd-accent) 16%, transparent); }
        .cd-input--error { border-color: var(--cd-danger); }
        .cd-error { font-size: 12px; font-weight: 600; color: var(--cd-danger); }
        .cd-error--block { margin-top: 2px; }
        .cd-addresses { display: flex; flex-direction: column; gap: 10px; }
        .cd-address { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border-radius: 16px; border: 1.5px solid var(--cd-line); background: var(--cd-tint); cursor: pointer; transition: border-color .15s ease, background-color .15s ease; }
        .cd-address--on { border-color: var(--cd-accent); background: color-mix(in srgb, var(--cd-accent) 11%, transparent); }
        .cd-radio { flex: 0 0 auto; width: 20px; height: 20px; margin-top: 2px; display: flex; align-items: center; justify-content: center; border-radius: 999px; border: 2px solid var(--cd-line); color: var(--pd-btn-text, var(--app-button-text)); }
        .cd-address--on .cd-radio { border-color: transparent; background: var(--pd-btn-bg, var(--app-button-bg)); }
        .cd-address-body { flex: 1; min-width: 0; }
        .cd-address-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--cd-strong); }
        .cd-address-text { margin-top: 5px; font-size: 14px; font-weight: 500; line-height: 1.45; color: var(--cd-ink); overflow-wrap: anywhere; }
        .cd-edit { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--cd-line); background: transparent; color: var(--cd-strong); font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .cd-editor { padding: 0; }
        .cd-required { color: var(--cd-danger); font-weight: 800; }
        .cd-input--auto { border-style: dashed; background: transparent; color: var(--cd-soft); cursor: default; }
        .cd-input--auto::placeholder { color: var(--cd-soft); }
        .cd-info { display: flex; align-items: center; gap: 8px; margin-top: -2px; font-size: 12.5px; font-weight: 500; color: var(--cd-soft); }
        .cd-info svg { color: var(--cd-accent); flex: 0 0 auto; }
        .cd-icon-box--sm { width: 42px; height: 42px; border-radius: 14px; }
        .cd-gst-row { display: flex; align-items: center; gap: 12px; }
        .cd-gst-text { flex: 1; min-width: 0; }
        .cd-gst-title { font-size: 15.5px; font-weight: 800; color: var(--cd-strong); }
        .cd-switch { flex: 0 0 auto; width: 52px; height: 30px; padding: 3px; border-radius: 999px; border: 0; background: color-mix(in srgb, var(--cd-ink) 22%, transparent); cursor: pointer; transition: background-color .2s ease; }
        .cd-switch--on { background: var(--pd-btn-bg, var(--app-button-bg)); }
        .cd-switch-knob { display: block; width: 24px; height: 24px; border-radius: 999px; background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25); transition: transform .2s ease; }
        .cd-switch--on .cd-switch-knob { transform: translateX(22px); }
        .cd-btn--primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 10px 22px color-mix(in srgb, var(--cd-ink) 16%, transparent); }
        .cd-chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; margin-bottom: 4px; }
        .cd-chip { flex: 1; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 12px; border: 1.5px solid var(--cd-line); background: transparent; color: var(--cd-soft); font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all .15s ease; }
        .cd-chip--on { border-color: transparent; background: var(--pd-btn-bg, var(--app-button-bg)); color: var(--pd-btn-text, var(--app-button-text)); }
        .cd-actions { display: flex; gap: 10px; margin-top: 18px; }
        .cd-btn { flex: 1; min-height: 48px; border-radius: 14px; font-size: 14px; font-weight: 800; cursor: pointer; transition: opacity .15s ease, transform .1s ease; }
        .cd-btn:active { transform: scale(0.98); }
        .cd-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .cd-btn--primary { border: 0; background: var(--pd-btn-bg, var(--app-button-bg)); color: var(--pd-btn-text, var(--app-button-text)); }
        .cd-btn--ghost { border: 1.5px solid var(--cd-line); background: transparent; color: var(--cd-strong); }
        .cd-add { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 14px; border: 1.5px dashed var(--cd-line); background: transparent; color: var(--cd-strong); font-size: 14px; font-weight: 700; cursor: pointer; }
        .cd-note { font-size: 12.5px; font-weight: 600; color: var(--cd-soft); }
        .cd-company { margin-top: 20px; padding-top: 18px; border-top: 1px dashed var(--cd-line); }
        .cd-company-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: var(--cd-strong); }
        .cd-company .cd-hint { margin-top: 4px; }
        .cd-skeleton { height: 90px; border-radius: 16px; background: var(--cd-tint); animation: cdPulse 1.4s ease-in-out infinite; }
        @keyframes cdPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
    </>
  );
}

export default CheckoutDetailsCard;
