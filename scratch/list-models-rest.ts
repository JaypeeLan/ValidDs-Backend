import * as dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function listModels() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return console.error('API key missing');

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json() as any;
    
    console.log('--- Available Models ---');
    if (data.models) {
      for (const model of data.models) {
        console.log(`Model: ${model.name}`);
      }
    } else {
      console.log('No models found or error:', data);
    }
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

listModels().catch(console.error);
