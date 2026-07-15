import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { supabase } from '../config/supabase.js';

const router = express.Router();
const PROFILE_PHOTO_BUCKET = 'profile_photo';
const MAX_PROFILE_PHOTO_BYTES = 25 * 1024;

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile pictures
  fileFilter: (req, file, cb) => {
    
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);

    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, WEBP allowed.'));
    }
  }
});

const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
const readMemberValue = (member, keys = []) => {
  for (const key of keys) {
    const value = member?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
};

const sanitizeMemberUpdateValue = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const compressProfilePhotoToLimit = async (inputBuffer, inputMimeType = 'image/jpeg') => {
  const originalBuffer = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer || []);
  if (originalBuffer.length <= MAX_PROFILE_PHOTO_BYTES) {
    return {
      buffer: originalBuffer,
      mimeType: inputMimeType || 'image/jpeg',
      extension: (inputMimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg'
    };
  }

  const baseImage = sharp(originalBuffer, { failOn: 'none' }).rotate();
  const metadata = await baseImage.metadata();
  const originalWidth = Number(metadata?.width) || 1080;
  const baseWidths = [originalWidth, 1280, 1080, 960, 840, 720, 640, 560, 480, 420, 360, 320];
  const widths = [...new Set(baseWidths.filter((w) => Number.isFinite(w) && w > 0 && w <= originalWidth))]
    .sort((a, b) => b - a);
  if (widths.length === 0) widths.push(320);

  const qualities = [85, 75, 65, 55, 45, 35, 25];
  let best = null;

  for (const width of widths) {
    for (const quality of qualities) {
      try {
        const webpBuffer = await sharp(originalBuffer, { failOn: 'none' })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality, effort: 6 })
          .toBuffer();

        if (!best || webpBuffer.length < best.buffer.length) {
          best = { buffer: webpBuffer, mimeType: 'image/webp', extension: 'webp' };
        }
        if (webpBuffer.length <= MAX_PROFILE_PHOTO_BYTES) {
          return { buffer: webpBuffer, mimeType: 'image/webp', extension: 'webp' };
        }

        const jpgBuffer = await sharp(originalBuffer, { failOn: 'none' })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();

        if (!best || jpgBuffer.length < best.buffer.length) {
          best = { buffer: jpgBuffer, mimeType: 'image/jpeg', extension: 'jpg' };
        }
        if (jpgBuffer.length <= MAX_PROFILE_PHOTO_BYTES) {
          return { buffer: jpgBuffer, mimeType: 'image/jpeg', extension: 'jpg' };
        }
      } catch {
        // try next compression setting
      }
    }
  }

  return best;
};

const hasFilledValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

const buildMembershipLookup = (memberships = []) => {
  const byMemberId = {};
  (memberships || []).forEach((membership) => {
    const memberId = String(membership?.members_id || '').trim();
    if (!memberId) return;
    if (!byMemberId[memberId]) byMemberId[memberId] = [];
    byMemberId[memberId].push(membership);
  });
  return byMemberId;
};

const scoreMemberCandidate = (member = {}, membershipsByMemberId = {}, trustIdHeader = '') => {
  const memberId = String(member?.members_id || '').trim();
  const memberships = membershipsByMemberId[memberId] || [];
  let score = 0;

  const normalizedTrustId = String(trustIdHeader || '').trim();
  if (normalizedTrustId) {
    if (memberships.some((m) => String(m?.trust_id || '') === normalizedTrustId && m?.is_active === true)) score += 120;
    if (memberships.some((m) => String(m?.trust_id || '') === normalizedTrustId)) score += 90;
  }
  if (memberships.some((m) => m?.is_active === true)) score += 70;
  if (memberships.length > 0) score += 50;

  if (hasFilledValue(member?.Name)) score += 15;
  if (hasFilledValue(member?.Email)) score += 8;
  if (hasFilledValue(member?.Mobile) || hasFilledValue(member?.contact)) score += 4;

  const serial = Number(member?.['S.No.'] || 0);
  if (Number.isFinite(serial)) score += Math.min(serial / 100000, 1);
  return score;
};

const resolveMemberContext = async ({ userIdHeader, membersIdHeader, trustIdHeader, profileData = null }) => {
  const identifiers = [
    userIdHeader,
    membersIdHeader,
    profileData?.memberId,
    profileData?.mobile
  ].filter(Boolean).map((v) => String(v).trim());

  const memberCandidates = new Map();
  const addCandidate = (candidate) => {
    const id = String(candidate?.members_id || '').trim();
    if (!id) return;
    if (!memberCandidates.has(id)) {
      memberCandidates.set(id, candidate);
    }
  };

  // 1) Direct by members_id header(s)
  for (const candidate of [membersIdHeader, userIdHeader, profileData?.members_id, profileData?.id]) {
    if (!candidate || !isUuid(candidate)) continue;
    const { data } = await supabase
      .from('Members')
      .select('*')
      .eq('members_id', String(candidate).trim())
      .maybeSingle();
    if (data?.members_id) addCandidate(data);
  }

  // 2) Membership number in Members table (optional schema support)
  for (const candidate of identifiers) {
    const { data, error } = await supabase
      .from('Members')
      .select('*')
      .eq('Membership number', candidate)
      .limit(5);
    if (error && /does not exist/i.test(String(error?.message || ''))) {
      break;
    }
    (data || []).forEach(addCandidate);
  }

  // 3) Mobile/contact in Members table (duplicate-safe)
  const digits = Array.from(new Set(identifiers.map(normalizeDigits).filter(Boolean)));
  for (const d of digits) {
    const tenDigit = d.slice(-10);
    const variants = Array.from(new Set([d, tenDigit, `+91${tenDigit}`, `91${tenDigit}`].filter(Boolean)));
    for (const variant of variants) {
      const { data } = await supabase
        .from('Members')
        .select('*')
        .or(`Mobile.eq.${variant},contact.eq.${variant}`)
        .order('S.No.', { ascending: false })
        .limit(20);
      (data || []).forEach(addCandidate);
    }
  }

  // 4) Resolve via reg_members membership number and fetch Members row(s)
  for (const candidate of identifiers) {
    let regQuery = supabase
      .from('reg_members')
      .select('members_id')
      .eq('Membership number', candidate)
      .limit(20);
    if (trustIdHeader) regQuery = regQuery.eq('trust_id', trustIdHeader);
    const { data: regByMembership } = await regQuery;
    const resolvedMemberIds = Array.from(new Set((regByMembership || []).map((row) => row?.members_id).filter(Boolean)));
    if (!resolvedMemberIds.length) continue;
    const { data: resolvedMembers } = await supabase
      .from('Members')
      .select('*')
      .in('members_id', resolvedMemberIds)
      .limit(20);
    (resolvedMembers || []).forEach(addCandidate);
  }

  let member = null;
  const memberList = Array.from(memberCandidates.values());
  if (memberList.length > 0) {
    const candidateIds = Array.from(new Set(memberList.map((row) => row?.members_id).filter(Boolean)));
    const { data: linkedMemberships } = await supabase
      .from('reg_members')
      .select('members_id, trust_id, is_active')
      .in('members_id', candidateIds);

    const membershipsByMemberId = buildMembershipLookup(linkedMemberships || []);
    member = [...memberList].sort(
      (a, b) => scoreMemberCandidate(b, membershipsByMemberId, trustIdHeader) - scoreMemberCandidate(a, membershipsByMemberId, trustIdHeader)
    )[0] || null;
  }

  if (!member?.members_id) {
    const mobileDigits = normalizeDigits(profileData?.mobile || userIdHeader);
    if (mobileDigits && mobileDigits.length >= 10) {
      const normalizedMobile = mobileDigits.slice(-10);
      const variants = Array.from(new Set([normalizedMobile, `+91${normalizedMobile}`, `91${normalizedMobile}`]));

      const { data: existingByMobile } = await supabase
        .from('Members')
        .select('*')
        .or(variants.map((variant) => `Mobile.eq.${variant}`).join(','))
        .order('S.No.', { ascending: false })
        .limit(20);

      if ((existingByMobile || []).length > 0) {
        const existingIds = Array.from(new Set((existingByMobile || []).map((row) => row?.members_id).filter(Boolean)));
        const { data: existingMemberships } = await supabase
          .from('reg_members')
          .select('members_id, trust_id, is_active')
          .in('members_id', existingIds);
        const membershipsByMemberId = buildMembershipLookup(existingMemberships || []);
        member = [...existingByMobile].sort(
          (a, b) => scoreMemberCandidate(b, membershipsByMemberId, trustIdHeader) - scoreMemberCandidate(a, membershipsByMemberId, trustIdHeader)
        )[0] || null;
      }

      if (!member?.members_id) {
        const { data: existingByMobileSingle } = await supabase
          .from('Members')
          .select('*')
          .eq('Mobile', normalizedMobile)
          .limit(1);
        if (existingByMobileSingle?.[0]?.members_id) {
          member = existingByMobileSingle[0];
        }
      }

      if (!member?.members_id) {
        const { data: existingByContact } = await supabase
          .from('Members')
          .select('*')
          .eq('contact', normalizedMobile)
          .limit(1);
        if (existingByContact?.[0]?.members_id) {
          member = existingByContact[0];
        }
      }

      if (!member?.members_id) {
        const { data: insertedMember } = await supabase
          .from('Members')
          .insert({ Mobile: normalizedMobile, contact: normalizedMobile })
          .select('*')
          .maybeSingle();

        if (insertedMember?.members_id) {
          member = insertedMember;
        } else {
          // If insert didn't return a row (or a concurrent insert happened), fetch again.
          const { data: afterInsertLookup } = await supabase
            .from('Members')
            .select('*')
            .or(variants.map((variant) => `Mobile.eq.${variant},contact.eq.${variant}`).join(','))
            .order('S.No.', { ascending: false })
            .limit(1);
          if (afterInsertLookup?.[0]?.members_id) {
            member = afterInsertLookup[0];
          }
        }
      }
    }
  }

  if (!member?.members_id) {
    return { member: null, activeMembership: null };
  }

  let membershipQuery = supabase
    .from('reg_members')
    .select('id, trust_id, role, is_active, joined_date, "Membership number"')
    .eq('members_id', member.members_id)
    .order('joined_date', { ascending: false });

  if (trustIdHeader) {
    membershipQuery = membershipQuery.eq('trust_id', trustIdHeader);
  }

  const { data: memberships } = await membershipQuery;
  const activeMembership =
    (memberships || []).find((m) => m?.is_active === true) ||
    (memberships || [])[0] ||
    null;

  return { member, activeMembership };
};

// Get user profile
router.get('/', async (req, res) => {
  try {
    const userIdHeader = req.headers['user-id'];
    const membersIdHeader = req.headers['members-id'];
    const trustIdHeader = req.headers['trust-id'];
    if (!userIdHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { member, activeMembership } = await resolveMemberContext({
      userIdHeader,
      membersIdHeader,
      trustIdHeader
    });

    if (!member?.members_id) {
      return res.json({ success: true, profile: null });
    }

    const membersId = member.members_id;

    const { data: profile, error: profileErr } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('members_id', membersId)
      .maybeSingle();

    if (profileErr) {
      console.error('Fetch member_profiles error:', profileErr);
      return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }

    const mergedProfile = {
      name: readMemberValue(member, ['Name', 'name', 'Full Name', 'full_name']),
      role: activeMembership?.role || member?.role || member?.Role || 'Trustee',
      memberId: activeMembership?.['Membership number'] || member?.['Membership number'] || '',
      mobile: readMemberValue(member, ['Mobile', 'mobile']),
      email: readMemberValue(member, ['Email', 'email']),
      address_home: member?.['Address Home'] || '',
      address_office: member?.['Address Office'] || '',
      company_name: member?.['Company Name'] || '',
      resident_landline: member?.['Resident Landline'] || '',
      office_landline: member?.['Office Landline'] || '',
      gender: profile?.gender || '',
      marital_status: profile?.marital_status || '',
      nationality: profile?.nationality || '',
      aadhaar_id: profile?.aadhaar_id || '',
      blood_group: profile?.blood_group || '',
      dob: profile?.date_of_birth || '',
      emergency_contact_name: profile?.emergency_contact_name || '',
      emergency_contact_number: profile?.emergency_contact_number || '',
      profile_photo_url: profile?.profile_photo_url || '',
      spouse_name: profile?.spouse_name || '',
      spouse_contact_number: profile?.spouse_contact || '',
      children_count: profile?.no_of_children ?? '',
      facebook: profile?.facebook || '',
      twitter: profile?.twitter || '',
      instagram: profile?.instagram || '',
      linkedin: profile?.linkedin || '',
      whatsapp: profile?.whatsapp || '',
      members_id: membersId
    };

    res.json({
      success: true,
      profile: mergedProfile
    });

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Save/Update user profile
router.post('/save', upload.single('profilePhoto'), async (req, res) => {
  try {
    const userIdHeader = req.headers['user-id'];
    const membersIdHeader = req.headers['members-id'];
    const trustIdHeader = req.headers['trust-id'];
    if (!userIdHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const profileData = JSON.parse(req.body.profileData || '{}');
    const profilePhotoFile = req.file;

    let profilePhotoUrl = profileData.profilePhotoUrl || profileData.profile_photo_url || '';

    const { member, activeMembership } = await resolveMemberContext({
      userIdHeader,
      membersIdHeader,
      trustIdHeader,
      profileData
    });

    if (!member?.members_id) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const membersId = member.members_id;

    // Upload profile picture if provided
    if (profilePhotoFile) {
      let uploadBuffer = profilePhotoFile.buffer;
      let uploadMimeType = profilePhotoFile.mimetype || 'image/jpeg';
      let uploadExtension = String(profilePhotoFile.originalname || '')
        .split('.')
        .pop()
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase() || 'jpg';

      if (uploadBuffer.length > MAX_PROFILE_PHOTO_BYTES) {
        const compressed = await compressProfilePhotoToLimit(uploadBuffer, uploadMimeType);
        if (!compressed?.buffer || compressed.buffer.length > MAX_PROFILE_PHOTO_BYTES) {
          return res.status(400).json({
            success: false,
            message: 'Image could not be compressed under 25KB. Please upload a smaller image.'
          });
        }
        uploadBuffer = compressed.buffer;
        uploadMimeType = compressed.mimeType;
        uploadExtension = compressed.extension;
      }

      const safeOriginalName = String(profilePhotoFile.originalname || 'profile_photo')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const baseNameWithoutExt = safeOriginalName.replace(/\.[^.]+$/, '');
      const fileName = `profiles/${membersId}/${Date.now()}_${baseNameWithoutExt}.${uploadExtension}`;
      console.log('Attempting to upload profile photo to:', fileName);
      
      const { error: uploadError } = await supabase.storage
        .from(PROFILE_PHOTO_BUCKET)
        .upload(fileName, uploadBuffer, {
          contentType: uploadMimeType,
          upsert: true
        });

      if (uploadError) {
        console.error('Profile photo upload error:', uploadError);
        console.error('Upload error details:', {
          message: uploadError.message,
          code: uploadError.code,
          statusCode: uploadError.statusCode
        });
        return res.status(500).json({ 
          success: false, 
          message: `Failed to upload profile photo: ${uploadError.message || 'unknown storage error'}`,
          error: uploadError.message,
          details: uploadError
        });
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(PROFILE_PHOTO_BUCKET)
        .getPublicUrl(fileName);

      console.log('Successfully uploaded profile photo, public URL:', urlData.publicUrl);
      profilePhotoUrl = urlData.publicUrl;
    }

    const memberPatch = {
      Name: sanitizeMemberUpdateValue(profileData.name),
      Email: sanitizeMemberUpdateValue(profileData.email),
      'Address Home': sanitizeMemberUpdateValue(profileData.address_home),
      'Address Office': sanitizeMemberUpdateValue(profileData.address_office),
      'Company Name': sanitizeMemberUpdateValue(profileData.company_name),
      'Resident Landline': sanitizeMemberUpdateValue(profileData.resident_landline),
      'Office Landline': sanitizeMemberUpdateValue(profileData.office_landline)
    };

    const memberUpdatePayload = Object.fromEntries(
      Object.entries(memberPatch).filter(([, value]) => value !== null)
    );

    let mergedMember = member;
    if (Object.keys(memberUpdatePayload).length > 0) {
      const { data: updatedMember, error: memberUpdateErr } = await supabase
        .from('Members')
        .update(memberUpdatePayload)
        .eq('members_id', membersId)
        .select('*')
        .maybeSingle();

      if (memberUpdateErr) {
        console.error('Members update error:', memberUpdateErr);
        return res.status(500).json({
          success: false,
          message: 'Failed to save profile',
          error: memberUpdateErr.message
        });
      }

      if (updatedMember?.members_id) {
        mergedMember = updatedMember;
      }
    }

    const dbProfileData = {
      members_id: membersId,
      profile_photo_url: profilePhotoUrl || null,
      gender: profileData.gender || null,
      date_of_birth: profileData.dob || null,
      blood_group: profileData.blood_group || null,
      marital_status: profileData.marital_status || null,
      nationality: profileData.nationality || null,
      aadhaar_id: profileData.aadhaar_id || null,
      emergency_contact_name: profileData.emergency_contact_name || null,
      emergency_contact_number: profileData.emergency_contact_number || null,
      spouse_name: profileData.spouse_name || null,
      spouse_contact: profileData.spouse_contact_number || null,
      no_of_children: profileData.children_count ? parseInt(profileData.children_count, 10) : 0,
      facebook: profileData.facebook || null,
      twitter: profileData.twitter || null,
      instagram: profileData.instagram || null,
      linkedin: profileData.linkedin || null,
      whatsapp: profileData.whatsapp || null,
      updated_at: new Date().toISOString()
    };

    const { data: upsertedProfile, error: upsertErr } = await supabase
      .from('member_profiles')
      .upsert(dbProfileData, { onConflict: 'members_id' })
      .select()
      .maybeSingle();

    if (upsertErr) {
      console.error('DB error:', upsertErr);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to save profile',
        error: upsertErr.message
      });
    }

    const responseProfile = {
      name: readMemberValue(mergedMember, ['Name', 'name', 'Full Name', 'full_name']),
      role: activeMembership?.role || mergedMember?.role || mergedMember?.Role || 'Trustee',
      memberId: activeMembership?.['Membership number'] || mergedMember?.['Membership number'] || '',
      mobile: readMemberValue(mergedMember, ['Mobile', 'mobile']),
      email: readMemberValue(mergedMember, ['Email', 'email']),
      address_home: mergedMember?.['Address Home'] || '',
      address_office: mergedMember?.['Address Office'] || '',
      company_name: mergedMember?.['Company Name'] || '',
      resident_landline: mergedMember?.['Resident Landline'] || '',
      office_landline: mergedMember?.['Office Landline'] || '',
      gender: upsertedProfile?.gender || '',
      marital_status: upsertedProfile?.marital_status || '',
      nationality: upsertedProfile?.nationality || '',
      aadhaar_id: upsertedProfile?.aadhaar_id || '',
      blood_group: upsertedProfile?.blood_group || '',
      dob: upsertedProfile?.date_of_birth || '',
      emergency_contact_name: upsertedProfile?.emergency_contact_name || '',
      emergency_contact_number: upsertedProfile?.emergency_contact_number || '',
      profile_photo_url: upsertedProfile?.profile_photo_url || profilePhotoUrl || '',
      spouse_name: upsertedProfile?.spouse_name || '',
      spouse_contact_number: upsertedProfile?.spouse_contact || '',
      children_count: upsertedProfile?.no_of_children ?? '',
      facebook: upsertedProfile?.facebook || '',
      twitter: upsertedProfile?.twitter || '',
      instagram: upsertedProfile?.instagram || '',
      linkedin: upsertedProfile?.linkedin || '',
      whatsapp: upsertedProfile?.whatsapp || '',
      members_id: membersId
    };

    res.json({
      success: true,
      message: 'Profile saved successfully',
      profile: responseProfile
    });

  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Get profile photos for multiple members
router.post('/photos', async (req, res) => {
  try {
    const { memberIds } = req.body;
    
    if (!memberIds || !Array.isArray(memberIds)) {
      return res.status(400).json({ success: false, message: 'memberIds array is required' });
    }

    const uniqIds = Array.from(
      new Set(
        (memberIds || [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );
    if (uniqIds.length === 0) {
      return res.json({ success: true, photos: {} });
    }

    const mobileDigits = Array.from(
      new Set(
        uniqIds
          .map((value) => normalizeDigits(value))
          .filter((value) => value.length >= 10)
          .map((value) => value.slice(-10))
      )
    );
    const mobileVariants = Array.from(
      new Set(
        mobileDigits.flatMap((digits) => [digits, `91${digits}`, `+91${digits}`])
      )
    );

    const uuidIds = uniqIds.filter((value) => isUuid(value));

    const { data: membersById } = await supabase
      .from('Members')
      .select('members_id, "Membership number", Mobile')
      .in('members_id', uuidIds);

    const { data: membersByNumber } = await supabase
      .from('Members')
      .select('members_id, "Membership number", Mobile')
      .in('Membership number', uniqIds);

    const { data: membersByMobile } = await supabase
      .from('Members')
      .select('members_id, "Membership number", Mobile')
      .in('Mobile', Array.from(new Set([...uniqIds, ...mobileVariants])));

    const { data: regByMembership } = await supabase
      .from('reg_members')
      .select('members_id, "Membership number", "Mobile"')
      .in('Membership number', uniqIds);

    const { data: regByMobile } = await supabase
      .from('reg_members')
      .select('members_id, "Membership number", "Mobile"')
      .in('Mobile', Array.from(new Set([...uniqIds, ...mobileVariants])));

    const regMemberIds = Array.from(
      new Set(
        [...(regByMembership || []), ...(regByMobile || [])]
          .map((row) => row?.members_id)
          .filter(Boolean)
      )
    );

    let membersFromReg = [];
    if (regMemberIds.length > 0) {
      const { data: regMembersResolved } = await supabase
        .from('Members')
        .select('members_id, "Membership number", Mobile')
        .in('members_id', regMemberIds);
      membersFromReg = regMembersResolved || [];
    }

    const memberMap = new Map();
    [...(membersById || []), ...(membersByNumber || []), ...(membersByMobile || []), ...membersFromReg].forEach(m => {
      if (m?.members_id) memberMap.set(String(m.members_id), m);
    });

    const membersIdList = Array.from(memberMap.keys());
    if (membersIdList.length === 0) {
      return res.json({ success: true, photos: {} });
    }

    const { data: profiles, error } = await supabase
      .from('member_profiles')
      .select('members_id, profile_photo_url')
      .in('members_id', membersIdList)
      .not('profile_photo_url', 'is', null);

    if (error) {
      console.error('Fetch profile photos error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch profile photos' });
    }

    const photoMap = {};
    (profiles || []).forEach(p => {
      const member = memberMap.get(String(p.members_id));
      if (!member) return;
      if (member['Membership number']) {
        const membership = String(member['Membership number']).trim();
        if (membership) photoMap[membership] = p.profile_photo_url;
      }
      if (member.Mobile) {
        const mobileRaw = String(member.Mobile).trim();
        const mobileOnlyDigits = normalizeDigits(mobileRaw);
        const mobile10 = mobileOnlyDigits.length >= 10 ? mobileOnlyDigits.slice(-10) : '';
        if (mobileRaw) photoMap[mobileRaw] = p.profile_photo_url;
        if (mobile10) {
          photoMap[mobile10] = p.profile_photo_url;
          photoMap[`91${mobile10}`] = p.profile_photo_url;
          photoMap[`+91${mobile10}`] = p.profile_photo_url;
        }
      }
      photoMap[p.members_id] = p.profile_photo_url;
    });
    
    res.json({
      success: true,
      photos: photoMap
    });
    
  } catch (error) {
    console.error('Fetch profile photos error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;

