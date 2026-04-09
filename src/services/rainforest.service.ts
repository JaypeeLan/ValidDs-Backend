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
   * Hardcoded parameters based on system schema, except for the dynamic search term.
   */
  async searchAmazonProducts(
    searchTerm: string,
    maxRetries = 3
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

    let attempt = 1;
    while (attempt <= maxRetries) {
      try {
        log.debug(`Requesting Rainforest API (Attempt ${attempt}/${maxRetries})`, { searchTerm });
        
        const response = await axios.get<RainforestSearchResponse>(url, { 
          params,
          timeout: 15000 // 15 seconds timeout
        });
        
        if (response.data?.request_info?.success === false) {
           log.error('Rainforest API returned success: false', { 
             info: response.data.request_info 
           });
           throw new Error('Rainforest API request failed internally.');
        }

        log.debug('Rainforest API search successful', {
          searchTerm,
          resultsFound: response.data.search_results?.length || 0,
        });

        return response.data;
      } catch (error: any) {
        log.warn(`Rainforest API attempt ${attempt} failed`, {
          searchTerm,
          error: error.message,
        });

        if (attempt === maxRetries) {
          log.error('Rainforest API exhausted all retries.', { searchTerm });
          throw new Error(`Rainforest search failed for "${searchTerm}" after ${maxRetries} attempts.`);
        }
        
        // Exponential backoff buffer before retry
        const delayMs = attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        
        attempt++;
      }
    }

    return null;
  },
};
