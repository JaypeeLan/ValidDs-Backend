import axios from 'axios';

// Mock axios to avoid actually spending Rainforest API credits on automated runs
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RainforestService - Amazon Enrichment', () => {
  let RainforestService: any;
  let envMock: any;

  beforeAll(async () => {
    // Scaffold minimal environment setup
    process.env.NODE_ENV = 'development';
    process.env.INTERNAL_API_KEY = 'k'.repeat(32);
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    // We provide a dummy Rainforest API key here so the service doesn't skip execution
    process.env.RAINFOREST_API_KEY = 'dummy-rainforest-key';

    // Must dynamically require env validation to respect process.env edits above
    const envConfig = await import('../src/config/env.validation');
    envMock = envConfig.env;

    const source = await import('../src/services/rainforest.service');
    RainforestService = source.RainforestService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip lookup and return null if RAINFOREST_API_KEY is not defined', async () => {
    const originalKey = envMock.RAINFOREST_API_KEY;
    delete envMock.RAINFOREST_API_KEY; // Temporarily unset

    const result = await RainforestService.searchAmazonProducts('wireless headphones');
    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();

    envMock.RAINFOREST_API_KEY = originalKey; // Restore
  });

  it('should formulate the correct Rainforest query parameters as specified', async () => {
    const mockResponse = {
      data: {
        request_info: { success: true },
        search_results: [{ title: 'Headphones Pro' }]
      }
    };
    mockedAxios.get.mockResolvedValueOnce(mockResponse);

    const result = await RainforestService.searchAmazonProducts('wireless headphones');

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(result?.search_results[0].title).toBe('Headphones Pro');

    // Strict parameter check
    const callArgs = mockedAxios.get.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.rainforestapi.com/request');
    expect(callArgs[1]?.params).toMatchObject({
      api_key: 'dummy-rainforest-key',
      type: 'search',
      amazon_domain: 'amazon.com',
      search_term: 'wireless headphones',
      sort_by: 'bestseller_rankings',
      page: '1',
      number_of_results: '20',
      include_products_count: '5',
      exclude_sponsored: 'false',
      direct_search: 'false',
    });
  });

  it('should retry automatically when API throws an error', async () => {
    const mockResponse = {
      data: {
        request_info: { success: true },
        search_results: []
      }
    };

    // First two fail, third succeeds
    mockedAxios.get
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce(mockResponse);

    const start = Date.now();
    const result = await RainforestService.searchAmazonProducts('retries test');
    const elapsed = Date.now() - start;

    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(result?.request_info.success).toBe(true);
    
    // Expect at least 3000ms delay since exponential backoff is 1s + 2s
    expect(elapsed).toBeGreaterThanOrEqual(2500); 
  }, 10000); // increase jest timeout for this test
});
