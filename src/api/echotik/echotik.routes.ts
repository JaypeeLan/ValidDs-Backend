import { NextFunction, Request, Response, Router } from 'express';
import { requireApiKey } from '../../middleware/auth.middleware';
import { successResponse } from '../../utils/response.util';
import { runTikTokLiveScraper } from '../../services/apify.service';
import { AppError } from '../../middleware/error.middleware';

const router = Router();

router.get('/live', requireApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    const maxItems = Number(req.query.maxItems ?? 20);
    if (!keyword) {
      throw new AppError(400, 'keyword is required', 'VALIDATION_ERROR');
    }
    const lives = await runTikTokLiveScraper(keyword, maxItems);
    res.json(successResponse({ keyword, count: lives.length, lives }, 'TikTok live streams retrieved successfully.', 200));
  } catch (err) {
    next(err);
  }
});

export default router;
