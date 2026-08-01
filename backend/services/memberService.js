import { supabase } from '../config/supabase.js';

const normalizeMembershipNumber = (value) => String(value || '').trim();

const normalizePriorityValue = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const comparePriorityValues = (a = {}, b = {}) => {
  const priorityA = normalizePriorityValue(a?.priority);
  const priorityB = normalizePriorityValue(b?.priority);
  const hasPriorityA = priorityA !== null;
  const hasPriorityB = priorityB !== null;

  if (hasPriorityA || hasPriorityB) {
    if (hasPriorityA !== hasPriorityB) return hasPriorityA ? -1 : 1;
    if (priorityA !== priorityB) return priorityA - priorityB;
  }

  return 0;
};

const comparePriorityThenName = (a = {}, b = {}) => {
  const priorityDiff = comparePriorityValues(a, b);
  if (priorityDiff !== 0) return priorityDiff;

  return String(a?.Name || a?.member_name_english || a?.title || '').localeCompare(
    String(b?.Name || b?.member_name_english || b?.title || '')
  );
};

const comparePriorityThenMembershipThenName = (a = {}, b = {}) => {
  const priorityDiff = comparePriorityValues(a, b);
  if (priorityDiff !== 0) return priorityDiff;

  const aMembership = normalizeMembershipNumber(a?.['Membership number']);
  const bMembership = normalizeMembershipNumber(b?.['Membership number']);
  const aNum = Number.parseInt((aMembership.match(/\d+/g) || ['999999999']).join(''), 10);
  const bNum = Number.parseInt((bMembership.match(/\d+/g) || ['999999999']).join(''), 10);
  if (aNum !== bNum) return aNum - bNum;
  return String(a?.Name || '').localeCompare(String(b?.Name || ''));
};

const mergeUniqueMembers = (rows = []) => {
  const seen = new Set();
  const output = [];

  for (const row of rows || []) {
    const key =
      row?.members_id
        ? `mid:${row.members_id}`
        : normalizeMembershipNumber(row?.['Membership number'])
          ? `mno:${normalizeMembershipNumber(row?.['Membership number']).toLowerCase()}`
          : row?.['S. No.']
            ? `sno:${row['S. No.']}`
            : null;

    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      output.push(row);
    }
  }

  return output;
};

// Fetch trust membership metadata from reg_members table (new schema)
// Supports both members_id and Membership number based linking.
const getTrustMembershipMeta = async (trustId) => {
  if (!trustId) {
    return {
      membersIds: [],
      membershipNumbers: [],
      roleByMembersId: new Map(),
      roleByMembershipNumber: new Map(),
      membershipNumberByMembersId: new Map(),
    };
  }

  const batchSize = 1000;
  let from = 0;
  let hasMore = true;
  let allRows = [];
  let error = null;

  while (hasMore) {
    const result = await supabase
      .from('reg_members')
      .select('members_id, "Membership number", role')
      .eq('trust_id', trustId)
      .or('is_active.is.null,is_active.eq.true')
      .range(from, from + batchSize - 1);

    if (result.error) {
      error = result.error;
      break;
    }

    if (result.data && result.data.length > 0) {
      allRows = [...allRows, ...result.data];
      if (result.data.length < batchSize) {
        hasMore = false;
      } else {
        from += batchSize;
      }
    } else {
      hasMore = false;
    }
  }

  if (error) {
    console.error('Error fetching reg_members for trust filter:', error);
    throw error;
  }

  const membersIds = [];
  const membershipNumbers = [];
  const roleByMembersId = new Map();
  const roleByMembershipNumber = new Map();
  const membershipNumberByMembersId = new Map();
  for (const row of allRows || []) {
    const membershipNumber = normalizeMembershipNumber(row?.['Membership number']);
    if (membershipNumber) {
      membershipNumbers.push(membershipNumber);
      if (!roleByMembershipNumber.has(membershipNumber.toLowerCase())) {
        roleByMembershipNumber.set(membershipNumber.toLowerCase(), row?.role || null);
      }
    }

    if (row?.members_id) {
      membersIds.push(row.members_id);
      roleByMembersId.set(row.members_id, row.role || null);
      if (membershipNumber && !membershipNumberByMembersId.has(row.members_id)) {
        membershipNumberByMembersId.set(row.members_id, membershipNumber);
      }
    }
  }

  return {
    membersIds: [...new Set(membersIds)],
    membershipNumbers: [...new Set(membershipNumbers)],
    roleByMembersId,
    roleByMembershipNumber,
    membershipNumberByMembersId,
  };
};

const applyMemberScopeFilter = (query, trustMeta) => {
  const membersIds = trustMeta?.membersIds || [];
  if (membersIds.length > 0) return query.in('members_id', membersIds);

  const membershipNumbers = trustMeta?.membershipNumbers || [];
  if (membershipNumbers.length > 0) return query.in('Membership number', membershipNumbers);

  return query;
};

const enrichWithMembershipData = (members, trustMeta) => {
  if (!trustMeta) return members || [];
  const membershipMap = trustMeta?.membershipNumberByMembersId;
  const roleMap = trustMeta?.roleByMembersId;
  const roleByMembershipNumber = trustMeta?.roleByMembershipNumber;

  return (members || []).map((member) => {
    const mid = member?.members_id || null;
    const existingMembershipNumber = normalizeMembershipNumber(member?.['Membership number']);
    const membershipNumber = mid ? membershipMap?.get(mid) : null;
    const roleFromMembershipNumber = existingMembershipNumber
      ? roleByMembershipNumber?.get(existingMembershipNumber.toLowerCase())
      : null;
    const mappedRole = mid ? roleMap?.get(mid) : null;
    const finalRole =
      mappedRole ||
      roleFromMembershipNumber ||
      member?.role ||
      member?.type ||
      'Member';

    return {
      ...member,
      'Membership number': membershipNumber || existingMembershipNumber || null,
      role: finalRole,
      type: member?.type || finalRole || 'Member',
    };
  });
};

const hasTrustMembershipScope = (trustMeta) => {
  const membersIds = trustMeta?.membersIds || [];
  const membershipNumbers = trustMeta?.membershipNumbers || [];
  return membersIds.length > 0 || membershipNumbers.length > 0;
};

const getTrustMemberIdList = (trustMeta, preferMembership = false) => {
  const membersIds = trustMeta?.membersIds || [];
  const membershipNumbers = trustMeta?.membershipNumbers || [];

  if (!preferMembership && membersIds.length > 0) {
    return { field: 'members_id', values: membersIds };
  }
  if (membershipNumbers.length > 0) {
    return { field: 'Membership number', values: membershipNumbers };
  }
  if (membersIds.length > 0) {
    return { field: 'members_id', values: membersIds };
  }

  return { field: null, values: [] };
};

const normalizeSearchText = (value) => String(value || '').trim().toLowerCase();

const mapDirectoryMemberRow = (row = {}) => {
  const joined = Array.isArray(row?.Members) ? row.Members[0] : row?.Members;

  return {
    id: row?.id || null,
    reg_id: row?.id || null,
    trust_id: row?.trust_id || null,
    members_id: row?.members_id || joined?.members_id || null,
    Name: joined?.Name || row?.Name || null,
    Mobile: joined?.Mobile || row?.Mobile || null,
    Email: joined?.Email || null,
    role: row?.role || null,
    type: row?.role || null,
    'Membership number': normalizeMembershipNumber(row?.['Membership number']) || null,
    'S. No.': joined?.['S.No.'] ?? joined?.['S. No.'] ?? `REG-${String(row?.id || '').slice(0, 8)}`,
    'Company Name': joined?.['Company Name'] || null,
    'Address Home': joined?.['Address Home'] || null,
    'Address Office': joined?.['Address Office'] || null,
    'Resident Landline': joined?.['Resident Landline'] || null,
    'Office Landline': joined?.['Office Landline'] || null,
    joined_date: row?.joined_date || null,
    Privacy: joined?.Privacy ?? true,
  };
};

const matchesDirectoryMember = (member, searchQuery, type = null) => {
  const normalizedQuery = normalizeSearchText(searchQuery);
  const normalizedType = normalizeSearchText(type);
  const memberRole = normalizeSearchText(member?.role || member?.type);

  if (normalizedType && normalizedType !== 'all' && memberRole !== normalizedType) {
    return false;
  }

  if (!normalizedQuery) return true;

  const haystack = [
    member?.Name,
    member?.role,
    member?.type,
    member?.Mobile,
    member?.Email,
    member?.['Membership number'],
    member?.['Company Name'],
    member?.['Address Home'],
    member?.['Address Office'],
    member?.['Resident Landline'],
    member?.['Office Landline'],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
};

const fetchTrustDirectoryMembers = async (trustId) => {
  if (!trustId) return [];

  const selectClause = `
    id,
    trust_id,
    role,
    joined_date,
    is_active,
    members_id,
    "Membership number",
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
  `;

  const batchSize = 1000;
  let from = 0;
  let hasMore = true;
  let allMembers = [];

  while (hasMore) {
    const query = supabase
      .from('reg_members')
      .select(selectClause)
      .eq('trust_id', trustId)
      .or('is_active.is.null,is_active.eq.true');

    const { data, error } = await query
      .order('joined_date', { ascending: false })
      .range(from, from + batchSize - 1);

    if (error) throw error;

    allMembers = [...allMembers, ...(data || []).map(mapDirectoryMemberRow)];

    if (!data || data.length < batchSize) {
      hasMore = false;
    } else {
      from += batchSize;
    }
  }

  return mergeUniqueMembers(allMembers);
};

const resolveMemberIdFieldOptions = (field) => {
  if (!field) return [];
  return [field];
};

const fetchMembersByIdChunks = async (field, values, tableName = 'Members') => {
  const chunkSize = 100;
  const fieldOptions = resolveMemberIdFieldOptions(field);
  let lastError = null;

  for (const fieldOption of fieldOptions) {
    try {
      let allData = [];
      for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        try {
          const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .in(fieldOption, chunk)
            .order('Name', { ascending: true });
          if (error) throw error;
          allData = [...allData, ...(data || [])];
        } catch (chunkError) {
          // Retry large IN queries with smaller slices to avoid URL/query-size failures.
          const retrySize = 25;
          for (let j = 0; j < chunk.length; j += retrySize) {
            const miniChunk = chunk.slice(j, j + retrySize);
            const { data: miniData, error: miniError } = await supabase
              .from(tableName)
              .select('*')
              .in(fieldOption, miniChunk)
              .order('Name', { ascending: true });
            if (miniError) throw miniError;
            allData = [...allData, ...(miniData || [])];
          }
          console.warn(`Retried oversized chunk for ${tableName}.${fieldOption} with smaller batches`);
          if (String(chunkError?.message || '').toLowerCase().includes('fetch failed')) {
            // Keep processing; miniChunk retries already succeeded.
          }
        }
      }
      return allData;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const getTrustNameById = async (trustId) => {
  if (!trustId) return null;
  const { data, error } = await supabase
    .from('Trust')
    .select('name')
    .eq('id', trustId)
    .limit(1);

  if (error) {
    console.error('Error fetching trust name:', error);
    throw error;
  }

  if (Array.isArray(data)) {
    return data[0]?.name || null;
  }
  return data?.name || null;
};

export const getTrustIdByName = async (trustName) => {
  const cleanedName = String(trustName || '').trim();
  if (!cleanedName) return null;

  const { data, error } = await supabase
    .from('Trust')
    .select('id')
    .ilike('name', cleanedName)
    .limit(1);

  if (error) {
    console.error('Error fetching trust id by name:', error);
    throw error;
  }

  if (Array.isArray(data)) {
    return data[0]?.id || null;
  }
  return data?.id || null;
};

/**
 * Get all members by type
 */
export const getMembersByType = async (type, trustId = null) => {
  try {
    if (trustId) {
      const trustedMembers = await getAllMembers(trustId);
      const filtered = (trustedMembers || []).filter((member) => member?.type === type);

      if (['trustee', 'patron'].includes(String(type || '').toLowerCase().trim())) {
        const normalizedType = String(type || '').toLowerCase().trim();
        return filtered.filter((member) => {
          const roleLower = String(member?.role || member?.type || '').toLowerCase().trim();
          return roleLower.includes(normalizedType);
        });
      }
      return filtered;
    }

    // Fetch all records of this type using batch fetching
    let allData = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('Members')
        .select('*')
        .eq('type', type);

      const { data, error } = await query
        .order('Name', { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) throw error;
      
      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }
    
    return allData;
  } catch (error) {
    console.error(`Error fetching ${type} members:`, error);
    throw error;
  }
};

/**
 * Search members for the directory
 */
export const searchMembers = async (searchQuery, type = null, trustId = null) => {
  try {
    if (trustId) {
      const trustedMembers = await fetchTrustDirectoryMembers(trustId);
      const filtered = (trustedMembers || []).filter((member) => matchesDirectoryMember(member, searchQuery, type));
      return [...filtered].sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
    }

    let query = supabase
      .from('Members')
      .select('*');

    const normalizedType = normalizeSearchText(type);
    if (normalizedType && normalizedType !== 'all') {
      query = query.or(`role.ilike.%${normalizedType}%,type.ilike.%${normalizedType}%`);
    }

    const normalizedQuery = normalizeSearchText(searchQuery);
    if (normalizedQuery) {
      query = query.or(
        `Name.ilike.%${normalizedQuery}%,` +
        `"Company Name".ilike.%${normalizedQuery}%,` +
        `Mobile.ilike.%${normalizedQuery}%,` +
        `Email.ilike.%${normalizedQuery}%,` +
        `"Membership number".ilike.%${normalizedQuery}%,` +
        `role.ilike.%${normalizedQuery}%,` +
        `type.ilike.%${normalizedQuery}%`
      );
    }

    query = query.order('Name', { ascending: true });

    const { data, error } = await query;

    if (error) throw error;

    return (data || []).filter((member) => matchesDirectoryMember(member, searchQuery, type));
  } catch (error) {
    console.error('Error searching members:', error);
    throw error;
  }
};

/**
 * Get member by ID
 */
export const getMemberById = async (id) => {
  try {
    const { data, error } = await supabase
      .from('Members')
      .select('*')
      .eq('S.No.', id)
      .single();

    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('Error fetching member by ID:', error);
    throw error;
  }
};

/**
 * Get all unique member types
 */
export const getMemberTypes = async (trustId = null) => {
  try {
    if (trustId) {
      const trustedMembers = await getAllMembers(trustId);
      const uniqueTypes = [...new Set((trustedMembers || [])
        .map((item) => item?.type)
        .filter(Boolean))];
      return uniqueTypes;
    }

    const trustMeta = await getTrustMembershipMeta(trustId);

    // Fetch all records to get all types (using batch fetching)
    let allData = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from('Members')
        .select('type')
        .not('type', 'is', null);

      if (trustId) {
        query = applyMemberScopeFilter(query, trustMeta);
      }

      const { data, error } = await query.range(from, from + batchSize - 1);

      if (error) throw error;
      
      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }
    
    const uniqueTypes = [...new Set(allData.map(item => item.type))];
    return uniqueTypes;
  } catch (error) {
    console.error('Error fetching member types:', error);
    throw error;
  }
};

/**
 * Get all members (for admin)
 */
export const getAllMembers = async (trustId = null) => {
  try {
    const trustMeta = await getTrustMembershipMeta(trustId);
    console.log('Fetching all members from Supabase...');
    console.log('Table name: "Members"');

    if (trustId) {
      if (!hasTrustMembershipScope(trustMeta)) {
        return [];
      }
      const idScope = getTrustMemberIdList(trustMeta, false);
      const membershipScope = getTrustMemberIdList(trustMeta, true);

      const byId = idScope.field && idScope.values.length
        ? await fetchMembersByIdChunks(idScope.field, idScope.values, 'Members')
        : [];
      const byMembership = membershipScope.field && membershipScope.values.length
        ? await fetchMembersByIdChunks(membershipScope.field, membershipScope.values, 'Members')
        : [];

      const membersData = mergeUniqueMembers([...(byId || []), ...(byMembership || [])]);
      const enriched = enrichWithMembershipData(membersData, trustMeta);
      const sorted = [...enriched].sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
      return sorted;
    }

    let allData = [];
    let from = 0;
    const batchSize = 50; // Reduced from 1000 to reduce load
    let hasMore = true;
    let error = null;

    // Fetch data in batches to get all records (Supabase has 1000 row limit by default)
    while (hasMore) {
      let query = supabase
        .from('Members')
        .select('*');

      let { data, error: batchError } = await query
        .order('Name', { ascending: true })
        .range(from, from + batchSize - 1);

      if (batchError) {
        console.error('Supabase error:', batchError);
        console.error('Error code:', batchError.code);
        console.error('Error message:', batchError.message);
        error = batchError;
        break;
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data];
        console.log(`Fetched batch: ${data.length} members (Total so far: ${allData.length})`);
        
        // If we got less than batchSize, we've reached the end
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    if (error) {
      console.error('Error details:', error.details);
      console.error('Error hint:', error.hint);
      throw error;
    }
    
    console.log(`✅ Total fetched: ${allData.length} members from Members Table`);
    
    const includeExtras = !trustId;

    // Now fetch doctors from opd_schedule table
    let doctorsData = [];
    if (includeExtras) {
      try {
        console.log('Fetching doctors from opd_schedule table...');
      
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;
      
      // Fetch data in batches to get all doctor records
      console.log('Attempting to fetch from opd_schedule table (getAllDoctors function)...');
      // First, let's check if the table exists by trying a simple count
      const { count: count2, error: countError2 } = await supabase
        .from('opd_schedule')
        .select('*', { count: 'exact', head: true });
          
      if (countError2) {
        console.error('Error checking opd_schedule table in getAllDoctors:', countError2);
        console.log('Trying alternative table name or checking if table exists in getAllDoctors...');
            
        // Try to list all tables to see what's available
        const { data: _tableData2, error: tableError2 } = await supabase.rpc('information_schema.tables');
        if (tableError2) {
          console.log('Could not list tables in getAllDoctors, proceeding with original query...');
        }
      } else {
        console.log(`opd_schedule table exists with ${count2} records in getAllDoctors (before filtering for active)`);
      }
          
      while (hasMore) {
        let { data, error, status } = await supabase
          .from('opd_schedule')
          .select('*')
          .eq('is_active', true) // Only fetch active doctors
          .order('consultant_name', { ascending: true })
          .range(from, from + batchSize - 1);
            
        console.log(`Supabase response status: ${status}`);
        if (error) {
          console.error('Supabase error details:', error);
          console.error('Supabase error code:', error.code);
          console.error('Supabase error message:', error.message);
          throw error;
        }

        if (error) {
          console.error('Error fetching doctors:', error);
          break;
        }

        if (data && data.length > 0) {
          // Transform doctor data to match the members table structure
          const transformedDoctors = data.map(doctor => ({
            'S. No.': `DOC${doctor.id}`,
            'Name': doctor.consultant_name,
            'Company Name': doctor.department,
            'Mobile': doctor.mobile,
            'Email': null, // No email in opd_schedule
            'type': 'Doctor',
            'specialization': doctor.designation,
            'qualification': doctor.qualification,
            'unit': doctor.unit,
            'senior_junior': doctor.senior_junior,
            'general_opd_days': doctor.general_opd_days,
            'private_opd_days': doctor.private_opd_days,
            'effective_from': doctor.effective_from,
            'notes': doctor.notes,
            'is_active': doctor.is_active,
            'created_at': doctor.created_at,
            'updated_at': doctor.updated_at,
            // Include original opd_schedule fields for reference
            'original_id': doctor.id,
            'department': doctor.department,
            'designation': doctor.designation,
            'consultant_name': doctor.consultant_name,
          }));
          
          doctorsData = [...doctorsData, ...transformedDoctors];
          console.log(`Fetched batch: ${data.length} doctors (Total so far: ${doctorsData.length})`);
          
          // If we got less than batchSize, we've reached the end
          if (data.length < batchSize) {
            hasMore = false;
          } else {
            from += batchSize;
          }
        } else {
          hasMore = false;
        }
      }
      
        console.log(`✅ Total fetched: ${doctorsData.length} doctors from opd_schedule table`);
      } catch (error) {
        console.error('Error fetching doctors from opd_schedule:', error);
      }
    }
    
    // Fetch committee members data
    let committeeData = [];
    if (includeExtras) {
      try {
        console.log('Fetching committee members from committee_members table...');
      
      let fromCommittee = 0;
      const batchSizeCommittee = 1000;
      let hasMoreCommittee = true;
      
      // Fetch data in batches to get all committee members
      while (hasMoreCommittee) {
        let { data, error } = await supabase
          .from('committee_members')
          .select('*')
          .order('member_name_english', { ascending: true })
          .range(fromCommittee, fromCommittee + batchSizeCommittee - 1);

        if (error) {
          console.error('Error fetching committee members:', error);
          throw error;
        }

        if (data && data.length > 0) {
          // Transform committee data to match the members table structure
          const transformedCommittee = data.map(committee => ({
            'S. No.': `CM${committee.id}`,
            'Name': committee.member_name_english,
            'Company Name': committee.committee_name_hindi,
            'Mobile': null, // No mobile in committee_members
            'Email': null, // No email in committee_members
            'type': committee.member_role,
            'priority': committee.priority ?? null,
            'committee_name_hindi': committee.committee_name_hindi,
            'member_name_english': committee.member_name_english,
            'member_role': committee.member_role,
            'created_at': committee.created_at,
            'updated_at': committee.updated_at,
            // Include original committee fields for reference
            'original_id': committee.id,
            'is_committee_member': true
          }));
          
          committeeData = [...committeeData, ...transformedCommittee];
          console.log(`Fetched batch: ${data.length} committee members (Total so far: ${committeeData.length})`);
          
          // If we got less than batchSize, we've reached the end
          if (data.length < batchSizeCommittee) {
            hasMoreCommittee = false;
          } else {
            fromCommittee += batchSizeCommittee;
          }
        } else {
          hasMoreCommittee = false;
        }
      }
      
        console.log(`✅ Total fetched: ${committeeData.length} committee members from committee_members table`);
      } catch (error) {
        console.error('Error fetching committee members:', error);
      }
    }
    
    if (committeeData.length > 0) {
      committeeData = [...committeeData].sort(comparePriorityThenName);
    }

    // Combine members, doctors, and committee data
    const combinedData = includeExtras
      ? [...allData, ...doctorsData, ...committeeData]
      : allData;
    console.log(`✅ Combined total: ${combinedData.length} records (Members: ${allData.length}, Doctors: ${doctorsData.length}, Committee: ${committeeData.length})`);
    
    return combinedData;
  } catch (error) {
    console.error('Error fetching all members:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};

/**
 * Get members page (pagination) from Members Table only
 * Returns { data: [...], count: totalCount }
 */
export const getMembersPage = async (page = 1, limit = 100, trustId = null) => {
  try {
    const trustMeta = await getTrustMembershipMeta(trustId);
    const p = Math.max(1, Number(page) || 1);
    const l = Math.max(1, Number(limit) || 100);
    const from = (p - 1) * l;
    const to = from + l - 1;

    if (trustId) {
      if (!hasTrustMembershipScope(trustMeta)) {
        return { data: [], count: 0 };
      }
      const trustedMembers = await getAllMembers(trustId);
      const sortedTrustedMembers = [...(trustedMembers || [])]
        .sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
      return {
        data: sortedTrustedMembers.slice(from, to + 1),
        count: sortedTrustedMembers.length
      };
    }

    // Get total count (head request)
    const { count, error: countErr } = await supabase
      .from('Members')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      console.warn('Could not get total count for Members:', countErr);
    }

    const { data, error } = await supabase
      .from('Members')
      .select('*')
      .order('Name', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Error fetching members page:', error);
      throw error;
    }

    return { data: data || [], count: Number(count) || (data ? data.length : 0) };
  } catch (error) {
    console.error('Error in getMembersPage:', error);
    throw error;
  }
};

/**
 * Get a small preview/sample of members (limited) to speed up initial loads
 */
export const getMembersPreview = async (limit = 100, trustId = null) => {
  try {
    const trustMeta = await getTrustMembershipMeta(trustId);
    if (trustId && !hasTrustMembershipScope(trustMeta)) {
      return [];
    }

    const l = Number(limit) || 100;
    // Fetch first `l` members from Members table
    let membersData = [];
    let membersError = null;

    if (trustId) {
      const trustedMembers = await getAllMembers(trustId);
      membersData = (trustedMembers || []).slice(0, l);
    } else {
      const result = await supabase
        .from('Members')
        .select('*')
        .order('Name', { ascending: true })
        .range(0, l - 1);
      membersData = result.data;
      membersError = result.error;
    }

    if (membersError) {
      console.error('Error fetching members preview:', membersError);
      throw membersError;
    }

    const includeExtras = !trustId;

    // Fetch first `l` doctors
    let doctorsData = [];
    if (includeExtras) {
      try {
        const { data: ddata, error: derror } = await supabase
          .from('opd_schedule')
          .select('*')
          .eq('is_active', true)
          .order('consultant_name', { ascending: true })
          .range(0, l - 1);
        if (derror) {
          console.warn('Could not fetch doctors preview:', derror);
        } else if (ddata) {
          doctorsData = ddata.map(doctor => ({
            'S. No.': `DOC${doctor.id}`,
            'Name': doctor.consultant_name,
            'Company Name': doctor.department,
            'Mobile': doctor.mobile,
            'Email': null,
            'type': 'Doctor',
            'specialization': doctor.designation,
            'original_id': doctor.id,
            'consultant_name': doctor.consultant_name
          }));
        }
      } catch (e) {
        console.warn('Error fetching doctors preview inner:', e);
      }
    }

    // Fetch first `l` committee members
    let committeeData = [];
    if (includeExtras) {
      try {
        const { data: cdata, error: cerror } = await supabase
          .from('committee_members')
          .select('*')
          .order('member_name_english', { ascending: true })
          .range(0, l - 1);
        if (cerror) {
          console.warn('Could not fetch committee preview:', cerror);
        } else if (cdata) {
          committeeData = cdata.map(committee => ({
            'S. No.': `CM${committee.id}`,
            'Name': committee.member_name_english,
            'Company Name': committee.committee_name_english || committee.committee_name_hindi,
            'Mobile': null,
            'Email': null,
            'type': committee.member_role,
            'committee_name_hindi': committee.committee_name_hindi,
            'committee_name_english': committee.committee_name_english,
            'original_id': committee.id
          }));
        }
      } catch (e) {
        console.warn('Error fetching committee preview inner:', e);
      }
    }

    // Fetch first `l` hospitals
    let hospitalsData = [];
    if (includeExtras) {
      try {
        const { data: hdata, error: herror } = await supabase
          .from('hospitals')
          .select('*')
          .eq('is_active', true)
          .order('hospital_name', { ascending: true })
          .range(0, l - 1);
        if (herror) {
          console.warn('Could not fetch hospitals preview:', herror);
        } else if (hdata) {
          hospitalsData = hdata.map(hospital => ({
            'S. No.': `HOSP${hospital.id}`,
            'Name': hospital.hospital_name,
            'Company Name': hospital.trust_name,
            'Mobile': hospital.contact_phone,
            'Email': hospital.contact_email,
            'type': 'Hospital',
            'hospital_name': hospital.hospital_name,
            'trust_name': hospital.trust_name,
            'hospital_type': hospital.hospital_type,
            'address': hospital.address,
            'city': hospital.city,
            'original_id': hospital.id
          }));
        }
      } catch (e) {
        console.warn('Error fetching hospitals preview inner:', e);
      }
    }

    const combined = includeExtras
      ? [ ...(membersData || []), ...doctorsData, ...committeeData, ...hospitalsData ]
      : (membersData || []);
    return combined;
  } catch (error) {
    console.error('Error in getMembersPreview:', error);
    throw error;
  }
};

/**
 * Get all doctors from opd_schedule
 */
export const getAllDoctors = async (trustId = null, trustName = null) => {
  try {
    console.log('Fetching doctors from reg_members + employee_details + opd_schedule...', { trustId, trustName });

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

    let allData = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
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

      const { data, error } = await query
        .order('id', { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Error fetching doctors:', error);
        return [];
      }

      if (data && data.length > 0) {
        const transformedDoctors = data
          .map((row) => {
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

            return {
              id: row.id,
              reg_id: row.id,
              'S. No.': member?.['S.No.'] ?? member?.['S. No.'] ?? `DOC${row.id}`,
              'Name': member?.Name || null,
              'Company Name': member?.['Company Name'] || null,
              'Mobile': member?.Mobile || null,
              'Email': member?.Email || null,
              'type': row.role || 'Doctor',
              'role': row.role || 'Doctor',
              'Membership number': row['Membership number'] || null,
              designation: details.designation || null,
              qualification: details.qualification || null,
              experience_years: details.experience_years || null,
              doctor_image_url: details.doctor_image_url || null,
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
              consultation_fee: general.fee || privateOpd.fee || null,
              // Include original refs for debug
              original_id: member?.['S.No.'] ?? member?.['S. No.'] ?? null,
              members_id: row.members_id || member?.members_id || null,
              trust_id: row.trust_id || null
            };
          })
          .filter(Boolean);

        allData = [...allData, ...transformedDoctors];
        console.log(`Fetched batch: ${data.length} doctors (Total so far: ${allData.length})`);

        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    const sorted = allData.sort((a, b) => String(a?.Name || '').localeCompare(String(b?.Name || '')));
    console.log(`✅ Total fetched: ${sorted.length} doctors from reg_members + employee_details + opd_schedule`);
    return sorted;
  } catch (error) {
    console.error('Error fetching doctors from reg_members/employee_details/opd_schedule:', error);
    throw error;
  }
};

/**
 * Get all committee members
 */
export const getAllCommitteeMembers = async (trustId = null) => {
  const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
  const getPhoneVariants = (value) => {
    const digits = normalizePhone(value);
    if (!digits) return [];
    const variants = new Set([digits]);
    if (digits.length > 10) variants.add(digits.slice(-10));
    if (digits.length === 10) {
      variants.add(`91${digits}`);
      variants.add(`+91${digits}`);
      variants.add(`+${digits}`);
    }
    return [...variants];
  };

  const fallbackFromMemberRoles = async () => {
    console.log('Fallback: committee members via member_roles join...', { trustId });
    if (!trustId) return [];

    const batchSize = 1000;
    let from = 0;
    let hasMore = true;
    let roleRows = [];

    while (hasMore) {
      const { data, error } = await supabase
        .from('member_roles')
        .select('reg_id, role_type, title, subtitle, priority, privacy, created_at, reg_members!inner(id, trust_id, members_id, "Membership number", is_active)')
        .eq('role_type', 'committee')
        .eq('reg_members.trust_id', trustId)
        .or('is_active.is.null,is_active.eq.true', { foreignTable: 'reg_members' })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Error fetching member_roles (committee):', error);
        return [];
      }

      if (data && data.length > 0) {
        roleRows = [...roleRows, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    if (roleRows.length === 0) return [];

    const memberIds = [...new Set(roleRows
      .map(r => r?.reg_members?.members_id)
      .filter(Boolean))];
    if (memberIds.length === 0) return [];

    const members = await fetchMembersByIdChunks('members_id', memberIds, 'Members');
    const memberMap = new Map();
    (members || []).forEach(m => {
      if (m?.members_id) memberMap.set(String(m.members_id), m);
    });

    const result = roleRows.map(r => {
      const reg = r.reg_members || {};
      const m = reg.members_id ? (memberMap.get(String(reg.members_id)) || {}) : {};
      const committeeName = r.title || r.subtitle || 'Committee';
      return {
        ...m,
        'Membership number': m?.['Membership number'] || reg?.['Membership number'] || null,
        'Company Name': m?.['Company Name'] || committeeName,
        'trust_id': reg.trust_id,
        'reg_id': reg.id,
        'role_type': 'committee',
        'title': r.title || null,
        'subtitle': r.subtitle || null,
        'priority': r.priority ?? null,
        'privacy': r.privacy ?? null,
        'committee_name_english': r.title || committeeName,
        'committee_name_hindi': r.subtitle || r.title || committeeName,
        'created_at': r.created_at || m?.created_at || null,
        'is_committee_member': true
      };
    });

    const sorted = [...result].sort(comparePriorityThenMembershipThenName);
    console.log(`✅ Total fetched: ${sorted.length} committee members (fallback)`);
    return sorted;
  };

  try {
    console.log('Fetching committee members from committee_members + Members...', { trustId });

    const batchSize = 1000;
    let from = 0;
    let hasMore = true;
    let committeeRows = [];

    while (hasMore) {
      let query = supabase
        .from('committee_members')
        .select('*')
        .order('member_name_english', { ascending: true })
        .range(from, from + batchSize - 1);

      if (trustId) {
        query = query.eq('trust_id', trustId);
      }

      let data = null;
      let error = null;
      ({ data, error } = await query);

      if (error && trustId && String(error.message || '').includes('trust_id')) {
        // trust_id column missing — retry without trust filter
        ({ data, error } = await supabase
          .from('committee_members')
          .select('*')
          .order('member_name_english', { ascending: true })
          .range(from, from + batchSize - 1));
      }

      if (error) {
        console.error('Error fetching committee_members:', error);
        return fallbackFromMemberRoles();
      }

      if (data && data.length > 0) {
        committeeRows = [...committeeRows, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    if (committeeRows.length === 0) {
      return fallbackFromMemberRoles();
    }

    const phoneVariants = new Set();
    const nameSet = new Set();
    committeeRows.forEach((c) => {
      (getPhoneVariants(c.phone1) || []).forEach(v => phoneVariants.add(v));
      (getPhoneVariants(c.phone2) || []).forEach(v => phoneVariants.add(v));
      if (c.member_name_english) nameSet.add(String(c.member_name_english).trim());
    });

    let membersByMobile = new Map();
    if (phoneVariants.size > 0) {
      const mobiles = [...phoneVariants];
      const membersByPhone = await fetchMembersByIdChunks('Mobile', mobiles, 'Members');
      (membersByPhone || []).forEach((m) => {
        const norm = normalizePhone(m?.Mobile);
        if (norm) membersByMobile.set(norm, m);
      });
    }

    let membersByName = new Map();
    if (nameSet.size > 0) {
      const names = [...nameSet];
      const membersByNameRows = await fetchMembersByIdChunks('Name', names, 'Members');
      (membersByNameRows || []).forEach((m) => {
        const key = String(m?.Name || '').trim().toLowerCase();
        if (key) membersByName.set(key, m);
      });
    }

    const result = committeeRows.map((committee) => {
      const phoneMatches = [...getPhoneVariants(committee.phone1), ...getPhoneVariants(committee.phone2)];
      let member = null;
      for (const p of phoneMatches) {
        const hit = membersByMobile.get(p);
        if (hit) {
          member = hit;
          break;
        }
      }

      if (!member && committee.member_name_english) {
        member = membersByName.get(String(committee.member_name_english).trim().toLowerCase()) || null;
      }

      const committeeName = committee.committee_name_english || committee.committee_name_hindi || 'Committee';
      return {
        ...(member || {}),
        'S. No.': member?.['S.No.'] ?? member?.['S. No.'] ?? `CM${committee.id}`,
        'Name': member?.Name || committee.member_name_english || committee.member_name_hindi || 'N/A',
        'Mobile': member?.Mobile || committee.phone1 || committee.phone2 || null,
        'Email': member?.Email || null,
        'Address Home': member?.['Address Home'] || null,
        'Company Name': member?.['Company Name'] || committeeName,
        'Address Office': member?.['Address Office'] || null,
        'Resident Landline': member?.['Resident Landline'] || null,
        'Office Landline': member?.['Office Landline'] || null,
        'type': committee.member_role || member?.type || 'Committee',
        'priority': committee.priority ?? null,
        'committee_name_hindi': committee.committee_name_hindi || null,
        'committee_name_english': committee.committee_name_english || null,
        'member_name_english': committee.member_name_english || null,
        'member_name_hindi': committee.member_name_hindi || null,
        'member_role': committee.member_role || null,
        'phone1': committee.phone1 || null,
        'phone2': committee.phone2 || null,
        'address': committee.address || null,
        'created_at': committee.created_at || null,
        'updated_at': committee.updated_at || null,
        'trust_id': committee.trust_id || trustId || null,
        'original_id': committee.id,
        'is_committee_member': true
      };
    });

    const sorted = [...result].sort(comparePriorityThenName);
    console.log(`✅ Total fetched: ${sorted.length} committee members (merged with Members)`);
    return sorted;
  } catch (error) {
    console.error('Error fetching committee members from committee_members:', error);
    return fallbackFromMemberRoles();
  }
};

/**
 * Get all hospitals from hospitals table
 */
export const getAllHospitals = async (trustId = null, trustNameParam = null) => {
  try {
    console.log('Fetching all hospitals from hospitals table...');
    const trustName = trustNameParam || (trustId ? await getTrustNameById(trustId) : null);
    if (trustId && !trustName) {
      return [];
    }
    
    let allData = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    // Fetch data in batches to get all hospital records
    while (hasMore) {
      let query = supabase
        .from('hospitals')
        .select('*')
        .eq('is_active', true); // Only fetch active hospitals

      if (trustName) {
        query = query.eq('trust_name', trustName);
      }

      let { data, error } = await query
        .order('hospital_name', { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Error fetching hospitals:', error);
        throw error;
      }

      if (data && data.length > 0) {
        // Transform hospital data to match the expected structure
        const transformedHospitals = data.map(hospital => ({
          'S. No.': `HOSP${hospital.id}`,
          'Name': hospital.hospital_name,
          'Company Name': hospital.trust_name,
          'Mobile': hospital.contact_phone,
          'Email': hospital.contact_email,
          'type': 'Hospital',
          'hospital_name': hospital.hospital_name,
          'trust_name': hospital.trust_name,
          'hospital_type': hospital.hospital_type,
          'address': hospital.address,
          'city': hospital.city,
          'state': hospital.state,
          'pincode': hospital.pincode,
          'established_year': hospital.established_year,
          'bed_strength': hospital.bed_strength,
          'accreditation': hospital.accreditation,
          'facilities': hospital.facilities,
          'departments': hospital.departments,
          'contact_phone': hospital.contact_phone,
          'contact_email': hospital.contact_email,
          'is_active': hospital.is_active,
          'created_at': hospital.created_at,
          // Include original hospital fields for reference
          'original_id': hospital.id,
          'is_hospital': true
        }));
        
        allData = [...allData, ...transformedHospitals];
        console.log(`Fetched batch: ${data.length} hospitals (Total so far: ${allData.length})`);
        
        // If we got less than batchSize, we've reached the end
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`✅ Total fetched: ${allData.length} hospitals from hospitals table`);
    return allData;
  } catch (error) {
    console.error('Error fetching hospitals from hospitals table:', error);
    throw error;
  }
};

/**
 * Get all elected members from elected_members table and join with members table.
 * Schema: elected_members(id uuid, trust_id uuid, person_id uuid, position, ward_area, is_active)
 * Join:   person_id → Members Table.person_id
 */
export const getAllElectedMembers = async (trustId = null) => {
  try {
    console.log('Fetching elected members via member_roles join...', { trustId });
    if (!trustId) return [];

    const batchSize = 1000;
    let from = 0;
    let hasMore = true;
    let roleRows = [];

    while (hasMore) {
      const { data, error } = await supabase
        .from('member_roles')
        .select('reg_id, role_type, title, subtitle, priority, created_at, reg_members!inner(id, trust_id, members_id, "Membership number", is_active)')
        .eq('role_type', 'elected')
        .eq('reg_members.trust_id', trustId)
        .or('is_active.is.null,is_active.eq.true', { foreignTable: 'reg_members' })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error('Error fetching member_roles (elected):', error);
        return [];
      }

      if (data && data.length > 0) {
        roleRows = [...roleRows, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    if (roleRows.length === 0) return [];

    const memberIds = [...new Set(roleRows
      .map(r => r?.reg_members?.members_id)
      .filter(Boolean))];
    if (memberIds.length === 0) return [];

    const members = await fetchMembersByIdChunks('members_id', memberIds, 'Members');
    const memberMap = new Map();
    (members || []).forEach(m => {
      if (m?.members_id) memberMap.set(String(m.members_id), m);
    });

    const result = roleRows.map(r => {
      const reg = r.reg_members || {};
      const m = reg.members_id ? (memberMap.get(String(reg.members_id)) || {}) : {};
      return {
        ...m,
        'Membership number': m?.['Membership number'] || reg?.['Membership number'] || null,
        'trust_id': reg.trust_id,
        'reg_id': reg.id,
        'role_type': 'elected',
        'title': r.title || null,
        'subtitle': r.subtitle || null,
        'priority': r.priority ?? null,
        'created_at': r.created_at || m?.created_at || null,
        'is_elected_member': true
      };
    });

    const sorted = [...result].sort(comparePriorityThenMembershipThenName);
    console.log(`✅ Total fetched: ${sorted.length} elected members (trust filtered)`);
    return sorted;
  } catch (error) {
    console.error('Error in getAllElectedMembers:', error);
    throw error;
  }
};

/**
 * Get member trust links for a specific member
 * Returns all trusts a member is linked to
 */
export const getMemberTrustLinks = async (memberId) => {
  try {
    if (!memberId) {
      throw new Error('memberId is required');
    }

    const { data: links, error: linksError } = await supabase
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
      .or('is_active.is.null,is_active.eq.true')
      .order('joined_date', { ascending: false, nullsFirst: false });

    if (linksError) {
      console.error('Error fetching member trust links:', linksError);
      throw linksError;
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

    console.log(`Total fetched: ${mapped.length} trusts for member ${memberId}`);
    return mapped;
  } catch (error) {
    console.error('Error in getMemberTrustLinks:', error);
    throw error;
  }
};
