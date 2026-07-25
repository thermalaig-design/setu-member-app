import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCategoryView } from '../src/utils/categoryDisplay.js';

test('categories without display metadata do not render', () => {
  const categories = [
    {
      id: 1,
      name: 'women',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [],
    },
    {
      id: 2,
      name: 'western wear',
      status: 'active',
      parent_id: 1,
      products: [],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'western wear',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 3,
      name: 'jeans',
      status: 'active',
      parent_id: 2,
      products: [{ id: 101 }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'jeans',
          order: 2,
          status: 'active',
        },
      ],
    },
    {
      id: 4,
      name: 'kids',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'kids',
          order: 3,
          status: 'active',
        },
      ],
    },
    {
      id: 5,
      name: 'handbags',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [
        {
          display_type: 'slider',
          display_name: 'handbags',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 6,
      name: 'girls',
      status: 'active',
      parent_id: 4,
      products: [{ id: 202 }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'girls',
          order: 4,
          status: 'active',
        },
      ],
    },
    {
      id: 7,
      name: 'girls',
      status: 'active',
      parent_id: 2,
      products: [{ id: 203 }],
      display_orders: [],
    },
    {
      id: 8,
      name: 'boys',
      status: 'active',
      parent_id: 4,
      products: [{ id: 204 }],
      display_orders: [],
    },
    {
      id: 9,
      name: 'hidden',
      status: 'inactive',
      parent_id: 4,
      products: [{ id: 205 }],
      display_orders: [],
    },
  ];

  const { sliderEntries, cardSections } = buildCategoryView(categories);

  assert.deepEqual(sliderEntries.map((entry) => entry.id), ['5']);
  assert.deepEqual(cardSections.map((section) => section.id), ['2', '4']);
  assert.deepEqual(
    cardSections.find((section) => section.id === '2')?.items.map((item) => item.id),
    ['3']
  );
  assert.deepEqual(
    cardSections.find((section) => section.id === '4')?.items.map((item) => item.id),
    ['6']
  );
  const renderedIds = new Set([
    ...sliderEntries.map((entry) => entry.id),
    ...cardSections.flatMap((section) => [section.id, ...section.items.map((item) => item.id)]),
  ]);
  assert.equal(renderedIds.has('1'), false);
  assert.equal(renderedIds.has('7'), false);
  assert.equal(renderedIds.has('8'), false);
  assert.equal(renderedIds.has('9'), false);
});
