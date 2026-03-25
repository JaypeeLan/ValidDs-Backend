import { Router } from 'express';
import { livenessHandler, readinessHandler } from './health.controller';

const router = Router();

/**
 * GET /health  — liveness (is the process alive?)
 * GET /ready   — readiness (are all dependencies up?)
 */
router.get('/health', livenessHandler);
router.get('/ready', readinessHandler);

export default router;
