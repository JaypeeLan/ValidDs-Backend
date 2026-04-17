import { Request, Response, NextFunction } from 'express';
import { CreativeService } from '../../services/creative.service';
import { CreativeListQuery, CreativeIngestBody } from './creative.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { NotFoundError } from '../../middleware/error.middleware';

export const CreativeController = {
  /**
   * Retrieves a paginated list of creatives with filters.
   * GET /api/v1/creatives
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as CreativeListQuery;
      const result = await CreativeService.findCreatives(query);

      res.json(
        successResponse(
          result,
          ResponseMessage.CREATIVES_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * Retrieves detailed information for a single creative.
   * GET /api/v1/creatives/:id
   */
  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const creative = await CreativeService.getCreativeById(id);

      if (!creative) {
        throw new NotFoundError('Creative not found');
      }

      res.json(
        successResponse(
          { creative },
          ResponseMessage.CREATIVE_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
  /**
   * Standalone creative ingestion by keyword.
   * POST /api/v1/creatives/ingest
   */
  async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { keyword, limit, period, country } = req.body as CreativeIngestBody;
      const result = await CreativeService.ingestByKeyword(keyword, { limit, period, country });

      res.status(201).json(
        successResponse(
          result,
          ResponseMessage.CREATIVES_INGESTED,
          201
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
