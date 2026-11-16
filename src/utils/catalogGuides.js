const OPEN_APP_MANAGER = {
  title: 'Open App Manager',
  description: 'Tap the + icon at the top of the app. Your App Manager dashboard opens.',
  tap: '+ (top bar)',
  icon: 'Plus',
};

export const CATALOG_GUIDES = {
  category: {
    title: 'Set up your store',
    heading: 'Add your first category in 5 steps',
    intro: 'Categories group your products, like Jewellery or Clothing. Once you add one, it shows up for your members.',
    steps: [
      OPEN_APP_MANAGER,
      {
        title: 'Go to Products',
        description: 'Under “What would you like to update?”, tap Products.',
        tap: 'Products · Add or manage products',
        icon: 'Package',
      },
      {
        title: 'Tap Add in the Slider',
        description: 'On the App Display page, tap the + Add circle in the Slider, or tap + Add a section. The Add to Slider (or Add to Cards) box opens.',
        tap: '+ Add / + Add a section',
        icon: 'Plus',
      },
      {
        title: 'Open the Category list',
        description: 'In the box, tap Select a category. The first option in the list is + Add Category. Tap it.',
        tap: 'Select a category → + Add Category',
        icon: 'ChevronDown',
      },
      {
        title: 'Create and save',
        description: 'On Create Category, add an image, type a name, and choose Main category or Inside another. Tap Save category and you’re taken back to App Display.',
        tap: 'Save category',
        icon: 'Check',
      },
    ],
    tip: 'Square images look best. Use “Inside another” to make a sub-category, like Rings inside Jewellery.',
  },
  product: {
    title: 'Add your products',
    heading: 'Add a product in 6 steps',
    intro: 'Products always live inside a category. Make sure you’ve added a category first.',
    steps: [
      {
        title: 'Pick a category',
        description: 'Tap a category in the Slider, or tap any section on the page. A box with that category’s details opens.',
        tap: 'Your category (e.g. Category 1)',
        icon: 'LayoutGrid',
      },
      {
        title: 'Tap Add product',
        description: 'In the category box, tap Add product. The New product form opens with this category already filled in.',
        tap: '+ Add product',
        icon: 'Plus',
      },
      {
        title: 'Step 1 · Basics',
        description: 'Type the product name and choose Product or Subscription. Code and position are optional. Tap Next.',
        tap: 'Next',
        icon: 'ArrowRight',
      },
      {
        title: 'Step 2 · Photos',
        description: 'Tap Add photo. The first photo is the main one members see. Use 5:7 portrait photos, up to 5 MB each. Tap Next.',
        tap: '+ Add photo → Next',
        icon: 'Image',
      },
      {
        title: 'Step 3 · Price',
        description: 'Enter the MRP, plus a discount and delivery fee if you have them, and pick the GST rate. The app works out what members pay. Tap Review.',
        tap: 'Review',
        icon: 'Tag',
      },
      {
        title: 'Step 4 · Check and save',
        description: 'Check the details and tap Edit to change anything. Tap Save product. To add Size or Colour, tap Add details, or tap Not now to do it later.',
        tap: 'Save product',
        icon: 'Check',
      },
    ],
    tip: 'If a category has sub-categories, members see those first. Add products to the sub-category so members can find them.',
  },
};
