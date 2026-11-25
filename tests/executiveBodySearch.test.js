import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExecutiveBodyCommitteeSearchResults,
  getExecutiveBodySearchFields,
  getExecutiveBodySearchRank,
} from '../src/features/directory-executivebody/executiveBodySearch.js';

test('elected search matches member values instead of field getter source', () => {
  const member = {
    Name: 'Asha Mehta',
    member_role: 'President',
    Mobile: '9998887777',
    'Membership number': 'MMPB-42',
  };

  const fields = getExecutiveBodySearchFields(member, 'elected');

  assert.equal(fields.includes('Asha Mehta'), true);
  assert.equal(getExecutiveBodySearchRank(member, 'asha', 'elected'), 0);
  assert.equal(getExecutiveBodySearchRank(member, 'president', 'elected') < fields.length, true);
  assert.equal(getExecutiveBodySearchRank(member, 'item', 'elected'), fields.length);
});

test('committee search matches committee names and nested member values', () => {
  const committee = {
    Name: 'Education Committee',
    committee_name_english: 'Education Committee',
    committee_members: [
      {
        Name: 'Rahul Shah',
        member_role: 'Coordinator',
        Mobile: '8887776666',
      },
    ],
  };

  const fields = getExecutiveBodySearchFields(committee, 'committee');

  assert.equal(getExecutiveBodySearchRank(committee, 'education', 'committee') < fields.length, true);
  assert.equal(getExecutiveBodySearchRank(committee, 'rahul', 'committee') < fields.length, true);
  assert.equal(getExecutiveBodySearchRank(committee, 'coordinator', 'committee') < fields.length, true);
});

test('committee search results include direct member matches', () => {
  const results = buildExecutiveBodyCommitteeSearchResults([
    {
      id: 'education',
      Name: 'Education Committee',
      committee_name_english: 'Education Committee',
      committee_members: [
        {
          id: 'rahul',
          Name: 'Rahul Shah',
          member_role: 'Coordinator',
          Mobile: '8887776666',
          'Membership number': 'MMPB-108',
        },
      ],
    },
  ], 'rahul');

  assert.deepEqual(results.map((item) => item.result_type), ['committee-member']);
  assert.equal(results[0].item.Name, 'Rahul Shah');
  assert.equal(results[0].item.parent_committee_name, 'Education Committee');
});

test('committee name search keeps committee cards before contextual member hits', () => {
  const results = buildExecutiveBodyCommitteeSearchResults([
    {
      id: 'education',
      Name: 'Education Committee',
      committee_name_english: 'Education Committee',
      committee_members: [
        {
          id: 'rahul',
          Name: 'Rahul Shah',
          member_role: 'Coordinator',
        },
      ],
    },
  ], 'education');

  assert.deepEqual(results.map((item) => item.result_type), ['committee', 'committee-member']);
});
