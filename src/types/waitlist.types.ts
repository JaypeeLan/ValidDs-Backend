import { Document, Model } from 'mongoose';

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
