import { getCardRowPattern } from './categoryDisplay.js';

// Static placeholder categories shown to app owners when their trust has no
// categories yet. Shaped like buildCategoryView() output so CircleSlider and
// CardGrid can render them unchanged. Nothing here is ever sent to the API.
const SAMPLES = [
  { key: 'jewellery', label: 'Jewellery', icon: 'Gem' },
  { key: 'clothing', label: 'Clothing', icon: 'Shirt' },
  { key: 'mobiles', label: 'Mobiles', icon: 'Smartphone' },
  { key: 'footwear', label: 'Footwear', icon: 'Footprints' },
  { key: 'bags', label: 'Bags', icon: 'ShoppingBag' },
  { key: 'watches', label: 'Watches', icon: 'Watch' },
];

const SLIDER_COUNT = 4;

const toEntry = ({ key, label, icon }, index) => ({
  type: 'category',
  id: `sample-${key}`,
  categoryId: `sample-${key}`,
  label,
  imageUrl: '',
  colors: ['transparent', 'transparent'],
  icon,
  sourceIndex: index,
  sample: true,
});

export const buildSampleCategoryView = () => {
  const entries = SAMPLES.map(toEntry);

  return {
    sliderEntries: entries.slice(0, SLIDER_COUNT),
    cardSections: [
      {
        id: 'sample-all',
        label: 'All categories',
        sourceIndex: 0,
        items: entries,
        rowPattern: getCardRowPattern(entries.length),
      },
    ],
  };
};
