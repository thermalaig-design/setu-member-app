import { supabase } from './supabaseClient';

const attachProfilePhotosByMembersId = async (items = []) => {
  const membersIds = Array.from(new Set((items || []).map((item) => item?.members_id).filter(Boolean)));
  if (membersIds.length === 0) return items;

  try {
    const { data: profileRows, error } = await supabase
      .from('member_profiles')
      .select('members_id, profile_photo_url')
      .in('members_id', membersIds)
      .not('profile_photo_url', 'is', null);

    if (error) {
      console.warn('Failed to fetch profile photo URLs:', error?.message || error);
      return items;
    }

    const photoByMemberId = new Map(
      (profileRows || [])
        .filter((row) => row?.members_id && row?.profile_photo_url)
        .map((row) => [String(row.members_id), row.profile_photo_url])
    );

    return (items || []).map((item) => ({
      ...item,
      profile_photo_url: item?.profile_photo_url || (item?.members_id ? photoByMemberId.get(String(item.members_id)) || null : null),
    }));
  } catch (err) {
    console.warn('attachProfilePhotosByMembersId failed:', err?.message || err);
    return items;
  }
};

const normalizePriorityValue = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDirectoryText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const firstDirectoryValue = (...values) => {
  for (const value of values) {
    const text = normalizeDirectoryText(value);
    if (text) return text;
  }
  return '';
};

const toDirectoryBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeDirectoryText(value).toLowerCase();
  if (!normalized) return false;
  return ['true', '1', 'yes', 'y'].includes(normalized);
};

const mapDirectoryMemberRow = (row = {}) => {
  const name = firstDirectoryValue(
    row?.Name,
    row?.member_name_english,
    row?.member_name_hindi,
    row?.name,
    row?.full_name
  );
  const membershipNumber = firstDirectoryValue(
    row?.['Membership number'],
    row?.membership_number,
    row?.membership_no,
    row?.membershipNumber,
    row?.member_no,
    row?.member_id_number
  );
  const role = firstDirectoryValue(row?.role, row?.member_role, row?.role_type, row?.type);
  const companyName = firstDirectoryValue(row?.['Company Name'], row?.company_name, row?.company, row?.organization_name);
  const addressHome = firstDirectoryValue(row?.['Address Home'], row?.address_home, row?.home_address, row?.address);
  const addressOffice = firstDirectoryValue(row?.['Address Office'], row?.address_office, row?.office_address);
  const residentLandline = firstDirectoryValue(row?.['Resident Landline'], row?.resident_landline, row?.landline_home);
  const officeLandline = firstDirectoryValue(row?.['Office Landline'], row?.office_landline, row?.landline_office);
  const mobile = firstDirectoryValue(row?.Mobile, row?.mobile, row?.phone1, row?.phone2, row?.contact_no, row?.contact_number);
  const email = firstDirectoryValue(row?.Email, row?.email, row?.email_id, row?.mail);
  const serialNumber = firstDirectoryValue(
    row?.['S. No.'],
    row?.['S.No.'],
    row?.s_no,
    row?.serial_no,
    row?.serialNumber,
    row?.id ? `REG-${String(row.id).slice(0, 8)}` : ''
  );
  const privacy = row?.Privacy ?? row?.privacy ?? row?.is_private ?? row?.private ?? false;

  return {
    id: row?.id || row?.reg_id || row?.members_id || null,
    reg_id: row?.reg_id || row?.id || null,
    trust_id: row?.trust_id || null,
    members_id: row?.members_id || row?.member_id || null,
    Name: name || 'N/A',
    Mobile: mobile || null,
    Email: email || null,
    role: role || null,
    type: firstDirectoryValue(row?.type, role) || null,
    'Membership number': membershipNumber || null,
    'S. No.': serialNumber || null,
    'Company Name': companyName || null,
    'Address Home': addressHome || null,
    'Address Office': addressOffice || null,
    'Resident Landline': residentLandline || null,
    'Office Landline': officeLandline || null,
    joined_date: row?.joined_date || row?.created_at || null,
    Privacy: toDirectoryBoolean(privacy),
    profile_photo_url: firstDirectoryValue(row?.profile_photo_url, row?.photo_url, row?.image_url, row?.avatar_url) || null,
    title: row?.title || null,
    subtitle: row?.subtitle || null,
    member_role: row?.member_role || null,
    role_type: row?.role_type || null,
    committee_name_english: row?.committee_name_english || null,
    committee_name_hindi: row?.committee_name_hindi || null,
    position: row?.position || null,
    location: row?.location || null,
    original_id: row?.original_id ?? row?.originalId ?? row?.['S.No.'] ?? row?.['S. No.'] ?? null,
  };
};

const dedupeDirectoryMembers = (rows = []) => {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = firstDirectoryValue(
      row?.members_id,
      row?.['Membership number'],
      row?.id,
      row?.reg_id,
      row?.Name
    ).toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const directoryRpcCache = new Map();
const DIRECTORY_RPC_CACHE_TTL_MS = 5 * 60 * 1000;

export const getDirectoryViewRoles = async (trustId = null) => {
  const normalizedTrustId = normalizeDirectoryText(trustId);
  if (!normalizedTrustId) {
    return { success: true, data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('directory_view_roles')
      .select('id, trust_id, role, status, created_at')
      .eq('trust_id', normalizedTrustId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .order('role', { ascending: true });

    if (error) throw error;

    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row?.id || null,
        trust_id: row?.trust_id || null,
        role: firstDirectoryValue(row?.role) || null,
        status: row?.status || 'active',
        created_at: row?.created_at || null,
      })).filter((row) => row.role),
    };
  } catch (error) {
    console.error('Error fetching directory view roles:', error);
    return { success: false, data: [], error: error?.message || 'Failed to fetch directory view roles' };
  }
};

const fetchDirectoryMembersFromRpc = async (trustId) => {
  const normalizedTrustId = normalizeDirectoryText(trustId);
  if (!normalizedTrustId) return [];

  const cacheKey = normalizedTrustId;
  const cached = directoryRpcCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < DIRECTORY_RPC_CACHE_TTL_MS) {
    return cached.rows;
  }

  try {
    const { data, error } = await supabase.rpc('get_members_full_details_by_trust_id', {
      p_trust_id: normalizedTrustId,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const mapped = dedupeDirectoryMembers(rows.map(mapDirectoryMemberRow));
    directoryRpcCache.set(cacheKey, { ts: Date.now(), rows: mapped });
    return mapped;
  } catch (error) {
    console.warn('Failed to fetch directory members via RPC:', error?.message || error);
    return null;
  }
};

// Fetch trustees and patrons directly from Supabase using reg_members + Members tables
export const getTrusteesAndPatrons = async (trustId = null, trustName = null) => {
  try {
    let resolvedTrustId = trustId;
    const normalizeMembershipNumber = (value) => String(value || '').trim();

    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      resolvedTrustId = trustData?.[0]?.id || null;
    }

    // Use both members_id (UUID FK) and Membership number from reg_members to look up Members
    let membersIds = [];
    let membershipNumbers = [];
    const roleByMembersId = new Map();
    const roleByMembershipNumber = new Map();
    const membershipNumberByMembersId = new Map();

    if (resolvedTrustId) {
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;
      const rmRows = [];

      while (hasMore) {
        const { data: batch, error } = await supabase
          .from('reg_members')
          .select('members_id, role, "Membership number"')
          .eq('trust_id', resolvedTrustId)
          .or('is_active.is.null,is_active.eq.true')
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (batch && batch.length > 0) {
          rmRows.push(...batch);
          if (batch.length < batchSize) {
            hasMore = false;
          } else {
            from += batchSize;
          }
        } else {
          hasMore = false;
        }
      }

      const ids = (rmRows || []).map(r => r.members_id).filter(Boolean);
      const membershipNos = (rmRows || [])
        .map((row) => normalizeMembershipNumber(row?.['Membership number']))
        .filter(Boolean);
      (rmRows || []).forEach((row) => {
        const membershipNumber = normalizeMembershipNumber(row?.['Membership number']);

        if (row.members_id) {
          const key = String(row.members_id);
          if (!roleByMembersId.has(key)) {
            roleByMembersId.set(key, row.role || null);
          }
          if (membershipNumber && !membershipNumberByMembersId.has(key)) {
            membershipNumberByMembersId.set(key, membershipNumber);
          }
        }

        if (membershipNumber && !roleByMembershipNumber.has(membershipNumber.toLowerCase())) {
          roleByMembershipNumber.set(membershipNumber.toLowerCase(), row.role || null);
        }
      });
      if (ids.length > 0) membersIds = ids;
      if (membershipNos.length > 0) membershipNumbers = [...new Set(membershipNos)];
    }

    if (resolvedTrustId && membersIds.length === 0 && membershipNumbers.length === 0) {
      return { data: [] };
    }

    const chunkSize = 100;
    let allData = [];

    if (membersIds.length === 0) {
      // No trust filter — fetch all members
      const { data, error } = await supabase
        .from('Members')
        .select('*')
        .order('Name', { ascending: true });
      if (error) throw error;
      return { data: data || [] };
    }

    // Fetch members by members_id chunks (with retry in smaller slices)
    for (let i = 0; i < membersIds.length; i += chunkSize) {
      const chunk = membersIds.slice(i, i + chunkSize);
      try {
        const { data, error } = await supabase
          .from('Members')
          .select('*')
          .in('members_id', chunk)
          .order('Name', { ascending: true });
        if (error) throw error;
        allData = [...allData, ...(data || [])];
      } catch (chunkError) {
        const retrySize = 25;
        for (let j = 0; j < chunk.length; j += retrySize) {
          const miniChunk = chunk.slice(j, j + retrySize);
          const { data: miniData, error: miniError } = await supabase
            .from('Members')
            .select('*')
            .in('members_id', miniChunk)
            .order('Name', { ascending: true });
          if (miniError) throw miniError;
          allData = [...allData, ...(miniData || [])];
        }
        console.warn('Retried oversized Members query with smaller chunk size', chunkError?.message || chunkError);
      }
    }

    // Fetch members by Membership number chunks (for trusts linked via membership number only).
    // Some environments expose this field with a different column key, so we fall back to in-memory filtering.
    if (membershipNumbers.length > 0) {
      let fetchedByMembership = false;
      try {
        for (let i = 0; i < membershipNumbers.length; i += chunkSize) {
          const chunk = membershipNumbers.slice(i, i + chunkSize);
          const { data, error } = await supabase
            .from('Members')
            .select('*')
            .in('Membership number', chunk)
            .order('Name', { ascending: true });
          if (error) throw error;
          allData = [...allData, ...(data || [])];
        }
        fetchedByMembership = true;
      } catch (membershipQueryError) {
        console.warn('Membership-number DB filter failed, using in-memory fallback:', membershipQueryError?.message || membershipQueryError);
      }

      if (!fetchedByMembership) {
        const { data: fallbackMembers, error: fallbackError } = await supabase
          .from('Members')
          .select('*')
          .order('Name', { ascending: true });
        if (fallbackError) throw fallbackError;

        const membershipSet = new Set(
          (membershipNumbers || [])
            .map((value) => normalizeMembershipNumber(value).toLowerCase())
            .filter(Boolean)
        );

        const filteredFallbackMembers = (fallbackMembers || []).filter((member) => {
          const candidates = [
            member?.['Membership number'],
            member?.membership_number,
            member?.membershipNumber,
            member?.membership_no,
            member?.MembershipNo,
          ];
          return candidates.some((candidate) => {
            const normalized = normalizeMembershipNumber(candidate).toLowerCase();
            return normalized && membershipSet.has(normalized);
          });
        });

        allData = [...allData, ...filteredFallbackMembers];
      }
    }

    // De-duplicate rows that may come from both members_id and membership-number fetches.
    const seen = new Set();
    const uniqueMembers = [];
    for (const member of allData) {
      const mid = member?.members_id ? `mid:${String(member.members_id)}` : '';
      const mno = normalizeMembershipNumber(member?.['Membership number']);
      const mkey = mno ? `mno:${mno.toLowerCase()}` : '';
      const sno = member?.['S.No.'] ?? member?.['S. No.'] ?? null;
      const skey = sno ? `sno:${sno}` : '';
      const key = mid || mkey || skey || JSON.stringify(member);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueMembers.push(member);
    }

    // Enrich each member with their role from reg_members
    const enriched = uniqueMembers.map((member) => {
      const mid = member?.members_id ? String(member.members_id) : null;
      const memberMembershipNumber = normalizeMembershipNumber(member?.['Membership number']);
      const role = mid ? roleByMembersId.get(mid) : null;
      const roleFromMembership = memberMembershipNumber
        ? roleByMembershipNumber.get(memberMembershipNumber.toLowerCase())
        : null;
      const membershipNumber = mid ? membershipNumberByMembersId.get(mid) : null;

      return {
        ...member,
        type: member?.type || role || roleFromMembership || member?.role || null,
        role: member?.role || role || roleFromMembership || null,
        'Membership number': membershipNumber || memberMembershipNumber || null,
        // Normalize the S.No. field name (table uses "S.No." without space)
        'S. No.': member?.['S.No.'] ?? member?.['S. No.'] ?? null,
      };
    });
    const sorted = enriched.sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
    return { data: sorted };
  } catch (err) {
    console.error('Error fetching trustees and patrons from Supabase:', err);
    throw err;
  }
};


// Fetch executive body members from member_roles + reg_members + Members
export const getExecutiveBodyMembers = async (trustId = null, trustName = null) => {
  try {
    let resolvedTrustId = trustId;
    const normalizeMembershipNumber = (value) => String(value || '').trim();
    const extractMemberMembership = (member = {}) => {
      const candidates = [
        member?.['Membership number'],
        member?.membership_number,
        member?.membershipNumber,
        member?.membership_no,
        member?.MembershipNo,
      ];
      for (const candidate of candidates) {
        const normalized = normalizeMembershipNumber(candidate);
        if (normalized) return normalized;
      }
      return '';
    };

    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      resolvedTrustId = trustData?.[0]?.id || null;
    }

    let query = supabase
      .from('member_roles')
      .select(`
        id,
        reg_id,
        role_type,
        title,
        subtitle,
        priority,
        privacy,
        created_at,
        updated_at,
        reg_members!inner (
          id,
          trust_id,
          members_id,
          role,
          "Membership number",
          is_active,
          Members:members_id (
            "S.No.",
            "Name",
            "Mobile",
            "Email",
            "Address Home",
            "Company Name",
            "Address Office",
            "Resident Landline",
            "Office Landline",
            members_id
          )
        )
      `)
      .in('role_type', ['committee', 'elected']);

    if (resolvedTrustId) {
      query = query.eq('reg_members.trust_id', resolvedTrustId);
    }

    const { data: rows, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    const missingMembershipNumbers = [];
    (rows || []).forEach((row) => {
      const regMember = row?.reg_members || {};
      const memberFromJoin = Array.isArray(regMember?.Members) ? regMember.Members[0] : regMember?.Members;
      const membershipNumber = normalizeMembershipNumber(regMember?.['Membership number']);
      if (!memberFromJoin?.Name && membershipNumber) {
        missingMembershipNumbers.push(membershipNumber);
      }
    });

    const fallbackMembersByMembership = new Map();
    const uniqueMissingMemberships = [...new Set(missingMembershipNumbers)];

    if (uniqueMissingMemberships.length > 0) {
      try {
        const chunkSize = 100;
        let matchedRows = [];
        for (let i = 0; i < uniqueMissingMemberships.length; i += chunkSize) {
          const chunk = uniqueMissingMemberships.slice(i, i + chunkSize);
          const { data, error: chunkError } = await supabase
            .from('Members')
            .select('*')
            .in('Membership number', chunk);
          if (chunkError) throw chunkError;
          matchedRows = matchedRows.concat(data || []);
        }
        matchedRows.forEach((member) => {
          const key = extractMemberMembership(member).toLowerCase();
          if (key && !fallbackMembersByMembership.has(key)) {
            fallbackMembersByMembership.set(key, member);
          }
        });
      } catch (membershipLookupError) {
        console.warn('Membership-number lookup failed, using in-memory fallback:', membershipLookupError?.message || membershipLookupError);
        const { data: fallbackMembers, error: fallbackError } = await supabase
          .from('Members')
          .select('*');
        if (fallbackError) throw fallbackError;

        const membershipSet = new Set(uniqueMissingMemberships.map((value) => normalizeMembershipNumber(value).toLowerCase()).filter(Boolean));
        (fallbackMembers || []).forEach((member) => {
          const membership = extractMemberMembership(member).toLowerCase();
          if (membership && membershipSet.has(membership) && !fallbackMembersByMembership.has(membership)) {
            fallbackMembersByMembership.set(membership, member);
          }
        });
      }
    }

    const mapped = (rows || [])
      .filter((row) => row?.reg_members?.is_active !== false)
      .map((row) => {
        const regMember = row?.reg_members || {};
        const joinedMember = Array.isArray(regMember?.Members) ? regMember.Members[0] : regMember?.Members;
        const membershipNumber = normalizeMembershipNumber(regMember?.['Membership number']);
        const fallbackMember = membershipNumber
          ? fallbackMembersByMembership.get(membershipNumber.toLowerCase()) || {}
          : {};
        const member = joinedMember?.Name ? joinedMember : fallbackMember;
        const roleType = String(row?.role_type || '').toLowerCase();
        const isCommittee = roleType === 'committee';
        const isElected = roleType === 'elected';
        const roleLabel = row?.title || regMember?.role || (isCommittee ? 'Committee' : 'Elected');
        const resolvedMembership =
          membershipNumber ||
          extractMemberMembership(member) ||
          null;
        const serialNumber = member?.['S.No.'] ?? member?.['S. No.'] ?? `MR-${String(row?.id || '').slice(0, 8)}`;

        return {
          id: row?.id || null,
          reg_id: row?.reg_id || regMember?.id || null,
          trust_id: regMember?.trust_id || null,
          members_id: regMember?.members_id || member?.members_id || null,
          role_type: roleType,
          type: isCommittee ? 'Committee' : 'Elected',
          role: regMember?.role || null,
          title: row?.title || null,
          subtitle: row?.subtitle || null,
          priority: row?.priority ?? null,
          privacy: row?.privacy ?? null,
          member_role: roleLabel,
          member_name_english: member?.Name || null,
          Name: member?.Name || null,
          Mobile: member?.Mobile || null,
          Email: member?.Email || null,
          'Membership number': resolvedMembership,
          'Company Name': member?.['Company Name'] || null,
          'Address Home': member?.['Address Home'] || null,
          'Address Office': member?.['Address Office'] || null,
          'Resident Landline': member?.['Resident Landline'] || null,
          'Office Landline': member?.['Office Landline'] || null,
          'S. No.': serialNumber,
          original_id: member?.['S.No.'] ?? member?.['S. No.'] ?? null,
          committee_name_english: isCommittee ? (row?.title || roleLabel) : null,
          committee_name_hindi: isCommittee ? (row?.subtitle || null) : null,
          is_committee_member: isCommittee,
          is_elected_member: isElected,
          elected_id: isElected ? row?.id || null : null,
          position: isElected ? (row?.title || roleLabel) : null,
          location: isElected ? (row?.subtitle || null) : null,
          created_at: row?.created_at || null,
          updated_at: row?.updated_at || null,
        };
      });

    const byPriorityThenMembershipThenName = (a, b) => {
      const aPriority = normalizePriorityValue(a?.priority);
      const bPriority = normalizePriorityValue(b?.priority);
      const aHasPriority = aPriority !== null;
      const bHasPriority = bPriority !== null;

      if (aHasPriority || bHasPriority) {
        if (aHasPriority !== bHasPriority) return aHasPriority ? -1 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
      }

      const aMembership = normalizeMembershipNumber(a?.['Membership number']);
      const bMembership = normalizeMembershipNumber(b?.['Membership number']);
      const aNum = Number.parseInt((aMembership.match(/\d+/g) || ['999999999']).join(''), 10);
      const bNum = Number.parseInt((bMembership.match(/\d+/g) || ['999999999']).join(''), 10);
      if (aNum !== bNum) return aNum - bNum;
      return String(a?.Name || '').localeCompare(String(b?.Name || ''));
    };

    const withPhotos = await attachProfilePhotosByMembersId(mapped);
    const committee = withPhotos.filter((item) => item.role_type === 'committee').sort(byPriorityThenMembershipThenName);
    const elected = withPhotos.filter((item) => item.role_type === 'elected').sort(byPriorityThenMembershipThenName);

    return {
      success: true,
      data: {
        committee,
        elected,
        all: [...committee, ...elected],
      }
    };
  } catch (err) {
    console.error('Error fetching executive body members from Supabase:', err);
    return {
      success: false,
      data: { committee: [], elected: [], all: [] },
      error: err?.message || 'Failed to fetch executive body members',
    };
  }
};

// Fetch directory members from RPC first, then fall back to reg_members + Members
export const getDirectoryMembers = async (trustId = null, trustName = null, opts = {}) => {
  try {
    let resolvedTrustId = trustId;
    const normalizeMembershipNumber = (value) => String(value || '').trim();
    const fullList = Boolean(opts?.fullList || opts?.allMembers || opts?.searchAll);
    const page = fullList ? 1 : Math.max(1, Number(opts?.page) || 1);
    const limit = fullList ? 100000 : Math.max(1, Math.min(100, Number(opts?.limit) || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      resolvedTrustId = trustData?.[0]?.id || null;
    }

    if (resolvedTrustId) {
      const rpcRows = await fetchDirectoryMembersFromRpc(resolvedTrustId);
      if (rpcRows) {
        const sortedRows = [...rpcRows].sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
        const totalCount = sortedRows.length;
        if (fullList) {
          return {
            success: true,
            data: sortedRows,
            page: 1,
            limit: totalCount || limit,
            totalCount,
            hasMore: false
          };
        }
        const pageRows = sortedRows.slice(from, to + 1);
        const withPhotos = await attachProfilePhotosByMembersId(pageRows);

        return {
          success: true,
          data: withPhotos,
          page,
          limit,
          totalCount,
          hasMore: to + 1 < totalCount
        };
      }
    }

    let query = supabase
      .from('reg_members')
      .select(`
        id,
        trust_id,
        role,
        joined_date,
        is_active,
        members_id,
        "Membership number",
        "Mobile",
        "Name",
        Members:members_id (
          "S.No.",
          "Name",
          "Mobile",
          "Email",
          "Address Home",
          "Company Name",
          "Address Office",
          "Resident Landline",
          "Office Landline",
          members_id,
          "Privacy"
        )
      `, { count: 'exact' })
      .or('is_active.is.null,is_active.eq.true');

    if (resolvedTrustId) {
      query = query.eq('trust_id', resolvedTrustId);
    }

    const orderedQuery = query.order('joined_date', { ascending: false });
    const { data: rows, error, count } = fullList
      ? await orderedQuery
      : await orderedQuery.range(from, to);
    if (error) throw error;

    const mapped = (rows || []).map((row) => {
      const joined = Array.isArray(row?.Members) ? row.Members[0] : row?.Members;
      const membershipNumber = normalizeMembershipNumber(row?.['Membership number']) || null;
      const displayName = joined?.Name || row?.Name || null;
      const displayMobile = joined?.Mobile || row?.Mobile || null;

      return {
        id: row?.id || null,
        reg_id: row?.id || null,
        trust_id: row?.trust_id || null,
        members_id: row?.members_id || joined?.members_id || null,
        Name: displayName,
        Mobile: displayMobile,
        Email: joined?.Email || null,
        role: row?.role || null,
        type: row?.role || null,
        'Membership number': membershipNumber,
        'S. No.': joined?.['S.No.'] ?? joined?.['S. No.'] ?? `REG-${String(row?.id || '').slice(0, 8)}`,
        'Company Name': joined?.['Company Name'] || null,
        'Address Home': joined?.['Address Home'] || null,
        'Address Office': joined?.['Address Office'] || null,
        'Resident Landline': joined?.['Resident Landline'] || null,
        'Office Landline': joined?.['Office Landline'] || null,
        joined_date: row?.joined_date || null,
        Privacy: joined?.Privacy ?? true,
      };
    });

    if (fullList) {
      return {
        success: true,
        data: mapped,
        page: 1,
        limit: mapped.length || limit,
        totalCount: Number(count || mapped.length || 0),
        hasMore: false
      };
    }

    const withPhotos = await attachProfilePhotosByMembersId(mapped);

    return {
      success: true,
      data: withPhotos,
      page,
      limit,
      totalCount: Number(count || 0),
      hasMore: to + 1 < Number(count || 0)
    };
  } catch (err) {
    console.error('Error fetching directory members from reg_members:', err);
    return { success: false, data: [], error: err?.message || 'Failed to fetch directory members' };
  }
};


// Fetch doctors from Members + reg_members + employee_details + opd_schedule (new schema)
export const getOpdDoctors = async (trustId = null, trustName = null) => {
  try {
    let resolvedTrustId = trustId;
    
    // Resolve trust_id from trust_name if needed
    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      resolvedTrustId = trustData?.[0]?.id || null;
    }
    
    let query = supabase
      .from('reg_members')
      .select(`
        id,
        trust_id,
        role,
        "Membership number",
        members_id,
        Members:members_id (
          "S.No.",
          "Name",
          "Mobile",
          "Email",
          "Address Home",
          "Company Name",
          "Address Office",
          "Resident Landline",
          "Office Landline",
          members_id
        ),
        employee_details!inner (
          designation,
          qualification,
          experience_years,
          doctor_image_url,
          department,
          unit,
          unit_notes,
          is_active
        ),
        opd_schedule (
          opd_type,
          opd_days,
          opd_start_time,
          opd_end_time,
          slot_duration_minutes,
          fees
        )
      `)
      .ilike('role', '%doctor%')
      .or('is_active.is.null,is_active.eq.true')
      .eq('employee_details.is_active', true);

    if (resolvedTrustId) {
      query = query.eq('trust_id', resolvedTrustId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const buildSchedule = (rows, type) => {
      const filtered = (rows || []).filter(r => String(r?.opd_type || '').toLowerCase() === type);
      const schedule = filtered.map(r => ({
        day: r.opd_days || null,
        start_time: r.opd_start_time || null,
        end_time: r.opd_end_time || null,
        slot_duration_minutes: r.slot_duration_minutes ?? null,
        fees: r.fees ?? null
      }));

      const dayText = [...new Set(filtered.map(r => r?.opd_days).filter(Boolean))].join(', ') || null;
      const first = schedule[0] || {};
      const fee = schedule.find(s => s.fees != null)?.fees ?? null;
      const duration = schedule.find(s => s.slot_duration_minutes != null)?.slot_duration_minutes ?? null;

      return {
        schedule,
        dayText,
        start: first.start_time || null,
        end: first.end_time || null,
        fee,
        duration
      };
    };

    let normalized = (data || []).map((row) => {
      const member = row.Members || {};
      const empDetailsRaw = row.employee_details;
      const detailsArr = Array.isArray(empDetailsRaw)
        ? empDetailsRaw
        : empDetailsRaw
        ? [empDetailsRaw]
        : [];
      const activeDetails = detailsArr.filter(d => d?.is_active !== false);
      if (activeDetails.length === 0) return null;
      const details = activeDetails[0];
      const schedules = row.opd_schedule || [];
      const general = buildSchedule(schedules, 'general');
      const privateOpd = buildSchedule(schedules, 'private');
      const fallbackDepartment =
        details.department ||
        details.unit ||
        details.unit_notes ||
        details.designation ||
        member?.['Company Name'] ||
        null;

      let imageUrl = details.doctor_image_url || null;
      if (imageUrl && typeof imageUrl === 'string') {
        if (imageUrl.startsWith('data:') || imageUrl.startsWith('http')) {
          // use as-is
        } else {
          const path = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
          try {
            const { data: urlData } = supabase.storage
              .from('doctor-images')
              .getPublicUrl(path);
            imageUrl = urlData?.publicUrl || imageUrl;
          } catch (e) {
            console.warn('Could not get public URL for doctor image:', path, e);
          }
        }
      }

      return {
        id: row.id,
        original_id: member?.['S.No.'] ?? member?.['S. No.'] ?? null,
        members_id: row.members_id || member?.members_id || null,
        trust_id: row.trust_id || null,
        Name: member?.Name || null,
        Mobile: member?.Mobile || null,
        Email: member?.Email || null,
        'Address Home': member?.['Address Home'] || null,
        'Company Name': member?.['Company Name'] || null,
        'Address Office': member?.['Address Office'] || null,
        'Resident Landline': member?.['Resident Landline'] || null,
        'Office Landline': member?.['Office Landline'] || null,
        type: row.role || 'Doctor',
        role: row.role || 'Doctor',
        'Membership number': row['Membership number'] || null,
        designation: details.designation || null,
        qualification: details.qualification || null,
        experience_years: details.experience_years || null,
        doctor_image_url: imageUrl,
        department: fallbackDepartment,
        unit: details.unit || null,
        unit_notes: details.unit_notes || null,
        consultant_name: member?.Name || null,
        general_opd_schedule: general.schedule || [],
        private_opd_schedule: privateOpd.schedule || [],
        general_opd_days: general.dayText,
        private_opd_days: privateOpd.dayText,
        general_opd_start: general.start,
        general_opd_end: general.end,
        private_opd_start: privateOpd.start,
        private_opd_end: privateOpd.end,
        slot_duration_minutes: general.duration || privateOpd.duration || null,
        general_fee: general.fee ?? null,
        private_fee: privateOpd.fee ?? null,
        consultation_fee: general.fee || privateOpd.fee || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));

    // If no doctors found with employee_details, fall back to reg_members with doctor role
    if (normalized.length === 0) {
      console.log('No doctors with employee_details, falling back to reg_members...');
      let fallbackQuery = supabase
        .from('reg_members')
        .select(`
          id,
          trust_id,
          role,
          "Membership number",
          members_id,
          Members:members_id (
            "S.No.",
            "Name",
            "Mobile",
            "Email",
            "Address Home",
            "Company Name",
            "Address Office",
            "Resident Landline",
            "Office Landline",
            members_id
          )
        `)
        .ilike('role', '%doctor%');

      if (resolvedTrustId) {
        fallbackQuery = fallbackQuery.eq('trust_id', resolvedTrustId);
      }

      const { data: fallbackData } = await fallbackQuery;
      
      if (fallbackData && fallbackData.length > 0) {
        normalized = fallbackData.map(row => {
          const member = row.Members || {};
          return {
            id: row.id,
            original_id: member?.['S.No.'] ?? member?.['S. No.'] ?? null,
            members_id: row.members_id || member?.members_id || null,
            trust_id: row.trust_id || null,
            Name: member?.Name || null,
            Mobile: member?.Mobile || null,
            Email: member?.Email || null,
            'Address Home': member?.['Address Home'] || null,
            'Company Name': member?.['Company Name'] || null,
            'Address Office': member?.['Address Office'] || null,
            'Resident Landline': member?.['Resident Landline'] || null,
            'Office Landline': member?.['Office Landline'] || null,
            type: row.role || 'Doctor',
            role: row.role || 'Doctor',
            'Membership number': row['Membership number'] || null,
            designation: null,
            qualification: null,
            experience_years: null,
            doctor_image_url: null,
            department: member?.['Company Name'] || null,
            unit: null,
            unit_notes: null,
            consultant_name: member?.Name || null,
            general_opd_schedule: [],
            private_opd_schedule: [],
            general_opd_days: null,
            private_opd_days: null,
            general_opd_start: null,
            general_opd_end: null,
            private_opd_start: null,
            private_opd_end: null,
            slot_duration_minutes: null,
            general_fee: null,
            private_fee: null,
            consultation_fee: null
          };
        }).sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
      }
    }

    return { success: true, data: normalized };
  } catch (err) {
    console.error('Error fetching doctors from reg_members/employee_details:', err);
    return { success: true, data: [] };
  }
};

// Fetch doctors with OPD schedule from reg_members + Members + employee_details + opd_schedule (new schema)
export const getDoctorsWithSchedule = async ({ trustId = null, trustName = null } = {}) => {
  try {
    let resolvedTrustId = trustId;

    if (!resolvedTrustId && trustName) {
      const { data: trustData } = await supabase
        .from('Trust')
        .select('id')
        .ilike('name', String(trustName).trim())
        .limit(1);
      resolvedTrustId = trustData?.[0]?.id || null;
    }

    let query = supabase
      .from('reg_members')
      .select(`
        id,
        trust_id,
        role,
        "Membership number",
        members_id,
        Members:members_id (
          "S.No.",
          "Name",
          "Mobile",
          "Email",
          "Address Home",
          "Company Name",
          "Address Office",
          "Resident Landline",
          "Office Landline",
          members_id
        ),
        employee_details!inner (
          designation,
          qualification,
          experience_years,
          doctor_image_url,
          department,
          unit,
          unit_notes,
          is_active
        ),
        opd_schedule!inner (
          opd_type,
          opd_days,
          opd_start_time,
          opd_end_time,
          slot_duration_minutes,
          fees
        )
      `)
      .ilike('role', '%doctor%')
      .or('is_active.is.null,is_active.eq.true');

    if (resolvedTrustId) {
      query = query.eq('trust_id', resolvedTrustId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const buildSchedule = (rows, type) => {
      const filtered = (rows || []).filter(r => String(r?.opd_type || '').toLowerCase() === type);
      const schedule = filtered.map(r => ({
        day: r.opd_days || null,
        start_time: r.opd_start_time || null,
        end_time: r.opd_end_time || null,
        slot_duration_minutes: r.slot_duration_minutes ?? null,
        fees: r.fees ?? null
      }));

      const dayText = [...new Set(filtered.map(r => r?.opd_days).filter(Boolean))].join(', ') || null;
      const first = schedule[0] || {};
      const fee = schedule.find(s => s.fees != null)?.fees ?? null;
      const duration = schedule.find(s => s.slot_duration_minutes != null)?.slot_duration_minutes ?? null;

      return {
        schedule,
        dayText,
        start: first.start_time || null,
        end: first.end_time || null,
        fee,
        duration
      };
    };

    const normalized = (data || [])
      .map((row) => {
        const member = row.Members || {};

        // employee_details can be an array (multiple rows) or a single object — handle both
        const empDetailsRaw = row.employee_details;
        const detailsArr = Array.isArray(empDetailsRaw)
          ? empDetailsRaw
          : empDetailsRaw
          ? [empDetailsRaw]
          : [];

        // Filter to only active employee_details rows; skip doctor if none remain
        const activeDetails = detailsArr.filter(d => d?.is_active !== false);
        if (activeDetails.length === 0) return null;

        const details = activeDetails[0]; // use first active detail row
        const schedules = row.opd_schedule || [];

        const general = buildSchedule(schedules, 'general');
        const privateOpd = buildSchedule(schedules, 'private');

        // Fallback chain: department → unit → unit_notes → designation → Company Name
        const fallbackDepartment =
          details.department ||
          details.unit ||
          details.unit_notes ||
          details.designation ||
          member?.['Company Name'] ||
          null;

        let imageUrl = details.doctor_image_url || null;
        if (imageUrl && typeof imageUrl === 'string') {
          if (imageUrl.startsWith('data:') || imageUrl.startsWith('http')) {
            // use as-is
          } else {
            const path = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
            try {
              const { data: urlData } = supabase.storage
                .from('doctor-images')
                .getPublicUrl(path);
              imageUrl = urlData?.publicUrl || imageUrl;
            } catch (e) {
              console.warn('Could not get public URL for doctor image:', path, e);
            }
          }
        }

        return {
          id: row.id,
          reg_id: row.id,
          original_id: member?.['S.No.'] ?? member?.['S. No.'] ?? null,
          members_id: row.members_id || member?.members_id || null,
          trust_id: row.trust_id || null,
          Name: member?.Name || null,
          Mobile: member?.Mobile || null,
          Email: member?.Email || null,
          'Address Home': member?.['Address Home'] || null,
          'Company Name': member?.['Company Name'] || null,
          'Address Office': member?.['Address Office'] || null,
          'Resident Landline': member?.['Resident Landline'] || null,
          'Office Landline': member?.['Office Landline'] || null,
          type: row.role || 'Doctor',
          role: row.role || 'Doctor',
          'Membership number': row['Membership number'] || null,
          designation: details.designation || null,
          qualification: details.qualification || null,
          experience_years: details.experience_years || null,
          doctor_image_url: imageUrl,
          department: fallbackDepartment,
          unit: details.unit || null,
          unit_notes: details.unit_notes || null,
          consultant_name: member?.Name || null,
          general_opd_schedule: general.schedule || [],
          private_opd_schedule: privateOpd.schedule || [],
          general_opd_days: general.dayText,
          private_opd_days: privateOpd.dayText,
          general_opd_start: general.start,
          general_opd_end: general.end,
          private_opd_start: privateOpd.start,
          private_opd_end: privateOpd.end,
          slot_duration_minutes: general.duration || privateOpd.duration || null,
          general_fee: general.fee ?? null,
          private_fee: privateOpd.fee ?? null,
          consultation_fee: general.fee || privateOpd.fee || null
        };
      })
      .filter(Boolean) // remove null entries (inactive / missing employee_details)
      .filter(d => (d.general_opd_schedule?.length > 0) || (d.private_opd_schedule?.length > 0)) // only doctors with OPD schedule
      .sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));

    return { success: true, data: normalized };
  } catch (err) {
    console.error('Error fetching doctors with schedule:', err);
    return { success: true, data: [] };
  }
};
