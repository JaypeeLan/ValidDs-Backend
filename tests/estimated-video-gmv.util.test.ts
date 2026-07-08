import {
  computeEstimatedVideoGmvAllocations,
  type CreativeGmvInput,
} from '../src/utils/estimated-video-gmv.util';

function alloc(creatives: CreativeGmvInput[]) {
  return computeEstimatedVideoGmvAllocations(creatives);
}

describe('computeEstimatedVideoGmvAllocations', () => {
  it('returns none when product has no GMV or sales', () => {
    const result = alloc([
      { id: 'a', viewCount: 10_000, productTotalGmv: 0, productTotalSales: 0 },
    ]);
    expect(result.get('a')).toEqual({
      estimatedVideoGmv: null,
      estimatedVideoSales: null,
      estimatedVideoGmvShare: null,
      estimatedVideoGmvMethod: 'none',
    });
  });

  it('attributes full product GMV to a sole creative', () => {
    const result = alloc([
      { id: 'a', viewCount: 50_000, productTotalGmv: 1499.5, productTotalSales: 50 },
    ]);
    expect(result.get('a')).toEqual({
      estimatedVideoGmv: 1499.5,
      estimatedVideoSales: 50,
      estimatedVideoGmvShare: 1,
      estimatedVideoGmvMethod: 'sole_video',
    });
  });

  it('splits GMV by view share across multiple creatives', () => {
    const result = alloc([
      { id: 'a', viewCount: 75_000, productTotalGmv: 1000, productTotalSales: 100 },
      { id: 'b', viewCount: 25_000, productTotalGmv: 1000, productTotalSales: 100 },
    ]);

    expect(result.get('a')).toMatchObject({
      estimatedVideoGmv: 750,
      estimatedVideoSales: 75,
      estimatedVideoGmvShare: 0.75,
      estimatedVideoGmvMethod: 'view_share',
    });
    expect(result.get('b')).toMatchObject({
      estimatedVideoGmv: 250,
      estimatedVideoSales: 25,
      estimatedVideoGmvShare: 0.25,
      estimatedVideoGmvMethod: 'view_share',
    });

    const gmvSum =
      (result.get('a')?.estimatedVideoGmv ?? 0) + (result.get('b')?.estimatedVideoGmv ?? 0);
    const salesSum =
      (result.get('a')?.estimatedVideoSales ?? 0) + (result.get('b')?.estimatedVideoSales ?? 0);
    expect(gmvSum).toBe(1000);
    expect(salesSum).toBe(100);
  });

  it('uses equal split when all creatives have zero views', () => {
    const result = alloc([
      { id: 'a', viewCount: 0, productTotalGmv: 300, productTotalSales: 6 },
      { id: 'b', viewCount: 0, productTotalGmv: 300, productTotalSales: 6 },
      { id: 'c', viewCount: 0, productTotalGmv: 300, productTotalSales: 6 },
    ]);

    for (const id of ['a', 'b', 'c']) {
      expect(result.get(id)).toMatchObject({
        estimatedVideoGmv: 100,
        estimatedVideoSales: 2,
        estimatedVideoGmvMethod: 'equal_split',
      });
    }
  });
});
