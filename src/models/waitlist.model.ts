import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Waitlist Model
 *
 * Stores email addresses captured from the public landing page before users
 * fully register. No credentials, no PII beyond the email.
 *
 * Emails are stored lowercased and trimmed. A unique index prevents duplicates;
 * the service layer checks for an existing row before inserting so we return a
 * clean 409-style response instead of a Mongo duplicate-key error.
 */

export interface IWaitlistEntry {
  email: string;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWaitlistEntryDocument extends IWaitlistEntry, Document {}
export type IWaitlistEntryModel = Model<IWaitlistEntryDocument>;

const WaitlistEntrySchema = new Schema<IWaitlistEntryDocument>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    source:    { type: String, trim: true, maxlength: 64 },
    ipAddress: { type: String, trim: true, maxlength: 64 },
    userAgent: { type: String, trim: true, maxlength: 512 },
    referrer:  { type: String, trim: true, maxlength: 512 },
  },
  { timestamps: true }
);

export const WaitlistEntry: IWaitlistEntryModel =
  (mongoose.models.WaitlistEntry as IWaitlistEntryModel) ||
  mongoose.model<IWaitlistEntryDocument>('WaitlistEntry', WaitlistEntrySchema);
