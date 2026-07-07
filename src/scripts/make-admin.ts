import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { env } from '../config/env.validation';
import type { UserRole } from '../types/user.types';

/**
 * Promote a user to admin or super_admin.
 *
 * Usage:
 *   npx ts-node src/scripts/make-admin.ts "email@example.com"
 *   npx ts-node src/scripts/make-admin.ts "email@example.com" super
 */

async function run() {
  const email = process.argv[2];
  const roleArg = (process.argv[3] ?? 'admin').toLowerCase();
  const role: UserRole = roleArg === 'super' || roleArg === 'super_admin' ? 'super_admin' : 'admin';

  if (!email) {
    console.error('Missing email argument.');
    console.error('Usage: npx ts-node src/scripts/make-admin.ts "email@example.com" [admin|super]');
    process.exit(1);
  }

  console.log(
    `Connecting to MongoDB (${env.MONGODB_DB_NAME}) at ${env.MONGODB_URI.replace(/:([^@]+)@/, ':****@')}...`,
  );
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.error(`User with email "${email}" not found in the database.`);
      process.exit(1);
    }

    user.role = role;
    await user.save();

    console.log('\n--- SUCCESS ---');
    console.log(`User: ${user.email} (${user.name})`);
    console.log(`Role updated to: ${role.toUpperCase()}`);
    console.log('They can now access the admin dashboard.');
    console.log('----------------\n');
  } catch (err) {
    console.error('Error updating user:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.error);
