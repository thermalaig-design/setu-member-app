import axios from 'axios';
import { supabase } from './supabaseClient.js';

// Force local backend for current development flow.
const resolveDevApiBaseUrl = () => {
  return 'http://localhost:5005/api';
};

const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? resolveDevApiBaseUrl()
    : 'https://test-mahila-mandal.vercel.app/api');

const API_BASE_URL = String(RAW_API_BASE_URL || '').replace(/\/auth\/?$/i, '');

const normalizeTrustId = (value) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  return ['null', 'undefined', 'nan'].includes(lowered) ? '' : normalized;
};


// Create axios instance
export const api = axios.create({
  baseURL: API_BASE_URL,
});

// Get all members
export const getAllMembers = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/members${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching all members:', error);
    throw error;
  }
};

// Get members by page
export const getMembersPage = async (page = 1, limit = 100, trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    params.append('page', page);
    params.append('limit', limit);
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/members?${params}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching members page:', error);
    throw error;
  }
};

// Get doctors
export const getDoctors = async () => {
  try {
    const response = await api.get('/doctors');
    return response.data;
  } catch (error) {
    console.error('Error fetching doctors:', error);
    throw error;
  }
};

// Get members by type
export const getMembersByType = async (type, trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/members/type/${type}${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching members of type ${type}:`, error);
    throw error;
  }
};

// Search members
export const searchMembers = async (query, type = null, trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (query) params.append('query', query);
    if (type) params.append('type', type);
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);

    const response = await api.get(`/members/search?${params}`);
    return response.data;
  } catch (error) {
    console.error('Error searching members:', error);
    throw error;
  }
};

// Get member types
export const getMemberTypes = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/members/types${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching member types:', error);
    throw error;
  }
};

// Get all doctors (from reg_members where role includes doctor)
export const getAllDoctors = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/doctors${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching doctors:', error);
    throw error;
  }
};

// Get all committee members
export const getAllCommitteeMembers = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/committee${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching committee members:', error);
    throw error;
  }
};

// Get all hospitals
export const getAllHospitals = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/hospitals${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching hospitals:', error);
    throw error;
  }
};

// Get all elected members
export const getAllElectedMembers = async (trustId = null, trustName = null) => {
  try {
    const params = new URLSearchParams();
    if (trustId) params.append('trust_id', trustId);
    if (trustName) params.append('trust_name', trustName);
    const response = await api.get(`/elected-members${params.toString() ? `?${params}` : ''}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching elected members:', error);
    throw error;
  }
};

// Referral API functions
export const createReferral = async (referralData) => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    const response = await api.post('/referrals', referralData, {
      headers: {
        'user-id': userId,
        'user': user
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error creating referral:', error);
    throw error;
  }
};

export const getUserReferrals = async () => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    const response = await api.get('/referrals/my-referrals', {
      headers: {
        'user-id': userId
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching referrals:', error);
    throw error;
  }
};

export const getReferralCounts = async () => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    const response = await api.get('/referrals/counts', {
      headers: {
        'user-id': userId
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching referral counts:', error);
    throw error;
  }
};

export const updateReferral = async (referralId, referralData) => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    const response = await api.patch(`/referrals/${referralId}`, referralData, {
      headers: {
        'user-id': userId,
        'user': user
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error updating referral:', error);
    throw error;
  }
};

export const deleteReferral = async (referralId) => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    const response = await api.delete(`/referrals/${referralId}`, {
      headers: {
        'user-id': userId
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting referral:', error);
    throw error;
  }
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const sanitizeMemberUpdateValue = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const PROFILE_IMAGE_BUCKET = 'profile-images';

const getPublicStorageUrl = (bucket, storagePath) => {
  if (!storagePath) return '';
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const baseUrl = data?.publicUrl || '';
  // Add cache-busting timestamp for profile images
  if (bucket === PROFILE_IMAGE_BUCKET) {
    return `${baseUrl}?t=${Date.now()}`;
  }
  return baseUrl;
};

const normalizeMemberProfilePayload = (member = {}, profile = {}, parsedUser = {}) => {
  const resolvedName = member?.Name || member?.name || parsedUser?.name || parsedUser?.Name || '';
  const memberId =
    member?.['Membership number'] ||
    member?.membership_number ||
    parsedUser?.membershipNumber ||
    parsedUser?.['Membership number'] ||
    parsedUser?.membership_number ||
    '';

  return {
    name: resolvedName,
    name_locked: Boolean(String(member?.Name || member?.name || '').trim()),
    mobile: member?.Mobile || member?.mobile || parsedUser?.mobile || parsedUser?.Mobile || '',
    email: member?.Email || member?.email || parsedUser?.email || parsedUser?.Email || '',
    memberId,
    membership_number: memberId,
    members_id: member?.members_id || profile?.members_id || parsedUser?.members_id || parsedUser?.member_id || parsedUser?.id || null,
    privacy: member?.Privacy === true || member?.privacy === true,
    address_home: member?.['Address Home'] || '',
    address_office: member?.['Address Office'] || '',
    company_name: member?.['Company Name'] || '',
    resident_landline: member?.['Resident Landline'] || '',
    office_landline: member?.['Office Landline'] || '',
    profile_photo_url: profile?.profile_photo_url || '',
    gender: profile?.gender || '',
    dob: profile?.date_of_birth || '',
    blood_group: profile?.blood_group || '',
    marital_status: profile?.marital_status || '',
    nationality: profile?.nationality || 'Indian',
    aadhaar_id: profile?.aadhaar_id || '',
    emergency_contact_name: profile?.emergency_contact_name || '',
    emergency_contact_number: profile?.emergency_contact_number || '',
    spouse_name: profile?.spouse_name || '',
    spouse_contact_number: profile?.spouse_contact || '',
    children_count: profile?.no_of_children ?? '',
    facebook: profile?.facebook || '',
    twitter: profile?.twitter || '',
    instagram: profile?.instagram || '',
    linkedin: profile?.linkedin || '',
    whatsapp: profile?.whatsapp || ''
  };
};

const uploadProfilePhotoToSupabase = async (membersId, profilePhotoFile) => {
  if (!membersId || !profilePhotoFile) return '';

  const extension = String(profilePhotoFile.name || 'jpg').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = extension.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const storagePath = `${membersId}/profile-${Date.now()}.${safeExt}`;

  const { error: uploadError } = await supabase.storage
    .from(PROFILE_IMAGE_BUCKET)
    .upload(storagePath, profilePhotoFile, {
      cacheControl: '60',
      upsert: true,
      contentType: profilePhotoFile.type || 'image/jpeg'
    });

  if (uploadError) throw uploadError;
  return getPublicStorageUrl(PROFILE_IMAGE_BUCKET, storagePath);
};

const resolveMembersIdForProfile = async (parsedUser, profileData = {}, trustId = null) => {
  const directIds = [
    parsedUser?.members_id,
    parsedUser?.member_id,
    parsedUser?.id,
    profileData?.members_id,
    profileData?.id
  ].filter(Boolean);

  for (const id of directIds) {
    if (isUuid(id)) return String(id);
  }

  const { supabase } = await import('./supabaseClient.js');
  const mobileRaw = profileData?.mobile || parsedUser?.Mobile || parsedUser?.mobile || parsedUser?.phone || '';
  const mobileDigits = String(mobileRaw).replace(/\D/g, '');
  const mobileVariants = Array.from(new Set([mobileRaw, mobileDigits, mobileDigits.slice(-10), `+91${mobileDigits.slice(-10)}`].filter(Boolean)));

  for (const mobile of mobileVariants) {
    const { data } = await supabase
      .from('Members')
      .select('members_id')
      .eq('Mobile', mobile)
      .limit(1);
    if (data?.[0]?.members_id) return data[0].members_id;
  }

  const membershipNo = profileData?.memberId || parsedUser?.membershipNumber || parsedUser?.['Membership number'] || parsedUser?.membership_number || '';
  if (membershipNo) {
    const { data: memberByMNo } = await supabase
      .from('Members')
      .select('members_id')
      .eq('Membership number', membershipNo)
      .limit(1);
    if (memberByMNo?.[0]?.members_id) return memberByMNo[0].members_id;

    let regQuery = supabase
      .from('reg_members')
      .select('members_id')
      .eq('Membership number', membershipNo)
      .limit(1);
    if (trustId) regQuery = regQuery.eq('trust_id', trustId);
    const { data: regMember } = await regQuery;
    if (regMember?.[0]?.members_id) return regMember[0].members_id;
  }

  return null;
};

const fetchProfileDirectFromSupabase = async (parsedUser, trustId = null) => {
  const membersId = await resolveMembersIdForProfile(parsedUser, {}, trustId);
  if (!membersId) {
    return {
      success: true,
      profile: normalizeMemberProfilePayload({}, {}, parsedUser)
    };
  }

  const { data: member, error: memberError } = await supabase
    .from('Members')
    .select('*')
    .eq('members_id', membersId)
    .maybeSingle();
  if (memberError) throw memberError;

  const { data: profile, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('members_id', membersId)
    .maybeSingle();
  if (error) throw error;

  return {
    success: true,
    profile: normalizeMemberProfilePayload({ ...member, members_id: membersId }, profile, parsedUser)
  };
};

const saveProfileDirectToSupabase = async (profileData, parsedUser, trustId = null, profilePhotoFile = null) => {
  const membersId = await resolveMembersIdForProfile(parsedUser, profileData, trustId);
  if (!membersId) {
    throw new Error('Member not found');
  }

  const { data: existingMember, error: existingMemberError } = await supabase
    .from('Members')
    .select('members_id, "Name"')
    .eq('members_id', membersId)
    .maybeSingle();
  if (existingMemberError) throw existingMemberError;

  const existingName = sanitizeMemberUpdateValue(existingMember?.Name);
  const incomingName = sanitizeMemberUpdateValue(profileData.name);
  const fallbackName = sanitizeMemberUpdateValue(parsedUser?.Name || parsedUser?.name);
  const resolvedNameForMember = incomingName || existingName || fallbackName;

  const memberPatch = {
    Name: resolvedNameForMember,
    Email: sanitizeMemberUpdateValue(profileData.email),
    'Address Home': sanitizeMemberUpdateValue(profileData.address_home),
    'Address Office': sanitizeMemberUpdateValue(profileData.address_office),
    'Company Name': sanitizeMemberUpdateValue(profileData.company_name),
    'Resident Landline': sanitizeMemberUpdateValue(profileData.resident_landline),
    'Office Landline': sanitizeMemberUpdateValue(profileData.office_landline),
  };

  const memberUpdatePayload = Object.fromEntries(
    Object.entries(memberPatch).filter(([, value]) => value !== null)
  );

  if (Object.keys(memberUpdatePayload).length > 0) {
    const { error: memberUpdateError } = await supabase
      .from('Members')
      .update(memberUpdatePayload)
      .eq('members_id', membersId);
    if (memberUpdateError) throw memberUpdateError;
  }

  const uploadedPhotoUrl = await uploadProfilePhotoToSupabase(membersId, profilePhotoFile);

  const upsertPayload = {
    members_id: membersId,
    profile_photo_url: uploadedPhotoUrl || profileData.profile_photo_url || null,
    gender: profileData.gender || null,
    date_of_birth: profileData.dob || null,
    blood_group: profileData.blood_group || null,
    marital_status: profileData.marital_status || null,
    nationality: profileData.nationality || 'Indian',
    aadhaar_id: profileData.aadhaar_id || null,
    emergency_contact_name: profileData.emergency_contact_name || null,
    emergency_contact_number: profileData.emergency_contact_number || null,
    spouse_name: profileData.spouse_name || null,
    spouse_contact: profileData.spouse_contact_number || null,
    no_of_children: profileData.children_count !== '' && profileData.children_count !== null
      ? Number(profileData.children_count) : 0,
    facebook: profileData.facebook || null,
    twitter: profileData.twitter || null,
    instagram: profileData.instagram || null,
    linkedin: profileData.linkedin || null,
    whatsapp: profileData.whatsapp || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('member_profiles')
    .upsert(upsertPayload, { onConflict: 'members_id' });
  if (error) throw error;

  return {
    success: true,
    profile: normalizeMemberProfilePayload(
      {
        members_id: membersId,
        Name: memberUpdatePayload.Name ?? profileData.name,
        Mobile: parsedUser?.Mobile || parsedUser?.mobile || profileData.mobile,
        Email: memberUpdatePayload.Email ?? profileData.email,
        'Membership number': profileData.memberId || parsedUser?.['Membership number'] || parsedUser?.membership_number || '',
        'Address Home': memberUpdatePayload['Address Home'] ?? profileData.address_home,
        'Address Office': memberUpdatePayload['Address Office'] ?? profileData.address_office,
        'Company Name': memberUpdatePayload['Company Name'] ?? profileData.company_name,
        'Resident Landline': memberUpdatePayload['Resident Landline'] ?? profileData.resident_landline,
        'Office Landline': memberUpdatePayload['Office Landline'] ?? profileData.office_landline,
      },
      upsertPayload,
      parsedUser
    )
  };
};

const resolveAuthHeaders = (fallbackMembersId = null) => {
  const user = localStorage.getItem('user');
  const parsedUser = user ? JSON.parse(user) : null;
  const userId = parsedUser ? parsedUser.Mobile || parsedUser.mobile || parsedUser.id : null;
  const membersId = parsedUser?.members_id || parsedUser?.member_id || parsedUser?.id || fallbackMembersId || null;
  const trustId = localStorage.getItem('selected_trust_id') || null;

  if (!userId) {
    throw new Error('No user found in localStorage');
  }

  return {
    'user-id': userId,
    ...(membersId ? { 'members-id': membersId } : {}),
    ...(trustId ? { 'trust-id': trustId } : {})
  };
};

// Preload commonly used data
// Get user profile
export const getProfile = async () => {
  const user = localStorage.getItem('user');
  const parsedUser = user ? JSON.parse(user) : null;
  if (!parsedUser) {
    throw new Error('No user found in localStorage');
  }
  try {
    return await fetchProfileDirectFromSupabase(parsedUser, localStorage.getItem('selected_trust_id') || null);
  } catch (supabaseError) {
    console.error('Error fetching profile directly from Supabase:', supabaseError);
    try {
      const headers = resolveAuthHeaders();
      const response = await api.get('/profile', { headers });
      return response.data;
    } catch (error) {
      console.error('Error fetching profile from backend fallback:', error);
      throw error;
    }
  }
};

// Save user profile
export const saveProfile = async (profileData, profilePhotoFile) => {
  const user = localStorage.getItem('user');
  const parsedUser = user ? JSON.parse(user) : null;
  if (!parsedUser) {
    throw new Error('No user found in localStorage');
  }
  try {
    return await saveProfileDirectToSupabase(profileData, parsedUser, localStorage.getItem('selected_trust_id') || null, profilePhotoFile);
  } catch (supabaseError) {
    console.error('Error saving profile directly to Supabase:', supabaseError);
    try {
      const headers = resolveAuthHeaders(profileData?.members_id || null);
      const formData = new FormData();
      formData.append('profileData', JSON.stringify(profileData));
      if (profilePhotoFile) {
        formData.append('profilePhoto', profilePhotoFile);
      }
      const response = await api.post('/profile/save', formData, { headers });
      return response.data;
    } catch (error) {
      console.error('Error saving profile via backend fallback:', error);
      const serverMessage = error?.response?.data?.message || error?.response?.data?.error || error?.message || '';
      if (serverMessage) throw new Error(serverMessage);
      throw error;
    }
  }
};

// Toggle whether the logged-in member's contact/address details are visible in Directory/Executive Body
export const updateMemberPrivacy = async (nextValue) => {
  const user = localStorage.getItem('user');
  const parsedUser = user ? JSON.parse(user) : null;
  if (!parsedUser) {
    throw new Error('No user found in localStorage');
  }

  const membersId = await resolveMembersIdForProfile(parsedUser, {}, localStorage.getItem('selected_trust_id') || null);
  if (!membersId) {
    throw new Error('Member not found');
  }

  const privacy = Boolean(nextValue);
  const { error } = await supabase
    .from('Members')
    .update({ Privacy: privacy })
    .eq('members_id', membersId);
  if (error) throw error;

  return { success: true, privacy };
};
// Get marquee updates Ã¢â‚¬â€ direct Supabase (no backend needed)
const USE_BACKEND_FAMILY_API = String(import.meta.env.VITE_USE_BACKEND_FAMILY_API || 'false').toLowerCase() === 'true';

const shouldFallbackFamilyApi = (error) => {
  const status = error?.response?.status;
  const serverMessage = String(error?.response?.data?.message || error?.response?.data?.error || error?.message || '').toLowerCase();
  return status === 404 || serverMessage.includes('route not found') || serverMessage.includes('not found');
};

const resolveCurrentMembersId = async () => {
  const user = localStorage.getItem('user');
  const parsedUser = user ? JSON.parse(user) : null;
  if (!parsedUser) return null;
  const directMemberId = parsedUser?.members_id || parsedUser?.member_id || parsedUser?.id || null;
  if (directMemberId && isUuid(directMemberId)) return String(directMemberId);
  const trustId = localStorage.getItem('selected_trust_id') || null;
  return resolveMembersIdForProfile(parsedUser, {}, trustId);
};

const getFamilyMembersDirectFromSupabase = async () => {
  const membersId = await resolveCurrentMembersId();
  if (!membersId) return { success: true, members: [] };

  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('members_id', membersId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return { success: true, members: data || [] };
};

const createFamilyMemberDirectFromSupabase = async (memberPayload = {}) => {
  const membersId = await resolveCurrentMembersId();
  if (!membersId) throw new Error('Member not found');

  const insertPayload = {
    ...memberPayload,
    members_id: membersId,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('family_members')
    .insert(insertPayload)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return { success: true, member: data };
};

const updateFamilyMemberDirectFromSupabase = async (familyMemberId, memberPayload = {}) => {
  const membersId = await resolveCurrentMembersId();
  if (!membersId) throw new Error('Member not found');

  const { data, error } = await supabase
    .from('family_members')
    .update({ ...memberPayload, updated_at: new Date().toISOString() })
    .eq('id', familyMemberId)
    .eq('members_id', membersId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Family member not found');
  return { success: true, member: data };
};

const deleteFamilyMemberDirectFromSupabase = async (familyMemberId) => {
  const membersId = await resolveCurrentMembersId();
  if (!membersId) throw new Error('Member not found');

  const { error } = await supabase
    .from('family_members')
    .delete()
    .eq('id', familyMemberId)
    .eq('members_id', membersId);
  if (error) throw error;
  return { success: true, id: familyMemberId };
};

export const getFamilyMembers = async () => {
  if (!USE_BACKEND_FAMILY_API) {
    return getFamilyMembersDirectFromSupabase();
  }

  try {
    const response = await api.get('/family-members', {
      headers: resolveAuthHeaders()
    });
    return response.data;
  } catch (error) {
    if (shouldFallbackFamilyApi(error)) {
      try {
        return await getFamilyMembersDirectFromSupabase();
      } catch (fallbackError) {
        console.error('Family members fallback fetch failed:', fallbackError);
        const fallbackMessage = fallbackError?.message || 'Failed to fetch family members';
        throw new Error(fallbackMessage);
      }
    }
    console.error('Error fetching family members:', error);
    const serverMessage = error?.response?.data?.message || error?.message || 'Failed to fetch family members';
    throw new Error(serverMessage);
  }
};

export const createFamilyMember = async (memberPayload = {}) => {
  if (!USE_BACKEND_FAMILY_API) {
    return createFamilyMemberDirectFromSupabase(memberPayload);
  }

  try {
    const response = await api.post('/family-members', memberPayload, {
      headers: resolveAuthHeaders(memberPayload?.members_id || null)
    });
    return response.data;
  } catch (error) {
    if (shouldFallbackFamilyApi(error)) {
      try {
        return await createFamilyMemberDirectFromSupabase(memberPayload);
      } catch (fallbackError) {
        console.error('Family members fallback create failed:', fallbackError);
        const fallbackMessage = fallbackError?.message || 'Failed to create family member';
        throw new Error(fallbackMessage);
      }
    }
    console.error('Error creating family member:', error);
    const serverMessage = error?.response?.data?.message || error?.message || 'Failed to create family member';
    throw new Error(serverMessage);
  }
};

export const updateFamilyMember = async (familyMemberId, memberPayload = {}) => {
  if (!USE_BACKEND_FAMILY_API) {
    return updateFamilyMemberDirectFromSupabase(familyMemberId, memberPayload);
  }

  try {
    const response = await api.put(`/family-members/${familyMemberId}`, memberPayload, {
      headers: resolveAuthHeaders(memberPayload?.members_id || null)
    });
    return response.data;
  } catch (error) {
    if (shouldFallbackFamilyApi(error)) {
      try {
        return await updateFamilyMemberDirectFromSupabase(familyMemberId, memberPayload);
      } catch (fallbackError) {
        console.error('Family members fallback update failed:', fallbackError);
        const fallbackMessage = fallbackError?.message || 'Failed to update family member';
        throw new Error(fallbackMessage);
      }
    }
    console.error('Error updating family member:', error);
    const serverMessage = error?.response?.data?.message || error?.message || 'Failed to update family member';
    throw new Error(serverMessage);
  }
};

export const deleteFamilyMember = async (familyMemberId, membersId = null) => {
  if (!USE_BACKEND_FAMILY_API) {
    return deleteFamilyMemberDirectFromSupabase(familyMemberId);
  }

  try {
    const response = await api.delete(`/family-members/${familyMemberId}`, {
      headers: resolveAuthHeaders(membersId)
    });
    return response.data;
  } catch (error) {
    if (shouldFallbackFamilyApi(error)) {
      try {
        return await deleteFamilyMemberDirectFromSupabase(familyMemberId);
      } catch (fallbackError) {
        console.error('Family members fallback delete failed:', fallbackError);
        const fallbackMessage = fallbackError?.message || 'Failed to delete family member';
        throw new Error(fallbackMessage);
      }
    }
    console.error('Error deleting family member:', error);
    const serverMessage = error?.response?.data?.message || error?.message || 'Failed to delete family member';
    throw new Error(serverMessage);
  }
};

export const getMarqueeUpdates = async (trustId = null, trustName = null) => {
  try {
    // Resolve trustId from trustName if needed
    let resolvedTrustId = trustId || null;
    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      if (trustData?.[0]?.id) resolvedTrustId = trustData[0].id;
    }

    let query = supabase
      .from('marquee_updates')
      .select('id, trust_id, message, is_active, priority')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });

    if (resolvedTrustId) {
      query = query.eq('trust_id', resolvedTrustId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      success: true,
      data: (data || []).map(item => ({ message: item.message, ...item })),
    };
  } catch (error) {
    console.error('Error fetching marquee updates:', error);
    return { success: false, data: [] };
  }
};

const getTodayLocalYmd = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toYmdOnly = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ymdMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymdMatch) return ymdMatch[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isFlashDateValidForToday = (row, todayYmd) => {
  const startYmd = toYmdOnly(row?.start_date);
  const endYmd = toYmdOnly(row?.end_date);
  const startOk = !startYmd || startYmd <= todayYmd;
  const endOk = !endYmd || endYmd >= todayYmd;
  return startOk && endOk;
};

const isRowActive = (row) => {
  if (row?.status !== undefined && row?.status !== null) {
    return String(row.status).trim().toLowerCase() === 'active';
  }

  const value = row?.is_active;
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  return !['false', '0', 'no', 'inactive'].includes(normalized);
};

// Get sponsor information
// view: "carousel" | "list"
// Uses sponsor_flash as source of truth for trust + date-valid sponsor rotation.
export const getSponsors = async (
  trustId = null,
  trustName = null,
  { page = 1, limit = null, offset = null } = {}
) => {
  const shouldDebug = Boolean(import.meta.env.DEV) || String(import.meta.env.VITE_SPONSOR_DEBUG || '').toLowerCase() === 'true';
  const shouldLogEmptyAsError = String(import.meta.env.VITE_SPONSOR_LOG_EMPTY || 'true').toLowerCase() !== 'false';
  const diagnostics = {
    trustId: trustId === null || trustId === undefined ? null : String(trustId).trim(),
    trustName: trustName || null,
    today: getTodayLocalYmd(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    counts: {
      trustRows: 0,
      beforeDateFilterRows: 0,
      afterDateFilterRows: 0,
      joinedRows: 0,
      finalRows: 0
    },
    range: { page: Number(page) || 1, limit: Number(limit) || 3, offset: Number(offset) || 0 },
    sponsorFlashTrustIds: [],
    sponsorFlashSponsorIds: [],
    joinedSponsorIds: [],
    reason: ''
  };

  try {
    let resolvedTrustId = trustId || null;
    if (!resolvedTrustId && trustName) {
      const { data: trustData, error: trustError } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      if (!trustError && Array.isArray(trustData) && trustData[0]?.id) {
        resolvedTrustId = trustData[0].id;
      }
    }

    diagnostics.trustId = resolvedTrustId === null || resolvedTrustId === undefined ? null : String(resolvedTrustId).trim();

    if (!resolvedTrustId) {
      diagnostics.reason = 'No trust_id resolved from app context.';
      if (shouldLogEmptyAsError) {
        console.error('[SponsorFlash][Empty]', diagnostics.reason, diagnostics);
      }
      if (shouldDebug) {
        console.log('[SponsorFlash][Debug] reason=no-trust-id', diagnostics);
      }
      return { success: true, data: [], hasMore: false, debug: diagnostics };
    }

    const pageSize = Number(limit) > 0 ? Number(limit) : 3;
    const pageNo = Number(page) > 0 ? Number(page) : 1;
    const rangeFrom = Number.isFinite(Number(offset)) ? Number(offset) : (pageNo - 1) * pageSize;
    const rangeTo = rangeFrom + pageSize - 1;
    diagnostics.range = { page: pageNo, limit: pageSize, offset: rangeFrom };

    const sponsorSelectForView = '*';

    // Step A: Fetch ALL rows for this trust (used as fallback pool).
    const { data: trustRows, error: trustRowsError } = await supabase
      .from('sponsor_flash')
      .select('*')
      .eq('trust_id', resolvedTrustId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (trustRowsError) throw trustRowsError;
    const trustOnlyRows = Array.isArray(trustRows) ? trustRows : [];
    diagnostics.counts.trustRows = trustOnlyRows.length;
    diagnostics.sponsorFlashTrustIds = [...new Set(trustOnlyRows.map((r) => r?.trust_id).filter(Boolean).map(String))];

    // Step B: Date filter only.
    diagnostics.counts.beforeDateFilterRows = trustOnlyRows.length;

    // Step C: strict filter (active + date-valid).
    const dateFilteredRows = trustOnlyRows.filter((row) => isRowActive(row) && isFlashDateValidForToday(row, diagnostics.today));
    diagnostics.counts.afterDateFilterRows = dateFilteredRows.length;

    const candidateRows = dateFilteredRows;

    const pagedRows = candidateRows.slice(rangeFrom, rangeTo + 1);
    const sponsorIdsForPage = [...new Set(pagedRows.map((row) => row?.sponsor_id).filter(Boolean).map(String))];
    diagnostics.sponsorFlashSponsorIds = sponsorIdsForPage;


    // Step D: join sponsor_flash rows with sponsors table by sponsor_id.
    let sponsorsById = {};
    if (sponsorIdsForPage.length > 0) {
      const { data: sponsorRows, error: sponsorRowsError } = await supabase
        .from('sponsors')
        .select(sponsorSelectForView)
        .in('id', sponsorIdsForPage);
      if (sponsorRowsError) throw sponsorRowsError;
      const rows = Array.isArray(sponsorRows) ? sponsorRows : [];
      diagnostics.counts.joinedRows = rows.length;
      diagnostics.joinedSponsorIds = rows.map((row) => row?.id).filter(Boolean).map((id) => String(id));
      sponsorsById = rows.reduce((acc, sponsor) => {
        const key = sponsor?.id === null || sponsor?.id === undefined ? '' : String(sponsor.id);
        if (key) acc[key] = sponsor;
        return acc;
      }, {});
    }

    const mapped = pagedRows
      .filter((row) => {
        const key = row?.sponsor_id === null || row?.sponsor_id === undefined ? '' : String(row.sponsor_id);
        return Boolean(key && sponsorsById[key]);
      })
      .map((row) => {
        const sponsor = sponsorsById[String(row.sponsor_id)];
        return {
          id: sponsor.id,
          name: sponsor.name || null,
          photo_url: sponsor.photo_url || null,
          company_name: sponsor.company_name || null,
          position: sponsor.position || null,
          about: sponsor.about || null,
          ref_no: sponsor.ref_no || null,
          ContactNumber1: sponsor.ContactNumber1 || null,
          email_id1: sponsor.email_id1 || null,
          address: sponsor.address || null,
          city: sponsor.city || null,
          state: sponsor.state || null,
          whatsapp_number: sponsor.whatsapp_number || null,
          website_url: sponsor.website_url || null,
          catalog_url: sponsor.catalog_url || null,
          coPartner: sponsor.coPartner || null,
          contactNumber2: sponsor.contactNumber2 || null,
          contactNumber3: sponsor.contactNumber3 || null,
          emailId2: sponsor.emailId2 || null,
          emailId3: sponsor.emailId3 || null,
          facebook: sponsor.facebook || null,
          instagram: sponsor.instagram || null,
          X: sponsor.X || null,
          linkedin: sponsor.linkedin || null,
          address2: sponsor.address2 || null,
          address3: sponsor.address3 || null,
          position2: sponsor.position2 || null,
          flash_id: row.id,
          sponsor_id: row.sponsor_id,
          trust_id: row.trust_id,
          duration_seconds: row.duration_seconds,
          start_date: row.start_date,
          end_date: row.end_date,
          flash_created_at: row.created_at
        };
      });

    diagnostics.counts.finalRows = mapped.length;

    if (!trustOnlyRows.length) {
      diagnostics.reason = 'No sponsor_flash rows found for this trust_id.';
    } else if (!dateFilteredRows.length) {
      diagnostics.reason = 'All sponsor_flash rows were excluded by date filter.';
    } else if (sponsorIdsForPage.length > 0 && !diagnostics.counts.joinedRows) {
      diagnostics.reason = 'Join with sponsors returned zero rows for sponsor_ids in sponsor_flash.';
    } else if (!mapped.length) {
      diagnostics.reason = 'Joined rows exist but final mapped sponsor batch is empty.';
    } else {
      diagnostics.reason = '';
    }

    if (diagnostics.reason && shouldLogEmptyAsError) {
      console.error('[SponsorFlash][Empty]', diagnostics.reason, diagnostics);
    }

    if (shouldDebug) {
      // Trust mismatch probe (only needed when trust_id yields no sponsor_flash rows).
      if (!trustOnlyRows.length) {
        const { data: trustIdProbeRows, error: trustIdProbeError } = await supabase
          .from('sponsor_flash')
          .select('trust_id')
          .limit(200);
        if (!trustIdProbeError && Array.isArray(trustIdProbeRows)) {
          diagnostics.sponsorFlashTrustIds = [...new Set(trustIdProbeRows.map((row) => row?.trust_id).filter(Boolean).map((id) => String(id)))];
        }
      }

      console.log('[SponsorFlash][Debug] current_trust_id=', diagnostics.trustId);
      console.log('[SponsorFlash][Debug] trust_ids_in_db=', diagnostics.sponsorFlashTrustIds);
      console.log('[SponsorFlash][Debug] total_for_trust=', diagnostics.counts.trustRows);
      console.log('[SponsorFlash][Debug] rows_before_date_filter=', diagnostics.counts.beforeDateFilterRows);
      console.log('[SponsorFlash][Debug] rows_after_date_filter=', diagnostics.counts.afterDateFilterRows);
      console.log('[SponsorFlash][Debug] sponsor_flash_sponsor_ids=', diagnostics.sponsorFlashSponsorIds);
      console.log('[SponsorFlash][Debug] joined_sponsor_ids=', diagnostics.joinedSponsorIds);
      console.log('[SponsorFlash][Debug] final_batch_count=', diagnostics.counts.finalRows);
      if (diagnostics.reason) {
        console.log('[SponsorFlash][Debug] empty_reason=', diagnostics.reason);
      }
    }

    return {
      success: true,
      data: mapped,
      hasMore: candidateRows.length > rangeTo + 1,
      debug: diagnostics
    };
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (
      message.includes('permission') ||
      message.includes('row level security') ||
      message.includes('rls') ||
      String(error?.code || '') === '42501'
    ) {
      diagnostics.reason = 'RLS/permissions blocked sponsor_flash or sponsors read access.';
    }
    if (shouldLogEmptyAsError) {
      console.error('[SponsorFlash][Error]', diagnostics.reason || 'Query failed', diagnostics);
    }
    if (shouldDebug) {
      console.error('Error fetching sponsors from sponsor_flash:', error);
      console.log('[SponsorFlash][Debug] failure_state=', diagnostics);
    } else {
      console.error('Error fetching sponsors from sponsor_flash:', error);
    }
    throw error;
  }
};

/**
 * getAllSponsorsForTrust — fetches ALL valid sponsors in exactly 2 DB calls.
 * Much faster than paginated getSponsors for the list page.
 *
 * Call 1: sponsor_flash (all rows for trust, no pagination)
 * Call 2: sponsors JOIN (all valid IDs in one .in() call)
 */
export const getAllSponsorsForTrust = async (trustId) => {
  if (!trustId) return { success: true, data: [], total: 0 };

  try {
    const today = getTodayLocalYmd();

    // ── Call 1: ALL sponsor_flash rows for trust ──
    const { data: flashRows, error: flashErr } = await supabase
      .from('sponsor_flash')
      .select('*')
      .eq('trust_id', trustId)
      .order('created_at', { ascending: true });

    if (flashErr) throw flashErr;
    const allFlash = Array.isArray(flashRows) ? flashRows : [];

    // Filter: strict active + date-valid only
    const validFlash = allFlash.filter((r) => isRowActive(r) && isFlashDateValidForToday(r, today));

    if (validFlash.length === 0) {
      return { success: true, data: [], total: 0 };
    }

    // Deduplicate sponsor_ids preserving flash order
    const seen = new Set();
    const orderedSponsorIds = [];
    for (const row of validFlash) {
      const sid = String(row?.sponsor_id || '').trim();
      if (sid && !seen.has(sid)) { seen.add(sid); orderedSponsorIds.push(sid); }
    }

    // ── Call 2: ALL sponsors in one query ──
    const { data: sponsorRows, error: sponsorErr } = await supabase
      .from('sponsors')
      .select('*')
      .in('id', orderedSponsorIds);

    if (sponsorErr) throw sponsorErr;

    const byId = {};
    (Array.isArray(sponsorRows) ? sponsorRows : []).forEach((s) => {
      if (s?.id) byId[String(s.id)] = s;
    });

    // Build flash metadata map for duration etc.
    const flashById = {};
    validFlash.forEach((r) => { if (r?.sponsor_id) flashById[String(r.sponsor_id)] = r; });

    // Return in flash priority order
    const data = orderedSponsorIds
      .map((sid) => {
        const sponsor = byId[sid];
        const flash = flashById[sid];
        if (!sponsor) return null;
        return {
          ...sponsor,
          flash_id: flash?.id || null,
          sponsor_id: sid,
          trust_id: flash?.trust_id || trustId,
          duration_seconds: flash?.duration_seconds || 5,
          start_date: flash?.start_date || null,
          end_date: flash?.end_date || null,
        };
      })
      .filter(Boolean);

    console.log(`[getAllSponsorsForTrust] trust=${trustId} total=${data.length} (flash=${allFlash.length} valid=${validFlash.length})`);
    return { success: true, data, total: data.length };
  } catch (err) {
    console.error('[getAllSponsorsForTrust] Error:', err);
    return { success: true, data: [], total: 0 };
  }
};

// Get specific sponsor by ID
export const getSponsorById = async (id, trustId = null) => {
  try {
    const params = {};
    const normalizedTrustId = normalizeTrustId(trustId);
    if (normalizedTrustId) params.trust_id = normalizedTrustId;
    const response = await api.get(`/sponsors/${id}`, { params });
    const payload = response?.data || {};
    const sponsor = payload?.data || null;
    return { success: true, data: sponsor ? [sponsor] : [] };
  } catch (error) {
    console.error('Error fetching sponsor:', error);
    throw error;
  }
};

// Get user reports
export const getUserReports = async () => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    if (!userId) {
      throw new Error('No user found in localStorage');
    }

    const response = await api.get('/reports', {
      headers: {
        'user-id': userId
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching reports:', error);
    throw error;
  }
};

// Get user notifications from the new notification schema only
export const getUserNotifications = async (trustIdOverride = null) => {
  try {
    const headers = resolveAuthHeaders();
    const normalizedTrustIdOverride = normalizeTrustId(trustIdOverride);
    const requestHeaders = normalizedTrustIdOverride
      ? { ...headers, 'trust-id': normalizedTrustIdOverride }
      : headers;

    const response = await api.get('/notifications', {
      headers: requestHeaders,
    });

    return { success: true, data: response?.data?.data || [] };
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return { success: false, message: error.message, data: [] };
  }
};

// Mark notification as read through the backend using the new schema
export const markNotificationAsRead = async (id) => {
  try {
    await api.patch(`/notifications/${id}/read`, {}, {
      headers: resolveAuthHeaders(),
    });
    return { success: true };
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

// Mark all notifications as read through the backend using the new schema
export const markAllNotificationsAsRead = async () => {
  try {
    await api.patch('/notifications/read-all', {}, {
      headers: resolveAuthHeaders(),
    });
    return { success: true };
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

// Get member trust links Ã¢â‚¬â€ direct Supabase query (no backend needed)
export const getMemberTrustLinks = async (memberId) => {
  try {
    if (!memberId) {
      throw new Error('memberId is required');
    }
    const { supabase } = await import('./supabaseClient.js');
    const { data: links, error } = await supabase
      .from('reg_members')
      .select(`
        id,
        members_id,
        trust_id,
        "Membership number",
        role,
        joined_date,
        is_active,
        Trust:trust_id (
          id,
          name,
          icon_url
        )
      `)
      .eq('members_id', memberId)
      .order('joined_date', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('Error fetching member trusts from reg_members:', error);
      throw error;
    }

    const mapped = (links || []).map((row) => ({
      id: row.id,
      member_id: row.members_id || null,
      trust_id: row.trust_id || null,
      membership_no: row['Membership number'] || null,
      location: null,
      remark1: null,
      remark2: null,
      role: row.role || null,
      joined_date: row.joined_date || null,
      is_active: row.is_active,
      created_at: row.joined_date || null,
      Trust: row.Trust || null
    }));

    return { success: true, data: mapped, count: mapped.length };
  } catch (error) {
    console.error(`Error fetching trusts for member ${memberId}:`, error);
    return { success: false, data: [], message: error.message };
  }
};

// Delete/dismiss a specific notification through the backend using the new schema
export const deleteNotification = async (id) => {
  try {
    await api.delete(`/notifications/${id}`, {
      headers: resolveAuthHeaders(),
    });
    return { success: true };
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
};

// Upload user report
export const uploadUserReport = async (reportData, reportFile) => {
  try {
    const user = localStorage.getItem('user');
    const userId = user ? JSON.parse(user).Mobile || JSON.parse(user).mobile || JSON.parse(user).id : null;

    if (!userId) {
      throw new Error('No user found in localStorage');
    }

    // Prepare form data
    const formData = new FormData();
    formData.append('reportName', reportData.reportName);
    formData.append('reportType', reportData.reportType);
    formData.append('testDate', reportData.testDate);
    if (reportFile) {
      formData.append('reportFile', reportFile);
    }

    const response = await api.post('/reports/upload', formData, {
      headers: {
        'user-id': userId
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading report:', error);
    throw error;
  }
};


// Get profile photos for multiple members
export const getProfilePhotos = async (memberIds) => {
  try {
    const response = await api.post('/profile/photos', { memberIds });
    return response.data;
  } catch (error) {
    console.error('Error fetching profile photos:', error);
    throw error;
  }
};

export const preloadCommonData = async () => {
  try {
    const trustId = localStorage.getItem('selected_trust_id') || null;
    const trustName = localStorage.getItem('selected_trust_name') || null;
    // Load small amounts of data in parallel for quick initial load
    const [membersPreview, memberTypes, hospitals] = await Promise.allSettled([
      getMembersPage(1, 50, trustId, trustName),  // Get a small preview
      getMemberTypes(trustId, trustName),
      getAllHospitals(trustId, trustName)       // Hospitals are typically small dataset
    ]);

    const result = {
      membersPreview: membersPreview.status === 'fulfilled' ? membersPreview.value : null,
      memberTypes: memberTypes.status === 'fulfilled' ? memberTypes.value : null,
      hospitals: hospitals.status === 'fulfilled' ? hospitals.value : null
    };

    console.log('Ã¢Å“â€¦ Preloaded common data for faster directory loading');
    return result;
  } catch (error) {
    console.error('Error preloading common data:', error);
    return {};
  }
};




