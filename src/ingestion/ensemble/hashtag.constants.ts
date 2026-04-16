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

export const INTENT_HASHTAGS = [
  'TikTokMadeMeBuyIt',
  'AmazonFinds',
  'MustHave',
  'ViralProducts',
  'ProblemSolver',
  'UnnecessaryPurchase',
  'IWantOne',
  'ShutUpAndTakeMyMoney',
  'GiftIdeas',
] as const;

/**
 * High-intent behavioral keywords for "Full Search" ingestion.
 * These find the "conversational" viral products.
 */
export const BEHAVIORAL_KEYWORDS = [
  'I need this',
  'Game Changer',
  'Why did I not know about this',
  'Best purchase ever',
  'TikTok made me buy this',
  'I wish I found this sooner',
  'Mind Blown',
] as const;

export const TRACKED_HASHTAGS = [
  ...INTENT_HASHTAGS,
  ...Object.values(PRODUCT_NICHES).flat(),
] as const;
