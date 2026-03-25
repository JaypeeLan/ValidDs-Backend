import { Router } from 'express';
import healthRouter from './health/health.routes';
import authRouter from './auth/auth.routes';
import profileRouter from './profile/profile.routes';

/**
 * Root API router.
 *
 * Health routes: mounted at root (not under /api/v1) for Render health checks
 * All other routes: mounted under /api/v1 in app.ts
 *
 * Add new feature routers here as they are built:
 *   import productRouter from './products/product.routes';
 *   apiRouter.use('/products', productRouter);
 */

// Feature router (mounted under /api/v1)
const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/profile', profileRouter);

// Uncomment as each module is implemented:
// import productRouter from './products/product.routes';
// import videoRouter from './videos/video.routes';
// import trendRouter from './trends/trend.routes';
// import storeRouter from './stores/store.routes';
// import supplierRouter from './suppliers/supplier.routes';
// apiRouter.use('/products', productRouter);
// apiRouter.use('/videos', videoRouter);
// apiRouter.use('/trends', trendRouter);
// apiRouter.use('/stores', storeRouter);
// apiRouter.use('/suppliers', supplierRouter);

export { healthRouter };
export default apiRouter;
