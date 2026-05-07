/**
 * TikTok Shop Product Category Taxonomy
 *
 * Three-level hierarchy matching TikTok Shop's official category structure.
 *
 * - L1: Top-level category  (e.g. "Beauty & Personal Care")
 * - L2: Subcategory         (e.g. "Skincare")
 * - L3: Leaf / product type (e.g. "Skin Care Kits")
 *
 * Display format: "L1 / L2 / L3"
 * e.g. "Beauty & Personal Care / Skincare / Skin Care Kits"
 */

export const CATEGORY_TAXONOMY: Record<string, Record<string, string[]>> = {
  'Beauty & Personal Care': {
    'Skincare': [
      'Face Serums', 'Moisturizers & Creams', 'Skin Care Kits', 'Eye Creams & Treatments',
      'Toners & Essences', 'Face Masks', 'Cleansers & Face Wash', 'Sunscreen & SPF',
      'Exfoliators & Scrubs', 'Acne & Blemish Treatments', 'Lip Balm & Treatments',
    ],
    'Makeup': [
      'Lip Color', 'Foundation & Concealer', 'Mascara', 'Eyeshadow', 'Blush & Bronzer',
      'Setting Spray & Powder', 'Eyebrow Products', 'Eyeliner', 'Makeup Brushes & Tools',
      'Makeup Remover',
    ],
    'Hair Care': [
      'Shampoo & Conditioner', 'Hair Masks & Treatments', 'Hair Growth & Scalp Care',
      'Hair Styling Tools', 'Hair Styling Products', 'Hair Color & Dye', 'Wigs & Extensions',
    ],
    'Fragrance': [
      'Perfume', 'Body Mist & Spray', 'Cologne', 'Deodorant & Antiperspirant',
    ],
    'Nail Care': [
      'Nail Polish', 'Nail Art & Tools', 'Nail Extensions & Gel', 'Nail Care Kits',
    ],
    'Bath & Body': [
      'Body Lotion & Moisturizers', 'Body Wash & Soap', 'Body Scrubs', 'Bath Bombs & Salts',
    ],
    'Oral Care': [
      'Teeth Whitening', 'Toothbrushes', 'Mouthwash', 'Dental Floss & Picks',
    ],
    'Beauty Tools & Accessories': [
      'Facial Massagers & Rollers', 'LED & Light Therapy Devices', 'Hair Removal',
      'Eyelash Curlers', 'Makeup Mirrors', 'Beauty Fridges',
    ],
  },

  'Health & Wellness': {
    'Vitamins & Supplements': [
      'Vitamins', 'Protein Supplements', 'Collagen Supplements', 'Probiotics',
      'Weight Management', 'Energy & Focus', 'Sleep Aids',
    ],
    'Health Monitors': [
      'Blood Pressure Monitors', 'Pulse Oximeters', 'Thermometers', 'Glucose Monitors',
    ],
    'Personal Care': [
      'Feminine Hygiene', 'Eye Care', 'Foot Care', 'Pain Relief',
    ],
    'Medical Supplies': [
      'First Aid Kits', 'Compression Socks', 'Posture Correctors', 'TENS Units',
    ],
    'Mental Wellness': [
      'Meditation & Mindfulness', 'Aromatherapy & Essential Oils',
    ],
  },

  'Electronics & Gadgets': {
    'Mobile Accessories': [
      'Phone Cases', 'Screen Protectors', 'Chargers & Cables', 'Power Banks',
      'Wireless Chargers', 'Phone Stands & Holders', 'Earbuds & Headphones',
    ],
    'Smart Home': [
      'Smart Speakers', 'Smart Bulbs & Lighting', 'Smart Plugs', 'Security Cameras',
      'Robot Vacuums', 'Smart Displays',
    ],
    'Wearable Tech': [
      'Smartwatches', 'Fitness Trackers', 'Smart Glasses', 'Wearable Cameras',
    ],
    'Audio & Video': [
      'Bluetooth Speakers', 'Projectors', 'Webcams', 'Microphones', 'Ring Lights',
    ],
    'Computer Accessories': [
      'Laptop Stands', 'Mechanical Keyboards', 'Mouse & Mousepads', 'USB Hubs',
    ],
    'Photography & Video': [
      'Camera Accessories', 'Tripods & Stabilizers', 'GoPro & Action Cameras',
      'Lens Filters', 'Camera Bags',
    ],
    'Gaming': [
      'Gaming Controllers', 'Gaming Headsets', 'Gaming Chairs', 'Gaming Accessories',
    ],
  },

  'Home & Living': {
    'Kitchen & Dining': [
      'Kitchen Gadgets & Tools', 'Cookware & Bakeware', 'Food Storage',
      'Coffee & Tea', 'Blenders & Juicers', 'Air Fryers', 'Kitchen Organizers',
    ],
    'Bedroom': [
      'Bedding Sets', 'Pillows & Cushions', 'Mattress Toppers', 'Blackout Curtains',
    ],
    'Bathroom': [
      'Shower Accessories', 'Bathroom Organizers', 'Towels', 'Bath Mats',
    ],
    'Home Decor': [
      'Wall Art & Prints', 'Candles & Holders', 'Vases & Planters', 'Photo Frames',
      'LED Lights & Strip Lights', 'Aesthetic Decor',
    ],
    'Cleaning': [
      'Cleaning Tools', 'Cleaning Products', 'Vacuum Accessories', 'Mops & Brooms',
    ],
    'Storage & Organisation': [
      'Storage Boxes & Bins', 'Closet Organisers', 'Desk Organisers', 'Drawer Dividers',
    ],
    'Garden & Outdoor': [
      'Garden Tools', 'Planters & Pots', 'Outdoor Lighting', 'Pest Control',
    ],
  },

  'Fashion & Accessories': {
    'Clothing': [
      'Tops & T-Shirts', 'Dresses', 'Trousers & Jeans', 'Activewear', 'Swimwear', 'Outerwear',
    ],
    'Footwear': [
      'Trainers & Sneakers', 'Sandals', 'Boots', 'Slippers',
    ],
    'Jewellery': [
      'Necklaces', 'Earrings', 'Bracelets', 'Rings', 'Jewellery Sets',
    ],
    'Bags & Wallets': [
      'Handbags', 'Backpacks', 'Wallets & Card Holders', 'Crossbody Bags',
    ],
    'Accessories': [
      'Sunglasses', 'Hats & Caps', 'Scarves & Wraps', 'Belts', 'Watches',
    ],
    'Hair Accessories': [
      'Hair Clips & Pins', 'Headbands', 'Hair Ties', 'Scrunchies',
    ],
  },

  'Sports & Outdoors': {
    'Fitness Equipment': [
      'Resistance Bands', 'Yoga Mats', 'Dumbbells & Weights', 'Foam Rollers',
      'Jump Ropes', 'Ab Rollers', 'Pull-Up Bars',
    ],
    'Sports Clothing': [
      'Gym Wear', 'Compression Tights', 'Sports Bras', 'Running Shoes',
    ],
    'Outdoor Recreation': [
      'Camping Gear', 'Hiking Accessories', 'Fishing Equipment', 'Cycling Accessories',
    ],
    'Water Sports': [
      'Swimming Accessories', 'Surfing & Paddleboarding', 'Snorkeling',
    ],
    'Sports Accessories': [
      'Water Bottles & Flasks', 'Sports Bags', 'Gym Gloves', 'Resistance Loops',
    ],
  },

  'Toys & Games': {
    'Kids Toys': [
      'Educational Toys', 'Building & Construction', 'Dolls & Accessories', 'Action Figures',
      'Sensory Toys', 'Slime & Craft Kits',
    ],
    'Outdoor Toys': [
      'Remote Control Vehicles', 'Drones', 'Ride-On Toys', 'Water Guns',
    ],
    'Board Games & Puzzles': [
      'Board Games', 'Puzzles', 'Card Games', 'Strategy Games',
    ],
    'Gaming Accessories': [
      'Gaming Figures', 'Collectibles', 'Gaming Decor',
    ],
  },

  'Pet Supplies': {
    'Dog Supplies': [
      'Dog Food & Treats', 'Dog Toys', 'Dog Grooming', 'Dog Clothing & Accessories',
      'Dog Training', 'Dog Beds & Furniture',
    ],
    'Cat Supplies': [
      'Cat Food & Treats', 'Cat Toys', 'Cat Grooming', 'Cat Beds & Furniture',
      'Litter & Litter Boxes',
    ],
    'Pet Accessories': [
      'Leashes & Harnesses', 'Pet Carriers', 'Pet Cameras', 'Automatic Feeders',
    ],
  },

  'Baby & Maternity': {
    'Baby Care': [
      'Baby Skincare', 'Baby Bath', 'Baby Feeding', 'Nappies & Wipes',
    ],
    'Baby Gear': [
      'Baby Carriers', 'Pushchairs & Prams', 'Baby Monitors', 'Travel Accessories',
    ],
    'Maternity': [
      'Maternity Clothing', 'Nursing & Breastfeeding', 'Maternity Supports',
    ],
    'Toys & Learning': [
      'Infant Toys', 'Teethers', 'Baby Books', 'Musical Toys',
    ],
  },

  'Automotive': {
    'Car Accessories': [
      'Car Phone Holders', 'Dash Cams', 'Car Chargers', 'Car Air Fresheners',
      'Seat Covers', 'Steering Wheel Covers',
    ],
    'Car Electronics': [
      'Car Audio', 'Reversing Cameras', 'Car Jump Starters', 'GPS & Navigation',
    ],
    'Car Care': [
      'Car Cleaning Products', 'Car Wax & Polish', 'Tyre Accessories',
    ],
  },

  'Tools & Home Improvement': {
    'Hand Tools': [
      'Screwdrivers', 'Pliers', 'Hammers', 'Wrenches', 'Tool Sets',
    ],
    'Power Tools': [
      'Drills', 'Saws', 'Sanders', 'Electric Screwdrivers',
    ],
    'Home Improvement': [
      'Painting Supplies', 'Adhesives & Tapes', 'Wall Anchors & Fasteners',
      'Door & Window Hardware',
    ],
    'Safety & Security': [
      'Smoke & CO Detectors', 'Door Locks', 'Safe Boxes', 'Security Cameras',
    ],
  },

  'Food & Beverages': {
    'Health Foods': [
      'Protein Bars', 'Superfood Powders', 'Healthy Snacks', 'Dried Fruits & Nuts',
    ],
    'Specialty Foods': [
      'International Foods', 'Organic Foods', 'Vegan Foods', 'Keto Foods',
    ],
    'Beverages': [
      'Coffee & Tea', 'Protein Shakes', 'Energy Drinks', 'Electrolyte Drinks',
    ],
  },
};

// ── Flat arrays ───────────────────────────────────────────────────────────────

/** All top-level (L1) categories */
export const PRODUCT_CATEGORIES = Object.keys(CATEGORY_TAXONOMY) as string[];

/** Stored on `Product.discoverySections` (DiscoveryService + creative overlap). */
export const PRODUCT_DISCOVERY_SECTIONS = [
  'top-ads',
  'trending',
  'top-rated',
  'viral',
  'influencer-reviews',
  'tutorials',
  'viral-unboxings',
] as const;

/** All available subcategories (L2) across all L1 categories */
export const PRODUCT_SUBCATEGORIES = Object.values(CATEGORY_TAXONOMY)
  .flatMap(sub => Object.keys(sub));

/** Full category taxonomy as a flat array of path strings ("L1 / L2 / L3") */
export const ALL_CATEGORY_PATHS: string[] = Object.entries(CATEGORY_TAXONOMY).flatMap(
  ([l1, subcats]) =>
    Object.entries(subcats).flatMap(([l2, leafNodes]) =>
      leafNodes.map(l3 => `${l1} / ${l2} / ${l3}`)
    )
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a full category path string from 3 levels.
 * e.g. getCategoryPath('Beauty & Personal Care', 'Skincare', 'Skin Care Kits')
 *   → 'Beauty & Personal Care / Skincare / Skin Care Kits'
 */
export function getCategoryPath(l1: string, l2?: string, l3?: string): string {
  if (!l2) return l1;
  if (!l3) return `${l1} / ${l2}`;
  return `${l1} / ${l2} / ${l3}`;
}

/**
 * Parse a stored category path back into its 3 levels.
 */
export function parseCategoryPath(path: string): { l1: string; l2?: string; l3?: string } {
  const parts = path.split(' / ').map(s => s.trim());
  return { l1: parts[0], l2: parts[1], l3: parts[2] };
}

/**
 * Given a raw niche string from AI extraction, find the best matching
 * L1, L2, and L3 category. Returns the category path.
 *
 * Strategy: score each level by substring match density.
 */
export function matchCategoryPath(niche: string): {
  category: string;
  subCategory: string | undefined;
  categoryLeaf: string | undefined;
  categoryPath: string;
} {
  const normalized = niche.toLowerCase();

  let bestL1 = 'Home & Living';
  let bestL2: string | undefined;
  let bestL3: string | undefined;
  let bestScore = 0;

  for (const [l1, subcats] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const [l2, leafNodes] of Object.entries(subcats)) {
      for (const l3 of leafNodes) {
        // Score each level on how many words from the niche appear in it
        const haystack = `${l1} ${l2} ${l3}`.toLowerCase();
        const words = normalized.split(/\W+/).filter(w => w.length > 2);
        const score = words.filter(w => haystack.includes(w)).length;

        if (score > bestScore) {
          bestScore = score;
          bestL1 = l1;
          bestL2 = l2;
          bestL3 = l3;
        }
      }
    }
  }

  // If no match found at all, try top-level only
  if (bestScore === 0) {
    for (const l1 of PRODUCT_CATEGORIES) {
      if (normalized.includes(l1.toLowerCase()) || l1.toLowerCase().includes(normalized.split(' ')[0])) {
        bestL1 = l1;
        break;
      }
    }
  }

  return {
    category:     bestL1,
    subCategory:  bestL2,
    categoryLeaf: bestL3,
    categoryPath: getCategoryPath(bestL1, bestL2, bestL3),
  };
}

export type ProductCategory = string;
