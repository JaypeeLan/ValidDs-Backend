/**
 * Backfill transaction amounts that were stored as $0 during trial signups.
 *
 *   npx ts-node --transpile-only scripts/backfill-transaction-amounts.ts
 *   npx ts-node --transpile-only scripts/backfill-transaction-amounts.ts --dry-run
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Transaction } from '../src/models/transaction.model';
import { getStripe } from '../src/services/stripe.service';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const stripe = getStripe();

  await connectMongo();

  const rows = await Transaction.find({ amount: 0 }).lean();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const meta = row.metadata as Map<string, string> | Record<string, string> | undefined;
    const priceId =
      (meta instanceof Map ? meta.get('priceId') : meta?.priceId) ??
      (typeof meta === 'object' && meta && 'priceId' in meta
        ? String((meta as Record<string, string>).priceId)
        : '');

    if (!priceId || !stripe) {
      skipped += 1;
      continue;
    }

    try {
      const price = await stripe.prices.retrieve(priceId);
      const unitAmount = price.unit_amount ?? 0;
      if (unitAmount <= 0) {
        skipped += 1;
        continue;
      }

      const dollars = unitAmount / 100;
      console.log(`${dryRun ? '[dry-run] ' : ''}update ${row._id} → $${dollars} (${priceId})`);

      if (!dryRun) {
        await Transaction.updateOne({ _id: row._id }, { $set: { amount: dollars } });
      }
      updated += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`skip ${row._id}:`, String(err));
    }
  }

  console.log(`Done. updated=${updated} skipped=${skipped} dryRun=${dryRun}`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
