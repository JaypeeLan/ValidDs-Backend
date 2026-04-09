export {}; // Declares this as an ES module so ts-jest doesn't reject it at parse time

describe('HashtagIngestionPipeline', () => {
  let HashtagIngestionPipeline: any;
  let EnsembleJob: any;
  let ProductExtractor: any;
  let RainforestService: any;
  let ProductEnricher: any;
  let FreshnessService: any;

  beforeAll(async () => {
    // Prime env vars FIRST — before any src/ module is loaded
    process.env.NODE_ENV          = 'development';
    process.env.INTERNAL_API_KEY  = 'k'.repeat(32);
    process.env.JWT_SECRET        = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY    = 'a'.repeat(64);
    process.env.MONGODB_URI       = 'mongodb://localhost:27017/test';
    process.env.RAINFOREST_API_KEY = 'dummy';
    process.env.ENSEMBLE_API_KEY   = 'dummy';

    // Dynamic imports — env is ready so validation passes
    EnsembleJob      = (await import('../src/ingestion/ensemble/ensemble.job')).EnsembleJob;
    ProductExtractor = (await import('../src/services/product.extractor')).ProductExtractor;
    RainforestService= (await import('../src/services/rainforest.service')).RainforestService;
    ProductEnricher  = (await import('../src/services/product.enricher')).ProductEnricher;
    FreshnessService = (await import('../src/freshness/freshness.service')).FreshnessService;
    HashtagIngestionPipeline = (await import('../src/ingestion/ensemble/hashtag-ingestion.pipeline')).HashtagIngestionPipeline;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Minimal NormalizedPost builder ──────────────────────────────────────────
  // Only the fields the pipeline itself reads.  ProductEnricher is mocked so
  // downstream field requirements don't matter.
  const makePost = (videoId: string, viewCount: number): any => ({
    videoId,
    source: 'ensemble',
    viewCount,
    likeCount: 1000,
    commentCount: 100,
    shareCount: 50,
    engagementRate: 0.05,
    hashtags: ['gadget'],
    creatorHandle: 'tester',
    creatorFollowers: 50_000,
    collectedAt: new Date(),
    isAd: false,
    title: 'Test post',
    description: 'Test description',
    rawText: 'Test raw text',
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('should filter posts with < 50k views and only extract from qualifying ones', async () => {
    const posts = [
      makePost('vid_high', 60_000),  // ≥ 50k → should be processed
      makePost('vid_low',  10_000),  // < 50k → should be skipped
    ];

    // Mock at EnsembleJob level — this is what pipeline.run() actually calls.
    // Mocking EnsembleClient.prototype is too low-level: the client instance
    // is already created inside EnsembleJob's constructor before the spy can attach.
    jest.spyOn(EnsembleJob.prototype, 'runHashtagIngestion')
      .mockResolvedValue({ posts, commentMap: new Map() });

    // Create the pipeline AFTER the spy is in place so the internal EnsembleJob
    // inherits the patched prototype method.
    const pipeline = new HashtagIngestionPipeline();

    jest.spyOn(ProductExtractor, 'extractFromPost').mockResolvedValue({
      productName: 'Gadget Pro',
      productNiche: 'Electronics & Gadgets',
      trendDirection: 'rising',
      productDescription: 'A great gadget',
      extractionConfidence: 0.9,
      trendScore: 80,
      trendReason: 'Viral on TikTok',
      sentimentSummary: 'Very positive',
      buyingIntentScore: 8,
    });

    jest.spyOn(RainforestService, 'searchAmazonProducts').mockResolvedValue({
      search_results: [{ title: 'Gadget Pro Ultra', price: { value: 15 } }],
    });

    jest.spyOn(ProductEnricher,   'mergeAndUpsert').mockResolvedValue(undefined as any);
    jest.spyOn(FreshnessService,  'markUpdated').mockResolvedValue(undefined as any);

    const result = await pipeline.run();

    expect(result.postsCollected).toBe(2);
    expect(result.postsFiltered).toBe(1);      // vid_low was skipped
    expect(result.aiExtractionsDone).toBe(1);  // only vid_high extracted
    expect(result.rainforestHits).toBe(1);
    expect(result.dbUpserts).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify the correct post was sent to the AI
    const extractedPost = (ProductExtractor.extractFromPost as jest.Mock).mock.calls[0][0];
    expect(extractedPost.videoId).toBe('vid_high');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('should continue processing remaining posts when one post throws an error', async () => {
    const posts = [
      makePost('vid_crash', 60_000),  // will throw during AI extraction
      makePost('vid_ok',    70_000),  // should succeed
    ];

    jest.spyOn(EnsembleJob.prototype, 'runHashtagIngestion')
      .mockResolvedValue({ posts, commentMap: new Map() });

    const pipeline = new HashtagIngestionPipeline();

    jest.spyOn(ProductExtractor, 'extractFromPost')
      .mockRejectedValueOnce(new Error('Gemini API unavailable'))  // vid_crash fails
      .mockResolvedValueOnce({                                      // vid_ok succeeds
        productName: 'Good Gadget',
        productNiche: 'Electronics & Gadgets',
        trendDirection: 'rising',
        productDescription: 'Works great',
        extractionConfidence: 0.85,
        trendScore: 75,
        trendReason: 'Trending',
        buyingIntentScore: 7,
      });

    jest.spyOn(RainforestService, 'searchAmazonProducts').mockResolvedValue({ search_results: [] });
    jest.spyOn(ProductEnricher,   'mergeAndUpsert').mockResolvedValue(undefined as any);
    jest.spyOn(FreshnessService,  'markUpdated').mockResolvedValue(undefined as any);

    const result = await pipeline.run();

    expect(result.postsCollected).toBe(2);
    expect(result.postsFiltered).toBe(0);
    expect(result.aiExtractionsDone).toBe(1);   // only vid_ok completed
    expect(result.dbUpserts).toBe(1);
    expect(result.errors).toHaveLength(1);       // vid_crash error was caught
    expect(result.errors[0]).toContain('vid_crash');
  });
});
