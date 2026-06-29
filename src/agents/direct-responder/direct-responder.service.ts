import { Injectable } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';

@Injectable()
export class DirectResponderService {
  constructor(private readonly llm: LlmService) {}

  async answer(query: string, memoryContext = ''): Promise<string> {
    const system = `You are a concise and accurate assistant handling questions that do not require deep research.

Answer the user's question directly. Use prior session context only when it is relevant. Do not claim to have searched the web or private knowledge base.`;

    const prompt = memoryContext
      ? `Prior session context:\n${memoryContext}\n\nCurrent question: ${query}`
      : `Current question: ${query}`;

    return this.llm.chat(system, prompt);
  }
}
