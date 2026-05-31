import type { MarketModels } from '../../src/models/market-models.factory';
import type { MarketCode } from '../../src/utils/markets';

/** Market used by integration tests (must match API default / seeded user region). */
export const TEST_MARKET: MarketCode = 'US';

/** Resolve US market models after Mongo is connected (safe with jest.resetModules). */
export async function getSeededTestMarketModels(): Promise<MarketModels> {
  const { mongoose } = await import('../../src/db/client');
  if (mongoose.connection.readyState !== 1) {
    throw new Error(`MongoDB not connected (readyState=${mongoose.connection.readyState})`);
  }
  const { clearMarketModelsCache, getMarketModels } = await import(
    '../../src/models/market-models.factory'
  );
  clearMarketModelsCache();
  return getMarketModels(TEST_MARKET);
}
