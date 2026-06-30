import { minimalTestProduct } from './minimal-product.fixture';
import { minimalTestCreative } from './minimal-creative.fixture';
import { getSeededTestMarketModels } from './market-test-models';

/** Metrics required for creatives to appear in list/detail APIs. */
export const LISTABLE_PRODUCT_METRICS = {
  productTotalGmv: 5000,
  productTotalSales: 500,
};

export async function attachPlayableCreatives(
  products: Array<{ _id?: unknown } | null | undefined>,
): Promise<void> {
  const { Creative } = await getSeededTestMarketModels();
  const docs = products
    .filter((p): p is { _id: unknown } => p != null && p._id != null)
    .map((p, index) =>
      minimalTestCreative({
        ...LISTABLE_PRODUCT_METRICS,
        productId: p._id,
        externalVideoId: `vid_test_${String(p._id)}_${index}`,
        section: 'top-ads',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Skincare',
        publishedAt: new Date('2020-01-01'),
        metrics: { viewCount: 10_000, likeCount: 1000 },
      }),
    );
  if (docs.length > 0) {
    await Creative.create(docs);
  }
}

/** Product + feed-visible creative for detail/related endpoint tests. */
export async function seedListableProductPair(): Promise<{
  productId: string;
  creativeId: string;
}> {
  const { Product, Creative } = await getSeededTestMarketModels();
  const videoId = 'vid_endpoint_1';
  const postUrl = `https://www.tiktok.com/@testcreator/video/${videoId}`;

  const product = await Product.create(
    minimalTestProduct({
      externalId: `endpoint-prod-${Date.now()}`,
      postUrl,
      primaryCreator: {
        handle: 'testcreator',
        displayName: 'Test Creator',
        region: 'US',
        verified: false,
        tiktokPostUrl: postUrl,
        primaryImageUrl: '',
        avatarUrl: '',
      },
    }),
  );

  const creative = await Creative.create(
    minimalTestCreative({
      ...LISTABLE_PRODUCT_METRICS,
      productId: product._id,
      externalVideoId: videoId,
      tiktokPostUrl: postUrl,
      listingVerified: true,
      section: 'top-ads',
      categoryL1: 'Beauty & Personal Care',
      categoryL2: 'Skincare',
      publishedAt: new Date('2020-01-01'),
      creator: {
        handle: 'testcreator',
        displayName: 'Test Creator',
        region: 'US',
        tiktokPostUrl: postUrl,
        isIndependentCreator: false,
      },
      metrics: { viewCount: 10_000, likeCount: 1000 },
    }),
  );

  await Product.syncIndexes();

  return {
    productId: String(product._id),
    creativeId: String(creative._id),
  };
}
