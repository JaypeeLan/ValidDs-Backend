import mongoose, { Document, Model } from 'mongoose';

export type TransactionProvider = 'stripe' | 'shopify';
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
