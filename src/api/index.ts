import { Router } from 'express';
import healthRouter from './health/health.routes';
import authRouter from './auth/auth.routes';
import profileRouter from './profile/profile.routes';
import productRouter from './products/product.routes';

const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/products', productRouter);

// Uncomment as each module is implemented:
// import videoRouter from './videos/video.routes';
// import trendRouter from './trends/trend.routes';
// import storeRouter from './stores/store.routes';
// import supplierRouter from './suppliers/supplier.routes';
// apiRouter.use('/videos', videoRouter);
// apiRouter.use('/trends', trendRouter);
// apiRouter.use('/stores', storeRouter);
// apiRouter.use('/suppliers', supplierRouter);

export { healthRouter };
export default apiRouter;
