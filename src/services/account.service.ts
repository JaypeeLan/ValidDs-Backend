import { User, IUserDocument } from '../models/user.model';
import { AppError } from '../middleware/error.middleware';
import { getStripe } from './stripe.service';
import { ShopifyService } from './shopify.service';
import { AuthService } from './auth.service';
import { logger } from '../logger';
import { isDashboardRole } from '../utils/roles.util';

const log = logger.child({ module: 'account-service' });

export type CloseAccountInput = {
  password?: string;
  confirmEmail?: string;
};

export const AccountService = {
  /**
   * Self-service account closure: cancel billing, disconnect integrations,
   * scrub PII, and soft-delete the user record.
   */
  async closeAccount(userId: string, input: CloseAccountInput): Promise<void> {
    const user = await User.findActiveById(userId).select('+localAuth +shopifyConnection');
    if (!user) {
      throw new AppError(404, 'Account not found', 'USER_NOT_FOUND');
    }

    if (isDashboardRole(user.role)) {
      throw new AppError(
        400,
        'Admin accounts cannot be closed via this endpoint',
        'INVALID_OPERATION',
      );
    }

    await AccountService.verifyCloseConfirmation(user, input);

    if (user.stripeSubscriptionId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          await stripe.subscriptions.cancel(user.stripeSubscriptionId);
          log.info('Stripe subscription cancelled for account closure', {
            userId,
            subscriptionId: user.stripeSubscriptionId,
          });
        } catch (err) {
          log.error('Failed to cancel Stripe subscription during account closure', { userId, err });
          throw new AppError(
            502,
            'Unable to cancel your subscription. Please try again or contact support.',
            'STRIPE_CANCEL_FAILED',
          );
        }
      }
    }

    if (user.shopifyConnection) {
      await ShopifyService.disconnect(userId);
    }

    user.plan = 'free';
    user.creditBalance = 0;
    user.stripeSubscriptionId = undefined;
    user.stripePriceId = undefined;
    user.planExpiresAt = undefined;
    user.savedProducts = [];
    user.savedCreatives = [];
    user.searchHistory = [];
    user.shopifyImportHistory = [];
    user.name = 'Deleted User';
    user.firstName = undefined;
    user.lastName = undefined;
    user.avatarUrl = undefined;
    user.googleAuth = undefined;
    user.tiktokAuth = undefined;
    user.localAuth = undefined;
    user.shopifyConnection = undefined;
    user.notifications = {
      emailOnNewTrend: false,
      emailOnSavedProductUpdate: false,
      emailMarketing: false,
    };

    await user.softDelete();

    log.info('Account closed', { userId });
  },

  async verifyCloseConfirmation(user: IUserDocument, input: CloseAccountInput): Promise<void> {
    if (user.authProvider === 'local') {
      if (!input.password) {
        throw new AppError(400, 'Password is required to close your account', 'PASSWORD_REQUIRED');
      }
      const valid = await AuthService.verifyLocalPassword(user, input.password);
      if (!valid) {
        throw new AppError(401, 'Incorrect password', 'INVALID_PASSWORD');
      }
      return;
    }

    if (!input.confirmEmail) {
      throw new AppError(
        400,
        'Email confirmation is required to close your account',
        'EMAIL_CONFIRMATION_REQUIRED',
      );
    }

    if (input.confirmEmail.toLowerCase().trim() !== user.email.toLowerCase()) {
      throw new AppError(401, 'Email confirmation does not match', 'EMAIL_MISMATCH');
    }
  },
};
