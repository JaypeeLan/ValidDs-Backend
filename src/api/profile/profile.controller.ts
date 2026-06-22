import { Request, Response, NextFunction } from 'express';
import {
  UpdateProfileInput,
  AddBookmarkInput,
  ContentRegionInput,
  RemoveBookmarkQuery,
  CloseAccountInput,
  ChangePasswordInput,
} from './profile.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { PLAN_LIMITS } from '../../models/user.model';
import { countUserBookmarks, formatUserBookmarks } from '../../services/bookmark.service';
import { AccountService } from '../../services/account.service';
import { AuthService } from '../../services/auth.service';

export const ProfileController = {
  me(req: Request, res: Response): void {
    res.json(successResponse({ user: req.user!.toJSON() }, ResponseMessage.PROFILE_RETRIEVED, 200));
  },

  getContentRegion(req: Request, res: Response): void {
    res.json(
      successResponse({ contentRegion: req.user!.contentRegion }, ResponseMessage.SUCCESS, 200),
    );
  },

  async updateContentRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { contentRegion } = req.body as ContentRegionInput;
      const user = req.user!;
      user.contentRegion = contentRegion;
      await user.save();
      res.json(
        successResponse({ contentRegion: user.contentRegion }, ResponseMessage.UPDATED, 200),
      );
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
      const bookmarks = await formatUserBookmarks(
        req.user!,
        req.models?.Creative,
        req.models?.Product,
      );
      res.json(successResponse({ bookmarks }, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async addBookmark(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as AddBookmarkInput;
      const user = req.user!;

      const maxBookmarks = PLAN_LIMITS[user.plan].savedProductsMax;
      if (maxBookmarks !== -1 && countUserBookmarks(user) >= maxBookmarks) {
        throw new AppError(
          403,
          `Plan limit reached: maximum ${maxBookmarks} saved items`,
          'PLAN_LIMIT_REACHED',
        );
      }

      if (input.productId) {
        if (user.savedProducts.some((p) => p.productId.toString() === input.productId)) {
          const bookmarks = await formatUserBookmarks(
            user,
            req.models?.Creative,
            req.models?.Product,
          );
          res.json(successResponse({ bookmarks }, 'Product already saved', 200));
          return;
        }

        user.savedProducts.push({
          productId: input.productId as never,
          savedAt: new Date(),
          notes: input.notes,
          tags: input.tags,
        });
        await user.save();
        const bookmarks = await formatUserBookmarks(
          user,
          req.models?.Creative,
          req.models?.Product,
        );
        res.json(successResponse({ bookmarks }, 'Product saved successfully', 201));
        return;
      }

      const creativeId = input.creativeId!;
      if (user.savedCreatives?.some((c) => c.creativeId.toString() === creativeId)) {
        const bookmarks = await formatUserBookmarks(
          user,
          req.models?.Creative,
          req.models?.Product,
        );
        res.json(successResponse({ bookmarks }, 'Creative already saved', 200));
        return;
      }

      if (!user.savedCreatives) user.savedCreatives = [];
      user.savedCreatives.push({
        creativeId: creativeId as never,
        savedAt: new Date(),
        notes: input.notes,
        tags: input.tags,
      });
      await user.save();
      const bookmarks = await formatUserBookmarks(user, req.models?.Creative, req.models?.Product);
      res.json(successResponse({ bookmarks }, 'Creative saved successfully', 201));
    } catch (err) {
      next(err);
    }
  },

  async removeBookmark(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { kind } = req.query as unknown as RemoveBookmarkQuery;
      const user = req.user!;

      if (kind === 'creative') {
        const index = (user.savedCreatives ?? []).findIndex((c) => c.creativeId.toString() === id);
        if (index > -1) {
          user.savedCreatives.splice(index, 1);
          await user.save();
        }
      } else {
        const index = user.savedProducts.findIndex((p) => p.productId.toString() === id);
        if (index > -1) {
          user.savedProducts.splice(index, 1);
          await user.save();
        }
      }

      const bookmarks = await formatUserBookmarks(user, req.models?.Creative, req.models?.Product);
      res.json(successResponse({ bookmarks }, 'Bookmark removed', 200));
    } catch (err) {
      next(err);
    }
  },

  async closeAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as CloseAccountInput;
      await AccountService.closeAccount(String(req.user!._id), input);
      res.json(successResponse({ closed: true }, ResponseMessage.ACCOUNT_CLOSED, 200));
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body as ChangePasswordInput;
      await AuthService.changePassword(String(req.user!._id), currentPassword, newPassword);
      res.json(successResponse({ changed: true }, ResponseMessage.PASSWORD_CHANGED, 200));
    } catch (err) {
      next(err);
    }
  },
};
