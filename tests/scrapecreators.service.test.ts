import { ScrapeCreatorsService } from '../src/services/scrapecreators.service';

describe('ScrapeCreatorsService.creatorStatsFromProfile', () => {
  it('maps heartCount to totalLikes (lifetime profile likes, not one video)', () => {
    const stats = ScrapeCreatorsService.creatorStatsFromProfile({
      followerCount: 10_000,
      followingCount: 200,
      heartCount: 1_500_000,
    });

    expect(stats).toEqual({
      followers: 10_000,
      following: 200,
      totalLikes: 1_500_000,
    });
  });

  it('omits zero or missing stats', () => {
    expect(ScrapeCreatorsService.creatorStatsFromProfile(null)).toEqual({});
    expect(ScrapeCreatorsService.creatorStatsFromProfile({ heartCount: 0 })).toEqual({});
  });
});
