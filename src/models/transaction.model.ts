import mongoose, { Document, Model, Schema } from 'mongoose';

export type TransactionProvider = 'stripe';
export type TransactionMode = 'test' | 'live';
export type TransactionStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface ITransaction {
  userId: mongoose.Types.ObjectId;
  userEmail?: string;
  provider: TransactionProvider;
  mode: TransactionMode;
  status: TransactionStatus;
  amount: number;
  currency: string;
  reference?: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  metadata?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITransactionDocument extends ITransaction, Document {}

export interface ITransactionModel extends Model<ITransactionDocument> {}

const TransactionSchema = new Schema<ITransactionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userEmail: { type: String, lowercase: true, trim: true },
    provider: {
      type: String,
      enum: ['stripe'],
      required: true,
      default: 'stripe',
      index: true,
    },
    mode: {
      type: String,
      enum: ['test', 'live'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      required: true,
      default: 'pending',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'USD',
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    reference: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
    stripePaymentIntentId: { type: String, trim: true, sparse: true, index: true },
    stripeCustomerId: { type: String, trim: true, sparse: true, index: true },
    metadata: { type: Map, of: String, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

TransactionSchema.index({ createdAt: -1 });

export const Transaction =
  (mongoose.models.Transaction as ITransactionModel) ||
  mongoose.model<ITransactionDocument, ITransactionModel>('Transaction', TransactionSchema);
