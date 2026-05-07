import { GoogleGenerativeAI } from '@google/generative-ai';
import { DeepSeekService } from './deepseek.service';
import { logger } from '../logger';

const log = logger.child({ module: 'ai-orchestrator' });

export type AIPriority = 'gemini' | 'deepseek';

export class AIOrchestrator {
  private static geminiClient: GoogleGenerativeAI | null = null;

  private static getGemini() {
    if (!this.geminiClient) {
      const apiKey =
        process.env.GOOGLE_AI_API_KEY ||
        process.env.GOOGLE_API_KEY;
      if (apiKey) {
        this.geminiClient = new GoogleGenerativeAI(apiKey);
      }
    }
    return this.geminiClient;
  }

  /**
   * Unified interface for JSON extraction with failover.
   * @param priority Which model to try first.
   * @param prompt System instruction/prompt.
   * @param data Raw data to parse.
   */
  static async extractJson<T>(
    prompt: string,
    data: string,
    priority: AIPriority = 'gemini'
  ): Promise<T | null> {
    if (priority === 'deepseek') {
      const dsResult = await DeepSeekService.extractJson<T>(prompt, data);
      if (dsResult) return dsResult;
      
      log.info('DeepSeek failed, falling back to Gemini');
      return this.callGemini<T>(prompt, data);
    } else {
      const geminiResult = await this.callGemini<T>(prompt, data);
      if (geminiResult) return geminiResult;

      log.info('Gemini failed, falling back to DeepSeek');
      return DeepSeekService.extractJson<T>(prompt, data);
    }
  }

  private static async callGemini<T>(prompt: string, data: string): Promise<T | null> {
    const client = this.getGemini();
    if (!client) return null;

    try {
      const model = client.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nData:\n${data}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
        }
      });

      const text = result.response.text();
      return JSON.parse(text) as T;
    } catch (err: any) {
      log.debug('Gemini call failed', { error: err.message });
      return null;
    }
  }
}
