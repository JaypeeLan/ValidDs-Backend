import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { env } from '../config/env.validation';

/**
 * Script to safely promote a user to admin without affecting their auth method.
 * 
 * Usage: npx ts-node src/scripts/make-admin.ts "email@example.com"
 */

async function run() {
  const email = process.argv[2];

  if (!email) {
    console.error('Missing email argument.');
    console.error('Usage: npx ts-node src/scripts/make-admin.ts "email@example.com"');
    process.exit(1);
  }

  const connectionString = env.MONGODB_URI.includes('?') 
    ? env.MONGODB_URI.replace(/\/\?/, `/${env.MONGODB_DB_NAME}?`)
    : env.MONGODB_URI.endsWith('/') 
      ? `${env.MONGODB_URI}${env.MONGODB_DB_NAME}` 
      : `${env.MONGODB_URI}/${env.MONGODB_DB_NAME}`;

  console.log(`Connecting to MongoDB at ${connectionString.replace(/:([^@]+)@/, ':****@')}...`);
  await mongoose.connect(connectionString);

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.error(`User with email "${email}" not found in the database.`);
      process.exit(1);
    }

    user.role = 'admin';
    await user.save();

    console.log('\n--- SUCCESS ---');
    console.log(`User: ${user.email} (${user.name})`);
    console.log('Role updated to: ADMIN');
    console.log('They can now access the admin dashboard.');
    console.log('----------------\n');
  } catch (err) {
    console.error('Error updating user:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.error);
