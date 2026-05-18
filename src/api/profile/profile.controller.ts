import { Request, Response, NextFunction } from 'express';
import { UpdateProfileInput, AddBookmarkInput, ContentRegionInput } from './profile.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { PLAN_LIMITS } from '../../models/user.model';

export const ProfileController = {
  me(req: Request, res: Response): void {
    res.json(successResponse({ user: req.user!.toJSON() }, ResponseMessage.PROFILE_RETRIEVED, 200));
  },

  getContentRegion(req: Request, res: Response): void {
    res.json(
      successResponse(
        { contentRegion: req.user!.contentRegion },
        ResponseMessage.SUCCESS,
        200,
      ),
    );
  },

  async updateContentRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { contentRegion } = req.body as ContentRegionInput;
      const user = req.user!;
      user.contentRegion = contentRegion;
      await user.save();
      res.json(successResponse({ contentRegion: user.contentRegion }, ResponseMessage.UPDATED, 200));
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as UpdateProfileInput;
      const user = req.user!;

      if (input.name !== undefined) user.name = input.name;
      if (input.firstName !== undefined) user.firstName = input.firstName;
      if (input.lastName !== undefined) user.lastName = input.lastName;
      if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
      if (input.timezone !== undefined) user.timezone = input.timezone;
      if (input.locale !== undefined) user.locale = input.locale;
      if (input.contentRegion !== undefined) user.contentRegion = input.contentRegion;

      if (input.notifications) {
        user.notifications = {
          ...user.notifications,
          ...input.notifications,
        };
      }

      await user.save();

      res.json(successResponse({ user: user.toJSON() }, ResponseMessage.UPDATED, 200));
    } catch (err) {
      next(err);
    }
  },

  async getBookmarks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Return populated savedProducts
      const user = await req.user!.populate('savedProducts.productId');
      res.json(successResponse({ bookmarks: user.savedProducts }, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async addBookmark(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as AddBookmarkInput;
      const user = req.user!;

      const maxBookmarks = PLAN_LIMITS[user.plan].savedProductsMax;
      if (maxBookmarks !== -1 && user.savedProducts.length >= maxBookmarks) {
        throw new AppError(403, `Plan limit reached: maximum ${maxBookmarks} saved products`, 'PLAN_LIMIT_REACHED');
      }

      // Check if already saved
      if (user.savedProducts.some(p => p.productId.toString() === input.productId)) {
        res.json(successResponse({ bookmarks: user.savedProducts }, 'Product already saved', 200));
        return;
      }

      user.savedProducts.push({
        productId: input.productId as any,
        savedAt: new Date(),
        notes: input.notes,
        tags: input.tags,
      });

      await user.save();
      res.json(successResponse({ bookmarks: user.savedProducts }, 'Product saved successfully', 201));
    } catch (err) {
      next(err);
    }
  },

  async removeBookmark(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId } = req.params;
      const user = req.user!;

      const index = user.savedProducts.findIndex(p => p.productId.toString() === productId);
      if (index > -1) {
        user.savedProducts.splice(index, 1);
        await user.save();
      }

      res.json(successResponse({ bookmarks: user.savedProducts }, 'Product removed from bookmarks', 200));
    } catch (err) {
      next(err);
    }
  },
};

