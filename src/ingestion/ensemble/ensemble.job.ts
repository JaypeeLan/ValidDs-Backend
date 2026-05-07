import { EnsembleClient } from './ensemble.client';
import { ENSEMBLE_CATEGORY_KEYWORDS } from './hashtag.constants';
import { transformEnsemblePosts, transformEnsembleComments } from './ensemble.transformer';
import { NormalizedPost, NormalizedComment, NormalizedHashtag, NormalizedKeyword, IngestionJobResult } from '../ingestion.types';
import { logger } from '../../logger';
import { ingestionJobsTotal, ingestionRecordsIngested } from '../../monitoring/metrics';
import { FreshnessService } from '../../freshness/freshness.service';

const log = logger.child({ module: 'ensemble-job' });

export interface EnsembleJobOutput {
  posts: NormalizedPost[];
  hashtags: NormalizedHashtag[];
  keywords: NormalizedKeyword[];
}

/**
 * EnsembleData Ingestion Job
 *
 * Runs data collection cycle using EnsembleData:
 * Searches category keywords (plus tiktokmademebuyit) via keyword search to seed feed.
 *
 * Scheduled as a fallback inside IngestionOrchestrator.
 */
export class EnsembleJob {
  private readonly client: EnsembleClient;
  private readonly region: string;

  constructor(region = process.env.TIKTOK_REGION ?? 'US') {
    this.region = region;
    this.client = new EnsembleClient(region);
  }

  async run(): Promise<{ output: EnsembleJobOutput; result: IngestionJobResult }> {
    const startTime = Date.now();
    const errors: string[] = [];
    const output: EnsembleJobOutput = {
      posts: [],
      hashtags: [],  // Ensemble keyword search doesn't return aggregate trends
      keywords: [],
    };

    log.info('EnsembleData job started', { region: this.region });

    const isAlive = await this.client.ping();
    if (!isAlive) {
      const msg = 'EnsembleData not reachable or missing API key';
      log.error(msg);
      ingestionJobsTotal.inc({ source: 'ensemble', status: 'failure' });

      return {
        output,
        result: {
          source: 'ensemble',
          success: false,
          postsCollected: 0,
          productsExtracted: 0,
          hashtagsCollected: 0,
          errors: [msg],
          durationMs: Date.now() - startTime,
          ranAt: new Date(),
        },
      };
    }

    try {
      // Gather top posts: same category terms as hashtags, lowercased for keyword API
      const rawPosts = [];

      for (const kw of ENSEMBLE_CATEGORY_KEYWORDS) {
        const posts = await this.client.searchPosts(kw);
        rawPosts.push(...posts);
      }

      if (rawPosts.length > 0) {
        const normalized = transformEnsemblePosts(rawPosts);
        // Filter out posts with less than 50k views before adding to output
        const filtered = normalized.filter(post => post.viewCount >= 50_000);
        output.posts.push(...filtered);
        
        ingestionRecordsIngested.inc(
          { source: 'ensemble', entity: 'product' },
          filtered.length
        );
        log.info(`Collected ${filtered.length} trending posts from EnsembleData (filtered from ${normalized.length} raw posts)`);
      }
    } catch (err) {
      const msg = `EnsembleData posts collection failed: ${String(err)}`;
      errors.push(msg);
      log.error(msg);
    }

    const success = output.posts.length > 0;
    const durationMs = Date.now() - startTime;

    if (success) {
      await FreshnessService.markUpdated('product');
      ingestionJobsTotal.inc({ source: 'ensemble', status: 'success' });
    } else {
      ingestionJobsTotal.inc({ source: 'ensemble', status: 'failure' });
    }

    const result: IngestionJobResult = {
      source: 'ensemble',
      success,
      postsCollected: output.posts.length,
      productsExtracted: 0,
      hashtagsCollected: output.hashtags.length,
      errors,
      durationMs,
      ranAt: new Date(),
    };

    return { output, result };
  }

  /**
   * Hashtag-based ingestion with cursor pagination.
   *
   * For each hashtag in the provided list, fetches posts page by page:
   *   - development : 2 pages  (cursor 0 → 20)
   *   - staging / production : all pages (cursor 0 → 4000, or until empty)
   *
   * For every post collected it also fetches top comments so the AI
   * extraction layer can evaluate buying intent and sentiment.
   *
   * Returns the full post list and a commentMap keyed by videoId.
   */
  async runHashtagIngestion(
    hashtags: string[],
    processPage: (posts: NormalizedPost[]) => Promise<{ shouldStop: boolean }>
  ): Promise<void> {
    const isDev = process.env.NODE_ENV === 'development';
    // dev = 3 pages (cursor 0, 20, 40), production = all pages up to ~4000-5000
    const MAX_CURSOR = isDev ? 40 : 2000;

    log.info('Hashtag ingestion started', {
      hashtags,
      mode: isDev ? 'development (2 pages)' : 'full pagination',
    });

    for (const hashtag of hashtags) {
      let cursor: number | null = 0;
      let pagesFetched = 0;

      while (cursor !== null && cursor <= MAX_CURSOR) {
        const { posts: rawPosts, nextCursor } = await this.client.getHashtagPosts(hashtag, cursor);

        if (rawPosts.length === 0) {
          log.debug(`#${hashtag} returned 0 posts at cursor=${cursor} — stopping pagination`);
          break;
        }

        const normalized = transformEnsemblePosts(rawPosts);
        pagesFetched++;

        log.debug(`#${hashtag} cursor=${cursor}: ${normalized.length} posts collected (page ${pagesFetched})`);

        const { shouldStop } = await processPage(normalized);
        if (shouldStop) {
          log.info('Pagination stopped early by processor callback');
          return;
        }

        // Use API-provided nextCursor; fall back to null to stop if missing
        cursor = nextCursor;
      }
    }

    log.info('Hashtag ingestion complete');
  }

  /**
   * Fetch comments for a specific post on demand.
   * Used by the pipeline to fetch comments ONLY for qualifying posts,
   * saving significant API limits.
   */
  async getPostComments(videoId: string): Promise<NormalizedComment[]> {
    const rawComments = await this.client.getPostComments(videoId);
    if (rawComments.length === 0) return [];
    
    return transformEnsembleComments(rawComments, videoId);
  }

  /**
   * Behavioral keyword ingestion with recency constraints.
   * 
   * Uses the 'Full Search' endpoint to find high-intent phrases 
   * (e.g., "I need this") posted within the last X days.
   */
  async runBehavioralSearch(
    keywords: string[],
    days: 1 | 7 | 30 = 7,
    processPage: (posts: NormalizedPost[]) => Promise<{ shouldStop: boolean }>
  ): Promise<void> {
    log.info('Behavioral keyword ingestion started', { keywords, days });

    for (const kw of keywords) {
      let cursor: number | null = 0;
      let pagesFetched = 0;
      const MAX_PAGES = 3; // Keep behavioral searches tight to conserve credits

      while (cursor !== null && pagesFetched < MAX_PAGES) {
        const { posts: rawPosts, nextCursor } = await this.client.searchKeywordFull({
          name: kw,
          days,
          cursor,
          sorting: 1, // Sort by 'Relevance' or 'Most Recent' (Ensemble docs vary, usually 1 is relevance/trend)
        });

        if (rawPosts.length === 0) {
          log.debug(`Keyword "${kw}" returned 0 posts — stopping pagination`);
          break;
        }

        const normalized = transformEnsemblePosts(rawPosts);
        pagesFetched++;

        log.debug(`Keyword "${kw}" page ${pagesFetched}: ${normalized.length} posts collected`);

        const { shouldStop } = await processPage(normalized);
        if (shouldStop) {
          log.info('Behavioral search stopped early');
          return;
        }

        cursor = nextCursor;
      }
    }

    log.info('Behavioral keyword ingestion complete');
  }
}
