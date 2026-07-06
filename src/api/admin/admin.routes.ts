import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as adminController from './admin.controller';
import {
  AdminTransactionsQuerySchema,
  CreateTransactionSchema,
  AdminUsersQuerySchema,
  AdminUserIdParamSchema,
  AdminProductsQuerySchema_v2,
  AdminWaitlistQuerySchema,
  UpdateUserStatusSchema,
  AdminAnalyticsQuerySchema,
  AdminMaintenanceRunsQuerySchema,
  AdminJobHeartbeatsQuerySchema,
  AdminProviderHealthQuerySchema,
  AdminDeleteContentParamSchema,
  AdminMarketQuerySchema,
  AdminCreateProductSchema,
  AdminCreateCreativeSchema,
} from './admin.validator';

const router = Router();

// Protect all admin routes with authentication and role check
router.use(requireAuth, requireRole('admin'));

// ── Health & analytics ────────────────────────────────────────────────────────

router.get('/health', adminController.getSystemHealth);

// ?market=US  → stats for US only
// (no market) → aggregated across all markets
router.get('/analytics/users', adminController.getUserAnalytics);
router.get(
  '/analytics/products',
  validate(AdminAnalyticsQuerySchema, 'query'),
  adminController.getProductAnalytics,
);
router.get(
  '/analytics/creatives',
  validate(AdminAnalyticsQuerySchema, 'query'),
  adminController.getCreativeAnalytics,
);
router.get(
  '/analytics/inventory',
  validate(AdminAnalyticsQuerySchema, 'query'),
  adminController.getInventoryAnalyticsHandler,
);

router.get('/operations/overview', adminController.getOperationsOverviewHandler);
router.get(
  '/maintenance/runs',
  validate(AdminMaintenanceRunsQuerySchema, 'query'),
  adminController.listMaintenanceRunsHandler,
);
router.get(
  '/maintenance/jobs',
  validate(AdminJobHeartbeatsQuerySchema, 'query'),
  adminController.listJobHeartbeatsHandler,
);
router.get(
  '/providers/health',
  validate(AdminProviderHealthQuerySchema, 'query'),
  adminController.getProviderHealthHandler,
);

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', validate(AdminUsersQuerySchema, 'query'), adminController.listUsers);
router.delete(
  '/users/:userId',
  validate(AdminUserIdParamSchema, 'params'),
  adminController.deleteUser,
);
router.patch(
  '/users/:userId/status',
  validate(AdminUserIdParamSchema, 'params'),
  validate(UpdateUserStatusSchema, 'body'),
  adminController.updateUserStatus,
);

// ── Products — market required on every operation ─────────────────────────────
//
// GET    /admin/products?market=US             List products for a market
// POST   /admin/products                       Create a product in a market (body.market)
// DELETE /admin/products/:id?market=US         Delete a product from a market

router.get(
  '/products',
  validate(AdminProductsQuerySchema_v2, 'query'),
  adminController.listProducts,
);

router.post('/products', validate(AdminCreateProductSchema, 'body'), adminController.createProduct);

router.delete(
  '/products/:id',
  validate(AdminDeleteContentParamSchema, 'params'),
  validate(AdminMarketQuerySchema, 'query'),
  adminController.deleteProduct,
);

// ── Creatives — market required on every operation ────────────────────────────
//
// POST   /admin/creatives                      Create a creative in a market (body.market)
// DELETE /admin/creatives/:id?market=US        Delete a creative from a market

router.post(
  '/creatives',
  validate(AdminCreateCreativeSchema, 'body'),
  adminController.createCreative,
);

router.delete(
  '/creatives/:id',
  validate(AdminDeleteContentParamSchema, 'params'),
  validate(AdminMarketQuerySchema, 'query'),
  adminController.deleteCreative,
);

// ── Transactions ──────────────────────────────────────────────────────────────

router.get(
  '/transactions',
  validate(AdminTransactionsQuerySchema, 'query'),
  adminController.listTransactions,
);

router.post(
  '/transactions',
  validate(CreateTransactionSchema, 'body'),
  adminController.createTransaction,
);

// ── Waitlist ──────────────────────────────────────────────────────────────────

router.get('/waitlist', validate(AdminWaitlistQuerySchema, 'query'), adminController.listWaitlist);

export default router;
