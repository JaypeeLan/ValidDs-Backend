import { User } from '../models/user.model';
import { Transaction } from '../models/transaction.model';
import { AppError } from '../middleware/error.middleware';
import type { AdminTransactionsQueryInput, CreateTransactionInput } from '../api/admin/admin.validator';

export const TransactionService = {
  async list(query: AdminTransactionsQueryInput) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.mode) filter.mode = query.mode;

    const [rows, total] = await Promise.all([
      Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(filter),
    ]);

    const transactions = rows.map((row) => ({
      id: String(row._id),
      userId: String(row.userId),
      userEmail: row.userEmail,
      provider: row.provider,
      mode: row.mode,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      reference: row.reference,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeCustomerId: row.stripeCustomerId,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  },

  async create(input: CreateTransactionInput) {
    const userExists = await User.findById(input.userId).select('_id email').lean();
    if (!userExists) {
      throw new AppError(404, 'User not found for transaction', 'USER_NOT_FOUND');
    }

    const transaction = await Transaction.create({
      userId: input.userId,
      userEmail: input.userEmail ?? userExists.email,
      provider: input.provider,
      mode: input.mode,
      status: input.status,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      reference: input.reference,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeCustomerId: input.stripeCustomerId,
      metadata: input.metadata ?? {},
    });

    return {
      id: String(transaction._id),
      userId: String(transaction.userId),
      userEmail: transaction.userEmail,
      provider: transaction.provider,
      mode: transaction.mode,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      reference: transaction.reference,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  },
};
