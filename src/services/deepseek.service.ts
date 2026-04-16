import axios from 'axios';
import { logger } from '../logger';

const log = logger.child({ module: 'deepseek-service' });

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

export interface DeepSeekResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const DeepSeekService = {
  /**
   * General purpose extraction/parsing using DeepSeek.
   * Optimized for JSON output.
   */
  async extractJson<T>(prompt: string, jsonData: string): Promise<T | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      log.warn('DEEPSEEK_API_KEY is not configured');
      return null;
    }

    try {
      const response = await axios.post(
        DEEPSEEK_API_URL,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are an expert data extractor. You always return strictly valid JSON. No prose, no markdown blocks.'
            },
            {
              role: 'user',
              content: `${prompt}\n\nData to parse:\n${jsonData}`
            }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const content = response.data.choices[0].message.content;
      return JSON.parse(content) as T;
    } catch (err: any) {
      log.error('DeepSeek request failed', { 
        error: err.message, 
        status: err.response?.status,
        data: err.response?.data 
      });
      return null;
    }
  }
};
