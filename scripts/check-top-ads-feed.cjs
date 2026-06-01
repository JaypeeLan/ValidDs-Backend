/**
 * Simulate GET /creatives/top-ads page 1 — list duplicate products if any.
 *   node scripts/check-top-ads-feed.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');
const { computedAdDedupeKeyExpr } = require('./dedupe-creatives.cjs');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const coll = client.db(process.env.MONGODB_DB_NAME || 'validds').collection('creatives_us');

  const page = await coll
    .aggregate(
      [
        { $match: { section: 'trending', externalVideoId: { $regex: /^meta:/ } } },
        { $sort: { 'metrics.viewCount': -1, publishedAt: -1 } },
        { $addFields: { _feedDedupeKey: computedAdDedupeKeyExpr() } },
        { $group: { _id: '$_feedDedupeKey', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { 'metrics.viewCount': -1, publishedAt: -1 } },
        { $limit: 20 },
        { $project: { productName: 1, productId: 1, externalVideoId: 1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const byProduct = new Map();
  for (const row of page) {
    const pid = String(row.productId);
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid).push(row);
  }

  const dupProducts = [...byProduct.entries()].filter(([, rows]) => rows.length > 1);
  console.log('Page 1 (ads tab simulation):', page.length, 'cards');
  if (dupProducts.length) {
    console.log('Duplicate products on page 1:');
    for (const [pid, rows] of dupProducts) {
      console.log(' ', pid, rows.map((r) => `${r.externalVideoId} (${r.productName})`).join(' | '));
    }
  } else {
    console.log('No duplicate products on page 1.');
  }

  const vitamin = page.filter((r) => /vitamin d3/i.test(String(r.productName || '')));
  console.log(
    'Vitamin D3 on page 1:',
    vitamin.length,
    vitamin.map((r) => r.externalVideoId).join(', ') || 'none',
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
