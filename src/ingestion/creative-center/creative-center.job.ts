import { CreativeCenterClient } from './creative-center.client';
import {
  transformTopAds,
  transformTrendingVideos,
  transformHashtags,
  transformKeywordTrends,
} from './creative-center.transformer';
import { NormalizedPost, NormalizedHashtag, NormalizedKeyword, IngestionJobResult } from '../ingestion.types';
import { logger } from '../../logger';
import { ingestionJobsTotal, ingestionRecordsIngested } from '../../monitoring/metrics';
import { FreshnessService } from '../../freshness/freshness.service';

const log = logger.child({ module: 'creative-center-job' });

export interface CreativeCenterJobOutput {
  posts: NormalizedPost[];
  hashtags: NormalizedHashtag[];
  keywords: NormalizedKeyword[];
}

/**
 * Creative Center Ingestion Job
 *
 * Runs a full data collection cycle against TikTok Creative Center:
 *  1. Top ads (past 30 days, up to 5 pages = 100 ads)
 *  2. Trending organic videos
 *  3. Trending hashtags
 *  4. Keyword trends
 *
 * All data is normalized and returned to the orchestrator.
 * The orchestrator is responsible for passing it to the AI extractor
 * and product repository.
 *
 * Scheduled via: src/jobs/product-refresh.job.ts
 * Typical run time: 30–60 seconds (due to rate limiting between requests)
 */

export class CreativeCenterJob {
  private readonly client: CreativeCenterClient;
  private readonly region: string;

  constructor(region = process.env.CREATIVE_CENTER_REGION ?? 'US') {
    this.region = region;
    this.client = new CreativeCenterClient(region);
  }

  /**
   * Run the full collection cycle.
   */
  async run(): Promise<{ output: CreativeCenterJobOutput; result: IngestionJobResult }> {
    const startTime = Date.now();
    const errors: string[] = [];
    const output: CreativeCenterJobOutput = {
      posts: [],
      hashtags: [],
      keywords: [],
    };

    log.info('Creative Center job started', { region: this.region });

    // ── 1. Check availability ─────────────────────────────────────────────────
    const isAlive = await this.client.ping();
    if (!isAlive) {
      const msg = 'Creative Center is not reachable';
      log.error(msg);
      ingestionJobsTotal.inc({ source: 'creative-center', status: 'failure' });

      return {
        output,
        result: {
          source: 'creative-center',
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

    // ── 2. Top ads ────────────────────────────────────────────────────────────
    try {
      const rawAds = await this.client.getTopAdsAll({
        period: 30,
        maxPages: 5,
        limit: 20,
      });
      const adPosts = transformTopAds(rawAds);
      output.posts.push(...adPosts);
      ingestionRecordsIngested.inc(
        { source: 'creative-center', entity: 'product' },
        adPosts.length
      );
      log.info(`Collected ${adPosts.length} ad posts`);
    } catch (err) {
      const msg = `Top ads collection failed: ${String(err)}`;
      errors.push(msg);
      log.error(msg);
    }

    // ── 3. Trending organic videos ────────────────────────────────────────────
    try {
      const rawVideos = await this.client.getTrendingVideos({ count: 30 });
      const videoPosts = transformTrendingVideos(rawVideos);
      output.posts.push(...videoPosts);
      ingestionRecordsIngested.inc(
        { source: 'creative-center', entity: 'video' },
        videoPosts.length
      );
      log.info(`Collected ${videoPosts.length} trending video posts`);
    } catch (err) {
      const msg = `Trending videos collection failed: ${String(err)}`;
      errors.push(msg);
      log.warn(msg);  // warn not error — videos are a secondary signal
    }

    // ── 4. Trending hashtags ──────────────────────────────────────────────────
    try {
      const rawHashtags = await this.client.getTrendingHashtags({
        period: 7,
        limit: 50,
      });
      const normalizedHashtags = transformHashtags(rawHashtags, this.region);
      output.hashtags.push(...normalizedHashtags);
      ingestionRecordsIngested.inc(
        { source: 'creative-center', entity: 'trend' },
        normalizedHashtags.length
      );
      log.info(`Collected ${normalizedHashtags.length} trending hashtags`);
    } catch (err) {
      const msg = `Trending hashtags collection failed: ${String(err)}`;
      errors.push(msg);
      log.warn(msg);
    }

    // ── 5. Keyword trends ─────────────────────────────────────────────────────
    try {
      const rawKeywords = await this.client.getKeywordTrends({
        period: 7,
        limit: 30,
      });
      const normalizedKeywords = transformKeywordTrends(rawKeywords, this.region);
      output.keywords.push(...normalizedKeywords);
      log.info(`Collected ${normalizedKeywords.length} keyword trends`);
    } catch (err) {
      const msg = `Keyword trends collection failed: ${String(err)}`;
      errors.push(msg);
      log.warn(msg);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const success = output.posts.length > 0;
    const durationMs = Date.now() - startTime;

    if (success) {
      await FreshnessService.markUpdated('product');
      await FreshnessService.markUpdated('video');
      await FreshnessService.markUpdated('trend');
      ingestionJobsTotal.inc({ source: 'creative-center', status: 'success' });
    } else {
      ingestionJobsTotal.inc({ source: 'creative-center', status: 'failure' });
    }

    const result: IngestionJobResult = {
      source: 'creative-center',
      success,
      postsCollected: output.posts.length,
      productsExtracted: 0,          // set by orchestrator after AI extraction
      hashtagsCollected: output.hashtags.length,
      errors,
      durationMs,
      ranAt: new Date(),
    };

    log.info('Creative Center job completed', {
      success,
      postsCollected: result.postsCollected,
      hashtagsCollected: result.hashtagsCollected,
      durationMs,
      errors: errors.length,
    });

    return { output, result };
  }
}
