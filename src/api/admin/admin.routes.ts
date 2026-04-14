import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import * as adminController from './admin.controller';

const router = Router();

// Protect all admin routes with authentication and role check
router.use(requireAuth, requireRole('admin'));

// Route: GET /api/v1/admin/health
// Desc: Returns server health metrics (memory, CPU, DB, cache, jobs)
router.get('/health', adminController.getSystemHealth);

// Route: GET /api/v1/admin/analytics/users
// Desc: Returns user analytics (total, new today, by plan, by status)
router.get('/analytics/users', adminController.getUserAnalytics);

// Route: GET /api/v1/admin/analytics/products
// Desc: Returns product analytics (total, fresh 24h, by source, top categories)
router.get('/analytics/products', adminController.getProductAnalytics);

export default router;
