/**
 * Migration: Normalise product categoryL1, categoryL2, and categoryPath
 * to match the updated CATEGORY_TAXONOMY.
 *
 * Run:  npx ts-node scripts/migrate-categories.ts
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

import { CATEGORY_TAXONOMY, getCategoryPath } from '../src/api/products/product.constants';

const VALID_L1 = new Set(Object.keys(CATEGORY_TAXONOMY));
const VALID_L2_BY_L1: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(CATEGORY_TAXONOMY).map(([l1, subs]) => [l1, new Set(Object.keys(subs))])
);

// ── L1 remap: old name → new name ────────────────────────────────────────────
const L1_REMAP: Record<string, string> = {
  'Beauty':               'Beauty & Personal Care',
  'Electronics':          'Electronics & Tech',
  'Fashion':              'Fashion',                   // no change — keep as-is
  'Food & Beverage':      'Food & Beverage',           // no change
  'Home & Kitchen':       'Home & Kitchen',            // no change
  'Home & Living':        'Home & Kitchen',
  'Fashion & Accessories':'Fashion',
  'Food & Beverages':     'Food & Beverage',
  'Electronics & Gadgets':'Electronics & Tech',
  'Pet Supplies':         'Pets',
  'Baby & Maternity':     'Kids & Baby',
  'Toys & Games':         'Kids & Baby',               // L1 → L1 merge
};

// ── L2 remap: old name → new name (within any L1) ────────────────────────────
const L2_REMAP: Record<string, string> = {
  'Makeup':                     'Makeup & Cosmetics',
  'Clothing':                   'Women\'s Clothing',
  'Dog Supplies':               'Dog',
  'Cat Supplies':               'Cat',
  'Women Activewear':           'Activewear & Sportswear',
  'Women\'s Clothing Sets':     'Women\'s Clothing',
  'Women\'s Knitwear':          'Women\'s Clothing',
  'Women\'s Rompers':           'Women\'s Clothing',
  'Men\'s Tops':                'Men\'s Clothing',
  'Bags & Luggage':             'Bags & Accessories',
  'Bar Stools':                 'Furniture',
  'Bedding & Mattress Protectors': 'Bedding & Bath',
  'Kitchen Storage & Organization': 'Storage & Organisation',
  'Kitchen Taps':               'Kitchen Gadgets',
  'Door Hardware':              'Home Improvement',
  'Audio & Video Accessories':  'Audio',
  'Keyboards & Mice':           'Computers & Peripherals',
  'Breathing Aids':             'Medical Supplies',
  'Outdoor Play':               'Toys & Games',
  'Car Wash Accessories':       'Car Care',
  'Skin Care':                  'Skincare',
  'Hair Color':                 'Hair Care',
  'Concealer & Foundation':     'Makeup & Cosmetics',
  'Lipstick & Lip Gloss':       'Makeup & Cosmetics',
  'Eye Makeup':                 'Makeup & Cosmetics',
  'Lip Makeup':                 'Makeup & Cosmetics',
  'Men\'s Fragrance':           'Men\'s Grooming',
  'Body Moisturizers':          'Bath & Body',
  'Bath & Shower':              'Bath & Body',
  'Snacks & Candy':             'Snacks',
  'Nuts & Seeds':               'Snacks',
  'Chocolate & Chocolate Snacks': 'Sweets & Chocolate',
  'Shapewear':                  'Shapewear & Underwear',
};

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection('products');

  const total = await col.countDocuments();
  console.log(`Total products: ${total}`);

  let updated = 0;
  let skipped = 0;
  let noChange = 0;

  const cursor = col.find({});

  for await (const doc of cursor) {
    const origL1 = doc.categoryL1 as string | undefined;
    const origL2 = doc.categoryL2 as string | undefined;
    const origL3 = doc.categoryL3 as string | undefined;

    if (!origL1) { skipped++; continue; }

    // Remap L1
    let newL1 = VALID_L1.has(origL1) ? origL1 : (L1_REMAP[origL1] ?? origL1);

    // If still not valid, fall back to Beauty & Personal Care (shouldn't happen)
    if (!VALID_L1.has(newL1)) {
      console.warn(`  Unknown L1: "${origL1}" on ${doc._id} — keeping as-is`);
      newL1 = origL1;
    }

    // Remap L2
    let newL2 = origL2;
    if (origL2) {
      const validL2 = VALID_L2_BY_L1[newL1];
      if (validL2 && !validL2.has(origL2)) {
        newL2 = L2_REMAP[origL2] ?? origL2;
        // Check if remapped value is valid under new L1
        if (!validL2.has(newL2)) {
          // Try to find it under any L1
          const anyValid = Object.values(VALID_L2_BY_L1).find((s) => s.has(newL2!));
          if (!anyValid) {
            console.warn(`  Unknown L2: "${origL2}" → "${newL2}" under "${newL1}" on ${doc._id}`);
          }
        }
      }
    }

    // Fix old path separator " / " → " > "
    const oldPath = doc.categoryPath as string | undefined;
    const newPath = getCategoryPath(newL1, newL2, origL3);

    if (newL1 === origL1 && newL2 === origL2 && oldPath === newPath) {
      noChange++;
      continue;
    }

    await col.updateOne(
      { _id: doc._id },
      { $set: { categoryL1: newL1, categoryL2: newL2, categoryPath: newPath } }
    );
    updated++;

    if (updated <= 20 || origL1 !== newL1 || origL2 !== newL2) {
      console.log(`  ${doc._id}: "${origL1} / ${origL2}" → "${newL1} > ${newL2}"`);
    }
  }

  console.log(`\nDone — updated: ${updated}, no change: ${noChange}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
