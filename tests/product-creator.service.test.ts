import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { ProductSchema } from '../src/models/product.model';
import { CreativeSchema } from '../src/models/creative.model';
import type { IProductDocument } from '../src/types/product.types';
import type { ICreativeDocument } from '../src/types/creative.types';
import { findProductCreators } from '../src/services/product-creator.service';
import { minimalTestProduct } from './helpers/minimal-product.fixture';
import { minimalTestCreative } from './helpers/minimal-creative.fixture';

describe('findProductCreators', () => {
  jest.setTimeout(30000);
  let mongo: MongoMemoryServer;
  let Product: mongoose.Model<IProductDocument>;
  let Creative: mongoose.Model<ICreativeDocument>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
    await mongoose.connect(mongo.getUri());
    Product = mongoose.model<IProductDocument>(
      'Product_us_test',
      ProductSchema,
      'products_us_test',
    );
    Creative = mongoose.model<ICreativeDocument>(
      'Creative_us_test',
      CreativeSchema,
      'creatives_us_test',
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
    await Creative.deleteMany({});
  });

  it('returns unique primaryCreator handles from products only', async () => {
    const products = await Product.insertMany([
      minimalTestProduct({
        externalId: 'sku-a',
        title: 'Product A',
        shopName: 'Shop A',
        accountHandle: 'shopa',
        primaryCreator: {
          handle: 'shopa',
          displayName: 'Shop A',
          followers: 10_000,
          totalLikes: 50_000,
          verified: false,
          tiktokPostUrl: 'https://www.tiktok.com/@shopa/video/1',
          primaryImageUrl: '',
          avatarUrl: '',
          shopGmv: 2_000_000,
          shopTotalSales: 40_000,
          shopGmvSource: 'shop_catalog',
        },
        totalGmv: 100_000,
        storeGmv: 500_000,
        publishedAt: new Date('2026-06-01'),
        postCreatedAt: new Date('2026-06-01'),
      }),
      minimalTestProduct({
        externalId: 'sku-a2',
        title: 'Product A2',
        shopName: 'Shop A',
        accountHandle: 'shopa',
        primaryCreator: {
          handle: 'shopa',
          displayName: 'Shop A',
          followers: 10_000,
          totalLikes: 55_000,
          verified: false,
          tiktokPostUrl: 'https://www.tiktok.com/@shopa/video/2',
          primaryImageUrl: '',
          avatarUrl: '',
        },
        totalGmv: 50_000,
        storeGmv: 480_000,
        publishedAt: new Date('2026-06-02'),
        postCreatedAt: new Date('2026-06-02'),
      }),
      minimalTestProduct({
        externalId: 'sku-b',
        title: 'Product B',
        shopName: 'Shop B',
        accountHandle: 'shopb',
        primaryCreator: {
          handle: 'shopb',
          displayName: 'Shop B',
          followers: 5_000,
          totalLikes: 12_000,
          verified: true,
          tiktokPostUrl: 'https://www.tiktok.com/@shopb/video/1',
          primaryImageUrl: '',
          avatarUrl: '',
        },
        totalGmv: 200_000,
        storeGmv: 800_000,
        publishedAt: new Date('2026-06-03'),
        postCreatedAt: new Date('2026-06-03'),
      }),
    ]);
    await Creative.insertMany(
      products.map((product, index) =>
        minimalTestCreative({
          productId: product._id,
          externalVideoId: `vid_pc_test_${index}`,
        }),
      ),
    );

    const result = await findProductCreators(Product, {
      page: 1,
      limit: 20,
      sortBy: 'views',
    });

    expect(result.groupBy).toBe('creator');
    expect(result.pagination.total).toBe(2);
    expect(result.data.map((r) => r.creator.handle).sort()).toEqual(['shopa', 'shopb']);

    const shopA = result.data.find((r) => r.creator.handle === 'shopa');
    expect(shopA?.videoCount).toBe(2);
    expect(shopA?.productTotalGmv).toBe(2_000_000);
    expect(shopA?.creator.totalLikes).toBe(55_000);
    expect(shopA?.productName).toBe('Product A');
  });
});
