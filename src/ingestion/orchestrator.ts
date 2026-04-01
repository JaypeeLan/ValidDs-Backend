import { CreativeCenterJob } from './creative-center/creative-center.job';
import { IngestionJobResult, OrchestratorConfig, NormalizedPost } from './ingestion.types';
import { logger } from '../logger';
import { Alerts } from '../monitoring/alerts';

const log = logger.child({ module: 'ingestion-orchestrator' });

/**
 * Ingestion Orchestrator
 *
 * Manages the full data acquisition cycle:
 *  1. Tries the primary source (Creative Center)
 *  2. Falls back to secondary sources if the primary fails
 *  3. Fires alerts if all sources fail
 *  4. Returns unified output for the AI extraction layer
 *
 * Current source map:
 *  Primary:    Creative Center (HTTP scraper — no API key required)
 *  Fallback A: EnsembleData (API — pending key)
 *  Fallback B: RapidAPI scrapers (API — pending key)
 *
 * Adding a new source:
 *  1. Create src/ingestion/<name>/<name>.job.ts
 *  2. Import it here and add to SOURCES map
 *  3. Update the config below
 */

const DEFAULT_CONFIG: OrchestratorConfig = {
  primarySource: 'creative-center',
  fallbackSources: ['ensemble', 'rapidapi'],
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
    region = process.env.CREATIVE_CENTER_REGION ?? 'US'
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

    log.info('Ingestion cycle started', {
      primary: this.config.primarySource,
      fallbacks: this.config.fallbackSources,
    });

    // ── Try primary source ────────────────────────────────────────────────────
    const primaryResult = await this.runSource(this.config.primarySource);
    results.push(primaryResult.result);

    if (primaryResult.result.success && primaryResult.posts.length > 0) {
      allPosts.push(...primaryResult.posts);
      activeSources.push(this.config.primarySource);
      log.info(`Primary source (${this.config.primarySource}) succeeded`, {
        posts: primaryResult.posts.length,
      });
    } else {
      log.warn(`Primary source (${this.config.primarySource}) failed or returned 0 posts`);

      // ── Try fallbacks ───────────────────────────────────────────────────────
      for (const fallback of this.config.fallbackSources) {
        log.info(`Activating fallback source: ${fallback}`);

        await Alerts.fallbackActivated(this.config.primarySource, fallback);

        const fallbackResult = await this.runSource(fallback);
        results.push(fallbackResult.result);

        if (fallbackResult.result.success && fallbackResult.posts.length > 0) {
          allPosts.push(...fallbackResult.posts);
          activeSources.push(fallback);
          log.info(`Fallback source (${fallback}) succeeded`, {
            posts: fallbackResult.posts.length,
          });
          break; // Stop at first successful fallback
        }

        log.warn(`Fallback source (${fallback}) also failed`);
      }
    }

    // ── All sources failed ────────────────────────────────────────────────────
    if (allPosts.length === 0) {
      log.error('All ingestion sources failed — no posts collected');
      await Alerts.ingestionFailed('all-sources', 'All sources returned 0 posts');
    }

    const overallSuccess = allPosts.length > 0;

    log.info('Ingestion cycle completed', {
      overallSuccess,
      totalPosts: allPosts.length,
      activeSources,
    });

    return {
      posts: deduplicatePosts(allPosts),
      results,
      activeSources,
      overallSuccess,
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
      switch (source) {
        case 'creative-center': {
          const job = new CreativeCenterJob(this.region);
          const { output, result } = await job.run();
          return { posts: output.posts, result };
        }

        case 'ensemble': {
          const { EnsembleJob } = await import('./ensemble/ensemble.job');
          const job = new EnsembleJob(this.region);
          const { output, result } = await job.run();
          return { posts: output.posts, result };
        }

        case 'rapidapi': {
          // Placeholder — RapidAPI client will be added here
          log.info('RapidAPI source not yet configured — skipping');
          return {
            posts: [],
            result: {
              source: 'rapidapi',
              success: false,
              postsCollected: 0,
              productsExtracted: 0,
              hashtagsCollected: 0,
              errors: ['RapidAPI client not yet configured'],
              durationMs: 0,
              ranAt: new Date(),
            },
          };
        }

        default:
          throw new Error(`Unknown source: ${source}`);
      }
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
