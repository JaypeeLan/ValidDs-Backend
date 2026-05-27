import { Router } from 'express';
import { requireIngestKey } from '../../middleware/ingest-key.middleware';
import { ingestCreative, ingestProduct } from './ingest.controller';

const router = Router();

router.post('/ingest/product', requireIngestKey, ingestProduct);
router.post('/ingest/creative', requireIngestKey, ingestCreative);

export default router;
