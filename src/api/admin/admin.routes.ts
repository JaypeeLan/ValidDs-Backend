import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as adminController from './admin.controller';
import {
  AdminTransactionsQuerySchema,
  CreateTransactionSchema,
  AdminUsersQuerySchema,
  AdminUserIdParamSchema,
  AdminProductIdParamSchema,
  AdminProductsQuerySchema,
  AdminWaitlistQuerySchema,
  UpdateUserStatusSchema,
} from './admin.validator';

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

// Route: GET /api/v1/admin/analytics/creatives
// Desc: Returns creative (TikTok video) analytics: counts, sections, ads vs organic, top categories
router.get('/analytics/creatives', adminController.getCreativeAnalytics);

// Route: GET /api/v1/admin/users
// Desc: List users with pagination and filters (admin only)
router.get('/users', validate(AdminUsersQuerySchema, 'query'), adminController.listUsers);

// Route: GET /api/v1/admin/products
// Desc: List products with pagination and filters (admin only)
router.get('/products', validate(AdminProductsQuerySchema, 'query'), adminController.listProducts);

// Route: DELETE /api/v1/admin/users/:userId
// Desc: Permanently delete a user account (admin only)
router.delete(
  '/users/:userId',
  validate(AdminUserIdParamSchema, 'params'),
  adminController.deleteUser
);

// Route: PATCH /api/v1/admin/users/:userId/status
// Desc: Update user account status (active | suspended)
router.patch(
  '/users/:userId/status',
  validate(AdminUserIdParamSchema, 'params'),
  validate(UpdateUserStatusSchema, 'body'),
  adminController.updateUserStatus
);

// Route: DELETE /api/v1/admin/products/:productId
// Desc: Permanently delete a product (admin only)
router.delete(
  '/products/:productId',
  validate(AdminProductIdParamSchema, 'params'),
  adminController.deleteProduct
);

// Route: GET /api/v1/admin/transactions
// Desc: List all transaction records (admin only)
router.get(
  '/transactions',
  validate(AdminTransactionsQuerySchema, 'query'),
  adminController.listTransactions
);

// Route: POST /api/v1/admin/transactions
// Desc: Store a transaction record (admin only)
router.post(
  '/transactions',
  validate(CreateTransactionSchema, 'body'),
  adminController.createTransaction
);

// Route: GET /api/v1/admin/waitlist
// Desc: List waitlist entries with pagination, search, and stats (admin only)
router.get(
  '/waitlist',
  validate(AdminWaitlistQuerySchema, 'query'),
  adminController.listWaitlist
);

export default router;
