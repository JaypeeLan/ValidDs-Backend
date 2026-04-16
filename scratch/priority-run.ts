import 'dotenv/config';
import mongoose from 'mongoose';
import { EnsembleClient } from '../src/ingestion/ensemble/ensemble.client';
import { transformEnsemblePosts, transformEnsembleComments } from '../src/ingestion/ensemble/ensemble.transformer';
import { ProductExtractor } from '../src/services/product.extractor';
import { ProductEnricher } from '../src/services/product.enricher';
import { logger } from '../src/logger';

const log = logger.child({ module: 'priority-run' });

async function runPriorityTest() {
  console.log('🚀 Starting Priority Test Run (Discovery 2.0): 5 Products & 5 Creatives Per Product');
  
  const ensemble = new EnsembleClient();

  try {
    await mongoose.connect(process.env.MONGODB_URI + 'validds');
    console.log('✅ Connected to MongoDB (validds)');

    // 1. Fetch trending posts (EnsembleData)
    console.log('\n--- Step 1: Fetching hashtag posts for #tiktokmademebuyit ---');
    const result = await ensemble.getHashtagPosts('tiktokmademebuyit', 0); 
    const rawPosts = result.posts.slice(0, 5);
    const normalizedPosts = transformEnsemblePosts(rawPosts);
    console.log(`✅ Found ${normalizedPosts.length} posts to process`);

    for (const post of normalizedPosts) {
      console.log(`\n📦 Processing Post: ${post.videoId}`);
      console.log(`   Video: ${post.videoUrl}`);

      try {
        // 2. Fetch comments for extraction
        console.log('   💬 Fetching comments...');
        const rawComments = await ensemble.getPostComments(post.videoId);
        const normalizedComments = transformEnsembleComments(rawComments, post.videoId);

        // 3. AI Extraction
        console.log('   🤖 Running Discovery 2.0 AI Extraction...');
        const extraction = await ProductExtractor.extractFromPost(post, normalizedComments);

        if (!extraction) {
          console.log('   ⚠️ AI could not identify a clear product. Skipping.');
          continue;
        }

        console.log(`   ✅ Extracted: ${extraction.productName}`);
        console.log(`   🧬 Running Discovery 2.0 Enrichment (Serp, TeemDrop, Creators)...`);

        // 4. Enrich & Upsert (This will also fetch 5+ creatives internally)
        const product = await ProductEnricher.mergeAndUpsert(extraction, post);

        if (product) {
          console.log(`   💎 Success: "${product.title}" saved.`);
          console.log(`      Categories: ${product.categoryPath}`);
          console.log(`      Creatives:  ${product.creativeCounts.total} (${product.creativeCounts.ads} ads, ${product.creativeCounts.reviews} reviews)`);
          console.log(`      Gallery:    ${product.imageUrls.length} images`);
          console.log(`      Suppliers:  ${product.suppliers.length} (${product.suppliers.map(s => s.platform).join(', ') || 'none'})`);
          if (product.salesEvidence) {
            console.log(`      Sales:      ${product.salesEvidence.unitsSold} units from ${product.salesEvidence.store}`);
          }
          if (product.ratingSources.length) {
            const r = product.ratingSources[0];
            console.log(`      Rating:     ${r.rating}★ (${r.reviewCount} reviews on ${r.platform})`);
          }
          console.log(`      Creator:    @${product.primaryCreator.handle} → ${product.primaryCreator.tiktokPostUrl}`);
          console.log(`      AI conf:    ${product.aiIntelligence.confidence}% — ${product.aiIntelligence.confidenceReason}`);
        }
      } catch (err) {
        console.error(`   ❌ Failed to process post ${post.videoId}:`, err);
      }
    }

  } catch (err) {
    console.error('❌ Priority run failed:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\n✨ Priority run complete!');
    console.log('👋 Disconnected');
  }
}

runPriorityTest();
