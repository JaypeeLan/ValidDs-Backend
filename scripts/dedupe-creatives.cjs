/**
 * Lightweight duplicate-creative cleanup (no ts-node — avoids OOM).
 *
 *   node scripts/dedupe-creatives.cjs --market US --dry-run
 *   npm run dedupe-creatives -- --market US
 */
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BATCH = 500;

function mongoImageAssetKeyExpr(urlExpr) {
  const base = {
    $toLower: {
      $let: {
        vars: {
          noQuery: { $arrayElemAt: [{ $split: [{ $ifNull: [urlExpr, ''] }, '?'] }, 0] },
        },
        in: { $arrayElemAt: [{ $split: ['$$noQuery', '~tplv-'] }, 0] },
      },
    },
  };
  const hashMatch = { $regexFind: { input: base, regex: '/([a-f0-9]{32})(?:~|$)' } };
  return {
    $let: {
      vars: { base, hashMatch },
      in: {
        $cond: [
          { $ne: ['$$hashMatch', null] },
          { $arrayElemAt: ['$$hashMatch.captures', 0] },
          '$$base',
        ],
      },
    },
  };
}

function mongoMetaAdDedupeKeyExpr() {
  const page = {
    $toLower: {
      $trim: {
        input: { $ifNull: ['$metaPageId', { $ifNull: ['$creator.handle', ''] }] },
      },
    },
  };
  const desc = {
    $replaceAll: {
      input: { $toLower: { $trim: { input: { $ifNull: ['$description', ''] } } } },
      find: '  ',
      replacement: ' ',
    },
  };
  const thumb = mongoImageAssetKeyExpr('$thumbnailUrl');
  const productThumb = mongoImageAssetKeyExpr('$productPrimaryImageUrl');
  const pid = { $toString: '$productId' };
  const visualKey = { $concat: ['meta:visual:', page, ':', pid, ':', thumb] };
  return {
    $let: {
      vars: { page, desc, thumb, productThumb, pid, visualKey },
      in: {
        $cond: [
          {
            $and: [
              { $ne: ['$$thumb', ''] },
              { $ne: ['$$productThumb', ''] },
              { $eq: ['$$thumb', '$$productThumb'] },
            ],
          },
          '$$visualKey',
          {
            $cond: [
              { $gte: [{ $strLenCP: '$$desc' }, 12] },
              { $concat: ['meta:text:', '$$page', ':', { $substrCP: ['$$desc', 0, 240] }] },
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$$page', ''] },
                      { $ne: ['$$thumb', ''] },
                      { $ne: ['$$pid', ''] },
                    ],
                  },
                  '$$visualKey',
                  '$externalVideoId',
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

function mongoTiktokVideoDedupeKeyExpr() {
  return {
    $let: {
      vars: {
        postMatch: {
          $regexFind: {
            input: { $ifNull: ['$tiktokPostUrl', ''] },
            regex: '(?:/video/|embed/v2/)(\\d+)',
            options: 'i',
          },
        },
        embedMatch: {
          $regexFind: {
            input: { $ifNull: ['$embedUrl', ''] },
            regex: '(?:/video/|embed/v2/)(\\d+)',
            options: 'i',
          },
        },
      },
      in: {
        $cond: [
          { $ne: ['$$postMatch', null] },
          { $concat: ['tiktok:', { $arrayElemAt: ['$$postMatch.captures', 0] }] },
          {
            $cond: [
              { $ne: ['$$embedMatch', null] },
              { $concat: ['tiktok:', { $arrayElemAt: ['$$embedMatch.captures', 0] }] },
              {
                $cond: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ['$externalVideoId', ''] },
                      regex: '^\\d+$',
                    },
                  },
                  { $concat: ['tiktok:', '$externalVideoId'] },
                  { $ifNull: ['$externalVideoId', { $ifNull: ['$tiktokPostUrl', ''] }] },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

function computedAdDedupeKeyExpr() {
  const thumb = mongoImageAssetKeyExpr('$thumbnailUrl');
  const productThumb = mongoImageAssetKeyExpr('$productPrimaryImageUrl');
  const pid = { $toString: '$productId' };
  return {
    $cond: [
      {
        $and: [
          { $ne: [thumb, ''] },
          { $ne: [productThumb, ''] },
          { $eq: [thumb, productThumb] },
          { $ne: [pid, ''] },
        ],
      },
      { $concat: ['product-card:', pid] },
      {
        $cond: [
          { $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' } },
          mongoMetaAdDedupeKeyExpr(),
          mongoTiktokVideoDedupeKeyExpr(),
        ],
      },
    ],
  };
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const marketArg =
    argv.find((a) => a.startsWith('--market='))?.split('=')[1] ??
    (argv.includes('--market') ? argv[argv.indexOf('--market') + 1] : 'US');
  const market = String(marketArg || 'US').toUpperCase();
  return { dryRun, market };
}

async function main() {
  const { dryRun, market } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'validds';
  if (!uri) {
    console.error('Missing MONGODB_URI in .env');
    process.exit(1);
  }

  const collName = `creatives_${market.toLowerCase()}`;
  const client = new MongoClient(uri);
  await client.connect();
  const coll = client.db(dbName).collection(collName);

  const total = await coll.estimatedDocumentCount();
  console.log(`Collection ${collName}: ~${total} docs (${dryRun ? 'dry-run' : 'live'})`);

  const feedKeyExpr = computedAdDedupeKeyExpr();

  const dupCursor = coll.aggregate(
    [
      { $addFields: { _feedDedupeKey: feedKeyExpr } },
      { $sort: { 'metrics.viewCount': -1, publishedAt: -1 } },
      {
        $group: {
          _id: '$_feedDedupeKey',
          keepId: { $first: '$_id' },
          keepKey: { $first: '$_feedDedupeKey' },
          ids: { $push: '$_id' },
        },
      },
      { $match: { $expr: { $gt: [{ $size: '$ids' }, 1] } } },
      {
        $project: {
          keepId: 1,
          keepKey: 1,
          toDelete: {
            $filter: {
              input: '$ids',
              as: 'id',
              cond: { $ne: ['$$id', '$keepId'] },
            },
          },
        },
      },
      { $unwind: '$toDelete' },
      {
        $project: {
          _id: '$toDelete',
          keepId: 1,
          keepKey: 1,
        },
      },
    ],
    { allowDiskUse: true },
  );

  let deleteCount = 0;
  let batch = [];
  const keepUpdates = new Map();

  for await (const row of dupCursor) {
    batch.push(row._id);
    if (row.keepKey && row.keepId) {
      keepUpdates.set(String(row.keepId), row.keepKey);
    }
    if (batch.length >= BATCH) {
      if (!dryRun) {
        await coll.deleteMany({ _id: { $in: batch } });
      }
      deleteCount += batch.length;
      const verb = dryRun ? 'would remove' : 'removed';
      console.log(`  ${verb} batch of ${batch.length} (total ${deleteCount})`);
      batch = [];
    }
  }

  if (batch.length) {
    if (!dryRun) {
      await coll.deleteMany({ _id: { $in: batch } });
    }
    deleteCount += batch.length;
    const verb = dryRun ? 'would remove' : 'removed';
    console.log(`  ${verb} batch of ${batch.length} (total ${deleteCount})`);
  }

  if (!dryRun) {
    const backfill = await coll.updateMany({}, [{ $set: { adDedupeKey: feedKeyExpr } }]);
    console.log(`  backfilled adDedupeKey on ${backfill.modifiedCount} doc(s)`);
  }

  if (!dryRun && keepUpdates.size) {
    const ops = [...keepUpdates.entries()].map(([id, key]) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: { $set: { adDedupeKey: key } },
      },
    }));
    for (let i = 0; i < ops.length; i += BATCH) {
      await coll.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
    console.log(`  set adDedupeKey on ${keepUpdates.size} kept row(s) from duplicate groups`);
  }

  console.log(
    `Done. ${deleteCount} duplicate(s) ${dryRun ? 'would be removed' : 'removed'} from ${collName}.`,
  );
  await client.close();
}

module.exports = { computedAdDedupeKeyExpr };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
