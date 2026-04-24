import { Router } from 'express';
import { WaitlistController } from './waitlist.controller';
import { validate } from '../../middleware/validate.middleware';
import { JoinWaitlistSchema } from './waitlist.validator';

const router = Router();

/**
 * Waitlist Routes — public, no auth required.
 *
 *  POST /waitlist   → add an email to the pre-launch waitlist
 */
router.post('/', validate(JoinWaitlistSchema, 'body'), WaitlistController.join);

export default router;
