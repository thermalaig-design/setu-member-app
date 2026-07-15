import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

const ALLOWED_GENDERS = new Set(['Male', 'Female', 'Other']);
const ALLOWED_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

const cleanText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const parseAge = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
    throw new Error('Age must be an integer between 0 and 120');
  }
  return parsed;
};

const resolveMemberIdFromRequest = async (req) => {
  const userIdHeader = String(req.headers['user-id'] || '').trim();
  const membersIdHeader = String(req.headers['members-id'] || '').trim();

  let parsedUser = null;
  try {
    parsedUser = JSON.parse(String(req.headers.user || '{}'));
  } catch {
    parsedUser = null;
  }

  const directCandidates = [
    membersIdHeader,
    userIdHeader,
    parsedUser?.members_id,
    parsedUser?.member_id,
    parsedUser?.id
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  for (const candidate of directCandidates) {
    if (!isUuid(candidate)) continue;
    const { data } = await supabase
      .from('Members')
      .select('members_id')
      .eq('members_id', candidate)
      .maybeSingle();
    if (data?.members_id) return data.members_id;
  }

  const digits = normalizeDigits(userIdHeader || parsedUser?.mobile || parsedUser?.Mobile || '');
  if (digits.length >= 10) {
    const tenDigit = digits.slice(-10);
    const variants = Array.from(new Set([digits, tenDigit, `+91${tenDigit}`, `91${tenDigit}`]));
    for (const variant of variants) {
      const { data } = await supabase
        .from('Members')
        .select('members_id')
        .or(`Mobile.eq.${variant},contact.eq.${variant}`)
        .limit(1);
      if (data?.[0]?.members_id) return data[0].members_id;
    }
  }

  return null;
};

const sanitizeFamilyMemberPayload = (body = {}, { requireNameRelation = false } = {}) => {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) payload.name = cleanText(body.name);
  if (Object.prototype.hasOwnProperty.call(body, 'relation')) payload.relation = cleanText(body.relation);
  if (Object.prototype.hasOwnProperty.call(body, 'gender')) payload.gender = cleanText(body.gender);
  if (Object.prototype.hasOwnProperty.call(body, 'age')) payload.age = parseAge(body.age);
  if (Object.prototype.hasOwnProperty.call(body, 'blood_group')) payload.blood_group = cleanText(body.blood_group);
  if (Object.prototype.hasOwnProperty.call(body, 'contact_no')) payload.contact_no = cleanText(body.contact_no);
  if (Object.prototype.hasOwnProperty.call(body, 'email')) payload.email = cleanText(body.email);
  if (Object.prototype.hasOwnProperty.call(body, 'address')) payload.address = cleanText(body.address);

  if (requireNameRelation) {
    if (!payload.name) throw new Error('Name is required');
    if (!payload.relation) throw new Error('Relation is required');
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) {
    throw new Error('Name is required');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'relation') && !payload.relation) {
    throw new Error('Relation is required');
  }

  if (payload.gender && !ALLOWED_GENDERS.has(payload.gender)) {
    throw new Error('Gender must be Male, Female or Other');
  }

  if (payload.blood_group && !ALLOWED_BLOOD_GROUPS.has(payload.blood_group)) {
    throw new Error('Invalid blood group');
  }

  payload.updated_at = new Date().toISOString();
  return payload;
};

router.get('/', async (req, res) => {
  try {
    const membersId = await resolveMemberIdFromRequest(req);
    if (!membersId) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const { data, error } = await supabase
      .from('family_members')
      .select('*')
      .eq('members_id', membersId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[FamilyMembers] Fetch error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch family members' });
    }

    return res.json({ success: true, members: data || [] });
  } catch (error) {
    console.error('[FamilyMembers] Unexpected fetch error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const membersId = await resolveMemberIdFromRequest(req);
    if (!membersId) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    let payload;
    try {
      payload = sanitizeFamilyMemberPayload(req.body || {}, { requireNameRelation: true });
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    const insertPayload = {
      ...payload,
      members_id: membersId
    };

    const { data, error } = await supabase
      .from('family_members')
      .insert(insertPayload)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[FamilyMembers] Create error:', error);
      return res.status(500).json({ success: false, message: 'Failed to create family member' });
    }

    return res.status(201).json({ success: true, member: data });
  } catch (error) {
    console.error('[FamilyMembers] Unexpected create error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const familyMemberId = String(req.params.id || '').trim();
    if (!isUuid(familyMemberId)) {
      return res.status(400).json({ success: false, message: 'Invalid family member id' });
    }

    const membersId = await resolveMemberIdFromRequest(req);
    if (!membersId) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const { data: existing } = await supabase
      .from('family_members')
      .select('id')
      .eq('id', familyMemberId)
      .eq('members_id', membersId)
      .maybeSingle();

    if (!existing?.id) {
      return res.status(404).json({ success: false, message: 'Family member not found' });
    }

    let payload;
    try {
      payload = sanitizeFamilyMemberPayload(req.body || {}, { requireNameRelation: false });
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    const payloadKeys = Object.keys(payload).filter((key) => key !== 'updated_at');
    if (payloadKeys.length === 0) {
      return res.status(400).json({ success: false, message: 'No updatable fields provided' });
    }

    const { data, error } = await supabase
      .from('family_members')
      .update(payload)
      .eq('id', familyMemberId)
      .eq('members_id', membersId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[FamilyMembers] Update error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update family member' });
    }

    return res.json({ success: true, member: data });
  } catch (error) {
    console.error('[FamilyMembers] Unexpected update error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const familyMemberId = String(req.params.id || '').trim();
    if (!isUuid(familyMemberId)) {
      return res.status(400).json({ success: false, message: 'Invalid family member id' });
    }

    const membersId = await resolveMemberIdFromRequest(req);
    if (!membersId) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const { data: existing } = await supabase
      .from('family_members')
      .select('id')
      .eq('id', familyMemberId)
      .eq('members_id', membersId)
      .maybeSingle();

    if (!existing?.id) {
      return res.status(404).json({ success: false, message: 'Family member not found' });
    }

    const { error } = await supabase
      .from('family_members')
      .delete()
      .eq('id', familyMemberId)
      .eq('members_id', membersId);

    if (error) {
      console.error('[FamilyMembers] Delete error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete family member' });
    }

    return res.json({ success: true, id: familyMemberId });
  } catch (error) {
    console.error('[FamilyMembers] Unexpected delete error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
