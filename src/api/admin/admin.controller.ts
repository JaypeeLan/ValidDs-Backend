import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import os from 'os';
import { getRedisClient } from '../../cache/redis.client';
import { getJobsStatus } from '../../jobs/index';
import { User } from '../../models/user.model';
import { getMarketModels } from '../../models/market-models.factory';
import { deleteCreativeAndOrphanProduct } from '../../services/creative.service';
import { MARKET_CODES, toMarketCode, type MarketCode } from '../../utils/markets';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import type {
  AdminTransactionsQueryInput,
  CreateTransactionInput,
  AdminUsersQueryInput,
  AdminUserIdParamInput,
  UpdateUserStatusInput,
  AdminWaitlistQueryInput,
  AdminProductsQueryV2Input,
  AdminDeleteContentParamInput,
  AdminCreateProductInput,
  AdminCreateCreativeInput,
  AdminCreativesQueryInput,
  AdminAnalyticsQueryInput,
  AdminMaintenanceRunsQueryInput,
  AdminJobHeartbeatsQueryInput,
  AdminProviderHealthQueryInput,
  AdminQueueJobTriggerInput,
  AdminJobTriggersQueryInput,
} from './admin.validator';
import { TransactionService } from '../../services/transaction.service';
import { WaitlistService } from '../../services/waitlist.service';
import {
  getInventoryAnalytics,
  getOperationsOverview,
  listJobHeartbeats,
  listMaintenanceRuns,
} from '../../services/admin-ops.service';
import { providerSummary, runProviderHealthChecks } from '../../services/provider-health.service';
import {
  listJobTriggers,
  listTriggerableJobs,
  queueJobTrigger,
} from '../../services/job-trigger.service';

export const getSystemHealth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const memory = process.memoryUsage();
    const redisClient = getRedisClient();
    let redisStatus = 'disconnected';
    let redisLatencyMs = -1;

    try {
      const start = Date.now();
      await redisClient.ping();
      redisLatencyMs = Date.now() - start;
      redisStatus = 'connected';
    } catch {
      redisStatus = 'error';
    }

    const health = {
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        osUptimeSeconds: Math.round(os.uptime()),
        memory: {
          rssMb: Math.round(memory.rss / 1024 / 1024),
          heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
          heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        },
        cpuLoadAvg: os.loadavg(),
      },
      database: {
        mongoStatus: mongoose.STATES[mongoose.connection.readyState] || 'unknown',
        redisStatus,
        redisLatencyMs,
      },
      jobs: getJobsStatus(),
    };

    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
};

export const getUserAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const totalUsers = await User.countDocuments();

    // Users joined today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: startOfDay } });

    // Users by Plan
    const planAggregation = await User.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]);
    const usersByPlan = planAggregation.reduce(
      (acc, curr) => {
        acc[curr._id || 'unknown'] = curr.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Active vs Suspended vs Deleted
    const statusAggregation = await User.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const usersByStatus = statusAggregation.reduce(
      (acc, curr) => {
        acc[curr._id || 'unknown'] = curr.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersToday,
        usersByPlan,
        usersByStatus,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getProductAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminAnalyticsQueryInput;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // If a specific market is requested, query only that collection.
    // Otherwise aggregate across all markets.
    const markets: MarketCode[] = query.market ? [query.market as MarketCode] : [...MARKET_CODES];

    let totalProducts = 0;
    let freshProducts = 0;
    const productsBySource: Record<string, number> = {};
    const topCategoriesAcc: Record<string, number> = {};

    await Promise.all(
      markets.map(async (market) => {
        const { Product: MarketProduct } = getMarketModels(market);
        const [total, fresh, sourceAgg, catAgg] = await Promise.all([
          MarketProduct.countDocuments(),
          MarketProduct.countDocuments({ lastIngestedAt: { $gte: oneDayAgo } }),
          MarketProduct.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]),
          MarketProduct.aggregate([
            { $group: { _id: '$categoryL1', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),
        ]);
        totalProducts += total;
        freshProducts += fresh;
        for (const { _id, count } of sourceAgg)
          productsBySource[_id || 'unknown'] = (productsBySource[_id || 'unknown'] ?? 0) + count;
        for (const { _id, count } of catAgg)
          topCategoriesAcc[_id || 'Uncategorized'] =
            (topCategoriesAcc[_id || 'Uncategorized'] ?? 0) + count;
      }),
    );

    const topCategories = Object.fromEntries(
      Object.entries(topCategoriesAcc)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10),
    );

    res.json({
      success: true,
      data: {
        markets: query.market ? [query.market] : MARKET_CODES,
        totalProducts,
        freshProducts24h: freshProducts,
        productsBySource,
        topCategories,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getCreativeAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminAnalyticsQueryInput;
    const markets: MarketCode[] = query.market ? [query.market as MarketCode] : [...MARKET_CODES];
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    let totalCreatives = 0;
    let freshCreatives24h = 0;
    let adsCount = 0;
    let organicCount = 0;
    let totalVideos = 0;
    const creativesBySection: Record<string, number> = {};
    const topCategoriesAcc: Record<string, number> = {};

    await Promise.all(
      markets.map(async (market) => {
        const { Creative: MarketCreative } = getMarketModels(market);
        const [total, fresh, ads, organic, sectionAgg, catAgg, videoRows] = await Promise.all([
          MarketCreative.countDocuments(),
          MarketCreative.countDocuments({ ingestedAt: { $gte: oneDayAgo } }),
          MarketCreative.countDocuments({ isAd: true }),
          MarketCreative.countDocuments({ isAd: false }),
          MarketCreative.aggregate([{ $group: { _id: '$section', count: { $sum: 1 } } }]),
          MarketCreative.aggregate([
            { $group: { _id: '$categoryL1', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),
          MarketCreative.aggregate([
            {
              $project: {
                videoCount: { $add: [1, { $size: { $ifNull: ['$relatedVideos', []] } }] },
              },
            },
            { $group: { _id: null, totalVideos: { $sum: '$videoCount' } } },
          ]),
        ]);
        totalCreatives += total;
        freshCreatives24h += fresh;
        adsCount += ads;
        organicCount += organic;
        totalVideos += videoRows[0]?.totalVideos ?? 0;
        for (const { _id, count } of sectionAgg)
          creativesBySection[_id || 'unknown'] =
            (creativesBySection[_id || 'unknown'] ?? 0) + count;
        for (const { _id, count } of catAgg)
          topCategoriesAcc[_id || 'Uncategorized'] =
            (topCategoriesAcc[_id || 'Uncategorized'] ?? 0) + count;
      }),
    );

    const topCategories = Object.fromEntries(
      Object.entries(topCategoriesAcc)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10),
    );

    res.json({
      success: true,
      data: {
        markets: query.market ? [query.market] : MARKET_CODES,
        totalCreatives,
        totalVideos,
        freshCreatives24h,
        creativesBySection,
        creativesByAdType: { ads: adsCount, organic: organicCount },
        topCategories,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const listProducts = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminProductsQueryV2Input;
    const market = toMarketCode(query.market);
    const { Product: MarketProduct } = getMarketModels(market);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.source) filter.source = query.source;
    if (query.category) filter.categoryL1 = query.category;
    if (query.q) {
      const regex = new RegExp(query.q, 'i');
      filter.$or = [{ title: regex }, { description: regex }];
    }

    const [products, total] = await Promise.all([
      MarketProduct.find(filter).sort({ lastIngestedAt: -1 }).skip(skip).limit(limit).lean(),
      MarketProduct.countDocuments(filter),
    ]);

    res.json(
      successResponse(
        {
          market,
          products,
          pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        },
        'Products retrieved successfully.',
      ),
    );
  } catch (err) {
    next(err);
  }
};

export const listTransactions = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminTransactionsQueryInput;
    const data = await TransactionService.list(query);

    res.json(successResponse(data, 'Transaction records retrieved successfully.'));
  } catch (err) {
    next(err);
  }
};

export const createTransaction = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as CreateTransactionInput;
    const transaction = await TransactionService.create(input);

    res
      .status(201)
      .json(successResponse(transaction, 'Transaction record created successfully.', 201));
  } catch (err) {
    next(err);
  }
};

export const listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = req.query as unknown as AdminUsersQueryInput;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.role) filter.role = query.role;
    if (query.plan) filter.plan = query.plan;
    if (query.q) {
      const regex = new RegExp(query.q, 'i');
      filter.$or = [{ email: regex }, { name: regex }, { firstName: regex }, { lastName: regex }];
    }

    const [rows, total] = await Promise.all([
      User.find(filter)
        .select({ localAuth: 0, googleAuth: 0, tiktokAuth: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const users = rows.map((user) => ({
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      status: user.status,
      creditBalance: user.creditBalance,
      contentRegion: user.contentRegion,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
    }));

    res.json(
      successResponse(
        {
          users,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        },
        'Users retrieved successfully.',
      ),
    );
  } catch (err) {
    next(err);
  }
};

export const updateUserStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { userId } = req.params as unknown as AdminUserIdParamInput;
    const { status } = req.body as UpdateUserStatusInput;

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    user.status = status;
    await user.save();

    res.json(
      successResponse(
        { id: userId, status: user.status },
        `User status updated to ${status} successfully.`,
      ),
    );
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { userId } = req.params as unknown as AdminUserIdParamInput;

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    if (req.user && String(req.user._id) === String(user._id)) {
      throw new AppError(400, 'Admin cannot delete their own account', 'INVALID_OPERATION');
    }

    await User.findByIdAndDelete(userId);

    res.json(successResponse({ id: userId }, 'User account permanently deleted successfully.'));
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params as unknown as AdminDeleteContentParamInput;
    const market = toMarketCode((req.query as any).market);
    const { Product: MarketProduct } = getMarketModels(market);

    const product = await MarketProduct.findById(id);
    if (!product) {
      throw new AppError(404, 'Product not found', 'PRODUCT_NOT_FOUND');
    }

    await MarketProduct.findByIdAndDelete(id);

    res.json(successResponse({ id, market }, 'Product permanently deleted successfully.'));
  } catch (err) {
    next(err);
  }
};

// ── Admin content creation ────────────────────────────────────────────────────

export const listCreatives = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminCreativesQueryInput;
    const market = toMarketCode(query.market);
    const { Creative: MarketCreative } = getMarketModels(market);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.section) filter.section = query.section;
    if (query.category) filter.categoryL1 = query.category;
    if (query.platform === 'meta') {
      filter.externalVideoId = { $regex: /^meta:/ };
    } else if (query.platform === 'tiktok') {
      filter.externalVideoId = { $not: { $regex: /^meta:/ } };
    }
    if (query.adType === 'ads') {
      filter.isAd = true;
    } else if (query.adType === 'organic') {
      filter.isAd = false;
    }
    if (query.q) {
      const regex = new RegExp(query.q, 'i');
      filter.$or = [
        { externalVideoId: regex },
        { productName: regex },
        { 'creator.handle': regex },
        { description: regex },
      ];
    }

    const [rows, total] = await Promise.all([
      MarketCreative.find(filter).sort({ ingestedAt: -1 }).skip(skip).limit(limit).lean(),
      MarketCreative.countDocuments(filter),
    ]);

    const creatives = rows.map((row) => {
      const externalVideoId = String(row.externalVideoId ?? '');
      const isMeta = externalVideoId.startsWith('meta:');
      return {
        id: String(row._id),
        externalVideoId,
        tiktokPostUrl: row.tiktokPostUrl ?? '',
        thumbnailUrl: row.thumbnailUrl ?? null,
        section: row.section ?? '',
        isIndependentCreator:
          row.creator?.isIndependentCreator ?? row.isIndependentCreator ?? false,
        isAd: row.isAd ?? false,
        platform: isMeta ? 'meta' : 'tiktok',
        productName: row.productName ?? null,
        categoryL1: row.categoryL1 ?? '',
        categoryL2: row.categoryL2 ?? '',
        hashtags: row.hashtags ?? [],
        metrics: row.metrics ?? {
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
        },
        creator: row.creator
          ? {
              handle: row.creator.handle ?? null,
              displayName: row.creator.displayName ?? null,
              followers: row.creator.followers ?? null,
            }
          : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    res.json(
      successResponse(
        {
          market,
          creatives,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        },
        'Creatives retrieved successfully.',
      ),
    );
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as AdminCreateProductInput;
    const market = toMarketCode(body.market);
    const { Product: MarketProduct } = getMarketModels(market);

    const now = new Date();
    const normalizedTitle = body.title
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');

    const product = await MarketProduct.create({
      externalId: body.externalId,
      source: body.source ?? 'admin',
      status: 'review',
      title: body.title,
      normalizedTitle,
      description: body.description ?? '',
      categoryL1: body.categoryL1,
      categoryL2: body.categoryL2 ?? '',
      categoryPath: body.categoryL2 ? `${body.categoryL1} > ${body.categoryL2}` : body.categoryL1,
      price: body.price ?? 0,
      currency: body.currency ?? 'USD',
      productUrl: body.productUrl ?? '',
      primaryImageUrl: body.primaryImageUrl ?? '',
      shopName: body.shopName ?? '',
      validationStatus: 'pending',
      lastIngestedAt: now,
      dataSourceUpdatedAt: now,
      aiIntelligence: {
        confidence: 0,
        confidenceReason: 'Manually created by admin',
        extractedAt: now,
      },
      trend: { score: 0, direction: 'unknown', isTrending: false, calculatedAt: now },
    });

    res.status(201).json(successResponse({ market, product }, 'Product created successfully.'));
  } catch (err) {
    next(err);
  }
};

export const createCreative = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as AdminCreateCreativeInput;
    const market = toMarketCode(body.market);
    const { Creative: MarketCreative } = getMarketModels(market);

    const creative = await MarketCreative.create({
      externalVideoId: body.externalVideoId,
      productId: body.productId ? new mongoose.Types.ObjectId(body.productId) : undefined,
      videoPlayUrl: body.videoPlayUrl ?? '',
      thumbnailUrl: body.thumbnailUrl ?? '',
      isAd: body.isAd ?? false,
      section: body.section ?? 'ads',
      description: body.description ?? '',
      creator: body.creatorHandle ? { handle: body.creatorHandle, followers: 0 } : undefined,
      metrics: { viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 },
      ingestedAt: new Date(),
    });

    res.status(201).json(successResponse({ market, creative }, 'Creative created successfully.'));
  } catch (err) {
    next(err);
  }
};

export const deleteCreative = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params as unknown as AdminDeleteContentParamInput;
    const market = toMarketCode((req.query as any).market);
    const result = await deleteCreativeAndOrphanProduct(market, id);
    if (!result.creativeDeleted) {
      throw new AppError(404, 'Creative not found', 'CREATIVE_NOT_FOUND');
    }

    const message = result.productDeleted
      ? 'Creative deleted; product removed (no creatives remaining).'
      : 'Creative permanently deleted successfully.';

    res.json(
      successResponse(
        { id, market, productDeleted: result.productDeleted, productId: result.productId },
        message,
      ),
    );
  } catch (err) {
    next(err);
  }
};

export const listWaitlist = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminWaitlistQueryInput;
    const data = await WaitlistService.list(query);

    res.json(successResponse(data, 'Waitlist entries retrieved successfully.'));
  } catch (err) {
    next(err);
  }
};

export const getOperationsOverviewHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const refresh = String(req.query.refresh ?? '') === 'true';
    const data = await getOperationsOverview(refresh);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const listMaintenanceRunsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminMaintenanceRunsQueryInput;
    const data = await listMaintenanceRuns(query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const listJobHeartbeatsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminJobHeartbeatsQueryInput;
    const data = await listJobHeartbeats(query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getProviderHealthHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminProviderHealthQueryInput;
    const { checkedAt, providers } = await runProviderHealthChecks(Boolean(query.refresh));
    res.json({
      success: true,
      data: { checkedAt, providers, summary: providerSummary(providers) },
    });
  } catch (err) {
    next(err);
  }
};

export const listTriggerableJobsHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    res.json({ success: true, data: { jobs: listTriggerableJobs() } });
  } catch (err) {
    next(err);
  }
};

export const queueJobTriggerHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as AdminQueueJobTriggerInput;
    const requestedBy =
      (req.user as { email?: string; _id?: unknown } | undefined)?.email ??
      (req.user?._id ? String(req.user._id) : null);
    const trigger = await queueJobTrigger({
      job: body.job,
      market: body.market as MarketCode | undefined,
      requestedBy,
    });
    res
      .status(202)
      .json(successResponse(trigger, `${body.job} queued — worker will pick it up within ~30s.`));
  } catch (err) {
    next(err);
  }
};

export const listJobTriggersHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminJobTriggersQueryInput;
    const triggers = await listJobTriggers({ limit: query.limit, status: query.status });
    res.json({ success: true, data: { triggers } });
  } catch (err) {
    next(err);
  }
};

export const getInventoryAnalyticsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as AdminAnalyticsQueryInput;
    const data = await getInventoryAnalytics(query.market as MarketCode | undefined);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
