import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCategoryView } from '../src/utils/categoryDisplay.js';

test('card parent renders active descendants without requiring child display metadata', () => {
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
      id: 10,
      name: 'tops',
      status: 'active',
      parent_id: 4,
      products: [{ id: 206 }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'teen tops',
          order: 1,
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
  assert.deepEqual(cardSections.map((section) => section.id), ['10', '2', '3', '4', '6']);
  assert.deepEqual(
    cardSections.find((section) => section.id === '2')?.items.map((item) => item.id),
    ['3', '7']
  );
  assert.deepEqual(
    cardSections.find((section) => section.id === '4')?.items.map((item) => item.id),
    ['6', '10', '8']
  );
  assert.deepEqual(
    cardSections.find((section) => section.id === '4')?.items.map((item) => item.label),
    ['Girls', 'Teen Tops', 'Boys']
  );
  const renderedIds = new Set([
    ...sliderEntries.map((entry) => entry.id),
    ...cardSections.flatMap((section) => [section.id, ...section.items.map((item) => item.id)]),
  ]);
  assert.equal(renderedIds.has('1'), false);
  assert.equal(renderedIds.has('7'), true);
  assert.equal(renderedIds.has('8'), true);
  assert.equal(renderedIds.has('9'), false);
  assert.equal(renderedIds.has('10'), true);
  assert.deepEqual(
    cardSections.find((section) => section.id === '10')?.items.map((item) => item.type),
    ['product']
  );
});

test('card sections with the same order sort alphabetically', () => {
  const categories = [
    {
      id: 1,
      name: 'zebra wear',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'zebra wear',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 2,
      name: 'apple wear',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'apple wear',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 3,
      name: 'zebra child',
      status: 'active',
      parent_id: 1,
      products: [{ id: 301 }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'zebra child',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 4,
      name: 'apple child',
      status: 'active',
      parent_id: 2,
      products: [{ id: 302 }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'apple child',
          order: 1,
          status: 'active',
        },
      ],
    },
  ];

  const { cardSections } = buildCategoryView(categories);

  assert.deepEqual(cardSections.map((section) => section.id), ['4', '2', '3', '1']);
  assert.deepEqual(cardSections.find((section) => section.id === '2')?.items.map((item) => item.id), ['4']);
  assert.deepEqual(cardSections.find((section) => section.id === '1')?.items.map((item) => item.id), ['3']);
  assert.deepEqual(cardSections.find((section) => section.id === '4')?.items.map((item) => item.type), ['product']);
  assert.deepEqual(cardSections.find((section) => section.id === '3')?.items.map((item) => item.type), ['product']);
});

test('card parent renders all active descendant categories and no products', () => {
  const categories = [
    {
      id: 1,
      name: 'SETU',
      status: 'active',
      parent_id: null,
      products: [{ id: 'root-product', product_name: 'Root Product' }],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'SETU',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 2,
      name: 'Subscriptions',
      status: 'active',
      parent_id: 1,
      products: [{ id: 'child-product', product_name: 'Child Product' }],
      display_orders: [],
    },
    {
      id: 3,
      name: 'Association App',
      status: 'active',
      parent_id: 2,
      products: [],
      display_orders: [],
    },
    {
      id: 4,
      name: 'NGO App',
      status: 'active',
      parent_id: 3,
      products: [{ id: 'ngo-product', product_name: 'NGO Product' }],
      display_orders: [],
    },
    {
      id: 5,
      name: 'Inactive Child',
      status: 'inactive',
      parent_id: 3,
      products: [],
      display_orders: [],
    },
  ];

  const { cardSections } = buildCategoryView(categories);

  assert.deepEqual(cardSections.map((section) => section.id), ['1']);
  assert.deepEqual(cardSections[0].items.map((item) => item.id), ['2', '3', '4']);
  assert.deepEqual(cardSections[0].items.map((item) => item.type), ['category', 'category', 'category']);
});

test('leaf card category renders up to 9 active product cards', () => {
  const products = Array.from({ length: 11 }, (_, index) => ({
    id: `product-${index + 1}`,
    product_name: `Product ${index + 1}`,
    status: index === 9 ? 'inactive' : 'active',
  }));

  const categories = [
    {
      id: 1,
      name: 'NGO App',
      status: 'active',
      parent_id: null,
      products,
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'NGO App',
          order: 1,
          status: 'active',
        },
      ],
    },
  ];

  const { cardSections } = buildCategoryView(categories);

  assert.deepEqual(cardSections.map((section) => section.id), ['1']);
  assert.equal(cardSections[0].label, 'NGO App');
  assert.equal(cardSections[0].items.length, 9);
  assert.deepEqual(cardSections[0].items.map((item) => item.type), Array(9).fill('product'));
  assert.deepEqual(cardSections[0].items.map((item) => item.productId), [
    'product-1',
    'product-2',
    'product-3',
    'product-4',
    'product-5',
    'product-6',
    'product-7',
    'product-8',
    'product-9',
  ]);
  assert.deepEqual(
    [...new Set(cardSections[0].items.map((item) => item.categoryId))],
    ['1']
  );
});

test('leaf card category renders product section even when parent is also cards', () => {
  const categories = [
    {
      id: 1,
      name: 'Association App',
      status: 'active',
      parent_id: null,
      products: [],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'Association App',
          order: 1,
          status: 'active',
        },
      ],
    },
    {
      id: 2,
      name: 'Mobile App with management system',
      status: 'active',
      parent_id: 1,
      products: [
        { id: 'product-1', product_name: 'Mobile Product 1', status: 'active' },
        { id: 'product-2', product_name: 'Mobile Product 2', status: 'active' },
      ],
      display_orders: [
        {
          display_type: 'cards',
          display_name: 'Mobile App With Management System',
          order: 5,
          status: 'active',
        },
      ],
    },
  ];

  const { cardSections } = buildCategoryView(categories);

  assert.deepEqual(cardSections.map((section) => section.id), ['1', '2']);
  assert.deepEqual(cardSections[0].items.map((item) => item.type), ['category']);
  assert.deepEqual(cardSections[0].items.map((item) => item.id), ['2']);
  assert.deepEqual(cardSections[1].items.map((item) => item.type), ['product', 'product']);
  assert.deepEqual(cardSections[1].items.map((item) => item.productId), ['product-1', 'product-2']);
});
