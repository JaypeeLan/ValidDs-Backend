/**
 * Generate a new internal API key.
 *
 * Usage:
 *   npm run generate-api-key
 *
 * This outputs:
 *   - The raw key  → put this in INTERNAL_API_KEY in your .env
 *   - The hash     → what gets stored in the DB for multi-key setups
 *
 * The raw key is shown ONCE. Store it securely.
 */

import * as crypto from 'crypto';

function generateApiKey(): string {
  return 'vds_' + crypto.randomBytes(32).toString('hex');
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

const rawKey = generateApiKey();
const hashedKey = hashApiKey(rawKey);

console.log('\n ValidDs API Key Generated\n');
console.log('Raw key (add to .env as INTERNAL_API_KEY):');
console.log(`  ${rawKey}\n`);
console.log('SHA-256 hash (store in DB for multi-key support):');
console.log(`  ${hashedKey}\n`);
console.log('  The raw key is shown ONCE. Store it securely.\n');
