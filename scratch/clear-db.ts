import 'dotenv/config';
import mongoose from 'mongoose';

async function clearDb() {
  console.log('⚠️  DANGER: Clearing Products and Creatives from the database...');
  
  try {
    await mongoose.connect(process.env.MONGODB_URI + 'validds');
    console.log('📡 Connected to: ' + process.env.MONGODB_URI + 'validds');

    const productCount = await mongoose.connection.collection('products').countDocuments();
    const creativeCount = await mongoose.connection.collection('creatives').countDocuments();

    console.log(`📊 Current Counts: Products (${productCount}), Creatives (${creativeCount})`);

    await mongoose.connection.collection('products').deleteMany({});
    await mongoose.connection.collection('creatives').deleteMany({});

    console.log('🗑️  Deleted all products');
    console.log('🗑️  Deleted all creatives');
    console.log('✨ Database cleared successfully!');
  } catch (err) {
    console.error('❌ Clearance failed:', err);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected');
  }
}

clearDb();
