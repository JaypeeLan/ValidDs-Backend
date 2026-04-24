import { Request, Response, NextFunction } from 'express';
import { WaitlistService } from '../../services/waitlist.service';
import { successResponse, ResponseMessage } from '../../utils/response.util';
import { JoinWaitlistInput } from './waitlist.validator';

export const WaitlistController = {
  /**
   * POST /api/v1/waitlist
   * Body: { email, source?, referrer? }
   *
   * Responses:
   *   200 { joined: true }  — email already on the waitlist (idempotent).
   *   201 { joined: true }  — email accepted and stored.
   */
  async join(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, source, referrer } = req.body as JoinWaitlistInput;

      const { entry, alreadyOnWaitlist } = await WaitlistService.join(email, {
        source,
        referrer: referrer ?? (req.get('referer') || undefined),
        ipAddress: req.ip,
        userAgent: req.get('user-agent') || undefined,
      });

      const statusCode = alreadyOnWaitlist ? 200 : 201;
      const message = alreadyOnWaitlist
        ? 'This email is already on the waitlist.'
        : "You've been added to the waitlist. We'll be in touch.";

      res.status(statusCode).json(
        successResponse(
          {
            joined: true,
            alreadyOnWaitlist,
            email: entry.email,
            joinedAt: entry.createdAt,
          },
          message as ResponseMessage,
          statusCode
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
