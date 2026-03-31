import { Request, Response, NextFunction } from 'express';
import { UpdateProfileInput } from './profile.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';

export const ProfileController = {
  me(req: Request, res: Response): void {
    res.json(successResponse({ user: req.user!.toJSON() }, ResponseMessage.PROFILE_RETRIEVED, 200));
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
};

