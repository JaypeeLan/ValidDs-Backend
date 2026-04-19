/**
 * Power-Dropshipper Search Strategy Constants
 * 
 * Organized by Niche and Intent to find high-performing products
 * before they reach peak saturation.
 */

export const PRODUCT_NICHES = {
  HOME_KITCHEN: [
    'KitchenGadgets',
    'HomeFinds',
    'CleaningHacks',
    'HomeOrganization',
    'KitchenHacks',
  ],
  BEAUTY_CARE: [
    'BeautyFinds',
    'SkincareHacks',
    'HairCare',
    'MakeupMustHaves',
  ],
  TECH_GADGETS: [
    'TechTok',
    'SmartHome',
    'GadgetLover',
    'CoolTech',
  ],
  PETS: [
    'PetFinds',
    'DogMustHaves',
    'CatLover',
    'PetGadgets',
  ],
  OUTDOOR_FITNESS: [
    'CampingGear',
    'FitnessFinds',
    'OutdoorLife',
    'YogaGear',
  ],
} as const;

/** Every niche tag — used for both Ensemble keyword search and hashtag feeds. */
export const ALL_CATEGORY_TAGS = Object.values(PRODUCT_NICHES).flat() as readonly string[];

/**
 * Hashtag discovery (e.g. `/hashtag/posts`): all category tags plus TikTokMadeMeBuyIt.
 */
export const TRACKED_HASHTAGS = [
  ...new Set([...ALL_CATEGORY_TAGS, 'TikTokMadeMeBuyIt']),
] as readonly string[];

/**
 * Lowercase terms for `/keyword/search` in EnsembleJob.run — mirrors category tags + buying-intent.
 */
export const ENSEMBLE_CATEGORY_KEYWORDS = [
  ...new Set([...ALL_CATEGORY_TAGS.map((t) => t.toLowerCase()), 'tiktokmademebuyit']),
] as readonly string[];
