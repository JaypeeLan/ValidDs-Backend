import { EnsembleClient } from './ensemble.client';
import { transformEnsemblePosts } from './ensemble.transformer';
import { NormalizedPost, NormalizedHashtag, NormalizedKeyword, IngestionJobResult } from '../ingestion.types';
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
 * Searches for 'tiktokmademebuyit' / 'dropshipping' / 'product' posts to seed feed.
 *
 * Scheduled as a fallback inside IngestionOrchestrator.
 */
export class EnsembleJob {
  private readonly client: EnsembleClient;
  private readonly region: string;

  constructor(region = process.env.CREATIVE_CENTER_REGION ?? 'US') {
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
      // Gather top posts across trending product-focused keywords
      const keywords = ['tiktokmademebuyit', 'amazonfinds', 'musthaves'];
      const rawPosts = [];

      for (const kw of keywords) {
        const posts = await this.client.searchPosts(kw);
        rawPosts.push(...posts);
      }

      if (rawPosts.length > 0) {
        const normalized = transformEnsemblePosts(rawPosts);
        output.posts.push(...normalized);
        
        ingestionRecordsIngested.inc(
          { source: 'ensemble', entity: 'product' },
          normalized.length
        );
        log.info(`Collected ${normalized.length} trending posts from EnsembleData`);
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
}
