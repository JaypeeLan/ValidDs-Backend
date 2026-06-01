/**
 * Legacy one-off: move non-Meta rows out of DB section `trending`.
 * Prefer: scraper/scripts/maintenance/reclassify_creative_sections.py
 *
 *   node scripts/fix-creative-sections.cjs --market US --dry-run
 */
const path = require('path');
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const marketArg =
    argv.find((a) => a.startsWith('--market='))?.split('=')[1] ??
    (argv.includes('--market') ? argv[argv.indexOf('--market') + 1] : 'US');
  return { dryRun, market: String(marketArg || 'US').toUpperCase() };
}

async function main() {
  const { dryRun, market } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'validds';
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(dbName).collection(`creatives_${market.toLowerCase()}`);

  const filter = {
    section: 'trending',
    externalVideoId: { $not: { $regex: /^meta:/ } },
  };
  const count = await coll.countDocuments(filter);
  console.log(
    `${coll.collectionName}: ${count} TikTok row(s) in Meta bucket (section=trending)`,
    dryRun ? '(dry-run)' : '',
  );

  if (!dryRun && count > 0) {
    const res = await coll.updateMany(filter, { $set: { section: 'top-ads' } });
    console.log(`  moved ${res.modifiedCount} to section=top-ads`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
