/**
 * Backfill supplier.productUnitsSold to ensure it's never null/0.
 *
 *   npx ts-node --transpile-only scripts/backfill-supplier-units-sold.ts --market US
 *   npx ts-node --transpile-only scripts/backfill-supplier-units-sold.ts --market US --limit 500
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getMarketModels } from '../src/models/market-models.factory';
import { toMarketCode } from '../src/utils/markets';
import { ensureSupplierProductUnitsSold } from '../src/api/internal/ingest.normalize';

function supplierSeed(row: Record<string, unknown>, productId: string): string {
  const shop =
    row.shop && typeof row.shop === 'object' ? (row.shop as Record<string, unknown>) : {};
  for (const candidate of [shop.url, row.productUrl, row.shareUrl, row.externalId, row.title]) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return `supplier:${productId}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const market = toMarketCode(
    String(
      args.find((a) => a.startsWith('--market='))?.split('=')[1] ??
        (args.includes('--market') ? args[args.indexOf('--market') + 1] : 'US'),
    ).toUpperCase(),
  );
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0) || 0;

  await connectMongo();
  const { Product } = getMarketModels(market);

  const cursor = Product.find({
    suppliers: { $type: 'array', $ne: [] },
    $or: [
      { 'suppliers.productUnitsSold': null },
      { 'suppliers.productUnitsSold': { $exists: false } },
      { 'suppliers.productUnitsSold': 0 },
    ],
  })
    .select({ _id: 1, suppliers: 1 })
    .lean()
    .cursor();

  let scanned = 0;
  let updatedProducts = 0;
  let updatedSuppliers = 0;
  let skipped = 0;

  for await (const row of cursor) {
    if (limit > 0 && scanned >= limit) break;
    scanned += 1;

    const id = String((row as { _id?: unknown })._id ?? '');
    const suppliers = Array.isArray((row as { suppliers?: unknown }).suppliers)
      ? ((row as { suppliers: unknown[] }).suppliers as unknown[])
      : [];
    if (!id || !suppliers.length) {
      skipped += 1;
      continue;
    }

    let changed = false;
    const next = suppliers.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const sup = { ...(s as Record<string, unknown>) };
      const v = Number(sup.productUnitsSold);
      if (Number.isFinite(v) && v > 0) return sup;
      const seed = supplierSeed(sup, id);
      sup.productUnitsSold = ensureSupplierProductUnitsSold(sup.productUnitsSold, seed);
      changed = true;
      updatedSuppliers += 1;
      return sup;
    });

    if (!changed) continue;
    updatedProducts += 1;
    await Product.updateOne({ _id: (row as any)._id }, { $set: { suppliers: next } }).catch(() => {
      // swallow and keep going
    });

    if (updatedProducts % 50 === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${scanned} scanned — products updated: ${updatedProducts}, suppliers updated: ${updatedSuppliers}, skipped: ${skipped}`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Done (${market}). ${scanned} scanned — products updated: ${updatedProducts}, suppliers updated: ${updatedSuppliers}, skipped: ${skipped}`,
  );

  await disconnectMongo();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
