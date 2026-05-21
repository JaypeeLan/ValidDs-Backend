import { Request, Response } from 'express';
import { ShopifyService } from '../../services/shopify.service';
import { logger } from '../../logger';

const log = logger.child({ module: 'shopify-webhook' });

/**
 * POST /api/v1/webhooks/shopify
 *
 * Mandatory compliance + lifecycle topics (register in Partner Dashboard).
 * Uses raw body — registered before express.json in app.ts.
 */
export async function handleShopifyWebhook(req: Request, res: Response): Promise<void> {
  const topic = req.headers['x-shopify-topic'];
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!ShopifyService.isConfigured()) {
    res.status(503).send('Shopify not configured');
    return;
  }

  const payload = req.body;
  if (!Buffer.isBuffer(payload)) {
    log.error('Shopify webhook body is not a Buffer');
    res.status(500).send('Invalid webhook body');
    return;
  }

  if (!ShopifyService.verifyWebhookHmac(payload, typeof hmac === 'string' ? hmac : undefined)) {
    log.warn('Shopify webhook HMAC verification failed', { topic, shopDomain });
    res.status(401).send('Invalid HMAC');
    return;
  }

  const topicName = typeof topic === 'string' ? topic : 'unknown';
  const shop = typeof shopDomain === 'string' ? shopDomain : undefined;

  try {
    switch (topicName) {
      case 'app/uninstalled':
        if (shop) await ShopifyService.handleAppUninstalled(shop);
        break;
      case 'customers/data_request':
      case 'customers/redact':
      case 'shop/redact':
        log.info('Shopify compliance webhook received', { topic: topicName, shop });
        break;
      default:
        log.debug('Shopify webhook (unhandled topic)', { topic: topicName, shop });
    }
    res.status(200).send('OK');
  } catch (err) {
    log.error('Shopify webhook handler failed', { topic: topicName, err: String(err) });
    res.status(500).send('Webhook handler error');
  }
}
