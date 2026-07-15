import { supabase } from './supabaseClient';

const normalizeText = (value) => String(value || '').trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_RE.test(normalizeText(value));
const TRUST_FULL_SELECT = 'id,name,icon_url,remark,legal_name,terms_content,privacy_content,template_id,created_at,version';
const TRUST_BASIC_SELECT = 'id,name,icon_url,remark,created_at,version';

const runTrustQueryWithFallback = async (buildQuery) => {
  const fullResult = await buildQuery(TRUST_FULL_SELECT);
  if (!fullResult?.error) return fullResult;

  const message = [
    fullResult.error?.message,
    fullResult.error?.details,
    fullResult.error?.hint,
    fullResult.error?.code
  ].filter(Boolean).join(' ');

  const canRetryBasic = /schema cache/i.test(message)
    || /does not exist/i.test(message)
    || ['PGRST200', 'PGRST202', 'PGRST204'].includes(fullResult.error?.code);

  return canRetryBasic ? buildQuery(TRUST_BASIC_SELECT) : fullResult;
};

export const fetchMemberTrusts = async (membersId) => {
  const normalizedMemberId = normalizeText(membersId);
  if (!normalizedMemberId) return [];

  const regQuery = supabase
    .from('reg_members')
    .select('id, trust_id, "Membership number", role, joined_date, is_active, members_id');

  const { data: regMembershipsRaw, error: regError } = isUuid(normalizedMemberId)
    ? await regQuery.eq('members_id', normalizedMemberId)
    : await regQuery.eq('Membership number', normalizedMemberId);

  if (regError) {
    console.warn('Error fetching from reg_members:', regError);
  }

  const regMemberships = Array.isArray(regMembershipsRaw) ? regMembershipsRaw : [];

  const trustIds = Array.from(new Set(regMemberships.map((m) => m.trust_id).filter(Boolean)));

  if (trustIds.length === 0) return [];

  // Fetch trust details for all trust IDs
  const { data: trusts, error: trustError } = await supabase
    .from('Trust')
    .select('id,name,icon_url,remark,created_at,version')
    .in('id', trustIds);

  if (trustError) {
    console.warn('Error fetching trust details:', trustError);
  }

  const trustById = (trusts || []).reduce((acc, t) => {
    acc[t.id] = t;
    return acc;
  }, {});

  const mappedTrusts = regMemberships.map((m) => {
    const t = trustById[m.trust_id] || {};
    return {
      id: m.trust_id || null,
      name: t.name || null,
      icon_url: t.icon_url || null,
      remark: t.remark || null,
      is_active: m.is_active,
      membership_number: m['Membership number'] || null,
      role: m.role || null,
      members_id: m.members_id || null,
      source: 'reg_members'
    };
  });

  return mappedTrusts;
};

const mapMembershipRowsWithTrusts = (regMemberships = [], trustById = {}) =>
  regMemberships.map((m, index) => {
    const trustId = m?.trust_id || null;
    const trust = trustById[trustId] || {};
    return {
      id: m?.id || `membership-${index}`,
      trust_id: trustId,
      trust_name: trust?.name || null,
      trust_icon_url: trust?.icon_url || null,
      trust_remark: trust?.remark || null,
      is_active: m?.is_active,
      membership_number: m?.['Membership number'] || null,
      role: m?.role || null,
      members_id: m?.members_id || null,
      source: 'reg_members'
    };
  });

export const fetchMemberTrustMemberships = async ({ membersId = null, membershipNumber = '' } = {}) => {
  const normalizedMembersId = normalizeText(membersId);
  const normalizedMembershipNo = normalizeText(membershipNumber);

  if (!normalizedMembersId && !normalizedMembershipNo) return [];

  let regMemberships = [];

  if (isUuid(normalizedMembersId)) {
    const { data, error } = await supabase
      .from('reg_members')
      .select('id, trust_id, "Membership number", role, joined_date, is_active, members_id')
      .eq('members_id', normalizedMembersId);

    if (error) {
      console.warn('Error fetching member trusts by members_id:', error);
    } else if (Array.isArray(data)) {
      regMemberships = [...data];
    }
  }

  const membershipLookupValue = normalizedMembershipNo || (!isUuid(normalizedMembersId) ? normalizedMembersId : '');
  if (membershipLookupValue) {
    let membershipNoQuery = supabase
      .from('reg_members')
      .select('id, trust_id, "Membership number", role, joined_date, is_active, members_id')
      .eq('Membership number', membershipLookupValue);

    // Critical guard:
    // If members_id is known for selected account, never pull rows of another person
    // who happens to share/reuse the same membership number across trusts.
    if (isUuid(normalizedMembersId)) {
      membershipNoQuery = membershipNoQuery.eq('members_id', normalizedMembersId);
    }

    const { data, error } = await membershipNoQuery;

    if (error) {
      console.warn('Error fetching member trusts by membership number:', error);
    } else if (Array.isArray(data) && data.length > 0) {
      const seen = new Set(regMemberships.map((row) => String(row?.id || '')));
      data.forEach((row) => {
        const key = String(row?.id || '');
        if (!seen.has(key)) {
          seen.add(key);
          regMemberships.push(row);
        }
      });
    }
  }

  const trustIds = Array.from(new Set(regMemberships.map((m) => m?.trust_id).filter(Boolean)));
  if (trustIds.length === 0) return [];

  const { data: trusts, error: trustError } = await supabase
    .from('Trust')
    .select('id,name,icon_url,remark,created_at,version')
    .in('id', trustIds);

  if (trustError) {
    console.warn('Error fetching trust details for memberships:', trustError);
  }

  const trustById = (Array.isArray(trusts) ? trusts : []).reduce((acc, trust) => {
    acc[trust.id] = trust;
    return acc;
  }, {});

  const mapped = mapMembershipRowsWithTrusts(regMemberships, trustById);

  const deduped = [];
  const dedupeSet = new Set();
  mapped.forEach((membership) => {
    const dedupeKey = [
      normalizeText(membership?.trust_id).toLowerCase(),
      normalizeText(membership?.membership_number).toLowerCase(),
      normalizeText(membership?.members_id).toLowerCase()
    ].join('|');

    if (dedupeSet.has(dedupeKey)) return;
    dedupeSet.add(dedupeKey);
    deduped.push(membership);
  });

  deduped.sort((a, b) => {
    const activeDiff = Number(Boolean(b?.is_active)) - Number(Boolean(a?.is_active));
    if (activeDiff !== 0) return activeDiff;
    return String(a?.trust_name || '').localeCompare(String(b?.trust_name || ''));
  });

  return deduped;
};

export const fetchAllTrusts = async () => {
  const { data, error } = await supabase
    .from('Trust')
    .select('id,name,icon_url,remark,template_id,created_at,version')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
};

export const fetchDefaultTrust = async (preferredTrustId) => {
  const { data, error } = await runTrustQueryWithFallback((selectClause) => {
    let query = supabase
      .from('Trust')
      .select(selectClause)
      .limit(1);

    if (preferredTrustId) {
      query = query.eq('id', preferredTrustId);
    } else {
      query = query.order('created_at', { ascending: false });
    }

    return query;
  });
  if (error) {
    throw error;
  }

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
};

export const fetchTrustByName = async (name) => {
  if (!name) return null;
  const { data, error } = await runTrustQueryWithFallback((selectClause) =>
    supabase
      .from('Trust')
      .select(selectClause)
      .eq('name', name)
      .limit(1)
  );

  if (error) {
    throw error;
  }

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
};

export const fetchTrustById = async (id) => {
  if (!id) return null;
  const { data, error } = await runTrustQueryWithFallback((selectClause) =>
    supabase
      .from('Trust')
      .select(selectClause)
      .eq('id', id)
      .limit(1)
  );

  if (error) {
    throw error;
  }

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
};

export const fetchShareAppLinksByTrustId = async (trustId) => {
  const normalizedTrustId = String(trustId || '').trim();
  if (!normalizedTrustId) return null;

  const { data, error } = await supabase
    .from('shareApp_links')
    .select('trust_id, play_store_link, app_store_link, instagram_link, facebook_link, whatsapp_link, linkedin_link, version')
    .eq('trust_id', normalizedTrustId)
    .maybeSingle();

  if (error) {
    console.warn('Error fetching share app links:', error);
    return null;
  }

  return data || null;
};

export const fetchTemplatesForTrust = async (trustId) => {
  if (!trustId) return [];

  const query = supabase
    .from('app_templates')
    .select('id, trust_id, name, template_key, updated_at')
    .eq('trust_id', trustId)
    .order('updated_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const updateTrustTemplateLink = async ({ trustId, templateId }) => {
  if (!trustId) throw new Error('trustId is required');
  if (!templateId) throw new Error('templateId is required');

  const { data, error } = await supabase
    .from('Trust')
    .update({ template_id: templateId })
    .eq('id', trustId)
    .select('id, name, template_id')
    .maybeSingle();

  if (error) throw error;
  return data || null;
};
