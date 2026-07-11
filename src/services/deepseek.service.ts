import axios from 'axios';
import { logger } from '../logger';

const log = logger.child({ module: 'deepseek-service' });

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

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
          model: DEEPSEEK_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are an expert data extractor. You always return strictly valid JSON. No prose, no markdown blocks.',
            },
            {
              role: 'user',
              content: `${prompt}\n\nData to parse:\n${jsonData}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = response.data.choices[0].message.content;
      return JSON.parse(content) as T;
    } catch (err: any) {
      const status = err.response?.status;
      log.error('DeepSeek request failed', {
        error: err.message,
        status,
        data: err.response?.data,
      });
      if (status === 402 || status === 401) {
        const { sendOpsAlert } = await import('./ops-alert.service');
        void sendOpsAlert({
          issue: status === 402 ? 'DeepSeek balance exhausted' : 'DeepSeek API key rejected',
          service: 'backend',
          detail: `HTTP ${status} from DeepSeek chat completions`,
          fix:
            status === 402
              ? ['Top up DeepSeek balance', 'Confirm DEEPSEEK_API_KEY on backend']
              : ['Rotate DEEPSEEK_API_KEY on the backend Render service'],
          dedupeKey: `backend:deepseek:${status}`,
        });
      }
      return null;
    }
  },
};
