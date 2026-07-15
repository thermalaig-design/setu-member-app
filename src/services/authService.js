// authService.js - Frontend auth helpers

const USE_MOCK_AUTH = import.meta.env.VITE_AUTH_MOCK === 'true';
const BASE_TRUST_ID = import.meta.env.VITE_DEFAULT_TRUST_ID || '';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL || (API_BASE_URL ? `${String(API_BASE_URL).replace(/\/$/, '')}/auth` : '');

const postAuthJson = async (endpoint, payload) => {
  if (!AUTH_API_URL) {
    throw new Error('Missing VITE_AUTH_API_URL');
  }

  const base = AUTH_API_URL.endsWith('/') ? AUTH_API_URL.slice(0, -1) : AUTH_API_URL;
  const url = `${base}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || 'Auth API request failed');
  }
  return data;
};

const _triggerOtpSend = async (phoneNumber) => {
  const cleanedPhone = normalizeTo10Digits(phoneNumber);
  try {
    await postAuthJson('/check-phone', { phoneNumber: cleanedPhone });
    return { success: true };
  } catch (error) {
    // Keep legacy login condition unchanged: do not block auth pre-check flow
    // when OTP provider/backend lookup fails.
    console.warn('[Auth] OTP send skipped:', error?.message || error);
    return { success: false, message: error?.message || 'OTP send failed' };
  }
};

const buildMockUser = (phoneNumber) => ({
  id: phoneNumber,
  members_id: phoneNumber,
  member_ids: [phoneNumber],
  mobile: phoneNumber,
  name: 'Test User',
  type: 'Trustee',
  isRegisteredMember: false,
  vip_status: null,
  reg_member_id: null,
  hospital_memberships: []
});

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

// Always return last 10 digits â€” strips country code prefix (91, 0, +91, etc.)
const normalizeTo10Digits = (value) => {
  const digits = normalizePhone(value);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
};

const normalizeMemberName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lowered = raw.toLowerCase();
  const blockedNames = new Set([
    'aaaaa',
    'gau grass',
    'guest user',
    'test',
    'test user',
    'null',
    'undefined',
    'n/a',
    'na'
  ]);
  const compact = raw.replace(/\s+/g, '');
  const repeatedSingleChar = /^([a-zA-Z])\1{2,}$/.test(compact);
  if (blockedNames.has(lowered) || repeatedSingleChar) return '';
  return raw;
};

const pickPrimaryMembership = (memberships = [], preferredTrustId = '') => {
  const list = Array.isArray(memberships) ? memberships : [];
  if (list.length === 0) return null;
  const preferred = String(preferredTrustId || '').trim();
  if (preferred) {
    const preferredActive = list.find((m) => String(m?.trust_id || '') === preferred && m?.is_active !== false);
    if (preferredActive) return preferredActive;
    const preferredAny = list.find((m) => String(m?.trust_id || '') === preferred);
    if (preferredAny) return preferredAny;
  }
  return (
    list.find((m) => m.is_active && m.trust_id) ||
    list.find((m) => m.trust_id) ||
    list[0] ||
    null
  );
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const _scoreMemberCandidate = (member, membershipStats = null) => {
  let score = 0;
  if (membershipStats?.activeInPreferredTrust) score += 120;
  if (membershipStats?.anyInPreferredTrust) score += 90;
  if (membershipStats?.hasActiveMembership) score += 70;
  if (membershipStats?.hasAnyMembership) score += 50;
  if (hasValue(member?.['Name'])) score += 15;
  if (hasValue(member?.['Email'])) score += 8;
  if (hasValue(member?.contact)) score += 4;
  const serial = Number(member?.['S.No.'] || 0);
  if (Number.isFinite(serial)) score += Math.min(serial / 100000, 1);
  return score;
};

const buildTrustPayload = (membership = null) => {
  if (!membership?.trust_id) return null;
  return {
    id: membership.trust_id,
    name: membership.trust_name,
    icon_url: membership.trust_icon_url,
    remark: membership.trust_remark
  };
};

const _buildMemberAccount = ({
  member,
  cleanedPhone,
  allMemberships = [],
  preferredTrustId = '',
  isRegisteredMember = false,
  reg_member_id = null,
  vip_status = null
}) => {
  const memberId = member?.members_id ? String(member.members_id) : '';
  const linkedMemberships = memberId
    ? allMemberships.filter((m) => String(m?.members_id || '') === memberId)
    : [];
  const primaryTrust = pickPrimaryMembership(linkedMemberships, preferredTrustId);
  const trust = buildTrustPayload(primaryTrust);
  const primaryMembership = primaryTrust || linkedMemberships[0] || null;
  const sanitizedName = normalizeMemberName(member?.['Name']);
  const membershipNumber = primaryMembership?.membership_number || '';

  const account = {
    id: member?.members_id || member?.['S.No.'] || member?.['Mobile'] || cleanedPhone,
    members_id: member?.members_id || member?.['S.No.'] || null,
    // Keep this account scoped to its own member id so trust hydration on Home
    // only pulls links for the selected member (multi-trust per selected person).
    member_ids: memberId ? [memberId] : [],
    'S. No.': member?.['S.No.'] || null,
    Name: sanitizedName,
    name: sanitizedName,
    Mobile: member?.['Mobile'] || cleanedPhone,
    mobile: member?.['Mobile'] || cleanedPhone,
    Email: member?.['Email'] || '',
    email: member?.['Email'] || '',
    'Membership number': membershipNumber,
    membership_number: membershipNumber,
    membershipNumber,
    type: primaryMembership?.role || 'Trustee',
    trust,
    hospital_memberships: linkedMemberships,
    isRegisteredMember: Boolean(isRegisteredMember),
    vip_status: vip_status || null,
    reg_member_id: reg_member_id || null
  };

  if (trust) {
    account.primary_trust = {
      id: trust.id,
      name: trust.name,
      icon_url: trust.icon_url,
      remark: trust.remark || null,
      is_active: primaryTrust?.is_active !== false
    };
  } else {
    account.primary_trust = null;
  }

  return account;
};

/**
 * Check phone number and send OTP
 * Membership source: reg_members
 */
export const checkPhoneNumber = async (phoneNumber) => {
  try {
    if (USE_MOCK_AUTH) {
      const mockUser = buildMockUser(phoneNumber);
      return {
        success: true,
        message: 'Mocked: phone verified',
        data: {
          user: mockUser,
          accounts: [mockUser]
        }
      };
    }

    const cleanedPhone = normalizePhone(phoneNumber);
    if (!cleanedPhone || cleanedPhone.length < 10) {
      return { success: false, message: 'Please enter a valid 10-digit mobile number.' };
    }

    // Use the backend auth route so the browser never talks to Members directly.
    const response = await postAuthJson('/check-phone', { phoneNumber: cleanedPhone });
    const resolvedUser = response?.data?.user || response?.data?.accounts?.[0] || null;
    const resolvedAccounts = Array.isArray(response?.data?.accounts) && response.data.accounts.length > 0
      ? response.data.accounts
      : (resolvedUser ? [resolvedUser] : []);

    if (!resolvedUser) {
      return {
        success: false,
        message: response?.message || 'Unable to verify number. Please try again.'
      };
    }

    return {
      success: true,
      message: response?.message || 'Mobile verified',
      data: {
        user: resolvedUser,
        accounts: resolvedAccounts
      }
    };

    /*
    // Always work with last 10 digits â€” avoids format mismatch (91xxxxxxxxxx vs xxxxxxxxxx)
    const last10 = normalizeTo10Digits(cleanedPhone);

    // 1) Find member by mobile in "Members" table â€” check all common storage formats
    //    to avoid false "not found" that causes duplicate inserts on every login
    const mobileOrFilter = [
      `Mobile.eq.${last10}`,
      `Mobile.eq.91${last10}`,
      `Mobile.eq.+91${last10}`,
      `Mobile.eq.0${last10}`
    ].join(',');

    const { data: members, error: memberError } = await supabase
      .from('Members')
      .select('"S.No.", "Name", "Mobile", "Email", members_id')
      .or(mobileOrFilter)
      .order('"S.No."', { ascending: false });

    if (memberError) {
      console.error('Supabase member lookup error:', memberError);
      return { success: false, message: 'Unable to verify number. Please try again.' };
    }

    if (!members || members.length === 0) {
      // Member nahi mila â€” pehle double-check karo (race condition guard)
      // Phir naya row insert karo â€” always last 10 digits store karo
      const { data: newMember, error: insertError } = await supabase
        .from('Members')
        .insert({ Mobile: last10 })
        .select('"S.No.", "Name", "Mobile", "Email", members_id')
        .single();

      if (insertError) {
        // Agar unique constraint violation hai to existing record fetch karo
        if (insertError.code === '23505') {
          console.warn('[Auth] Duplicate mobile on insert â€” fetching existing record');
          const { data: existingMembers, error: refetchError } = await supabase
            .from('Members')
            .select('"S.No.", "Name", "Mobile", "Email", members_id')
            .or(mobileOrFilter)
            .order('"S.No."', { ascending: false });

          if (!refetchError && existingMembers && existingMembers.length > 0) {
            // Existing record mila â€” aage normal flow continue karo
            // (fall through to membership lookup below)
            console.log('[Auth] Found existing member after conflict, continuing...');
            // Reassign members to existingMembers and continue
            return checkPhoneNumber(phoneNumber); // retry once
          }
        }
        console.error('Supabase member insert error:', insertError);
        return { success: false, message: 'Unable to register number. Please try again.' };
      }

      const fallbackUser = {
        id: newMember?.members_id || newMember?.['S.No.'] || last10,
        members_id: newMember?.members_id || newMember?.['S.No.'] || last10,
        member_ids: [newMember?.members_id || newMember?.['S.No.'] || last10],
        name: normalizeMemberName(newMember?.['Name']),
        mobile: newMember?.['Mobile'] || last10,
        email: newMember?.['Email'] || '',
        type: 'Guest',
        membershipNumber: '',
        trust: null,
        primary_trust: null,
        hospital_memberships: [],
        isRegisteredMember: false,
        vip_status: null,
        reg_member_id: null
      };

      const otpSendResult = await triggerOtpSend(last10);
      if (!otpSendResult.success) {
        return {
          success: false,
          message: otpSendResult.message || 'OTP send failed. Please try again.'
        };
      }

      return {
        success: true,
        message: 'Mobile verified',
        data: {
          user: fallbackUser,
          accounts: [fallbackUser]
        }
      };
    }

    const membersIds = members.map((m) => m.members_id).filter(Boolean).map(String);

    // 2) Membership lookup from reg_members
    let hospitalMemberships = [];
    let regMemberships = [];
    let vipRows = [];

    if (membersIds.length > 0) {
      const regResult = await supabase
        .from('reg_members')
        .select('id, trust_id, "Membership number", role, is_active, members_id, joined_date')
        .in('members_id', membersIds);

      if (regResult.error) {
        console.error('Supabase membership lookup error:', regResult.error);
        return { success: false, message: 'Unable to verify membership. Please try again.' };
      }

      regMemberships = (Array.isArray(regResult.data) ? regResult.data : []).filter(
        (m) => m?.trust_id && membersIds.includes(String(m.members_id))
      );

      const trustIds = Array.from(new Set(regMemberships.map((m) => m.trust_id).filter(Boolean)));

      let trustsById = {};
      if (trustIds.length > 0) {
        const { data: trustRows, error: trustError } = await supabase
          .from('Trust')
          .select('id, name, icon_url, remark')
          .in('id', trustIds);

        if (!trustError && Array.isArray(trustRows)) {
          trustsById = trustRows.reduce((acc, row) => {
            acc[row.id] = row;
            return acc;
          }, {});
        }
      }

      hospitalMemberships = regMemberships.map((m) => {
        const t = trustsById[m.trust_id] || null;
        return {
          id: m.id || null,
          trust_id: m.trust_id || null,
          trust_name: t?.name || null,
          trust_icon_url: t?.icon_url || null,
          trust_remark: t?.remark || null,
          is_active: m.is_active,
          membership_number: m['Membership number'] || null,
          role: m.role || null,
          members_id: m.members_id || null,
          source: 'reg_members'
        };
      });

      hospitalMemberships.sort((a, b) => {
        const activeScore = Number(Boolean(b?.is_active)) - Number(Boolean(a?.is_active));
        if (activeScore !== 0) return activeScore;
        return String(a?.trust_name || '').localeCompare(String(b?.trust_name || ''));
      });

      const regIds = regMemberships.map((m) => m.id).filter(Boolean);
      if (regIds.length > 0) {
        const { data: vipData, error: vipError } = await supabase
          .from('vip_entry')
          .select('id, trust_id, reg_id, type, is_active')
          .in('reg_id', regIds)
          .eq('is_active', true)
          .limit(50);

        if (!vipError && Array.isArray(vipData)) {
          vipRows = vipData;
        }
      }
    }

    const preferredTrustId = String(BASE_TRUST_ID || '').trim();
    const governanceRoles = [
      'trustee', 'patron',
      'founder', 'president', 'maha mantri', 'chairman', 'vice-chairman',
      'secretary', 'treasurer', 'chief patron', 'patron-in-chief',
      'advisor', 'board member', 'governing body member'
    ];
    const isGovernanceRole = (role) => {
      if (!role) return false;
      const normalized = String(role).trim().toLowerCase();
      return governanceRoles.includes(normalized);
    };

    const membershipStatsByMemberId = (Array.isArray(membersIds) ? membersIds : []).reduce((acc, memberId) => {
      const linkedMemberships = hospitalMemberships.filter((hm) => String(hm?.members_id || '') === String(memberId));
      const hasAnyMembership = linkedMemberships.length > 0;
      const hasActiveMembership = linkedMemberships.some((hm) => hm?.is_active);
      const anyInPreferredTrust = preferredTrustId
        ? linkedMemberships.some((hm) => String(hm?.trust_id || '') === preferredTrustId)
        : false;
      const activeInPreferredTrust = preferredTrustId
        ? linkedMemberships.some((hm) => String(hm?.trust_id || '') === preferredTrustId && hm?.is_active)
        : false;
      acc[String(memberId)] = {
        hasAnyMembership,
        hasActiveMembership,
        anyInPreferredTrust,
        activeInPreferredTrust
      };
      return acc;
    }, {});

    const vipStatusByRegId = new Map();
    vipRows.forEach((row) => {
      if (!row?.reg_id) return;
      const regId = String(row.reg_id);
      const current = vipStatusByRegId.get(regId);
      const next = String(row.type || '').toUpperCase() === 'VVIP' ? 'VVIP' : (row.type || null);
      if (!current || String(next || '').toUpperCase() === 'VVIP') {
        vipStatusByRegId.set(regId, next);
      }
    });

    const accounts = [...members]
      .map((memberRow) => {
        const memberId = memberRow?.members_id ? String(memberRow.members_id) : '';
        const memberMemberships = memberId
          ? regMemberships.filter((m) => String(m?.members_id || '') === memberId)
          : [];
        const governanceMembership = memberMemberships.find((m) => isGovernanceRole(m?.role));
        const vipStatuses = memberMemberships
          .map((membership) => vipStatusByRegId.get(String(membership?.id || '')))
          .filter(Boolean);
        const vvip = vipStatuses.find((type) => String(type || '').toUpperCase() === 'VVIP');
        const vipStatus = vvip || vipStatuses[0] || null;

        return buildMemberAccount({
          member: memberRow,
          cleanedPhone,
          allMemberships: hospitalMemberships,
          preferredTrustId,
          isRegisteredMember: Boolean(governanceMembership),
          reg_member_id: governanceMembership?.id || null,
          vip_status: vipStatus
        });
      })
      .sort((a, b) => {
        const aStats = membershipStatsByMemberId[String(a?.members_id)] || null;
        const bStats = membershipStatsByMemberId[String(b?.members_id)] || null;
        return scoreMemberCandidate(b, bStats) - scoreMemberCandidate(a, aStats);
      });

    const user = accounts[0] || null;
    if (!user) {
      return { success: false, message: 'Unable to resolve account details. Please try again.' };
    }

    console.log(
      `User check complete: accounts=${accounts.length}, trusts=${hospitalMemberships.length}, selectedMember=${user?.members_id || user?.id}`
    );

    const otpSendResult = await triggerOtpSend(last10);
    if (!otpSendResult.success) {
      return {
        success: false,
        message: otpSendResult.message || 'OTP send failed. Please try again.'
      };
    }

    return {
      success: true,
      message: 'Mobile verified',
      data: {
        user,
        accounts
      }
    };
  */
  } catch (error) {
    console.error('Error checking phone:', error);
    throw error;
  }
};

/**
 * Verify OTP
 */
export const verifyOTP = async (phoneNumber, otp, options = {}) => {
  try {
    const payload = {
      phoneNumber: normalizeTo10Digits(phoneNumber),
      otp: String(otp || '').trim(),
      secretCode: String(options?.secretCode || '').trim(),
      trustId: String(options?.trustId || '').trim()
    };

    const response = await postAuthJson('/verify-otp', payload);
    const serverLoginMethod = String(response?.loginMethod || '').trim().toLowerCase();
    const usedSecretCode = Boolean(response?.usedSecretCode)
      || /secret\s*code/i.test(String(response?.message || ''));
    const loginMethod = (serverLoginMethod === 'secret_code' || usedSecretCode) ? 'secret_code' : 'otp';
    return {
      success: true,
      message: response?.message || 'OTP verified',
      loginMethod,
      usedSecretCode
    };
  } catch (error) {
    console.error('Error verifying OTP:', error?.message || error);
    return { success: false, message: error?.message || 'Invalid OTP or secret code' };
  }
};

/**
 * Special login with passcode + trust validation
 */
export const specialLogin = async (phoneNumber, passcode, trustId = '') => {
  try {
    const response = await postAuthJson('/special-login', { phoneNumber, passcode, trustId: String(trustId || '').trim() });
    return { success: true, message: response?.message || 'Passcode verified' };
  } catch (error) {
    console.error('Error in special login:', error?.message || error);
    return { success: false, message: error?.message || 'Invalid passcode' };
  }
};
