export { User } from './user.model';
export { Product } from './product.model';
export { Transaction } from './transaction.model';
export { WaitlistEntry } from './waitlist.model';
export { LiveSession } from './live-session.model';
export type { ILiveSession, ILiveSessionDocument, IProductSnapshot, IViewerPoll } from './live-session.model';

export type { IUser, IUserDocument, IUserModel, AuthProvider, UserPlan, UserRole, UserStatus } from '../types/user.types';
export type { IProduct, IProductDocument, IProductModel, ITrend, TrendDirection, IPrimaryCreator, IAIIntelligence } from '../types/product.types';
export type {
  ITransaction,
  ITransactionDocument,
  ITransactionModel,
  TransactionProvider,
  TransactionMode,
  TransactionStatus,
} from '../types/transaction.types';
export type { IWaitlistEntry, IWaitlistEntryDocument, IWaitlistEntryModel } from '../types/waitlist.types';
