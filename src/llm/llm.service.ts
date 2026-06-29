import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

// The model all agents use. Sonnet is fast + cost-effective for an 8-agent pipeline.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 8000;

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private client!: Anthropic;

  // Runs once when the app starts — sets up the Anthropic client.
  onModuleInit() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 2,
      timeout: 60_000,
    });
  }
  /**
   * Send a prompt to Claude and get back the full text response.
   * system  = the agent's role/instructions (e.g. "You are IntentRouter...")
   * prompt  = the actual user content for this turn
   */
  async chat(system: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: system,
      messages: [{ role: 'user', content: prompt }],
    });

    // Claude returns an array of content blocks; pull out the text one.
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : '';
  }
  /**
   * Safely pull a JSON object out of an LLM response.
   * Claude sometimes wraps JSON in ```code fences``` or adds chatter around it,
   * so we strip fences and grab the outermost { ... } before parsing.
   * If parsing fails, we return the provided fallback instead of crashing.
   */
  extractJson<T>(text: string, fallback: T): T {
    let cleaned = text.trim();

    // 1. Remove ```json or ``` code fences if present.
    cleaned = cleaned
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    // 2. Grab everything from the first { to the last } — the JSON body.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.slice(start, end + 1);
    }

    // 3. Try to parse. On any failure, fall back safely.
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      this.logger.warn(
        'Failed to parse JSON from LLM response, using fallback.',
      );
      return fallback;
    }
  }
}
