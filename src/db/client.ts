import mongoose from 'mongoose';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'mongodb' });

/**
 * MongoDB connection singleton using Mongoose.
 *
 * Connects to MongoDB Atlas (M0 free tier for dev/staging).
 * The connection is established once at startup and reused across all requests.
 *
 * Mongoose handles connection pooling internally.
 * Default pool size is 5 — sufficient for V1 load.
 */

let isConnected = false;

export async function connectMongo(): Promise<void> {
  if (isConnected) {
    log.debug('MongoDB already connected, reusing connection');
    return;
  }

  try {
    mongoose.set('strictQuery', true);

    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });

    isConnected = true;
    log.info('MongoDB connected', { db: env.MONGODB_DB_NAME });

    mongoose.connection.on('error', (err) => {
      log.error('MongoDB connection error', err);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      log.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      log.info('MongoDB reconnected');
    });

  } catch (err) {
    log.fatal('MongoDB connection failed', err);
    process.exit(1);
  }
}

export async function disconnectMongo(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  log.info('MongoDB disconnected gracefully');
}

export function getMongoStatus(): 'connected' | 'disconnected' | 'connecting' {
  const state = mongoose.connection.readyState;
  if (state === 1) return 'connected';
  if (state === 2) return 'connecting';
  return 'disconnected';
}

export { mongoose };
