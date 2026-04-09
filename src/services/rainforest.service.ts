import axios from 'axios';
import { env } from '../config/env.validation';
import { logger } from '../logger';
import { RainforestSearchResponse } from './rainforest.types';

const log = logger.child({ module: 'rainforest-service' });

/**
 * Service for interacting with the Rainforest API.
 * Used for searching Amazon for product enrichment data (pricing, listings, rank).
 */
export const RainforestService = {
  /**
   * Search Amazon using Rainforest API.
   * Single attempt — returns null on any failure (no retries).
   */
  async searchAmazonProducts(
    searchTerm: string
  ): Promise<RainforestSearchResponse | null> {
    const apiKey = env.RAINFOREST_API_KEY;

    if (!apiKey) {
      log.warn('RAINFOREST_API_KEY is not set. Skipping Rainforest lookup.', { searchTerm });
      return null;
    }

    const url = 'https://api.rainforestapi.com/request';
    const params = {
      api_key: apiKey,
      type: 'search',
      amazon_domain: 'amazon.com',
      search_term: searchTerm,
      sort_by: 'bestseller_rankings',
      page: '1',
      number_of_results: '20',
      include_products_count: '5',
      exclude_sponsored: 'false',
      direct_search: 'false',
    };

    try {
      log.debug('Requesting Rainforest API', { searchTerm });
      const response = await axios.get<RainforestSearchResponse>(url, {
        params,
        timeout: 15000,
      });

      if (response.data?.request_info?.success === false) {
        log.warn('Rainforest API returned success: false — skipping', { searchTerm });
        return null;
      }

      log.debug('Rainforest API search successful', {
        searchTerm,
        resultsFound: response.data.search_results?.length || 0,
      });

      return response.data;
    } catch (error: any) {
      log.warn('Rainforest API request failed — skipping product', {
        searchTerm,
        error: error.message,
        status: error.response?.status,
      });
      return null;
    }
  },
};
