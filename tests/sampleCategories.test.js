import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleCategoryView } from '../src/utils/sampleCategories.js';
import { CATALOG_GUIDES } from '../src/utils/catalogGuides.js';

test('sample view has a 4-item slider and one 6-item card section, all flagged as samples', () => {
  const { sliderEntries, cardSections } = buildSampleCategoryView();

  assert.equal(sliderEntries.length, 4);
  assert.equal(cardSections.length, 1);
  assert.equal(cardSections[0].items.length, 6);
  assert.deepEqual(cardSections[0].rowPattern, [3, 3]);
  [...sliderEntries, ...cardSections[0].items].forEach((entry) => {
    assert.equal(entry.sample, true);
    assert.ok(entry.id.startsWith('sample-'));
  });
});

test('guides keep the documented step counts', () => {
  assert.equal(CATALOG_GUIDES.category.steps.length, 5);
  assert.equal(CATALOG_GUIDES.product.steps.length, 6);
});
