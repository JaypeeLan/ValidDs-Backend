import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import os from 'os';
import { getRedisClient } from '../../cache/redis.client';
import { getJobsStatus } from '../../jobs/index';
import { User } from '../../models/user.model';
import { Product } from '../../models/product.model';
import { Creative } from '../../models/creative.model';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import type {
  AdminTransactionsQueryInput,
  CreateTransactionInput,
  AdminUsersQueryInput,
  AdminUserIdParamInput,
  UpdateUserStatusInput,
  AdminProductIdParamInput,
  AdminProductsQueryInput,
  AdminWaitlistQueryInput,
} from './admin.validator';
import { TransactionService } from '../../services/transaction.service';
import { WaitlistService } from '../../services/waitlist.service';

export const getSystemHealth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

export const getUserAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const totalUsers = await User.countDocuments();

    // Users joined today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: startOfDay } });

    // Users by Plan
    const planAggregation = await User.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } }
    ]);
    const usersByPlan = planAggregation.reduce((acc, curr) => {
      acc[curr._id || 'unknown'] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    // Active vs Suspended vs Deleted
    const statusAggregation = await User.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const usersByStatus = statusAggregation.reduce((acc, curr) => {
      acc[curr._id || 'unknown'] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersToday,
        usersByPlan,
        usersByStatus,
      }
    });
  } catch (err) {
    next(err);
  }
};

export const getProductAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const totalProducts = await Product.countDocuments();

    // Products ingested in the last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const freshProducts = await Product.countDocuments({ lastIngestedAt: { $gte: oneDayAgo } });

    // Breakdown by source
    const sourceAggregation = await Product.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    const productsBySource = sourceAggregation.reduce((acc, curr) => {
      acc[curr._id || 'unknown'] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    // Breakdown by Top Level Category
    const categoryAggregation = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    const topCategories = categoryAggregation.reduce((acc, curr) => {
      acc[curr._id || 'Uncategorized'] = curr.count;
      return acc;
    }, {} as Record<string, number>);


    res.json({
      success: true,
      data: {
        totalProducts,
        freshProducts24h: freshProducts,
        productsBySource,
        topCategories
      }
    });
  } catch (err) {
    next(err);
  }
};

export const getCreativeAnalytics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const totalCreatives = await Creative.countDocuments();

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const freshCreatives24h = await Creative.countDocuments({ ingestedAt: { $gte: oneDayAgo } });

    const [adsCount, organicCount] = await Promise.all([
      Creative.countDocuments({ isAd: true }),
      Creative.countDocuments({ isAd: false }),
    ]);

    const sectionAggregation = await Creative.aggregate([
      { $group: { _id: '$section', count: { $sum: 1 } } },
    ]);
    const creativesBySection = sectionAggregation.reduce((acc, curr) => {
      acc[curr._id || 'unknown'] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    const categoryAggregation = await Creative.aggregate([
      { $group: { _id: '$categoryL1', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    const topCategories = categoryAggregation.reduce((acc, curr) => {
      acc[curr._id || 'Uncategorized'] = curr.count;
      return acc;
    }, {} as Record<string, number>);

    const videoTotalRows = await Creative.aggregate([
      {
        $project: {
          videoCount: {
            $add: [1, { $size: { $ifNull: ['$relatedVideos', []] } }],
          },
        },
      },
      { $group: { _id: null, totalVideos: { $sum: '$videoCount' } } },
    ]);
    const totalVideos = videoTotalRows[0]?.totalVideos ?? 0;

    res.json({
      success: true,
      data: {
        totalCreatives,
        totalVideos,
        freshCreatives24h,
        creativesBySection,
        creativesByAdType: {
          ads: adsCount,
          organic: organicCount,
        },
        topCategories,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const listProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = req.query as unknown as AdminProductsQueryInput;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.source) filter.source = query.source;
    if (query.category) filter.category = query.category;
    if (query.q) {
      const regex = new RegExp(query.q, 'i');
      filter.$or = [{ title: regex }, { description: regex }, { tags: { $in: [regex] } }];
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ lastIngestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json(
      successResponse(
        {
          products,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        },
        'Products retrieved successfully.'
      )
    );
  } catch (err) {
    next(err);
  }
};

export const listTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = req.query as unknown as AdminTransactionsQueryInput;
    const data = await TransactionService.list(query);

    res.json(
      successResponse(data, 'Transaction records retrieved successfully.')
    );
  } catch (err) {
    next(err);
  }
};

export const createTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = req.body as CreateTransactionInput;
    const transaction = await TransactionService.create(input);

    res.status(201).json(
      successResponse(transaction, 'Transaction record created successfully.', 201)
    );
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
        'Users retrieved successfully.'
      )
    );
  } catch (err) {
    next(err);
  }
};

export const updateUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
        `User status updated to ${status} successfully.`
      )
    );
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    res.json(
      successResponse(
        { id: userId },
        'User account permanently deleted successfully.'
      )
    );
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { productId } = req.params as unknown as AdminProductIdParamInput;

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError(404, 'Product not found', 'PRODUCT_NOT_FOUND');
    }

    await Product.findByIdAndDelete(productId);

    res.json(
      successResponse(
        { id: productId },
        'Product permanently deleted successfully.'
      )
    );
  } catch (err) {
    next(err);
  }
};

export const listWaitlist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = req.query as unknown as AdminWaitlistQueryInput;
    const data = await WaitlistService.list(query);

    res.json(
      successResponse(data, 'Waitlist entries retrieved successfully.')
    );
  } catch (err) {
    next(err);
  }
};
