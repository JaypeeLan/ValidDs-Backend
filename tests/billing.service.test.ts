import { BillingService } from '../src/services/billing.service';
import { User } from '../src/models/user.model';
import { getStripe } from '../src/services/stripe.service';
import { AppError } from '../src/middleware/error.middleware';

jest.mock('../src/services/stripe.service', () => ({
  getStripe: jest.fn(),
  getPriceIdForPlan: jest.fn(),
  isStripeLiveMode: jest.fn(() => false),
  STRIPE_TRIAL_DAYS: 7,
}));

describe('BillingService.requestSubscriptionCancellation', () => {
  const mockUpdate = jest.fn();
  const mockCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getStripe as jest.Mock).mockReturnValue({
      subscriptions: {
        update: mockUpdate,
        cancel: mockCancel,
      },
    });
  });

  it('throws when user has no active subscription', async () => {
    const user = await User.create({
      email: 'free-user-cancel@test.com',
      name: 'Free User',
      authProvider: 'local',
      status: 'active',
      plan: 'free',
      creditBalance: 1000,
    });

    await expect(
      BillingService.requestSubscriptionCancellation(String(user._id)),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  it('schedules cancellation at period end by default', async () => {
    const user = await User.create({
      email: 'paid-user-cancel@test.com',
      name: 'Paid User',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
      creditBalance: 60000,
      stripeSubscriptionId: 'sub_test_123',
    });

    mockUpdate.mockResolvedValue({
      id: 'sub_test_123',
      cancel_at_period_end: true,
      current_period_end: 1_900_000_000,
    });

    const result = await BillingService.requestSubscriptionCancellation(String(user._id));

    expect(mockUpdate).toHaveBeenCalledWith('sub_test_123', { cancel_at_period_end: true });
    expect(mockCancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      canceled: true,
      immediate: false,
      plan: 'pro',
      stripeSubscriptionId: 'sub_test_123',
    });
    expect(result.cancelAt).toBe(new Date(1_900_000_000 * 1000).toISOString());

    const refreshed = await User.findById(user._id);
    expect(refreshed?.planExpiresAt?.toISOString()).toBe(result.cancelAt);
  });

  it('cancels immediately when requested', async () => {
    const user = await User.create({
      email: 'paid-user-immediate@test.com',
      name: 'Immediate User',
      authProvider: 'local',
      status: 'active',
      plan: 'explorer',
      creditBalance: 20000,
      stripeSubscriptionId: 'sub_test_456',
    });

    mockCancel.mockResolvedValue({ id: 'sub_test_456', status: 'canceled' });

    const result = await BillingService.requestSubscriptionCancellation(String(user._id), {
      immediate: true,
    });

    expect(mockCancel).toHaveBeenCalledWith('sub_test_456');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      canceled: true,
      immediate: true,
      plan: 'free',
      cancelAt: null,
      stripeSubscriptionId: null,
    });

    const refreshed = await User.findById(user._id);
    expect(refreshed?.plan).toBe('free');
    expect(refreshed?.stripeSubscriptionId).toBeUndefined();
  });

  it('throws when Stripe is not configured', async () => {
    (getStripe as jest.Mock).mockReturnValue(null);

    const user = await User.create({
      email: 'paid-user-no-stripe@test.com',
      name: 'No Stripe User',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
      creditBalance: 60000,
      stripeSubscriptionId: 'sub_test_789',
    });

    await expect(
      BillingService.requestSubscriptionCancellation(String(user._id)),
    ).rejects.toBeInstanceOf(AppError);
  });
});
