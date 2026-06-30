import { Router } from 'express';
import { WaitlistController } from './waitlist.controller';
import { validate } from '../../middleware/validate.middleware';
import { strictLimiter } from '../../middleware/rate-limit.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { JoinWaitlistSchema } from './waitlist.validator';

const router = Router();

/**
 * Waitlist Routes — JWT required.
 *
 *  POST /waitlist   → add an email to the pre-launch waitlist
 */
router.post(
  '/',
  strictLimiter,
  requireAuth,
  validate(JoinWaitlistSchema, 'body'),
  WaitlistController.join,
);

export default router;
