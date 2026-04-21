/**
 * Scratch: test the three-step searchapi.io review flow:
 *  1. google_shopping  → get product_token + prds
 *  2. google_product   → use product_token to get reviews & details
 *
 * Run: npx ts-node scratch/test-reviews-search.ts
 */
import 'dotenv/config';
import axios from 'axios';

const BASE = 'https://www.searchapi.io/api/v1/search';
const KEY  = process.env.SERPAPI_KEY!;

const PRODUCT = 'Protein Loaded Coffee Single Packet 16oz Coffee Drink Mix 10g Protein';

async function get(engine: string, params: Record<string, string> = {}) {
  const res = await axios.get(BASE, {
    params: { api_key: KEY, engine, ...params },
    timeout: 15_000,
  });
  return res.data;
}

async function main() {
  if (!KEY) { console.error('SERPAPI_KEY not set'); process.exit(1); }

  // ── Step 1: Google Shopping → product_token ───────────────────────────────
  console.log('Step 1: google_shopping...');
  const shopping = await get('google_shopping', { q: PRODUCT, gl: 'us', hl: 'en' });

  const first = shopping.shopping_results?.[0];
  console.log('\nFirst shopping result:');
  console.log(JSON.stringify(first, null, 2));

  if (!first?.product_token) {
    console.log('\nNo product_token found. Full shopping_results:');
    console.log(JSON.stringify(shopping.shopping_results?.slice(0, 3), null, 2));
    return;
  }

  const productToken = first.product_token;
  const prds = first.prds;
  console.log(`\nproduct_token: ${productToken}`);
  console.log(`prds:          ${prds}`);

  // ── Step 2: Google Product → reviews ────────────────────────────────────
  console.log('\nStep 2: google_product...');
  const product = await get('google_product', {
    product_token: productToken,
    gl: 'us',
    hl: 'en',
  });

  console.log('\nTop-level keys:', Object.keys(product));
  console.log('\nFull response:');
  console.log(JSON.stringify(product, null, 2));
}

main().catch(console.error);
