/**
 * Backfill: Categories & Suppliers
 *
 * For every active product in the DB:
 * 1. Re-maps the category to the 3-level TikTok Shop taxonomy using matchCategoryPath()
 * 2. Searches Rainforest (Amazon) with the product title to get fresh supplier links
 * 3. Also generates AliExpress + Alibaba search links for manual unit verification
 * 4. Updates the product with categoryPath, subCategory, categoryLeaf, and suppliers[]
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { Product } from '../src/models/product.model';
import { matchCategoryPath } from '../src/api/products/product.constants';
import { RainforestService } from '../src/services/rainforest.service';
import { MarketResearchService } from '../src/services/market-research.service';

/**
 * Parse Amazon's recent_sales string.
 * Example: "20K+ bought in past month" -> 20000
 * Example: "50+ bought in past month" -> 50
 */
function parseRecentSales(salesString?: string): number {
  if (!salesString) return 0;
  
  const match = salesString.match(/^(\d+)(K)?\+?/i);
  if (!match) return 0;
  
  const num = parseInt(match[1], 10);
  if (match[2]) { // 'K' is present
    return num * 1000;
  }
  return num;
}

const DELAY_MS = 2000; // rate limit Rainforest

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');
  // Ensure we connect to the correct database
  const dbUri = uri.endsWith('/') ? `${uri}validds` : uri.includes('/validds') ? uri : `${uri}/validds`;
  await mongoose.connect(dbUri);
  console.log('Connected to MongoDB');

  const products = await Product.find({}).lean();
  console.log(`Found ${products.length} products to backfill`);

  let updated = 0;
  let errors = 0;

  for (const product of products) {
    try {
      const title = product.title;
      const niche = (product.category as string) || title;

      // 1. Re-derive 3-level category
      const { category, subCategory, categoryLeaf, categoryPath } = matchCategoryPath(niche);

      // 2. Rainforest lookup for supplier links
      let suppliers: any[] = [];
      const now = new Date();
      const searchTerm = encodeURIComponent(title);
      let verifiedUnitsSold = 0;
      let bestAmazonResult: any = null;

      const rainforestResponse = await RainforestService.searchAmazonProducts(title).catch(() => null);
      if (rainforestResponse?.search_results?.length) {

        for (const r of rainforestResponse.search_results) {
          if (r.recent_sales && r.link) {
            const sales = parseRecentSales(r.recent_sales);
            if (sales > verifiedUnitsSold) {
              verifiedUnitsSold = sales;
              bestAmazonResult = r;
            }
          }
        }

        suppliers = rainforestResponse.search_results
          .slice(0, 5)
          .filter((r: any) => r.link)
          .map((r: any) => {
            const isTopVerified = bestAmazonResult && r.link === bestAmazonResult.link;
            return {
              platform:   'Amazon',
              productUrl: r.link,
              price:      r.price?.value ?? r.prices?.[0]?.value,
              currency:   'USD',
              verified:   isTopVerified ? true : false,
              checkedAt:  now,
            };
          });
      }

      // 3. Fallback to Web Search if Amazon had no verified sales
      if (verifiedUnitsSold === 0) {
        const webResearch = await MarketResearchService.estimateGlobalSales(title);
        if (webResearch && webResearch.sales > 0 && webResearch.url) {
          verifiedUnitsSold = webResearch.sales;
          suppliers.unshift({
            platform: 'Web Search',
            productUrl: webResearch.url,
            currency: 'USD',
            verified: true,
            checkedAt: now,
          });
        }
      }

      // 4. Always add AliExpress + Alibaba if not already included through something else
      suppliers.push(
        { platform: 'AliExpress', productUrl: `https://www.aliexpress.com/wholesale?SearchText=${searchTerm}`, verified: false, checkedAt: now },
        { platform: 'Alibaba',    productUrl: `https://www.alibaba.com/trade/search?SearchText=${searchTerm}`,    verified: false, checkedAt: now },
      );

      // 5. Write update
      await Product.updateOne(
        { _id: product._id },
        {
          $set: {
            category,
            subCategory,
            categoryLeaf,
            categoryPath,
            suppliers,
            unitsSold: verifiedUnitsSold,
          },
        }
      );

      console.log(`✔ ${title} → ${categoryPath} | ${suppliers.length} suppliers`);
      updated++;

      // Throttle Rainforest calls
      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err: any) {
      console.error(`✘ ${product.title}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Updated: ${updated} | Errors: ${errors}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
