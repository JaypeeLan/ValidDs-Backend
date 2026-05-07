import { EchoTikClient, EchoTikListParams } from './echotik.client';
import { transformEchoTikProducts, transformEchoTikComments } from './echotik.transformer';
import { NormalizedEchoTikProduct, NormalizedEchoTikComment, IngestionJobResult } from '../ingestion.types';
import { logger } from '../../logger';
import { FreshnessService } from '../../freshness/freshness.service';

const log = logger.child({ module: 'echotik-job' });

// ── Ingestion thresholds ───────────────────────────────────────────────────────

/**
 * Minimum 30-day sales for a product to be worth ingesting.
 * Keeps low-volume / zero-sales products out of the DB.
 */
const MIN_SALE_30D = 50;

/**
 * Maximum pages to paginate in each mode.
 * page_size=10, so dev=30 products, prod=500 products per run.
 */
const MAX_PAGES_DEV  = 3;
const MAX_PAGES_PROD = 50;

// ── Output type ────────────────────────────────────────────────────────────────

export interface EchoTikJobOutput {
  products: NormalizedEchoTikProduct[];
  comments: Map<string, NormalizedEchoTikComment[]>; // keyed by productId
}

// ── Job ───────────────────────────────────────────────────────────────────────

/**
 * EchoTik Ingestion Job
 *
 * Primary data acquisition source replacing EnsembleData.
 *
 * Strategy:
 *  1. Paginate /product/list sorted by 30-day sales descending (best products first)
 *  2. For products with review_count > 10, fetch verified buyer reviews
 *  3. Emit normalized products + comments for the EchoTik pipeline to persist
 *
 * No AI extraction is needed — EchoTik returns structured product data directly.
 */
export class EchoTikJob {
  readonly client: EchoTikClient;
  private readonly region: string;

  constructor(region = process.env.ECHOTIK_REGION ?? process.env.TIKTOK_REGION ?? 'US') {
    this.region = region;
    this.client = new EchoTikClient(region);
  }

  /**
   * Run a standard ingestion batch:
   * Paginate /product/list (sorted by 30d sales) until page cap is reached.
   */
  async run(): Promise<{ output: EchoTikJobOutput; result: IngestionJobResult }> {
    const startTime = Date.now();
    const errors: string[] = [];
    const output: EchoTikJobOutput = {
      products: [],
      comments: new Map(),
    };

    log.info('EchoTik job started', { region: this.region });

    const isAlive = await this.client.ping();
    if (!isAlive) {
      const msg = 'EchoTik not reachable — check ECHOTIK_USERNAME / ECHOTIK_PASSWORD';
      log.error(msg);
      return {
        output,
        result: {
          source: 'echotik',
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

    const isDev   = process.env.NODE_ENV === 'development';
    const maxPages = isDev ? MAX_PAGES_DEV : MAX_PAGES_PROD;

    log.info('Paginating /product/list', { maxPages, sortBy: '30d-sales-desc', region: this.region });

    for (let page = 1; page <= maxPages; page++) {
      try {
        const params: EchoTikListParams = {
          region:              this.region,
          page_num:            page,
          page_size:           10,
          product_sort_field:  5,  // sort by 30d sales
          sort_type:           1,  // descending
          min_total_sale_30d_cnt: MIN_SALE_30D,
        };

        const rawProducts = await this.client.listProducts(params);

        // Empty page = end of data
        if (!rawProducts || rawProducts.length === 0) {
          log.debug(`EchoTik /product/list — page ${page} returned 0 results, stopping`);
          break;
        }

        const normalized = transformEchoTikProducts(rawProducts);

        log.debug(`Page ${page}: ${normalized.length} products after transform`);
        output.products.push(...normalized);

        // Fetch reviews for products with meaningful review counts
        for (const product of normalized) {
          if (product.reviewCount >= 10) {
            try {
              const rawComments = await this.client.getProductComments(
                product.productId,
                this.region,
                1,
                10
              );
              if (rawComments.length > 0) {
                output.comments.set(
                  product.productId,
                  transformEchoTikComments(rawComments, product.productId)
                );
              }
            } catch (err) {
              log.warn(`Failed to fetch comments for product ${product.productId}`, {
                err: String(err),
              });
            }
          }
        }
      } catch (err) {
        const msg = `EchoTik page ${page} failed: ${String(err)}`;
        errors.push(msg);
        log.error(msg);
        break; // Don't retry on pagination errors — come back next run
      }
    }

    const success = output.products.length > 0;
    const durationMs = Date.now() - startTime;

    if (success) {
      await FreshnessService.markUpdated('product');
    }

    log.info('EchoTik job complete', {
      products:   output.products.length,
      withComments: output.comments.size,
      durationMs,
      errors:     errors.length,
    });

    return {
      output,
      result: {
        source:              'echotik',
        success,
        postsCollected:      output.products.length,
        productsExtracted:   output.products.length,
        hashtagsCollected:   0,
        errors,
        durationMs,
        ranAt:               new Date(),
      },
    };
  }

  /**
   * Paginated ingestion with a per-page callback.
   *
   * Allows the pipeline to process and persist products incrementally
   * (page by page) rather than loading everything into memory first.
   *
   * The callback should return { shouldStop: true } to halt early.
   */
  async runPaginated(
    params: Omit<EchoTikListParams, 'page_num'>,
    processPage: (
      products: NormalizedEchoTikProduct[],
      comments: Map<string, NormalizedEchoTikComment[]>
    ) => Promise<{ shouldStop: boolean }>
  ): Promise<void> {
    const isDev    = process.env.NODE_ENV === 'development';
    const maxPages = isDev ? MAX_PAGES_DEV : MAX_PAGES_PROD;

    log.info('EchoTik paginated ingestion started', { maxPages, params });

    for (let page = 1; page <= maxPages; page++) {
      const rawProducts = await this.client.listProducts({ ...params, page_num: page, page_size: 10 });

      if (!rawProducts || rawProducts.length === 0) {
        log.debug(`Page ${page} empty — end of data`);
        break;
      }

      const normalized = transformEchoTikProducts(rawProducts);
      const comments   = new Map<string, NormalizedEchoTikComment[]>();

      // Fetch comments for qualifying products
      for (const product of normalized) {
        if (product.reviewCount >= 10) {
          try {
            const raw = await this.client.getProductComments(product.productId, this.region, 1, 10);
            if (raw.length > 0) {
              comments.set(product.productId, transformEchoTikComments(raw, product.productId));
            }
          } catch { /* non-fatal */ }
        }
      }

      log.debug(`Page ${page}: processing ${normalized.length} products`);
      const { shouldStop } = await processPage(normalized, comments);
      if (shouldStop) {
        log.info('Pagination stopped early by processor callback');
        break;
      }
    }

    log.info('EchoTik paginated ingestion complete');
  }

  /**
   * Fetch today's best-selling ranked products.
   * Uses /product/ranklist for higher-confidence trending signal.
   */
  async runRanklist(date?: string): Promise<NormalizedEchoTikProduct[]> {
    const d = date ?? yesterday();
    log.info('Fetching EchoTik daily ranklist', { date: d, region: this.region });

    const rawProducts = await this.client.getRanklist({
      region:             this.region,
      date:               d,
      rank_type:          1,   // daily
      product_rank_field: 1,   // ranked by sales count
      page_num:           1,
      page_size:          10,
    });

    const products = transformEchoTikProducts(rawProducts);
    log.info(`Ranklist fetched: ${products.length} products`);
    return products;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
