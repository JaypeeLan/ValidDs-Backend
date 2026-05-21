import mongoose, { Schema, type Model } from 'mongoose';

/** OAuth completed from Partner App URL before the user links a ValidDs account. */
export interface IShopifyPendingConnection {
  shop: string;
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
  scope: string;
  shopName?: string;
  shopEmail?: string;
  shopOwner?: string;
  shopCountry?: string;
  shopCurrency?: string;
  installedAt: Date;
}

const ShopifyPendingConnectionSchema = new Schema<IShopifyPendingConnection>(
  {
    shop: { type: String, required: true, unique: true, index: true },
    accessTokenCiphertext: { type: String, required: true },
    accessTokenIv: { type: String, required: true },
    accessTokenAuthTag: { type: String, required: true },
    scope: { type: String, required: true },
    shopName: String,
    shopEmail: String,
    shopOwner: String,
    shopCountry: String,
    shopCurrency: String,
    installedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const ShopifyPendingConnection: Model<IShopifyPendingConnection> =
  mongoose.models.ShopifyPendingConnection ??
  mongoose.model<IShopifyPendingConnection>('ShopifyPendingConnection', ShopifyPendingConnectionSchema);
