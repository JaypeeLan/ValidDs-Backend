import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { ProfileController } from './profile.controller';
import { UpdateProfileSchema, AddBookmarkSchema, ContentRegionSchema } from './profile.validator';

const router = Router();

router.get('/content-region', requireAuth, ProfileController.getContentRegion);
router.patch('/content-region', requireAuth, validate(ContentRegionSchema, 'body'), ProfileController.updateContentRegion);

router.get('/', requireAuth, ProfileController.me);
router.patch('/', requireAuth, validate(UpdateProfileSchema, 'body'), ProfileController.update);

// Bookmarks (Saved Products)
router.get('/bookmarks', requireAuth, ProfileController.getBookmarks);
router.post('/bookmarks', requireAuth, validate(AddBookmarkSchema, 'body'), ProfileController.addBookmark);
router.delete('/bookmarks/:productId', requireAuth, ProfileController.removeBookmark);

export default router;

