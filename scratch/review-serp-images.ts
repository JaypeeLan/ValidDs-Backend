import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });

const ProductSchema = new mongoose.Schema({}, { strict: false, collection: 'products' });
const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);

async function review() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI);
  
  // Find products from the manual test run
  const products = await Product.find({ source: 'manual' }).sort({ collectedAt: -1 }).limit(10);

  console.log(`\n🔎 Reviewing ${products.length} Products from SerpAPI Test Run:\n`);

  for (const p of products) {
    const data = p.toObject();
    console.log(`📦 PRODUCT: ${data.title}`);
    console.log(`🖼️  PRIMARY IMAGE: ${data.primaryImageUrl}`);
    console.log(`🎞️  GALLERY (${data.imageUrls?.length || 0} images):`);
    if (data.imageUrls && data.imageUrls.length > 0) {
      data.imageUrls.forEach((url: string, i: number) => {
        console.log(`   ${i + 1}. ${url}`);
      });
    } else {
      console.log('   (No images found)');
    }
    console.log('---------------------------------------------------\n');
  }

  await mongoose.disconnect();
}

review().catch(console.error);
