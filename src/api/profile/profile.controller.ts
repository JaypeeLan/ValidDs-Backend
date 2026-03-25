import { Request, Response, NextFunction } from 'express';
import { UpdateProfileInput } from './profile.validator';

export const ProfileController = {
  me(req: Request, res: Response): void {
    res.json({ success: true, data: { user: req.user!.toJSON() } });
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

      res.json({ success: true, data: { user: user.toJSON() } });
    } catch (err) {
      next(err);
    }
  },
};

