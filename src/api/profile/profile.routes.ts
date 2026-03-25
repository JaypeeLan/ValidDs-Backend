import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { ProfileController } from './profile.controller';
import { UpdateProfileSchema } from './profile.validator';

const router = Router();

router.get('/', requireAuth, ProfileController.me);
router.patch('/', requireAuth, validate(UpdateProfileSchema, 'body'), ProfileController.update);

export default router;

