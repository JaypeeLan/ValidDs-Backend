import { Router } from 'express';
import healthRouter from './health/health.routes';
import authRouter from './auth/auth.routes';
import profileRouter from './profile/profile.routes';
import productRouter from './products/product.routes';
import creativeRouter from './creatives/creative.routes';

import ingestionRouter from './ingestion/ingestion.routes';
import jobsRouter from './jobs/jobs.routes';
import adminRouter from './admin/admin.routes';
import billingRouter from './billing/billing.routes';
import waitlistRouter from './waitlist/waitlist.routes';
import scraperRouter from './scrapers/scraper.routes';

const apiRouter = Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/creatives', creativeRouter);
apiRouter.use('/ingestion', ingestionRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/waitlist', waitlistRouter);
apiRouter.use('/scrapers', scraperRouter);

// Sentry test endpoint
apiRouter.get('/debug-sentry', (_req, _res) => {
  throw new Error('Test Sentry Error from ValidDs Backend');
});

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
