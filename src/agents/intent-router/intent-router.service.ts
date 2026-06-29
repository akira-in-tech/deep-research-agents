import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';

// Two possible routes a query can take.
export type IntentRoute = 'direct' | 'multiagent';

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  // LlmService is injected here so this agent can call Claude.
  constructor(private readonly llm: LlmService) {}
  /**
   * Rule-based pre-check. Fast and free — no LLM call.
   * If the query clearly contains research-style keywords, we can
   * route to "multiagent" without asking Claude at all.
   */
  private detectIntentByRules(query: string): IntentRoute {
    const q = query.trim().toLowerCase();

    // Strong signals: if any of these appear, it's almost certainly research.
    const researchKeywords = [
      'research',
      'investigate',
      'analyze',
      'analysis',
      'compare',
      'comparison',
      'survey',
      'report',
      'trend',
      'latest',
      'overview',
      'vs',
      'versus',
      'best',
      'evaluate',
      'review',
    ];

    const hasResearchKeyword = researchKeywords.some((word) =>
      q.includes(word),
    );

    // Year + trend pattern, e.g. "2026 trends", "2025 developments".
    const yearTrendPattern = /20\d{2}.*(trend|news|develop|forecast|outlook)/;
    const hasYearTrend = yearTrendPattern.test(q);

    if (hasResearchKeyword || hasYearTrend) {
      return 'multiagent';
    }

    // Default: treat as a simple/direct question.
    return 'direct';
  }
  /**
   * Main entry point. Combines the rule-based pre-check with a final
   * Claude judgment, then validates the result.
   * This mirrors the dual-mode (rules + LLM) intent routing design.
   */
  async route(query: string, memoryContext = ''): Promise<IntentRoute> {
    // Step 1: fast rule-based pre-check.
    const ruleRoute = this.detectIntentByRules(query);
    this.logger.log(`Rule-based pre-check: ${ruleRoute}`);

    // Step 2: ask Claude for the final decision, giving it the rule hint.
    const system = `You are IntentRouter. Decide whether a user question should be answered directly or needs deep multi-agent research.

Output ONLY a JSON object, no markdown, in this exact shape:
{"route": "direct" | "multiagent", "reason": "..."}

Routing rules:
- "direct": greetings, self-introductions, simple facts, casual chat.
- "multiagent": anything needing research, multi-source verification, comparison, analysis, trends, or a report.`;

    const prompt = `User question: ${query}
${memoryContext ? `Prior session context: ${memoryContext}\n` : ''}
Rule-based hint: ${ruleRoute}
Output the JSON now.`;

    // Step 3: call Claude and safely parse its JSON.
    const raw = await this.llm.chat(system, prompt);
    const parsed = this.llm.extractJson<{ route: string; reason: string }>(
      raw,
      { route: ruleRoute, reason: 'fallback to rule-based result' },
    );

    // Step 4: validate — only accept the two legal values, else fall back.
    const route: IntentRoute =
      parsed.route === 'direct' || parsed.route === 'multiagent'
        ? parsed.route
        : ruleRoute;

    this.logger.log(`Final route: ${route} (${parsed.reason})`);
    return route;
  }
}
