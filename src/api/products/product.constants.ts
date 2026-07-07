/**
 * ValidDs Product Category Taxonomy
 *
 * Three-level hierarchy used across all products, ingestion, AI classification,
 * and API filtering.
 *
 *   L1 — top-level category   (e.g. "Beauty & Personal Care")
 *   L2 — subcategory          (e.g. "Skincare")
 *   L3 — leaf / product type  (e.g. "Face Serums")  — free-form, not validated
 *
 * Every product MUST have a valid L1 and L2 from this file.
 * L3 is stored as-is from the AI extraction.
 *
 * Display path: "L1 > L2 > L3"
 */

export const CATEGORY_TAXONOMY: Record<string, Record<string, string[]>> = {
  'Beauty & Personal Care': {
    Skincare: [
      'Face Serums',
      'Moisturizers & Creams',
      'Eye Creams & Treatments',
      'Toners & Essences',
      'Face Masks',
      'Cleansers & Face Wash',
      'Sunscreen & SPF',
      'Exfoliators & Scrubs',
      'Acne & Blemish Treatments',
      'Lip Balm & Treatments',
      'Skin Care Kits',
    ],
    'Makeup & Cosmetics': [
      'Lip Color',
      'Foundation & Concealer',
      'Mascara',
      'Eyeshadow',
      'Blush & Bronzer',
      'Setting Spray & Powder',
      'Eyebrow Products',
      'Eyeliner',
      'Makeup Brushes & Tools',
      'Makeup Remover',
      'Contour & Highlight',
    ],
    'Hair Care': [
      'Shampoo & Conditioner',
      'Hair Masks & Treatments',
      'Hair Growth & Scalp Care',
      'Hair Styling Products',
      'Hair Color & Dye',
      'Wigs & Extensions',
    ],
    'Hair Styling Tools': [
      'Hair Dryers',
      'Flat Irons & Straighteners',
      'Curling Wands & Irons',
      'Hot Brushes',
      'Hair Clippers & Trimmers',
    ],
    Fragrance: ['Perfume', 'Body Mist & Spray', 'Cologne', 'Deodorant & Antiperspirant'],
    'Nail Care': ['Nail Polish', 'Nail Art & Tools', 'Nail Extensions & Gel', 'Nail Care Kits'],
    'Bath & Body': [
      'Body Lotion & Moisturizers',
      'Body Wash & Soap',
      'Body Scrubs',
      'Bath Bombs & Salts',
    ],
    "Men's Grooming": [
      'Shaving & Beard Care',
      "Men's Skincare",
      "Men's Hair Care",
      "Men's Fragrance",
    ],
    'Oral Care': ['Teeth Whitening', 'Toothbrushes', 'Mouthwash', 'Dental Floss & Picks'],
    'Beauty Tools & Accessories': [
      'Facial Massagers & Rollers',
      'LED & Light Therapy Devices',
      'Hair Removal',
      'Eyelash Curlers',
      'Makeup Mirrors',
      'Beauty Fridges',
      'Gua Sha & Face Tools',
    ],
  },

  Fashion: {
    "Women's Clothing": [
      'Tops & T-Shirts',
      'Dresses',
      'Trousers & Jeans',
      'Skirts',
      'Outerwear & Coats',
      'Loungewear & Pyjamas',
      'Sets & Co-ords',
    ],
    "Men's Clothing": [
      'T-Shirts & Shirts',
      'Trousers & Jeans',
      'Hoodies & Sweatshirts',
      'Jackets & Outerwear',
      'Suits & Smart Wear',
    ],
    'Activewear & Sportswear': [
      'Leggings & Tights',
      'Sports Bras',
      'Gym Tops',
      'Shorts',
      'Tracksuits',
      'Sports Socks',
    ],
    'Shoes & Footwear': [
      'Trainers & Sneakers',
      'Sandals & Slides',
      'Boots',
      'Heels & Wedges',
      'Slippers',
      'Flat Shoes',
    ],
    'Bags & Accessories': [
      'Handbags',
      'Backpacks',
      'Crossbody Bags',
      'Wallets & Card Holders',
      'Sunglasses',
      'Hats & Caps',
      'Scarves & Wraps',
      'Belts',
      'Watches',
    ],
    Jewellery: ['Necklaces', 'Earrings', 'Bracelets', 'Rings', 'Jewellery Sets', 'Anklets'],
    'Shapewear & Underwear': ['Shapewear', 'Bras', 'Underwear & Knickers', 'Bodysuits'],
    Swimwear: ['Bikinis', 'One-Piece Swimsuits', 'Swim Shorts', 'Cover-Ups & Sarongs'],
    'Hair Accessories': ['Hair Clips & Pins', 'Headbands', 'Hair Ties & Scrunchies', 'Hair Wraps'],
  },

  'Health & Wellness': {
    'Vitamins & Supplements': [
      'Vitamins & Minerals',
      'Collagen Supplements',
      'Probiotics',
      'Protein Supplements',
      'Weight Management',
      'Energy & Focus',
      'Sleep Aids',
      'Immune Support',
    ],
    'Fitness Equipment': [
      'Resistance Bands',
      'Yoga Mats',
      'Dumbbells & Weights',
      'Foam Rollers',
      'Jump Ropes',
      'Ab Rollers',
      'Pull-Up Bars',
      'Balance Boards',
    ],
    'Recovery & Pain Relief': [
      'Massage Guns',
      'TENS Units',
      'Compression Sleeves',
      'Posture Correctors',
      'Hot & Cold Therapy',
      'Acupuncture Mats',
    ],
    'Health Monitors': [
      'Blood Pressure Monitors',
      'Pulse Oximeters',
      'Thermometers',
      'Glucose Monitors',
      'Smart Scales',
    ],
    "Women's Health": [
      'Feminine Hygiene',
      'Menstrual Cups & Discs',
      'Fertility Supplements',
      'Pregnancy & Postpartum Care',
    ],
    'Mental Wellness': [
      'Meditation & Mindfulness',
      'Aromatherapy & Essential Oils',
      'Stress Relief',
      'Sleep Accessories',
    ],
    'Medical Supplies': ['First Aid Kits', 'Compression Socks', 'Wound Care', 'Mobility Aids'],
  },

  'Home & Kitchen': {
    'Cookware & Bakeware': [
      'Pots & Pans',
      'Baking Trays & Dishes',
      'Cast Iron',
      'Non-Stick Cookware',
      'Woks & Stir Fry Pans',
    ],
    'Kitchen Gadgets': [
      'Air Fryers',
      'Blenders & Juicers',
      'Food Processors',
      'Coffee Makers',
      'Electric Kettles',
      'Toasters & Grills',
      'Instant Pots & Slow Cookers',
      'Kitchen Organizers',
      'Cutting Boards & Knives',
    ],
    'Home Decor': [
      'Wall Art & Prints',
      'Candles & Holders',
      'Vases & Planters',
      'LED Lights & Strip Lights',
      'Aesthetic Decor',
      'Photo Frames',
      'Mirrors',
    ],
    'Bedding & Bath': [
      'Bedding Sets & Duvet Covers',
      'Pillows & Cushions',
      'Mattress Toppers',
      'Towels',
      'Bath Mats',
      'Shower Curtains',
      'Blackout Curtains',
    ],
    Cleaning: [
      'Cleaning Tools',
      'Cleaning Products',
      'Robot & Vacuum Accessories',
      'Mops & Brooms',
      'Laundry Accessories',
    ],
    'Storage & Organisation': [
      'Storage Boxes & Bins',
      'Closet Organisers',
      'Desk Organisers',
      'Drawer Dividers',
      'Fridge Organisers',
      'Shoe Racks',
    ],
    Furniture: [
      'Chairs & Seating',
      'Tables & Desks',
      'Shelving & Bookcases',
      'Storage Furniture',
      'Outdoor Furniture',
    ],
    Lighting: ['Desk & Table Lamps', 'Floor Lamps', 'Ceiling Lights', 'Fairy & Decorative Lights'],
  },

  'Food & Beverage': {
    Snacks: [
      'Crisps & Popcorn',
      'Nuts & Seeds',
      'Dried Fruit',
      'Protein Bars',
      'Rice Cakes & Crackers',
      'Jerky & Meat Snacks',
    ],
    'Sweets & Chocolate': ['Chocolate Bars & Boxes', 'Gummies & Candy', 'Cookies & Biscuits'],
    'Health Foods': [
      'Superfood Powders',
      'Granola & Muesli',
      'Organic Foods',
      'Vegan Foods',
      'Keto & Low-Carb Foods',
      'Protein Powders',
    ],
    'Coffee & Tea': [
      'Ground Coffee',
      'Coffee Pods & Capsules',
      'Instant Coffee',
      'Herbal & Wellness Tea',
      'Matcha',
    ],
    'Drinks & Beverages': [
      'Protein Shakes',
      'Energy Drinks',
      'Electrolyte Drinks',
      'Juices',
      'Sports Drinks',
    ],
    'Condiments & Sauces': ['Hot Sauce', 'Marinades & Rubs', 'Dressings', 'Spreads & Jams'],
    'Specialty Foods': ['International Foods', 'Meal Kits', 'Freeze-Dried & Camping Food'],
  },

  'Electronics & Tech': {
    'Phone Accessories': [
      'Phone Cases',
      'Screen Protectors',
      'MagSafe Accessories',
      'Phone Stands & Holders',
    ],
    'Charging & Power': [
      'Chargers & Cables',
      'Power Banks',
      'Wireless Chargers',
      'Multi-Port Chargers',
    ],
    Audio: [
      'Earbuds & In-Ear Headphones',
      'Over-Ear Headphones',
      'Bluetooth Speakers',
      'Microphones',
      'Soundbars',
    ],
    Wearables: ['Smartwatches', 'Fitness Trackers', 'Smart Glasses', 'Wearable Cameras'],
    'Smart Home': [
      'Smart Speakers',
      'Smart Bulbs & Lighting',
      'Smart Plugs',
      'Security Cameras',
      'Robot Vacuums',
      'Smart Displays',
    ],
    'Computers & Peripherals': [
      'Laptop Stands',
      'Mechanical Keyboards',
      'Mouse & Mousepads',
      'USB Hubs',
      'Webcams',
      'External Drives',
    ],
    'Photography & Video': [
      'Camera Accessories',
      'Tripods & Stabilizers',
      'Ring Lights',
      'Action Cameras',
      'Lens Filters',
      'Camera Bags',
    ],
    Gaming: ['Gaming Controllers', 'Gaming Headsets', 'Gaming Chairs', 'Gaming Accessories'],
  },

  'Sports & Outdoors': {
    'Running & Cycling': [
      'Running Shoes',
      'Cycling Accessories',
      'Running Gear',
      'Hydration Packs',
    ],
    'Gym & Training': [
      'Gym Wear',
      'Gym Gloves & Straps',
      'Gym Bags',
      'Pre-Workout & Intra-Workout',
    ],
    'Yoga & Pilates': [
      'Yoga Mats',
      'Yoga Blocks & Straps',
      'Pilates Equipment',
      'Meditation Cushions',
    ],
    'Outdoor & Camping': [
      'Camping Gear',
      'Hiking Accessories',
      'Tents & Sleeping Bags',
      'Outdoor Lighting',
      'Survival Tools',
    ],
    'Water Sports': [
      'Swimming Accessories',
      'Surfing & Paddleboarding',
      'Snorkelling',
      'Swim Gear',
    ],
    'Team & Racket Sports': ['Football Accessories', 'Tennis & Badminton', 'Basketball Gear'],
    'Sports Accessories': [
      'Water Bottles & Flasks',
      'Sports Bags',
      'Resistance Loops',
      'Jump Ropes',
    ],
  },

  Pets: {
    Dog: [
      'Dog Food & Treats',
      'Dog Toys',
      'Dog Grooming',
      'Dog Clothing & Accessories',
      'Dog Beds & Furniture',
      'Dog Training',
      'Dog Health & Supplements',
    ],
    Cat: [
      'Cat Food & Treats',
      'Cat Toys',
      'Cat Grooming',
      'Cat Beds & Furniture',
      'Litter & Litter Boxes',
      'Cat Health & Supplements',
    ],
    'Pet Accessories': [
      'Leashes & Harnesses',
      'Pet Carriers',
      'Pet Cameras',
      'Automatic Feeders',
      'Pet Strollers',
      'ID Tags',
    ],
    'Small Animals & Birds': ['Small Animal Supplies', 'Bird Supplies', 'Aquarium & Fish Supplies'],
  },

  'Kids & Baby': {
    'Baby Gear': [
      'Baby Carriers',
      'Pushchairs & Prams',
      'Baby Monitors',
      'Car Seats',
      'Baby Bouncers & Swings',
    ],
    'Baby Care': ['Baby Skincare', 'Baby Bath', 'Baby Feeding', 'Nappies & Wipes', 'Baby Health'],
    'Toys & Games': [
      'Educational Toys',
      'Building & Construction',
      'Dolls & Accessories',
      'Action Figures',
      'Sensory Toys',
      'Slime & Craft Kits',
      'Remote Control Vehicles',
      'Board Games & Puzzles',
    ],
    'Learning & Education': [
      'Baby & Toddler Books',
      'Flash Cards',
      'Art & Craft Supplies',
      'Science Kits',
      'Musical Instruments for Kids',
    ],
    "Kids' Clothing": ["Girls' Clothing", "Boys' Clothing", 'Baby Clothing', "Kids' Shoes"],
    Maternity: ['Maternity Clothing', 'Nursing & Breastfeeding', 'Maternity Supports'],
  },

  Automotive: {
    'Car Accessories': [
      'Car Phone Holders',
      'Dash Cams',
      'Seat Covers',
      'Steering Wheel Covers',
      'Car Air Fresheners',
      'Sunshades',
      'Boot Organisers',
    ],
    'Car Electronics': [
      'Car Audio',
      'Reversing Cameras',
      'Car Jump Starters',
      'GPS & Navigation',
      'Car Chargers',
    ],
    'Car Care': [
      'Car Cleaning Products',
      'Car Wax & Polish',
      'Tyre Accessories',
      'Windscreen & Wipers',
    ],
    'Tools & Equipment': ['Tool Sets', 'Jacks & Stands', 'Air Compressors', 'OBD Scanners'],
  },

  'Tools & Home Improvement': {
    'Hand Tools': ['Screwdrivers', 'Pliers', 'Hammers', 'Wrenches', 'Tool Sets'],
    'Power Tools': ['Drills', 'Circular Saws', 'Sanders', 'Electric Screwdrivers'],
    'Home Improvement': [
      'Painting Supplies',
      'Adhesives & Tapes',
      'Wall Anchors & Fasteners',
      'Door & Window Hardware',
      'Caulking & Sealants',
    ],
    'Safety & Security': [
      'Smoke & CO Detectors',
      'Door Locks & Deadbolts',
      'Safe Boxes',
      'Security Cameras',
      'Door & Window Alarms',
    ],
    'Garden & Outdoor': [
      'Garden Tools',
      'Planters & Pots',
      'Outdoor Lighting',
      'Pest Control',
      'Lawn Care',
    ],
  },
};

// ── Derived flat arrays ───────────────────────────────────────────────────────

/** All L1 category names */
export const PRODUCT_CATEGORIES = Object.keys(CATEGORY_TAXONOMY);

/** All L2 subcategory names (flat, across all L1s) */
export const PRODUCT_SUBCATEGORIES = Object.values(CATEGORY_TAXONOMY).flatMap((sub) =>
  Object.keys(sub),
);

/** L2 subcategories keyed by L1 */
export const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_TAXONOMY).map(([l1, subcats]) => [l1, Object.keys(subcats)]),
);

/** L3 leaf values keyed by "L1 > L2" */
export const LEAVES_BY_PATH: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_TAXONOMY).flatMap(([l1, subcats]) =>
    Object.entries(subcats).map(([l2, leaves]) => [`${l1} > ${l2}`, leaves]),
  ),
);

/** Flat array of all category paths as "L1 > L2 > L3" */
export const ALL_CATEGORY_PATHS: string[] = Object.entries(CATEGORY_TAXONOMY).flatMap(
  ([l1, subcats]) =>
    Object.entries(subcats).flatMap(([l2, leaves]) => leaves.map((l3) => `${l1} > ${l2} > ${l3}`)),
);

/** Stored on `Product.discoverySections` — each product has exactly one. */
export const PRODUCT_DISCOVERY_SECTIONS = [
  'top-ads',
  'trending',
  'high-opportunity',
  'global-selling',
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a category path string */
export function getCategoryPath(l1: string, l2?: string, l3?: string): string {
  if (!l2) return l1;
  if (!l3) return `${l1} > ${l2}`;
  return `${l1} > ${l2} > ${l3}`;
}

/** Parse a stored category path back into its 3 levels */
export function parseCategoryPath(path: string): { l1: string; l2?: string; l3?: string } {
  const parts = path.split(' > ').map((s) => s.trim());
  return { l1: parts[0], l2: parts[1], l3: parts[2] };
}

/** Check whether a given L1 and optional L2 are valid */
export function isValidCategory(l1: string, l2?: string): boolean {
  if (!CATEGORY_TAXONOMY[l1]) return false;
  if (l2 && !CATEGORY_TAXONOMY[l1][l2]) return false;
  return true;
}

/**
 * Given a raw niche/category string from AI extraction, find the best
 * matching L1, L2, and L3 from the taxonomy.
 *
 * Strategy: score each path by how many words from the input appear in it.
 */
export function matchCategoryPath(niche: string): {
  category: string;
  subCategory: string | undefined;
  categoryLeaf: string | undefined;
  categoryPath: string;
} {
  const normalized = niche.toLowerCase();

  let bestL1 = PRODUCT_CATEGORIES[0];
  let bestL2: string | undefined;
  let bestL3: string | undefined;
  let bestScore = 0;

  for (const [l1, subcats] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const [l2, leafNodes] of Object.entries(subcats)) {
      for (const l3 of leafNodes) {
        const haystack = `${l1} ${l2} ${l3}`.toLowerCase();
        const words = normalized.split(/\W+/).filter((w) => w.length > 2);
        const score = words.filter((w) => haystack.includes(w)).length;

        if (score > bestScore) {
          bestScore = score;
          bestL1 = l1;
          bestL2 = l2;
          bestL3 = l3;
        }
      }
    }
  }

  // Fallback: try L1-only match
  if (bestScore === 0) {
    for (const l1 of PRODUCT_CATEGORIES) {
      if (
        normalized.includes(l1.toLowerCase()) ||
        l1.toLowerCase().includes(normalized.split(' ')[0])
      ) {
        bestL1 = l1;
        break;
      }
    }
  }

  return {
    category: bestL1,
    subCategory: bestL2,
    categoryLeaf: bestL3,
    categoryPath: getCategoryPath(bestL1, bestL2, bestL3),
  };
}

export type ProductCategory = string;
