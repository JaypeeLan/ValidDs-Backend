import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { GoogleGenerativeAI } from '@google/generative-ai';

async function listModels() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return console.error('API key missing');

  const genAI = new GoogleGenerativeAI(apiKey);
  const models = await genAI.listModels();
  
  console.log('--- Available Models ---');
  for (const model of models.models) {
    console.log(`Model: ${model.name} | Methods: ${model.supportedGenerationMethods.join(', ')}`);
  }
}

listModels().catch(console.error);
