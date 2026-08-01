import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, HomeIcon, Menu, Plus, ShieldCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppTheme } from './context/ThemeContext';
import { applyOpacity } from './utils/colorUtils';
import { getFamilyMembers } from './services/api';
import { supabase } from './services/supabaseClient';
import { getNavbarThemeStyles } from './utils/themeUtils';
import Sidebar from './components/Sidebar';

const resolveInitialMemberships = () => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.hospital_memberships) ? parsed.hospital_memberships : [];
  } catch {
    return [];
  }
};

const normalizeId = (value) => String(value || '').trim();
const normalizeText = (value) => String(value || '').trim();

const getFamilyMemberMembershipNo = (member) => (
  normalizeText(
    member?.membership_no
    || member?.membership_number
    || member?.membershipNumber
    || member?.['Membership number']
  )
);

const NominationDetails = ({ onNavigate }) => {
  const theme = useAppTheme();
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState(() => resolveInitialMemberships());
  const [selectedTrustId, setSelectedTrustId] = useState(() => normalizeId(localStorage.getItem('selected_trust_id')));
  const [familyMembers, setFamilyMembers] = useState([]);
  const [nominations, setNominations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [nominationForm, setNominationForm] = useState({ family_member_id: '' });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [contextIds, setContextIds] = useState({ memberId: '', regId: '' });
  const [isMemberMenuOpen, setIsMemberMenuOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navbarTheme = getNavbarThemeStyles(theme);
  const navbarTextColor = navbarTheme?.textColor || 'var(--navbar-text)';
  
  const [replaceDialog, setReplaceDialog] = useState({
    open: false,
    familyMemberId: '',
    currentNomineeName: '',
    nextNomineeName: '',
  });
  const [removeDialog, setRemoveDialog] = useState({
    open: false,
    familyMemberId: '',
    familyMemberName: '',
  });
  const memberMenuRef = useRef(null);

  const nominatedFamilyIds = useMemo(
    () => new Set(nominations.map((row) => normalizeId(row?.family_member_id)).filter(Boolean)),
    [nominations]
  );

  const selectedNominee = useMemo(
    () => familyMembers.find((member) => normalizeId(member?.id) === normalizeId(nominationForm.family_member_id)) || null,
    [familyMembers, nominationForm.family_member_id]
  );

  const resolveMemberContext = async (trustId, membershipRows = memberships) => {
    let memberId = '';
    let regId = '';

    try {
      const raw = localStorage.getItem('user');
      const parsed = raw ? JSON.parse(raw) : null;
      const memberFromUser = normalizeId(parsed?.members_id || parsed?.member_id || parsed?.id);
      const match = (membershipRows || []).find((item) => normalizeId(item?.trust_id) === trustId);

      memberId = normalizeId(match?.members_id || memberFromUser);
      regId = normalizeId(match?.id || '');

      if (!regId && trustId && memberId) {
        const { data } = await supabase
          .from('reg_members')
          .select('id')
          .eq('trust_id', trustId)
          .eq('members_id', memberId)
          .limit(1);
        regId = normalizeId(data?.[0]?.id || '');
      }
    } catch {
      memberId = '';
      regId = '';
    }

    return { memberId, regId };
  };

  const loadAll = async (trustId) => {
    const normalizedTrustId = normalizeId(trustId);
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const nextMemberships = resolveInitialMemberships();
      setMemberships(nextMemberships);

      const [{ members }, ids] = await Promise.all([
        getFamilyMembers(),
        resolveMemberContext(normalizedTrustId, nextMemberships),
      ]);

      setContextIds(ids);
      const family = Array.isArray(members) ? members : [];
      setFamilyMembers(family);

      if (!normalizedTrustId || !ids.memberId) {
        setNominations([]);
        return;
      }

      if (!ids.regId) {
        setNominations([]);
        return;
      }

      const { data, error } = await supabase
        .from('member_nominations')
        .select('id, family_member_id, reg_id')
        .eq('reg_id', ids.regId);

      if (error) throw error;
      setNominations(Array.isArray(data) ? data : []);
    } catch (error) {
      setNominations([]);
      setFamilyMembers([]);
      setMessage({ type: 'error', text: error?.message || 'Unable to load nomination details.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedTrustId) return;
    loadAll(selectedTrustId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrustId]);

  useEffect(() => {
    if (!isMemberMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (isMemberMenuOpen && memberMenuRef.current && !memberMenuRef.current.contains(event.target)) {
        setIsMemberMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMemberMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMemberMenuOpen]);

  useEffect(() => {
    if (!removeDialog.open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRemoveDialog({ open: false, familyMemberId: '', familyMemberName: '' });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [removeDialog.open]);

  useEffect(() => {
    const syncSelectedTrust = () => {
      const nextTrustId = normalizeId(localStorage.getItem('selected_trust_id'));
      if (nextTrustId && nextTrustId !== selectedTrustId) {
        setSelectedTrustId(nextTrustId);
      }
    };

    window.addEventListener('storage', syncSelectedTrust);
    window.addEventListener('trust-changed', syncSelectedTrust);
    return () => {
      window.removeEventListener('storage', syncSelectedTrust);
      window.removeEventListener('trust-changed', syncSelectedTrust);
    };
  }, [selectedTrustId]);

  const refreshNominations = async () => {
    if (!selectedTrustId || !contextIds.regId) return;
    const { data, error } = await supabase
      .from('member_nominations')
      .select('id, family_member_id, reg_id')
      .eq('reg_id', contextIds.regId);
    if (error) throw error;
    setNominations(Array.isArray(data) ? data : []);
  };

  const assignNominee = async (familyMemberId) => {
    if (!selectedTrustId || !contextIds.regId) {
      setMessage({ type: 'error', text: 'Member context missing for selected trust.' });
      return;
    }
    const lockKey = `${familyMemberId}:assign`;
    setSavingKey(lockKey);
    setMessage({ type: '', text: '' });
    try {
      const alreadyNominated = nominations.some(
        (row) => normalizeId(row?.family_member_id) === normalizeId(familyMemberId)
      );
      if (alreadyNominated) {
        setMessage({ type: 'success', text: 'This member is already nominated.' });
        return;
      }

      const payload = {
        reg_id: contextIds.regId,
        family_member_id: familyMemberId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('member_nominations').insert(payload);
      if (error) throw error;
      await refreshNominations();
      setNominationForm({ family_member_id: '' });
      setMessage({ type: 'success', text: 'Nominee saved successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to update nominee.' });
    } finally {
      setSavingKey('');
    }
  };

  const handleSaveNominee = async () => {
    const familyId = normalizeId(nominationForm.family_member_id);
    if (!familyId) {
      setMessage({ type: 'error', text: 'Please select a family member for nomination.' });
      return;
    }

    const currentNomination = nominations[0] || null;
    const currentNomineeId = normalizeId(currentNomination?.family_member_id);

    if (!currentNomineeId) {
      await assignNominee(familyId);
      return;
    }

    if (currentNomineeId === familyId) {
      setMessage({ type: 'success', text: 'This member is already nominated.' });
      return;
    }

    const currentNominee = familyMembers.find((member) => normalizeId(member?.id) === currentNomineeId);
    const nextNominee = familyMembers.find((member) => normalizeId(member?.id) === familyId);
    setReplaceDialog({
      open: true,
      familyMemberId: familyId,
      currentNomineeName: currentNominee?.name || 'Current nominee',
      nextNomineeName: nextNominee?.name || 'Selected member',
    });
  };

  const confirmReplaceNominee = async () => {
    const familyId = normalizeId(replaceDialog.familyMemberId);
    if (!familyId) return;

    setReplaceDialog((prev) => ({ ...prev, open: false }));
    const currentNomination = nominations[0] || null;
    const currentNominationId = normalizeId(currentNomination?.id);
    if (currentNominationId) {
      await revokeNominee(currentNomination.family_member_id);
    }
    await assignNominee(familyId);
    setNominationForm({ family_member_id: '' });
  };

  const revokeNominee = async (familyMemberId) => {
    if (!selectedTrustId || !contextIds.regId) return;
    const lockKey = `${familyMemberId}:revoke`;
    setSavingKey(lockKey);
    setMessage({ type: '', text: '' });
    try {
      const targetIds = nominations
        .filter((row) => normalizeId(row?.family_member_id) === normalizeId(familyMemberId))
        .map((row) => row.id)
        .filter(Boolean);

      if (targetIds.length === 0) {
        setMessage({ type: 'error', text: 'Selected member is not a nominee.' });
        return;
      }

      const { error } = await supabase
        .from('member_nominations')
        .delete()
        .in('id', targetIds);
      if (error) throw error;
      await refreshNominations();
      setMessage({ type: 'success', text: 'Nomination removed.' });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to remove nomination.' });
    } finally {
      setSavingKey('');
    }
  };

  const submitNominationForm = async () => {
    await handleSaveNominee();
  };

  const openRemoveDialog = (familyMemberId, familyMemberName) => {
    setRemoveDialog({
      open: true,
      familyMemberId: normalizeId(familyMemberId),
      familyMemberName: String(familyMemberName || 'this nominee').trim() || 'this nominee',
    });
  };

  const closeRemoveDialog = () => {
    setRemoveDialog({ open: false, familyMemberId: '', familyMemberName: '' });
  };

  const confirmRemoveNominee = async () => {
    const familyId = normalizeId(removeDialog.familyMemberId);
    if (!familyId) return;

    closeRemoveDialog();
    await revokeNominee(familyId);
  };

  const openAddFamilyMember = () => {
    setIsMemberMenuOpen(false);
    navigate('/my-family', { state: { returnTo: '/nomination-details' } });
  };

  const selectFamilyMember = (familyMemberId) => {
    const nextValue = normalizeId(familyMemberId);
    if (!nextValue) return;
    setNominationForm((prev) => ({ ...prev, family_member_id: nextValue }));
    setIsMemberMenuOpen(false);
  };

  return (
    <div
      className="min-h-screen pb-8"
      style={{
        background: 'var(--page-bg, var(--app-page-bg))',
        color: 'var(--body-text-color)',
      }}
    >
      <div
        className="theme-navbar sticky top-0 z-20"
        style={{
          background: navbarTheme?.backgroundStyle || 'var(--navbar-bg, var(--app-navbar-bg))',
          backdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          WebkitBackdropFilter: `blur(${navbarTheme?.blurPx || '12px'})`,
          borderBottom: '1px solid var(--navbar-border)',
          boxShadow: '0 2px 16px color-mix(in srgb, var(--brand-navy) 16%, transparent)',
        }}
      >
        <div className="h-[3px]" style={{ background: 'var(--navbar-accent)' }} />
        <div className="px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'color-mix(in srgb, var(--navbar-bg) 72%, var(--surface-color))' }}
              aria-label="Open menu"
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <h1 className="text-lg font-extrabold tracking-wide" style={{ color: navbarTextColor }}>Nomination Details</h1>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="p-2 rounded-xl transition-colors"
              style={{ color: navbarTextColor, background: 'transparent' }}
              aria-label="Home"
            >
              <HomeIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
      
            {isMenuOpen && (
              <div
                className="fixed inset-0 z-25"
                style={{ background: applyOpacity('var(--brand-navy-dark)', 0.12) }}
                onClick={() => setIsMenuOpen(false)}
              />
            )}
            <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onNavigate={onNavigate} currentPage="nomination-details" />
      <div className="px-6 py-5 space-y-4">
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{
            background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-page-bg))',
            border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
          }}
        >
          <p className="text-sm font-extrabold tracking-wide" style={{ color: `${theme.primary}` }}>
            Assign Nominee
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              {/* <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: applyOpacity(theme.primary, 0.82) }}>
                Family Member
              </p> */}
            </div>

            <div ref={memberMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsMemberMenuOpen((prev) => !prev);
                  }}
                  className="w-full rounded-[24px] border px-4 py-3.5 text-left transition-all active:scale-[0.99]"
                style={{
                  // background: 'color-mix(in srgb, var(--surface-color) 92%, var(--app-accent-bg))',
                  borderColor: applyOpacity(theme.primary, 0.16),
                  boxShadow: isMemberMenuOpen ? `0 14px 34px ${applyOpacity(theme.secondary, 0.1)}` : 'none',
                }}
                aria-haspopup="listbox"
                aria-expanded={isMemberMenuOpen}
                aria-label="Select family member for nomination"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {/* <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: applyOpacity(theme.primary, 0.72) }}>
                      Nominee
                    </p> */}
                    <p
                      className="mt-0.5 truncate text-sm font-extrabold"
                      style={{ color: selectedNominee ? theme.primary : `${theme.primary}` }}
                    >
                      {selectedNominee ? (selectedNominee.name || 'Unnamed Member') : 'Select Family Member'}
                    </p>
                    <p
                      className="mt-1 truncate text-xs font-medium"
                      style={{ color: 'color-mix(in srgb, var(--body-text-color) 66%, var(--surface-color))' }}
                    >
                      {selectedNominee
                        ? (
                          [getFamilyMemberMembershipNo(selectedNominee) ? `Membership No: ${getFamilyMemberMembershipNo(selectedNominee)}` : '', [selectedNominee?.relation, selectedNominee?.gender].filter(Boolean).join(' | ')]
                            .filter(Boolean)
                            .join(' | ')
                          || 'Tap to choose from your family list'
                        )
                        : 'Tap to choose from your family list'}
                    </p>
                  </div>
                  <div
                    className="h-9 w-9 shrink-0 rounded-2xl flex items-center justify-center"
                    style={{
                      background: applyOpacity(theme.primary, 0.08),
                      color: theme.primary,
                    }}
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMemberMenuOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </button>

              {isMemberMenuOpen && (
                <div
                  className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[min(24rem,60vh)] overflow-y-auto overflow-x-hidden rounded-[24px] border shadow-2xl"
                  style={{
                    // background: `${theme.secondary ? theme.secondary : 'var(--surface-color)'}`,
                    background: `color-mix(in srgb, var(--surface-color) 92%, var(--app-accent-bg))`,
                    borderColor: applyOpacity(theme.primary, 0.16),
                    boxShadow: `0 18px 46px ${applyOpacity(theme.secondary, 0.14)}`,
                  }}
                  role="listbox"
                  aria-label="Family members"
                >
                  <button
                    type="button"
                    onClick={openAddFamilyMember}
                    className="w-full px-4 py-3.5 flex items-center gap-3 text-left text-sm font-semibold transition-colors"
                    style={{
                      color: theme.primary,
                      background: applyOpacity(theme.primary, 0.05),
                    }}
                    role="option"
                    aria-selected="false"
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-2xl flex items-center justify-center"
                      style={{
                        background: applyOpacity(theme.primary, 0.08),
                        color: theme.primary,
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="leading-5">Add Family Member</span>
                  </button>

                  <div style={{ height: 1, background: applyOpacity(theme.primary, 0.08) }} />

                  {familyMembers.length > 0 ? (
                    familyMembers.map((member, index) => {
                      const familyId = normalizeId(member?.id);
                      const isSelected = normalizeId(nominationForm.family_member_id) === familyId;
                      const membershipNo = getFamilyMemberMembershipNo(member);
                      const metaText = [
                        membershipNo ? `Membership No: ${membershipNo}` : '',
                        [member?.relation, member?.gender].filter(Boolean).join(' | '),
                      ].filter(Boolean).join(' | ');

                      return (
                        <button
                          key={familyId || member?.name || `member-${index}`}
                          type="button"
                          onClick={() => selectFamilyMember(familyId)}
                          className="w-full px-4 py-3.5 text-left transition-colors"
                          style={{
                            background: isSelected ? applyOpacity(theme.primary, 0.08) : 'transparent',
                          }}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold" style={{ color: theme.primary }}>
                                {member?.name || 'Unnamed Member'}
                              </p>
                              <p
                                className="mt-0.5 truncate text-xs font-medium"
                                style={{ color: 'color-mix(in srgb, var(--body-text-color) 68%, var(--surface-color))' }}
                              >
                                {metaText || 'Family Member'}
                              </p>
                            </div>
                            {isSelected ? <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.primary }} /> : null}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div
                      className="px-4 py-4 text-sm font-medium"
                      style={{ color: 'color-mix(in srgb, var(--body-text-color) 68%, var(--surface-color))' }}
                    >
                      No family members available.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {selectedNominee ? (
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'var(--advertisement-card-bg)',
                border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
                borderTop: `3px solid linear-gradient(90deg, ${theme.primary || 'var(--brand-red)'}, ${theme.secondary || 'var(--brand-navy)'})`
              }}
            >
               
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-base truncate" style={{ color: `${theme.primary}` }}>
                    {selectedNominee?.name || 'Unnamed Member'}
                  </p>
                  <p className="text-sm mt-0.5" style={{ color: 'color-mix(in srgb, var(--surface-color) 60%, var(--surface-color))' }}>
                    {[selectedNominee?.relation, selectedNominee?.gender].filter(Boolean).join(' | ') || 'Family Member'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'color-mix(in srgb, var(--surface-color) 58%, var(--surface-color))' }}>
                    {[selectedNominee?.age ? `Age ${selectedNominee.age}` : '', selectedNominee?.blood_group ? `Blood ${selectedNominee.blood_group}` : ''].filter(Boolean).join(' | ')}
                  </p>
                  <p className="text-xs mt-1 break-words" style={{ color: 'color-mix(in srgb, var(--surface-color) 58%, var(--surface-color))' }}>
                    {[selectedNominee?.contact_no || '', selectedNominee?.email || '', selectedNominee?.address || ''].filter(Boolean).join(' | ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(savingKey)}
                onClick={submitNominationForm}
                className="mt-3 w-full h-10 rounded-xl text-sm font-bold active:scale-95 transition-all disabled:opacity-60"
                style={{ color: 'var(--surface-color)', background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)', border: `1px solid ${applyOpacity(theme.primary, 0.1)}` }}
              >
                Save Nominee
              </button>
            </div>
          ) : null}
        </div>

        {message.text ? (
          <div
            className="rounded-xl px-3 py-2 text-sm font-medium"
            style={{
              // background: message.type === 'error'
              //   ? 'color-mix(in srgb, var(--brand-red) 14%, var(--surface-color))'
              //   : 'color-mix(in srgb, var(--brand-navy) 16%, var(--surface-color))',
              background: message.type === 'error'
                 ? 'color-mix(in srgb, var(--brand-red) 14%, var(--surface-color))':
                  `color-mix(in srgb, ${theme.primary} 70%, var(--surface-color))`,
              color: message.type === 'error' ? 'var(--brand-red-dark)' : 'var(--surface-color)',
            }}
          >
            {message.text}
          </div>
        ) : null}

        {replaceDialog.open ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(15, 23, 42, 0.45)' }}
              onClick={() => setReplaceDialog({ open: false, familyMemberId: '', currentNomineeName: '', nextNomineeName: '' })}
            />
            <div
              className="relative w-full max-w-sm rounded-2xl p-5 shadow-2xl"
              style={{ background: 'var(--surface-color)', border: `1px solid ${applyOpacity(theme.primary, 0.12)}` }}
            >
              <p className="text-sm font-bold uppercase tracking-[0.18em]" style={{ color: theme.primary }}>
                Nominee Limit
              </p>
              <h3 className="mt-2 text-lg font-extrabold" style={{ color: 'var(--heading-color)' }}>
                You can create only one nominee
              </h3>
              <p className="mt-2 text-sm" style={{ color: 'var(--body-text-color)' }}>
                Replace <strong>{replaceDialog.currentNomineeName}</strong> with <strong>{replaceDialog.nextNomineeName}</strong>?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReplaceDialog({ open: false, familyMemberId: '', currentNomineeName: '', nextNomineeName: '' })}
                  className="h-10 rounded-xl text-sm font-bold"
                  style={{ background: 'color-mix(in srgb, var(--body-text-color) 8%, var(--surface-color))', color: 'var(--body-text-color)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmReplaceNominee}
                  className="h-10 rounded-xl text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)', color: 'var(--surface-color)' }}
                >
                  Replace
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {removeDialog.open ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
            <div
              className="absolute inset-0 backdrop-blur-[2px]"
              style={{ background: 'color-mix(in srgb, var(--brand-navy-dark) 78%, transparent)' }}
              onClick={closeRemoveDialog}
            />
            <div
              className="relative w-full max-w-sm overflow-hidden rounded-[28px] border shadow-2xl"
              style={{
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface-color) 96%, var(--app-accent-bg)) 0%, var(--surface-color) 100%)',
                borderColor: applyOpacity(theme.primary, 0.14),
                boxShadow: `0 24px 60px ${applyOpacity(theme.secondary, 0.2)}`,
              }}
            >
              <div style={{ height: 6, background: 'linear-gradient(90deg, var(--brand-red) 0%, var(--brand-navy) 100%)' }} />
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center"
                    style={{
                      background: 'color-mix(in srgb, var(--brand-red) 14%, var(--surface-color))',
                      color: theme.primary,
                    }}
                  >
                    <X className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: theme.primary }}>
                      Remove Nominee
                    </p>
                    <h3 className="mt-1 text-lg font-extrabold" style={{ color: 'var(--heading-color)' }}>
                      Are you sure?
                    </h3>
                  </div>
                </div>

                <p
                  className="mt-4 text-sm leading-6"
                  style={{ color: 'var(--body-text-color)' }}
                >
                  Remove <strong>{removeDialog.familyMemberName}</strong> from the nominee list? You can add them again later.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2">
                   <button
                    type="button"
                    onClick={confirmRemoveNominee}
                    disabled={Boolean(savingKey)}
                    className="h-10 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-60"
                    style={{
                      background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)',
                      color: 'var(--surface-color)',
                    }}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={closeRemoveDialog}
                    className="h-10 rounded-xl text-sm font-bold transition-all active:scale-95"
                    style={{
                      background: 'color-mix(in srgb, var(--body-text-color) 8%, var(--surface-color))',
                      color: 'var(--body-text-color)',
                    }}
                  >
                    Cancel
                  </button>
                 
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center">
            <div
              className="w-10 h-10 mx-auto rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: theme.primary, borderTopColor: 'transparent' }}
            />
            <p className="mt-3 text-sm font-semibold">Loading nominations...</p>
          </div>
        ) : nominations.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{
              background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-page-bg))',
              border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
            }}
          >
            <FileText className="h-8 w-8 mx-auto mb-2" style={{ color: theme.primary }} />
            <p className="font-semibold">No nominees selected.</p>
          </div>
        ) : (
          <div
          className="rounded-2xl p-4 space-y-3"
          style={{
            background: 'color-mix(in srgb, var(--surface-color) 90%, var(--app-page-bg))',
            border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
          }}
        >
          <p className="text-sm font-extrabold tracking-wide" style={{ color: `${theme.primary}` }}>
            Your Nominee
          </p>
          <div className="space-y-3">
            {familyMembers.filter((member) => nominatedFamilyIds.has(normalizeId(member?.id))).map((member) => {
              const familyId = normalizeId(member?.id);

              return (
                <div
                  key={familyId}
                  className="relative rounded-2xl p-4 pr-12"
                  style={{
                    background: 'var(--advertisement-card-bg)',
                    border: `1px solid ${applyOpacity(theme.primary, 0.1)}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openRemoveDialog(familyId, member?.name || 'this nominee')}
                    disabled={Boolean(savingKey)}
                    className="absolute top-3 right-3 w-7 h-7 rounded-full inline-flex items-center justify-center disabled:opacity-60"
                    style={{
                      // color: 'var(--brand-red-dark)',
                      // background: 'color-mix(in srgb, var(--brand-red) 12%, var(--surface-color))',

                      color: 'var(--surface-color)', opacity: 0.75, background: 'linear-gradient(135deg, var(--brand-red) 0%, var(--brand-red-dark) 45%, var(--brand-navy) 100%)', border: `1px solid ${theme.primary}`

                    }}
                    aria-label="Remove nominee"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0">
                    <p className="font-semibold text-base truncate" style={{ color: `${theme.primary? theme.primary : 'var(--brand-color-navy)'}` }}>
                      {member?.name || 'Unnamed Member'}
                    </p>
                    <p className="text-sm mt-0.5" style={{ color: 'color-mix(in srgb, var(--surface-color) 60%, var(--surface-color))' }}>
                      {[member?.relation, member?.gender].filter(Boolean).join(' | ') || 'Family Member'}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'color-mix(in srgb, var(--surface-color) 58%, var(--surface-color))' }}>
                      {[member?.age ? `Age ${member.age}` : '', member?.blood_group ? `Blood ${member.blood_group}` : ''].filter(Boolean).join(' | ')}
                    </p>
                    <p className="text-xs mt-1 break-words" style={{ color: 'color-mix(in srgb, var(--surface-color) 58%, var(--surface-color))' }}>
                      {[member?.contact_no || '', member?.email || '', member?.address || ''].filter(Boolean).join(' | ')}
                    </p>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
                    style={{ color: `var(--surface-color)`, background: applyOpacity(theme.primary, 0.52) }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Nominee
                  </div>

                </div>
              );
            })}
          </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default NominationDetails;
