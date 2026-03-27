import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface AIProvider {
  name: string;
  analyze(systemPrompt: string, userContent: string): Promise<string>;
}

function errMsg(provider: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `${provider} error: ${msg}`;
}

export class GeminiProvider implements AIProvider {
  name = 'gemini';

  async analyze(systemPrompt: string, userContent: string): Promise<string> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini error: GEMINI_API_KEY no configurada');
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel(
        { model: 'gemini-2.5-flash' },
        { apiVersion: 'v1' }
      );
      const combined = `${systemPrompt}\n\n${userContent}`;
      const result = await model.generateContent(combined);
      const response = await result.response;
      return response.text();
    } catch (e) {
      throw new Error(errMsg('Gemini', e));
    }
  }
}

export class AnthropicProvider implements AIProvider {
  name = 'anthropic';

  async analyze(systemPrompt: string, userContent: string): Promise<string> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Anthropic error: ANTHROPIC_API_KEY no configurada');
    try {
      const client = new Anthropic({ apiKey: key });
      const msg = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      const block = msg.content[0];
      if (block.type === 'text') return block.text;
      return '';
    } catch (e) {
      throw new Error(errMsg('Anthropic', e));
    }
  }
}

export class OpenAIProvider implements AIProvider {
  name = 'openai';

  async analyze(systemPrompt: string, userContent: string): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OpenAI error: OPENAI_API_KEY no configurada');
    try {
      const client = new OpenAI({ apiKey: key });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });
      return completion.choices[0]?.message?.content ?? '';
    } catch (e) {
      throw new Error(errMsg('OpenAI', e));
    }
  }
}

export function getAIProvider(name: 'gemini' | 'anthropic' | 'openai'): AIProvider {
  switch (name) {
    case 'gemini':
      return new GeminiProvider();
    case 'anthropic':
      return new AnthropicProvider();
    case 'openai':
      return new OpenAIProvider();
    default:
      return new GeminiProvider();
  }
}
