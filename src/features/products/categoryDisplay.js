const FALLBACK_PALETTES = [
  ['color-mix(in srgb, var(--brand-red-light) 70%, var(--surface-color))', 'color-mix(in srgb, var(--brand-navy-light) 72%, var(--surface-color))'],
  ['color-mix(in srgb, var(--brand-navy-light) 72%, var(--surface-color))', 'color-mix(in srgb, var(--brand-red) 18%, var(--surface-color))'],
  ['color-mix(in srgb, var(--app-accent-bg) 70%, var(--surface-color))', 'color-mix(in srgb, var(--brand-red-light) 62%, var(--surface-color))'],
  ['color-mix(in srgb, var(--brand-red-light) 64%, var(--surface-color))', 'color-mix(in srgb, var(--brand-navy) 18%, var(--surface-color))'],
  ['color-mix(in srgb, var(--surface-color) 82%, var(--app-accent-bg))', 'color-mix(in srgb, var(--brand-navy-light) 64%, var(--surface-color))'],
  ['color-mix(in srgb, var(--brand-navy) 18%, var(--surface-color))', 'color-mix(in srgb, var(--brand-red-light) 64%, var(--surface-color))'],
];

const FALLBACK_ICONS = [
  'Shirt',
  'Sparkles',
  'Heart',
  'Briefcase',
  'Dumbbell',
  'Baby',
  'Footprints',
  'Home',
  'Lamp',
  'Droplet',
  'Palette',
  'Gem',
];

const VISIBLE_CATEGORY_STATUSES = new Set(['active']);

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const lowered = text.toLowerCase();
  if (['null', 'undefined', 'nan'].includes(lowered)) return '';
  return text;
};

const titleCase = (value) => {
  const text = normalizeText(value);
  if (!text) return '';
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
};

const hashString = (value) => {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pickPalette = (seed) => FALLBACK_PALETTES[hashString(seed) % FALLBACK_PALETTES.length];

const pickFallbackIcon = (seed) => FALLBACK_ICONS[hashString(seed) % FALLBACK_ICONS.length];

const getFirstProductImage = (category) => {
  const products = Array.isArray(category?.products) ? category.products : [];
  for (const product of products) {
    const images = Array.isArray(product?.images) ? product.images : [];
    for (const image of images) {
      const imageUrl = normalizeText(image?.image_url);
      if (imageUrl) return imageUrl;
    }
  }
  return '';
};

const resolveImageUrl = (category) =>
  normalizeText(category?.image_url) || getFirstProductImage(category);

const resolveProductImageUrl = (product) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  for (const image of images) {
    const imageUrl = normalizeText(image?.image_url);
    if (imageUrl) return imageUrl;
  }

  return normalizeText(product?.image_url) || normalizeText(product?.imageUrl);
};

const getDisplayOrder = (category, displayType) => {
  const displayOrders = Array.isArray(category?.display_orders)
    ? category.display_orders
    : [];

  return displayOrders.find((entry) => (
    normalizeText(entry?.display_type) === displayType
    && normalizeText(entry?.status).toLowerCase() === 'active'
  )) || null;
};

const getDisplaySortValue = (category, displayType) => {
  const displayOrder = getDisplayOrder(category, displayType);
  const order = Number(displayOrder?.order);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
};

const hasDisplayType = (category, displayType) =>
  Boolean(getDisplayOrder(category, displayType));

const getDisplayName = (category, displayType) =>
  normalizeText(getDisplayOrder(category, displayType)?.display_name);

const isVisibleCategory = (category) => {
  const status = normalizeText(category?.status).toLowerCase();
  return VISIBLE_CATEGORY_STATUSES.has(status);
};

const getCategoryDisplayLabel = (category, displayType) => {
  const displayName = getDisplayName(category, displayType);
  return titleCase(displayName) || titleCase(category?.name) || `Category ${normalizeText(category?.id)}`;
};

const sortByDisplayOrder = (displayType) => (a, b) => {
  const orderDiff = getDisplaySortValue(a, displayType) - getDisplaySortValue(b, displayType);
  if (orderDiff !== 0) return orderDiff;

  const labelDiff = getCategoryDisplayLabel(a, displayType)
    .localeCompare(getCategoryDisplayLabel(b, displayType), undefined, { sensitivity: 'base' });
  if (labelDiff !== 0) return labelDiff;

  return a.sourceIndex - b.sourceIndex
    || normalizeText(a.name).toLowerCase().localeCompare(normalizeText(b.name).toLowerCase());
};

const sortSliderCategories = sortByDisplayOrder('slider');

const sortBySourceOrder = (a, b) =>
  a.sourceIndex - b.sourceIndex
  || getCategoryDisplayLabel(a, 'cards').localeCompare(getCategoryDisplayLabel(b, 'cards'));

const isVisibleProduct = (product) => {
  const status = normalizeText(product?.status).toLowerCase();
  return !status || status === 'active';
};

export const getCardRowPattern = (count) => {
  if (count <= 0) return [];

  const directPatterns = {
    1: [1],
    2: [2],
    3: [3],
    4: [2, 2],
    5: [3, 2],
    6: [3, 3],
    7: [3, 2, 2],
    8: [3, 3, 2],
    9: [3, 3, 3],
    10: [3, 3, 2, 2],

  };

  if (directPatterns[count]) return directPatterns[count];

  const pattern = [];
  let remaining = count;

  while (remaining > 0) {
    if (remaining === 4) {
      pattern.push(2, 2);
      break;
    }

    if (remaining === 5) {
      pattern.push(3, 2);
      break;
    }

    if (remaining === 7) {
      pattern.push(3, 2, 2);
      break;
    }

    if (remaining === 8) {
      pattern.push(3, 3, 2);
      break;
    }

    if (remaining === 9) {
      pattern.push(3, 3, 3);
      break;
    }

    const next = Math.min(3, remaining);
    pattern.push(next);
    remaining -= next;
  }

  return pattern;
};

export const splitIntoRows = (items, pattern) => {
  const rows = [];
  let cursor = 0;

  pattern.forEach((rowSize) => {
    rows.push(items.slice(cursor, cursor + rowSize));
    cursor += rowSize;
  });

  if (cursor < items.length) {
    rows.push(items.slice(cursor));
  }

  return rows.filter((row) => row.length > 0);
};

const buildCategoryEntry = (category, displayType) => {
  const id = normalizeText(category?.id);
  const label = displayType
    ? getCategoryDisplayLabel(category, displayType)
    : titleCase(category?.name) || `Category ${id}`;
  const seed = `${id}:${label}`;

  return {
    type: 'category',
    id,
    categoryId: id,
    label,
    imageUrl: resolveImageUrl(category),
    colors: pickPalette(seed),
    icon: pickFallbackIcon(seed),
    sourceIndex: Number(category?.sourceIndex) || 0,
  };
};

const getProductDisplayLabel = (product) =>
  titleCase(product?.product_name)
  || titleCase(product?.alias_name)
  || titleCase(product?.name)
  || `Product ${normalizeText(product?.id)}`;

const buildProductEntry = (product, category, sourceIndex) => {
  const productId = normalizeText(product?.id);
  const categoryId = normalizeText(category?.id);
  const label = getProductDisplayLabel(product);
  const seed = `${categoryId}:${productId}:${label}`;

  return {
    type: 'product',
    id: productId ? `${categoryId}:${productId}` : `${categoryId}:product:${sourceIndex}`,
    productId,
    categoryId,
    label,
    imageUrl: resolveProductImageUrl(product),
    colors: pickPalette(seed),
    icon: pickFallbackIcon(seed),
    sourceIndex,
  };
};

export const buildCategoryView = (categories) => {
  const normalized = (Array.isArray(categories) ? categories : [])
    .map((category, index) => ({
      ...category,
      id: normalizeText(category?.id),
      parentId: normalizeText(category?.parent_id),
      status: normalizeText(category?.status).toLowerCase(),
      sourceIndex: Number.isFinite(Number(category?.sourceIndex))
        ? Number(category?.sourceIndex)
        : index,
    }))
    .filter((category) => Boolean(category.id));

  const activeCategories = normalized.filter(isVisibleCategory);
  const cardCategoryIds = new Set(
    activeCategories
      .filter((category) => hasDisplayType(category, 'cards'))
      .map((category) => category.id)
  );
  const visibleChildrenByParent = new Map();

  activeCategories.forEach((category) => {
    if (!category.parentId) return;
    if (!visibleChildrenByParent.has(category.parentId)) {
      visibleChildrenByParent.set(category.parentId, []);
    }
    visibleChildrenByParent.get(category.parentId).push(category);
  });

  visibleChildrenByParent.forEach((children) => {
    children.sort(sortBySourceOrder);
  });

  const isLeafCategory = (category) =>
    (visibleChildrenByParent.get(category.id) || []).length === 0;

  const shouldShowCardSection = (category) =>
    isVisibleCategory(category)
    && hasDisplayType(category, 'cards')
    && (isLeafCategory(category) || !cardCategoryIds.has(category.parentId));

  const collectVisibleDescendants = (parentId) => {
    const descendants = [];
    const visit = (currentParentId) => {
      const children = visibleChildrenByParent.get(currentParentId) || [];
      children.forEach((child) => {
        descendants.push(child);
        visit(child.id);
      });
    };

    visit(parentId);
    return descendants;
  };

  const buildCardSectionItems = (section) => {
    const children = visibleChildrenByParent.get(section.id) || [];

    if (children.length === 0) {
      return (Array.isArray(section?.products) ? section.products : [])
        .filter(isVisibleProduct)
        .slice(0, 9)
        .map((product, index) => buildProductEntry(product, section, index))
        .filter((product) => Boolean(product.productId));
    }

    return collectVisibleDescendants(section.id)
      .map((category) => buildCategoryEntry(category, 'cards'));
  };

  const sliderEntries = activeCategories
    .filter((category) => hasDisplayType(category, 'slider'))
    .sort(sortSliderCategories)
    .map((category) => buildCategoryEntry(category, 'slider'));

  const explicitCardSections = activeCategories
    .filter((category) => shouldShowCardSection(category, cardCategoryIds))
    .sort(sortByDisplayOrder('cards'))
    .map((section) => {
      const items = buildCardSectionItems(section);
      return {
        id: section.id,
        label: getCategoryDisplayLabel(section, 'cards'),
        sourceIndex: section.sourceIndex,
        sortOrder: getDisplaySortValue(section, 'cards'),
        items,
        rowPattern: getCardRowPattern(items.length),
      };
    })
    .filter((section) => section.items.length > 0);

  const cardSections = explicitCardSections
    .sort((a, b) => a.sortOrder - b.sortOrder
      || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      || a.sourceIndex - b.sourceIndex);

  return { sliderEntries, cardSections };
};
