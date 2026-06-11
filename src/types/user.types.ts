import mongoose, { Document, Model } from 'mongoose';

export type AuthProvider = 'google' | 'local' | 'tiktok';
export type UserPlan = 'free' | 'explorer' | 'pro' | 'premium';
export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface IGoogleAuth {
  googleId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface ITikTokAuth {
  openId: string;
  unionId?: string;
}

export interface ILocalAuth {
  passwordHash?: string;
  passwordResetToken?: string;
  passwordResetExpiresAt?: Date;
  emailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationCodeHash?: string;
  emailVerificationExpiresAt?: Date;
}

/**
 * Shopify store connection stored on the user document.
 * The `accessToken` is encrypted at rest using AES-256-GCM (see security/encryption.ts).
 */
export interface IShopifyConnection {
  shop: string; // e.g. "my-store.myshopify.com"
  accessTokenCiphertext: string; // hex
  accessTokenIv: string; // hex
  accessTokenAuthTag: string; // hex
  refreshTokenCiphertext?: string;
  refreshTokenIv?: string;
  refreshTokenAuthTag?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
  shopName?: string;
  shopEmail?: string;
  shopOwner?: string;
  shopCountry?: string;
  shopCurrency?: string;
  installedAt: Date;
  lastSyncedAt?: Date;
}

export interface IUsageStats {
  productsViewedToday: number;
  productsViewedTotal: number;
  searchesToday: number;
  searchesTotal: number;
  lastActivityAt: Date;
  usageResetAt: Date;
}

export interface ISavedProduct {
  productId: mongoose.Types.ObjectId;
  savedAt: Date;
  notes?: string;
  tags?: string[];
}

export interface ISearchHistoryEntry {
  query: string;
  filters?: Record<string, unknown>;
  searchedAt: Date;
  resultCount?: number;
}

export interface INotificationPrefs {
  emailOnNewTrend: boolean;
  emailOnSavedProductUpdate: boolean;
  emailMarketing: boolean;
}

export interface IUser {
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  authProvider: AuthProvider;
  googleAuth?: IGoogleAuth;
  tiktokAuth?: ITikTokAuth;
  localAuth?: ILocalAuth;
  shopifyConnection?: IShopifyConnection;
  role: UserRole;
  plan: UserPlan;
  planExpiresAt?: Date;
  creditBalance: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  usage: IUsageStats;
  savedProducts: ISavedProduct[];
  searchHistory: ISearchHistoryEntry[];
  notifications: INotificationPrefs;
  timezone?: string;
  locale?: string;
  contentRegion: string;
  status: UserStatus;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  loginCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface IUserDocument extends IUser, Document {
  isActive(): boolean;
  canViewProduct(): boolean;
  incrementProductView(): Promise<void>;
  resetDailyUsage(): Promise<void>;
  softDelete(): Promise<void>;
  deductCredits(amount: number): Promise<boolean>;
}

export interface IUserModel extends Model<IUserDocument> {
  findByEmail(email: string): Promise<IUserDocument | null>;
  findByGoogleId(googleId: string): Promise<IUserDocument | null>;
  findByTikTokOpenId(openId: string): Promise<IUserDocument | null>;
  findActiveById(id: string): Promise<IUserDocument | null>;
}
