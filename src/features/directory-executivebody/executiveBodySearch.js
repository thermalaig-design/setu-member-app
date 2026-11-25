const EXECUTIVE_BODY_SEARCH_FIELD_GETTERS = {
  committee: [
    (item) => item?.Name,
    (item) => item?.committee_name_english,
    (item) => item?.committee_name_hindi,
    (item) => item?.member_role,
    (item) => item?.title,
    (item) => item?.subtitle,
    (item) => item?.position,
    (item) => item?.location,
    (item) => item?.Mobile,
    (item) => item?.Email,
    (item) => item?.['Membership number'],
  ],
  member: [
    (item) => item?.Name,
    (item) => item?.member_name_english,
    (item) => item?.committee_name_english,
    (item) => item?.committee_name_hindi,
    (item) => item?.member_role,
    (item) => item?.title,
    (item) => item?.subtitle,
    (item) => item?.position,
    (item) => item?.location,
    (item) => item?.Mobile,
    (item) => item?.Email,
    (item) => item?.['Membership number'],
  ],
};

export const getExecutiveBodySearchFields = (item, tab) => {
  const getters = EXECUTIVE_BODY_SEARCH_FIELD_GETTERS[tab] || EXECUTIVE_BODY_SEARCH_FIELD_GETTERS.member;
  const fields = getters.map((getValue) => getValue(item));

  if (tab === 'committee' && Array.isArray(item?.committee_members)) {
    item.committee_members.forEach((member) => {
      fields.push(
        member?.Name,
        member?.member_name_english,
        member?.committee_name_english,
        member?.committee_name_hindi,
        member?.member_role,
        member?.title,
        member?.subtitle,
        member?.position,
        member?.location,
        member?.Mobile,
        member?.Email,
        member?.['Membership number']
      );
    });
  }

  return fields;
};

const getExecutiveBodyCommitteeSummaryFields = (committee) =>
  EXECUTIVE_BODY_SEARCH_FIELD_GETTERS.committee.map((getValue) => getValue(committee));

export const getSearchRankFromFields = (fields, query) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return fields.length;

  for (let index = 0; index < fields.length; index += 1) {
    if (String(fields[index] ?? '').toLowerCase().includes(normalizedQuery)) {
      return index;
    }
  }

  return fields.length;
};

export const getExecutiveBodySearchRank = (item, query, tab) => {
  const fields = getExecutiveBodySearchFields(item, tab);
  return getSearchRankFromFields(fields, query);
};

const getSearchResultKey = (item = {}, fallback = '') => {
  const key = (
    item?.members_id ||
    item?.reg_id ||
    item?.id ||
    item?.['Membership number'] ||
    item?.['S. No.'] ||
    fallback
  );
  return String(key || fallback).trim();
};

const withCommitteeContext = (member = {}, committee = {}) => {
  const parentCommitteeName = committee?.Name || committee?.committee_name_english || 'Committee';
  return {
    ...member,
    parent_committee_id: committee?.id || committee?.committee_name_english || committee?.Name || null,
    parent_committee_name: parentCommitteeName,
    parent_committee_name_hindi: committee?.committee_name_hindi || null,
    committee_name_english: member?.committee_name_english || committee?.committee_name_english || parentCommitteeName,
    committee_name_hindi: member?.committee_name_hindi || committee?.committee_name_hindi || null,
    role_type: member?.role_type || 'committee',
    type: member?.type || 'Committee',
  };
};

export const buildExecutiveBodyCommitteeSearchResults = (committeeGroups = [], query = '') => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const groups = Array.isArray(committeeGroups) ? committeeGroups : [];

  if (!normalizedQuery) {
    return groups.map((committee, committeeIndex) => ({
      result_type: 'committee',
      key: `committee:${getSearchResultKey(committee, committeeIndex)}`,
      item: committee,
      rank: committeeIndex,
      committeeIndex,
      memberIndex: -1,
    }));
  }

  const results = [];

  groups.forEach((committee, committeeIndex) => {
    const committeeFields = getExecutiveBodyCommitteeSummaryFields(committee);
    const committeeRank = getSearchRankFromFields(committeeFields, normalizedQuery);

    if (committeeRank < committeeFields.length) {
      results.push({
        result_type: 'committee',
        key: `committee:${getSearchResultKey(committee, committeeIndex)}`,
        item: committee,
        rank: committeeRank,
        committeeIndex,
        memberIndex: -1,
      });
    }

    const members = Array.isArray(committee?.committee_members) ? committee.committee_members : [];
    members.forEach((member, memberIndex) => {
      const item = withCommitteeContext(member, committee);
      const memberFields = getExecutiveBodySearchFields(item, 'member');
      const memberRank = getSearchRankFromFields(memberFields, normalizedQuery);

      if (memberRank >= memberFields.length) return;

      results.push({
        result_type: 'committee-member',
        key: `committee-member:${getSearchResultKey(committee, committeeIndex)}:${getSearchResultKey(item, memberIndex)}:${memberIndex}`,
        item,
        rank: memberRank,
        committeeIndex,
        memberIndex,
      });
    });
  });

  return results.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.committeeIndex !== right.committeeIndex) return left.committeeIndex - right.committeeIndex;
    if (left.result_type !== right.result_type) {
      return left.result_type === 'committee' ? -1 : 1;
    }
    return left.memberIndex - right.memberIndex;
  });
};
