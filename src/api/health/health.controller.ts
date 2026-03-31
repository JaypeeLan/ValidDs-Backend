import { Request, Response } from 'express';
import { getMongoStatus } from '../../db/client';
import { getRedisStatus } from '../../cache/redis.client';
import { env } from '../../config/env.validation';
import { ResponseMessage, successResponse } from '../../utils/response.util';

/**
 * Health check endpoints.
 *
 * GET /health  — liveness probe
 *   Returns 200 if the process is alive.
 *   Render uses this to know the app is running.
 *
 * GET /ready   — readiness probe
 *   Returns 200 only if all critical dependencies (MongoDB, Redis) are healthy.
 *   Use this as the load balancer / deploy health check.
 *   If this returns non-200, Render will not route traffic to the instance.
 */

interface ServiceStatus {
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  services?: Record<string, ServiceStatus>;
}

export async function livenessHandler(_req: Request, res: Response): Promise<void> {
  const response = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  } satisfies Partial<HealthResponse>;
  res.status(200).json(successResponse(response, ResponseMessage.HEALTH_OK, 200));
}

export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const mongoStatus = getMongoStatus();
  const redisStatus = getRedisStatus();

  const services: Record<string, ServiceStatus> = {
    mongodb: {
      status: mongoStatus === 'connected' ? 'ok' : 'down',
    },
    redis: {
      status: redisStatus === 'ready' ? 'ok' : 'down',
    },
  };

  const allHealthy = Object.values(services).every((s) => s.status === 'ok');
  const anyDown = Object.values(services).some((s) => s.status === 'down');

  const overallStatus = allHealthy ? 'ok' : anyDown ? 'down' : 'degraded';
  const httpStatus = allHealthy ? 200 : 503;

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    environment: env.NODE_ENV,
    uptime: process.uptime(),
    services,
  };

  res.status(httpStatus).json(successResponse(response, ResponseMessage.HEALTH_OK, httpStatus));
}
