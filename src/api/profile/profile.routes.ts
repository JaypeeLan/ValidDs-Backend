import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import { validate } from '../../middleware/validate.middleware';
import { ProfileController } from './profile.controller';
import {
  UpdateProfileSchema,
  AddBookmarkSchema,
  ContentRegionSchema,
  RemoveBookmarkParamsSchema,
  RemoveBookmarkQuerySchema,
  CloseAccountSchema,
  ChangePasswordSchema,
} from './profile.validator';

const router = Router();

router.get('/content-region', requireAuth, ProfileController.getContentRegion);
router.patch(
  '/content-region',
  requireAuth,
  validate(ContentRegionSchema, 'body'),
  ProfileController.updateContentRegion,
);

router.get('/', requireAuth, ProfileController.me);
router.patch('/', requireAuth, validate(UpdateProfileSchema, 'body'), ProfileController.update);

// Bookmarks (saved products + creatives)
router.get('/bookmarks', requireAuth, attachMarketModels, ProfileController.getBookmarks);
router.post(
  '/bookmarks',
  requireAuth,
  attachMarketModels,
  validate(AddBookmarkSchema, 'body'),
  ProfileController.addBookmark,
);
router.delete(
  '/bookmarks/:id',
  requireAuth,
  attachMarketModels,
  validate(RemoveBookmarkParamsSchema, 'params'),
  validate(RemoveBookmarkQuerySchema, 'query'),
  ProfileController.removeBookmark,
);

router.post(
  '/close',
  requireAuth,
  validate(CloseAccountSchema, 'body'),
  ProfileController.closeAccount,
);

router.post(
  '/change-password',
  requireAuth,
  validate(ChangePasswordSchema, 'body'),
  ProfileController.changePassword,
);

export default router;
