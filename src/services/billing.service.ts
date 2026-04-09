import { User } from '../models/user.model';
import { SocketService } from '../config/socket';
import { logger } from '../logger';

const log = logger.child({ module: 'billing-service' });

export class BillingService {
  /**
   * Deducts a specified amount of credits from the user's balance.
   * If successful, it emits a real-time websocket event carrying the new balance.
   * Returns true on success, or false if the user has insufficient valid credits.
   */
  public static async deductCredits(userId: string, amount: number, actionName: string = 'internal_action'): Promise<boolean> {
    const user = await User.findActiveById(userId);
    
    if (!user) {
      log.warn(`Billing action attempted on unknown or inactive user: ${userId}`);
      return false;
    }

    // Attempt the deduction natively at Schema level
    const success = await user.deductCredits(amount);

    if (success) {
      log.info(`Deducted ${amount} credits from user ${userId} for action: ${actionName}. Remaining: ${user.creditBalance}`);
      
      // Socket emission actively syncing the frontend UI real-time
      try {
        SocketService.emitToUser(userId, 'creditBalanceUpdated', {
          userId,
          newBalance: user.creditBalance,
          deductedAmount: amount,
          action: actionName,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
         log.error(`Socket broadcast failed for user ${userId}`, { err });
      }
    } else {
      log.warn(`User ${userId} has insufficient credits to perform ${actionName}. Required: ${amount}, Available: ${user.creditBalance}`);
    }

    return success;
  }
}
