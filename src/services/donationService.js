import { supabase } from './supabaseClient.js';
import { resolveSelectedTrustMembership } from '../utils/storageUtils';
import { checkVipNoticeEligibility } from './communityService';

const normalizeText = (value) => String(value || '').trim();

export const getDonationFormPrefill = () => {
  let parsedUser = {};
  try {
    parsedUser = JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    parsedUser = {};
  }

  const selectedTrustId = localStorage.getItem('selected_trust_id') || '';
  const selectedTrustName = localStorage.getItem('selected_trust_name') || '';
  const membership = resolveSelectedTrustMembership(parsedUser, selectedTrustId);

  return {
    trustId: selectedTrustId || membership?.trust_id || parsedUser?.trust?.id || '',
    trustName: selectedTrustName || membership?.trust_name || parsedUser?.trust?.name || import.meta.env.VITE_DEFAULT_TRUST_NAME || 'Trust',
    donorName: normalizeText(parsedUser?.Name || parsedUser?.name),
    mobile: normalizeText(parsedUser?.Mobile || parsedUser?.mobile || parsedUser?.phone),
    email: normalizeText(parsedUser?.Email || parsedUser?.email),
    membershipNumber: normalizeText(
      membership?.membership_number ||
      parsedUser?.['Membership number'] ||
      parsedUser?.membership_number
    ),
    regMemberId: normalizeText(parsedUser?.reg_member_id),
    tier: normalizeText(parsedUser?.vip_status) ? 'vip' : 'general',
    vipStatus: normalizeText(parsedUser?.vip_status),
  };
};

export const fetchDonationsByTrust = async (trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return [];

  let vipEligible = false;
  try {
    const eligibility = await checkVipNoticeEligibility({ trustId: normalizedTrustId });
    vipEligible = Boolean(eligibility?.vipEligible);
  } catch {
    vipEligible = false;
  }

  const { data, error } = await supabase
    .from('Donations')
    .select('id, trust_id, name, description, attachments, amount, amount_type, status, type, created_at, updated_at')
    .eq('trust_id', normalizedTrustId)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[Donation] Failed to fetch donations:', error);
    throw error;
  }

  return (data || []).filter((row) => {
    const status = normalizeText(row?.status).toLowerCase();
    if (status && status !== 'active') return false;

    const normalizedType = normalizeText(row?.type).toLowerCase();
    const isVipType = normalizedType === 'vip';
    if (isVipType && !vipEligible) return false;

    return true;
  });
};

export const fetchDonationMembersByTrust = async (trustId) => {
  const normalizedTrustId = normalizeText(trustId);
  if (!normalizedTrustId) return [];

  const { data, error } = await supabase
    .from('donation_members')
    .select('id, trust_id, name, mobile, email_id, qr, created_at')
    .eq('trust_id', normalizedTrustId)
    .order('created_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[Donation] Failed to fetch donation members:', error);
    throw error;
  }

  return data || [];
};
