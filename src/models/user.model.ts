import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * User Model
 *
 * Designed for ValidDs — a dropshipper product research platform.
 *
 * Auth strategies supported:
 *  - Google OAuth (primary — "Sign in with Google")
 *  - Email + password (optional local auth)
 *
 * The model tracks:
 *  - Identity fields (name, email, avatar)
 *  - Auth method (google | local)
 *  - Subscription/plan info (free | pro | team)
 *  - Usage tracking (for rate limiting and quota enforcement)
 *  - Saved products, search history (core product features)
 *  - Account status and soft delete
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

export type AuthProvider = 'google' | 'local' | 'tiktok';
export type UserPlan = 'free' | 'trial' | 'pro' | 'team' | 'starter' | 'validator' | 'scale';
export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

// ── Sub-document interfaces ───────────────────────────────────────────────────

export interface IGoogleAuth {
  googleId: string;
  accessToken?: string;        // Not stored long-term — refresh only
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

export interface IUsageStats {
  productsViewedToday: number;
  productsViewedTotal: number;
  searchesToday: number;
  searchesTotal: number;
  lastActivityAt: Date;
  usageResetAt: Date;          // When the daily counters were last reset
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

// ── Main interface ────────────────────────────────────────────────────────────

export interface IUser {
  // Identity
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;

  // Auth
  authProvider: AuthProvider;
  googleAuth?: IGoogleAuth;
  tiktokAuth?: ITikTokAuth;
  localAuth?: ILocalAuth;

  // Role & plan
  role: UserRole;
  plan: UserPlan;
  planExpiresAt?: Date;        // null = no expiry (lifetime / free)

  // Credits
  creditBalance: number;

  // Stripe Billing
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;

  // Usage (for quota enforcement per plan)
  usage: IUsageStats;

  // Product features
  savedProducts: ISavedProduct[];
  searchHistory: ISearchHistoryEntry[];

  // Preferences
  notifications: INotificationPrefs;
  timezone?: string;
  locale?: string;
  contentRegion: string;

  // Account status
  status: UserStatus;
  lastLoginAt?: Date;
  lastLoginIp?: string;
  loginCount: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;            // Soft delete
}

export interface IUserDocument extends IUser, Document {
  // Instance methods
  isActive(): boolean;
  canViewProduct(): boolean;
  incrementProductView(): Promise<void>;
  resetDailyUsage(): Promise<void>;
  softDelete(): Promise<void>;
  deductCredits(amount: number): Promise<boolean>;
}

export interface IUserModel extends Model<IUserDocument> {
  // Static methods
  findByEmail(email: string): Promise<IUserDocument | null>;
  findByGoogleId(googleId: string): Promise<IUserDocument | null>;
  findByTikTokOpenId(openId: string): Promise<IUserDocument | null>;
  findActiveById(id: string): Promise<IUserDocument | null>;
}

// ── Plan limits ───────────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<UserPlan, { creditsPerMonth: number; productsPerDay: number; searchesPerDay: number; savedProductsMax: number }> = {
  free:      { creditsPerMonth: 1000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: 50 },
  trial:     { creditsPerMonth: 1000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: 50 },
  pro:       { creditsPerMonth: 60000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: 2000 },
  team:      { creditsPerMonth: 200000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: -1 },
  starter:   { creditsPerMonth: 15000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: 500 },
  validator: { creditsPerMonth: 60000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: 2000 },
  scale:     { creditsPerMonth: 200000, productsPerDay: -1, searchesPerDay: -1, savedProductsMax: -1 },
};

export const ALLOWED_CONTENT_REGIONS = ['US', 'CA', 'MX', 'UK', 'ES', 'DE', 'IT', 'FR', 'AU', 'NZ'] as const;

// ── Schema ────────────────────────────────────────────────────────────────────

const GoogleAuthSchema = new Schema<IGoogleAuth>(
  {
    googleId: { type: String, required: true },
    refreshToken: { type: String, select: false },  // Never returned by default
    tokenExpiresAt: { type: Date },
  },
  { _id: false }
);

const TikTokAuthSchema = new Schema<ITikTokAuth>(
  {
    openId: { type: String, required: true },
    unionId: { type: String },
  },
  { _id: false }
);

const LocalAuthSchema = new Schema<ILocalAuth>(
  {
    passwordHash: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpiresAt: { type: Date },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationCodeHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
  },
  { _id: false }
);

const UsageStatsSchema = new Schema<IUsageStats>(
  {
    productsViewedToday: { type: Number, default: 0 },
    productsViewedTotal: { type: Number, default: 0 },
    searchesToday: { type: Number, default: 0 },
    searchesTotal: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now },
    usageResetAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SavedProductSchema = new Schema<ISavedProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    savedAt: { type: Date, default: Date.now },
    notes: { type: String, maxlength: 500 },
    tags: [{ type: String, maxlength: 50 }],
  },
  { _id: true }
);

const SearchHistorySchema = new Schema<ISearchHistoryEntry>(
  {
    query: { type: String, required: true, maxlength: 200 },
    filters: { type: Schema.Types.Mixed },
    searchedAt: { type: Date, default: Date.now },
    resultCount: { type: Number },
  },
  { _id: false }
);

const NotificationPrefsSchema = new Schema<INotificationPrefs>(
  {
    emailOnNewTrend: { type: Boolean, default: true },
    emailOnSavedProductUpdate: { type: Boolean, default: true },
    emailMarketing: { type: Boolean, default: false },
  },
  { _id: false }
);

const UserSchema = new Schema<IUserDocument, IUserModel>(
  {
    // Identity
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    firstName: { type: String, trim: true, maxlength: 50 },
    lastName: { type: String, trim: true, maxlength: 50 },
    avatarUrl: { type: String },

    // Auth
    authProvider: {
      type: String,
      enum: ['google', 'local', 'tiktok'] as AuthProvider[],
      required: true,
    },
    googleAuth: { type: GoogleAuthSchema },
    tiktokAuth: { type: TikTokAuthSchema },
    localAuth: { type: LocalAuthSchema },

    // Role & plan
    role: {
      type: String,
      enum: ['user', 'admin'] as UserRole[],
      default: 'user',
    },
    plan: {
      type: String,
      enum: ['free', 'trial', 'pro', 'team', 'starter', 'validator', 'scale'] as UserPlan[],
      default: 'free',
    },
    planExpiresAt: { type: Date },

    creditBalance: { type: Number, default: 1000 }, // Defaults to trial credits

    stripeCustomerId: { type: String, sparse: true },
    stripeSubscriptionId: { type: String, sparse: true },
    stripePriceId: { type: String, sparse: true },

    // Usage
    usage: { type: UsageStatsSchema, default: () => ({}) },

    // Product features
    savedProducts: {
      type: [SavedProductSchema],
      default: [],
      validate: {
        validator(val: ISavedProduct[]) {
          // Enforce saved product limit based on plan — checked at service layer too
          return val.length <= 500;
        },
        message: 'Saved products limit exceeded',
      },
    },
    searchHistory: {
      type: [SearchHistorySchema],
      default: [],
    },

    // Preferences
    notifications: { type: NotificationPrefsSchema, default: () => ({}) },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
    contentRegion: { 
      type: String, 
      enum: ALLOWED_CONTENT_REGIONS,
      default: 'US'
    },

    // Account status
    status: { type: String, enum: ['active', 'suspended', 'deleted'] as UserStatus[], default: 'active' },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    loginCount: { type: Number, default: 0 },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Never expose these fields in JSON responses
        delete ret.localAuth;
        delete ret.googleAuth;
        delete ret.tiktokAuth;
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ 'googleAuth.googleId': 1 }, { sparse: true });
UserSchema.index({ 'tiktokAuth.openId': 1 }, { sparse: true });
UserSchema.index({ status: 1 });
UserSchema.index({ plan: 1 });
UserSchema.index({ createdAt: -1 });

// ── Instance methods ──────────────────────────────────────────────────────────

UserSchema.methods.isActive = function (): boolean {
  return this.status === 'active';
};

UserSchema.methods.canViewProduct = function (): boolean {
  const limit = PLAN_LIMITS[this.plan as UserPlan].productsPerDay;
  if (limit === -1) return true;
  return this.usage.productsViewedToday < limit;
};

UserSchema.methods.incrementProductView = async function (): Promise<void> {
  this.usage.productsViewedToday += 1;
  this.usage.productsViewedTotal += 1;
  this.usage.lastActivityAt = new Date();
  await this.save();
};

UserSchema.methods.resetDailyUsage = async function (): Promise<void> {
  this.usage.productsViewedToday = 0;
  this.usage.searchesToday = 0;
  this.usage.usageResetAt = new Date();
  await this.save();
};

UserSchema.methods.softDelete = async function (): Promise<void> {
  this.status = 'deleted';
  this.deletedAt = new Date();
  this.email = `deleted_${Date.now()}_${this.email}`; // Free the email for re-registration
  await this.save();
};

UserSchema.methods.deductCredits = async function (amount: number): Promise<boolean> {
  if (this.creditBalance < amount) {
    return false; // Insufficient credits
  }
  this.creditBalance -= amount;
  await this.save();
  return true;
};

// ── Static methods ────────────────────────────────────────────────────────────

UserSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email: email.toLowerCase(), status: { $ne: 'deleted' } });
};

UserSchema.statics.findByGoogleId = function (googleId: string) {
  return this.findOne({ 'googleAuth.googleId': googleId, status: { $ne: 'deleted' } });
};

UserSchema.statics.findByTikTokOpenId = function (openId: string) {
  return this.findOne({ 'tiktokAuth.openId': openId, status: { $ne: 'deleted' } });
};

UserSchema.statics.findActiveById = function (id: string) {
  return this.findOne({ _id: id, status: 'active' });
};

// ── Pre-save middleware ───────────────────────────────────────────────────────

UserSchema.pre('save', function (next) {
  // Keep searchHistory to last 50 entries
  if (this.searchHistory.length > 50) {
    this.searchHistory = this.searchHistory.slice(-50);
  }
  next();
});

// ── Export ────────────────────────────────────────────────────────────────────

export const User = mongoose.model<IUserDocument, IUserModel>('User', UserSchema);
