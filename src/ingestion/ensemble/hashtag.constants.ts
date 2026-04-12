/**
 * Hashtags to track for product ingestion via EnsembleData.
 *
 * Extend this list to track more TikTok hashtags in the future.
 * Each hashtag here will be fully paginated and fed through the
 * Gemini AI extraction → Rainforest enrichment → DB pipeline.
 */
export const TRACKED_HASHTAGS = [
  'TikTokMadeMeBuyIt',
  'AmazonFinds',
  'TikTokShop',
  'MustHave',
  'ViralProducts',
  'ProblemSolver',
  'KitchenGadgets',
  'BeautyFinds',
  'HomeFinds',
  'TechTok',
  'Unboxing',
  'Dropshipping',
] as const;
