export { User } from './user.model';
export { Product } from './product.model';
export { Transaction } from './transaction.model';

export type { IUser, IUserDocument, IUserModel, AuthProvider, UserPlan, UserRole, UserStatus, PLAN_LIMITS } from './user.model';
export type { IProduct, IProductDocument, IProductModel, ITrend, TrendDirection, IPrimaryCreator, IRatingSource, ISupplier, ISalesEvidence, IAIIntelligence } from './product.model';
export type {
  ITransaction,
  ITransactionDocument,
  ITransactionModel,
  TransactionProvider,
  TransactionMode,
  TransactionStatus,
} from './transaction.model';
