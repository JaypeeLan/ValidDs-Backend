import axios from 'axios';

jest.mock('axios');

function seedBaseEnv(): void {
  process.env.NODE_ENV = 'development';
  process.env.INTERNAL_API_KEY = 'k'.repeat(32);
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
}

async function loadService(): Promise<{
  TeemDropService: typeof import('../src/services/teemdrop.service').TeemDropService;
  axiosMock: jest.Mocked<typeof axios>;
}> {
  const axiosModule = await import('axios');
  const axiosMock = axiosModule.default as jest.Mocked<typeof axios>;
  const serviceModule = await import('../src/services/teemdrop.service');
  return { TeemDropService: serviceModule.TeemDropService, axiosMock };
}

describe('TeemDropService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    seedBaseEnv();
    delete process.env.TEEMDROP_APP_KEY;
    delete process.env.TEEMDROP_APP_SECRET;
    delete process.env.TEEMDROP_BASE_URL;
    delete process.env.TEEMDROP_USER_AGENT;
  });

  it('should skip lookup when TeemDrop credentials are missing', async () => {
    const { TeemDropService, axiosMock } = await loadService();

    const result = await TeemDropService.findProductDetailByName('portable air conditioner');

    expect(result).toBeNull();
    expect(axiosMock.post).not.toHaveBeenCalled();
  });

  it('should create a token, search the catalog, and fetch product detail', async () => {
    process.env.TEEMDROP_APP_KEY = '100022';
    process.env.TEEMDROP_APP_SECRET = 'secret';
    process.env.TEEMDROP_BASE_URL = 'https://openapi.teemdrop.com';
    process.env.TEEMDROP_USER_AGENT = 'PostmanRuntime/7.43.0';

    const { TeemDropService, axiosMock } = await loadService();

    axiosMock.post
      .mockResolvedValueOnce({
        data: {
          code: 0,
          message: 'Success',
          success: true,
          data: {
            apiKey: '100022',
            token: 'token-123',
            expireTime: Date.now() + 3600_000,
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          message: 'Success',
          success: true,
          data: {
            total: 2,
            page: 0,
            pageNum: 1,
            pageSize: 100,
            data: [
              {
                productId: 'pid_1',
                productNameEn: 'Portable Air Conditioner Water Cooling Fan',
                productMinPrice: 7.3,
                productMaxPrice: 7.3,
                image: 'https://example.com/image.jpg',
                images: ['https://example.com/image.jpg'],
              },
              {
                productId: 'pid_2',
                productNameEn: 'Wireless Headphones',
                productMinPrice: 15,
                productMaxPrice: 20,
                image: 'https://example.com/headphones.jpg',
                images: ['https://example.com/headphones.jpg'],
              },
            ],
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 0,
          message: 'Success',
          success: true,
          data: {
            productId: 'pid_1',
            productNameEn: 'Portable Air Conditioner Water Cooling Fan',
            productMinPrice: 7.3,
            productMaxPrice: 7.3,
            description: '<p>Cooling fan</p>',
            image: 'https://example.com/image.jpg',
            images: ['https://example.com/image.jpg'],
          },
        },
      } as any);

    const result = await TeemDropService.findProductDetailByName('portable air conditioner');

    expect(result?.product.productId).toBe('pid_1');
    expect(result?.match.score).toBeGreaterThan(0.55);
    expect(axiosMock.post).toHaveBeenCalledTimes(3);
    expect(axiosMock.post.mock.calls[0][0]).toBe('https://openapi.teemdrop.com/openapi/createToken/v1');
    expect(axiosMock.post.mock.calls[1][0]).toBe('https://openapi.teemdrop.com/openapi/product/list/v1');
    expect(axiosMock.post.mock.calls[2][0]).toBe('https://openapi.teemdrop.com/openapi/product/detail/v1');

    const signedHeaders = axiosMock.post.mock.calls[1][2]?.headers as Record<string, string>;
    expect(signedHeaders['API-KEY']).toBe('100022');
    expect(signedHeaders['API-SIGN']).toEqual(expect.any(String));
    expect(signedHeaders['User-Agent']).toBe('PostmanRuntime/7.43.0');
  });

  it('should reuse the cached token across multiple product lookups', async () => {
    process.env.TEEMDROP_APP_KEY = '100022';
    process.env.TEEMDROP_APP_SECRET = 'secret';

    const { TeemDropService, axiosMock } = await loadService();

    const tokenResponse = {
      data: {
        code: 0,
        message: 'Success',
        success: true,
        data: {
          apiKey: '100022',
          token: 'token-123',
          expireTime: Date.now() + 3600_000,
        },
      },
    };

    const listResponse = {
      data: {
        code: 0,
        message: 'Success',
        success: true,
        data: {
          total: 1,
          page: 0,
          pageNum: 1,
          pageSize: 100,
          data: [
            {
              productId: 'pid_1',
              productNameEn: 'Portable Air Conditioner Water Cooling Fan',
              productMinPrice: 7.3,
              productMaxPrice: 7.3,
              image: 'https://example.com/image.jpg',
              images: ['https://example.com/image.jpg'],
            },
          ],
        },
      },
    };

    const detailResponse = {
      data: {
        code: 0,
        message: 'Success',
        success: true,
        data: {
          productId: 'pid_1',
          productNameEn: 'Portable Air Conditioner Water Cooling Fan',
          productMinPrice: 7.3,
          productMaxPrice: 7.3,
          image: 'https://example.com/image.jpg',
          images: ['https://example.com/image.jpg'],
        },
      },
    };

    axiosMock.post
      .mockResolvedValueOnce(tokenResponse as any)
      .mockResolvedValueOnce(listResponse as any)
      .mockResolvedValueOnce(detailResponse as any)
      .mockResolvedValueOnce(listResponse as any)
      .mockResolvedValueOnce(detailResponse as any);

    await TeemDropService.findProductDetailByName('portable air conditioner');
    await TeemDropService.findProductDetailByName('portable air conditioner');

    const tokenCalls = axiosMock.post.mock.calls.filter((call) =>
      String(call[0]).includes('/openapi/createToken/v1')
    );

    expect(tokenCalls).toHaveLength(1);
  });
});
