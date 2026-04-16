import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';

async function verifyCreatives() {
  console.log('🔍 Verifying Creatives API richness...');
  
  try {
    await mongoose.connect(process.env.MONGODB_URI + 'validds');
    const Product = mongoose.model('Product');
    
    const product = await Product.findOne();
    if (!product) {
      console.log('❌ No products found in DB. Run priority-run first.');
      return;
    }
    
    console.log(`📡 Product: ${product.title} (${product._id})`);
    
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    const url = `${baseUrl}/api/v1/products/${product._id}/creatives`;
    
    const res = await axios.get(url, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY }
    });
    
    if (res.status === 200) {
      const creators = res.data.data.creators;
      console.log(`✅ Received ${creators.length} grouped creators.`);
      
      const sample = creators[0];
      console.log('\n--- Sample Creator Details ---');
      console.log(`Handle:      ${sample.handle}`);
      console.log(`Display:     ${sample.displayName}`);
      console.log(`Followers:   ${sample.followers}`);
      console.log(`Total Likes: ${sample.totalLikes}`);
      console.log(`Region:      ${sample.region}`);
      console.log(`Verified:    ${sample.verified}`);
      console.log(`Bio:         ${sample.bio || 'none'}`);
      console.log(`Videos:      ${sample.videos.length}`);
      
      if (!sample.verified && sample.handle !== 'unknown') {
         console.log('⚠️ Note: Creator not verified or payload missing flags.');
      }
    }
  } catch (err: any) {
    console.error('❌ Connection or request failed:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

verifyCreatives();
