import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import os from 'os';
import { getRedisClient } from '../../cache/redis.client';
import { getJobsStatus } from '../../jobs/index';
import { User } from '../../models/user.model';
import { Product } from '../../models/product.model';

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
