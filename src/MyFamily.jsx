import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Home as HomeIcon,
  Mail,
  MapPin,
  Menu,
  Phone,
  Plus,
  Save,
  Trash2,
  Users,
  X
} from 'lucide-react';
import Sidebar from './components/Sidebar';
import { createFamilyMember, deleteFamilyMember, getFamilyMembers, updateFamilyMember } from './services/api';
import { useAppTheme } from './context/ThemeContext';
import { getNavbarThemeStyles } from './utils/themeUtils';

const RELATION_OPTIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Other'];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const createDraftMember = () => ({
  id: null,
  name: '',
  relation: '',
  gender: '',
  age: '',
  blood_group: '',
  contact_no: '',
  email: '',
  address: ''
});

const toFormState = (member = {}) => ({
  id: member?.id || null,
  name: String(member?.name || ''),
  relation: String(member?.relation || ''),
  gender: String(member?.gender || ''),
  age: member?.age === null || member?.age === undefined ? '' : String(member.age),
  blood_group: String(member?.blood_group || ''),
  contact_no: String(member?.contact_no || ''),
  email: String(member?.email || ''),
  address: String(member?.address || '')
});

const MyFamily = ({ onNavigate }) => {
  const theme = useAppTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  const mainContainerRef = useRef(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [successPopup, setSuccessPopup] = useState({ open: false, text: '' });
  const [screen, setScreen] = useState('list');
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [formState, setFormState] = useState(createDraftMember());
  const returnToRoute = location.state?.returnTo || '';

  useEffect(() => {
    if (isMenuOpen) {
      const y = window.scrollY;
      Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%', top: `-${y}px` });
    } else {
      const y = parseInt(document.body.style.top || '0', 10) * -1;
      Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
      window.scrollTo(0, Number.isFinite(y) ? y : 0);
    }
    return () => Object.assign(document.body.style, { overflow: '', position: '', width: '', top: '' });
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest('[data-sidebar="true"]') && !event.target.closest('[data-sidebar-overlay="true"]')) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleOutside, true);
    return () => document.removeEventListener('click', handleOutside, true);
  }, [isMenuOpen]);

  useEffect(() => {
    let active = true;
    const loadMembers = async () => {
      setLoading(true);
      setMessage({ type: '', text: '' });
      try {
        const response = await getFamilyMembers();
        if (!active) return;
        setMembers(Array.isArray(response?.members) ? response.members : []);
      } catch (error) {
        if (!active) return;
        setMembers([]);
        setMessage({ type: 'error', text: error?.message || 'Unable to load family members.' });
      } finally {
        if (active) setLoading(false);
      }
    };
    loadMembers();
    return () => {
      active = false;
    };
  }, []);

  const validateMember = (member) => {
    if (!String(member?.name || '').trim()) return 'Member name is required.';
    if (!String(member?.relation || '').trim()) return 'Relation is required.';
    if (member?.gender && !GENDER_OPTIONS.includes(member.gender)) return 'Invalid gender selected.';
    if (member?.blood_group && !BLOOD_GROUP_OPTIONS.includes(member.blood_group)) return 'Invalid blood group selected.';
    const ageText = String(member?.age ?? '').trim();
    if (ageText) {
      const parsedAge = Number(ageText);
      if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120) return 'Age must be between 0 and 120.';
    }
    return '';
  };

  const buildPayload = (member) => {
    const ageText = String(member?.age ?? '').trim();
    return {
      name: String(member?.name || '').trim(),
      relation: String(member?.relation || '').trim(),
      gender: String(member?.gender || '').trim() || null,
      age: ageText === '' ? null : Number(ageText),
      blood_group: String(member?.blood_group || '').trim() || null,
      contact_no: String(member?.contact_no || '').trim() || null,
      email: String(member?.email || '').trim() || null,
      address: String(member?.address || '').trim() || null
    };
  };

  const openAddForm = () => {
    setScreen('edit');
    setFormState(createDraftMember());
    setMessage({ type: '', text: '' });
  };

  const openEditForm = (member) => {
    setScreen('edit');
    setFormState(toFormState(member));
    setMessage({ type: '', text: '' });
  };

  const saveCurrentMember = async () => {
    const validationError = validateMember(formState);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const payload = buildPayload(formState);
      const isCreate = !formState.id;
      const response = isCreate
        ? await createFamilyMember(payload)
        : await updateFamilyMember(formState.id, payload);
      const saved = response?.member;
      if (!saved?.id) throw new Error('Failed to save family member.');

      if (isCreate) {
        setMembers((prev) => [saved, ...prev]);
        setExpandedMemberId(String(saved.id));
      } else {
        setMembers((prev) => prev.map((item) => (String(item.id) === String(saved.id) ? saved : item)));
        setExpandedMemberId(String(saved.id));
      }

      setScreen('list');
      setFormState(createDraftMember());
      setSuccessPopup({
        open: true,
        text: isCreate ? 'Family member added successfully.' : 'Family member updated successfully.'
      });
      if (returnToRoute) {
        setTimeout(() => {
          navigate(returnToRoute, { replace: true });
        }, 700);
      }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Failed to save family member.' });
    } finally {
      setSaving(false);
    }
  };

  const removeCurrentMember = async () => {
    if (!formState.id) {
      setScreen('list');
      setFormState(createDraftMember());
      return;
    }
    const okToDelete = window.confirm('Remove this family member?');
    if (!okToDelete) return;

    setDeleting(true);
    setMessage({ type: '', text: '' });
    try {
      await deleteFamilyMember(formState.id, null);
      setMembers((prev) => prev.filter((item) => String(item.id) !== String(formState.id)));
      setExpandedMemberId(null);
      setScreen('list');
      setFormState(createDraftMember());
      setSuccessPopup({ open: true, text: 'Family member removed.' });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Failed to remove family member.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      ref={mainContainerRef}
      className="min-h-screen font-sans"
      style={{ background: 'linear-gradient(140deg, color-mix(in srgb, var(--surface-color) 90%, var(--app-accent-bg)) 0%, var(--surface-color) 50%, color-mix(in srgb, var(--brand-navy-light) 50%, var(--surface-color)) 100%)' }}
    >
      <div
        className="px-4 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
          color: navbarTextColor
        }}
      >
        <button onClick={() => (screen === 'list' ? setIsMenuOpen((prev) => !prev) : setScreen('list'))} className="p-2 rounded-xl transition-colors" style={{ color: navbarTextColor, background: 'transparent' }}>
          {screen === 'list' ? (isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />) : <ArrowLeft className="h-6 w-6" />}
        </button>
        <h1 className="text-base font-bold tracking-wide" style={{ color: navbarTextColor }}>
          {screen === 'list' ? 'My Family' : (formState.id ? 'Edit Member' : 'Add Member')}
        </h1>
        <button onClick={() => onNavigate('home')} className="p-2 rounded-xl transition-colors" style={{ color: navbarTextColor, background: 'transparent' }}>
          <HomeIcon className="h-5 w-5" />
        </button>
      </div>

      <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="my-family" />

      {message.text ? (
        <div
          className="mx-4 mt-3 rounded-xl p-3 flex items-center gap-2"
          style={
            message.type === 'error'
              ? { background: 'var(--brand-red-light)', border: '1px solid color-mix(in srgb, var(--brand-red) 20%, transparent)' }
              : { background: 'color-mix(in srgb, var(--brand-navy-light) 68%, var(--surface-color))', border: '1px solid color-mix(in srgb, var(--brand-navy) 16%, transparent)' }
          }
        >
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--brand-red)' }} />
            : <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--brand-navy)' }} />}
          <p className="text-sm" style={{ color: message.type === 'error' ? 'var(--brand-red-dark)' : 'var(--brand-navy)' }}>{message.text}</p>
        </div>
      ) : null}

      <div className="px-4 pt-5 pb-24">
        {screen === 'list' ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--heading-color)' }}>Family Members</p>
                <p className="mt-1 text-sm leading-5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 58%, var(--surface-color))' }}>
                  Add, update and manage members linked with your profile
                </p>
              </div>
              <button
                type="button"
                onClick={openAddForm}
                className="h-11 px-4 rounded-xl text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-1.5 shrink-0"
                style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)' }}
              >
                <Plus className="h-4 w-4" />
                Add Member
              </button>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <div className="inline-block w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--brand-red)', borderTopColor: 'transparent' }} />
                <p className="mt-3 text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--body-text-color) 65%, var(--surface-color))' }}>Loading family members...</p>
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center rounded-2xl border" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))' }}>
                <Users className="h-12 w-12" style={{ color: 'color-mix(in srgb, var(--body-text-color) 35%, var(--surface-color))' }} />
                <p className="font-semibold" style={{ color: 'var(--heading-color)' }}>No family members yet</p>
                <p className="text-sm px-8" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>Tap Add Member to create the first family profile.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {members.map((member) => {
                  const isExpanded = expandedMemberId === String(member.id);
                  return (
                    <div key={member.id} className="rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)', background: 'var(--surface-color)' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedMemberId(isExpanded ? null : String(member.id))}
                        className="w-full px-4 py-3.5 text-left flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-base truncate" style={{ color: 'var(--heading-color)' }}>{member.name || 'Unnamed Member'}</p>
                          <p className="text-sm truncate mt-0.5" style={{ color: 'color-mix(in srgb, var(--body-text-color) 55%, var(--surface-color))' }}>
                            {[member.relation, member.gender, member.age ? `Age ${member.age}` : ''].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--body-text-color)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--body-text-color)' }} />}
                      </button>

                      {isExpanded ? (
                        <div className="border-t px-4 py-3 space-y-2.5" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'color-mix(in srgb, var(--surface-color) 86%, var(--app-accent-bg))' }}>
                          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--brand-red)' }}>Details</p>
                          <div className="text-sm flex items-center gap-2" style={{ color: 'var(--body-text-color)' }}>
                            <Phone className="h-4 w-4" />
                            <span>{member.contact_no || 'Not provided'}</span>
                          </div>
                          <div className="text-sm flex items-center gap-2" style={{ color: 'var(--body-text-color)' }}>
                            <Mail className="h-4 w-4" />
                            <span className="truncate">{member.email || 'Not provided'}</span>
                          </div>
                          <div className="text-sm flex items-start gap-2" style={{ color: 'var(--body-text-color)' }}>
                            <MapPin className="h-4 w-4 mt-0.5" />
                            <span>{member.address || 'Not provided'}</span>
                          </div>
                          <div className="text-sm" style={{ color: 'var(--body-text-color)' }}>
                            Blood Group: <span className="font-semibold">{member.blood_group || 'Not provided'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditForm(member)}
                            className="mt-1 w-full h-10 rounded-xl text-sm font-semibold active:scale-95 transition-all"
                            style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)' }}
                          >
                            Edit
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-2xl border p-4 space-y-3 shadow-sm" style={{ borderColor: 'color-mix(in srgb, var(--brand-navy) 12%, transparent)', background: 'var(--surface-color)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Name *</label>
                <input type="text" value={formState.name} onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Relation *</label>
                <select value={formState.relation} onChange={(e) => setFormState((prev) => ({ ...prev, relation: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }}>
                  <option value="">Select</option>
                  {RELATION_OPTIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Gender</label>
                <select value={formState.gender} onChange={(e) => setFormState((prev) => ({ ...prev, gender: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }}>
                  <option value="">Select</option>
                  {GENDER_OPTIONS.map((gender) => <option key={gender} value={gender}>{gender}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Age</label>
                <input type="number" min="0" max="120" value={formState.age} onChange={(e) => setFormState((prev) => ({ ...prev, age: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Blood Group</label>
                <select value={formState.blood_group} onChange={(e) => setFormState((prev) => ({ ...prev, blood_group: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }}>
                  <option value="">Select</option>
                  {BLOOD_GROUP_OPTIONS.map((bloodGroup) => <option key={bloodGroup} value={bloodGroup}>{bloodGroup}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Contact No</label>
                <input type="tel" value={formState.contact_no} onChange={(e) => setFormState((prev) => ({ ...prev, contact_no: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Email</label>
              <input type="email" value={formState.email} onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-widest ml-0.5" style={{ color: 'var(--brand-red)' }}>Address</label>
              <input type="text" value={formState.address} onChange={(e) => setFormState((prev) => ({ ...prev, address: e.target.value }))} className="w-full px-3 py-2.5 text-sm font-medium rounded-2xl border-2 bg-transparent focus:outline-none" style={{ color: 'var(--body-text-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 10%, transparent)', background: 'var(--surface-color)' }} />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button type="button" onClick={saveCurrentMember} disabled={saving || deleting} className="w-full py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5" style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)' }}>
                <Save className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={formState.id ? removeCurrentMember : () => setScreen('list')} disabled={saving || deleting} className="w-full py-2.5 rounded-xl text-sm font-semibold active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5 border" style={{ color: 'var(--brand-red)', borderColor: 'color-mix(in srgb, var(--brand-red) 20%, transparent)', background: 'color-mix(in srgb, var(--brand-red-light) 72%, var(--surface-color))' }}>
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Removing...' : (formState.id ? 'Remove' : 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {successPopup.open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-5" style={{ background: 'rgba(10, 18, 35, 0.35)' }}>
          <div className="w-full max-w-sm rounded-2xl p-5 text-center shadow-xl border" style={{ background: 'var(--surface-color)', borderColor: 'color-mix(in srgb, var(--brand-navy) 14%, transparent)' }}>
            <div className="mx-auto mb-2 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--brand-navy-light) 68%, var(--surface-color))' }}>
              <CheckCircle2 className="h-6 w-6" style={{ color: 'var(--brand-navy)' }} />
            </div>
            <p className="text-base font-semibold" style={{ color: 'var(--heading-color)' }}>{successPopup.text}</p>
            <button
              type="button"
              onClick={() => setSuccessPopup({ open: false, text: '' })}
              className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold"
              style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)' }}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MyFamily;
