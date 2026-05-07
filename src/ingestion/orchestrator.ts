import { IngestionJobResult, OrchestratorConfig, NormalizedPost } from './ingestion.types';
import { logger } from '../logger';

const log = logger.child({ module: 'ingestion-orchestrator' });

/**
 * Ingestion Orchestrator
 *
 * Manages the full data acquisition cycle:
 *  1. Uses the primary source
 *  2. Fires alerts if the source fails
 *  3. Returns unified output for the AI extraction layer
 *
 * Current source map:
 *  Primary:    Manual source
 *
 * Adding a new source:
 *  1. Create src/ingestion/<name>/<name>.job.ts
 *  2. Import it here and add to SOURCES map
 *  3. Update the config below
 */

const DEFAULT_CONFIG: OrchestratorConfig = {
  primarySource: 'manual',
  fallbackSources: [],
  maxRetries: 2,
  retryDelayMs: 3000,
};

export interface OrchestratorOutput {
  posts: NormalizedPost[];
  results: IngestionJobResult[];
  activeSources: string[];
  overallSuccess: boolean;
}

export class IngestionOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly region: string;

  constructor(
    config: Partial<OrchestratorConfig> = {},
    region = process.env.TIKTOK_REGION ?? 'US'
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.region = region;
  }

  /**
   * Run the full ingestion cycle.
   *
   * Tries primary source first. If it fails (zero posts collected),
   * activates fallbacks in order until one succeeds or all fail.
   */
  async run(): Promise<OrchestratorOutput> {
    const results: IngestionJobResult[] = [];
    const allPosts: NormalizedPost[] = [];
    const activeSources: string[] = [];

    log.info('Ingestion cycle is disabled');

    return {
      posts: deduplicatePosts(allPosts),
      results,
      activeSources,
      overallSuccess: false,
    };
  }

  /**
   * Run a specific source and return its posts + result.
   * Returns empty output on failure — never throws.
   */
  private async runSource(
    source: string
  ): Promise<{ posts: NormalizedPost[]; result: IngestionJobResult }> {
    try {
      return {
        posts: [],
        result: {
          source: source as never,
          success: false,
          postsCollected: 0,
          productsExtracted: 0,
          hashtagsCollected: 0,
          errors: ['Ingestion source is disabled'],
          durationMs: 0,
          ranAt: new Date(),
        },
      };
    } catch (err) {
      log.error(`Source ${source} threw an unexpected error`, err);
      return {
        posts: [],
        result: {
          source: source as never,
          success: false,
          postsCollected: 0,
          productsExtracted: 0,
          hashtagsCollected: 0,
          errors: [String(err)],
          durationMs: 0,
          ranAt: new Date(),
        },
      };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Remove duplicate posts by videoId.
 * This can happen if multiple sources return the same viral video.
 */
function deduplicatePosts(posts: NormalizedPost[]): NormalizedPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    if (seen.has(post.videoId)) return false;
    seen.add(post.videoId);
    return true;
  });
}
