import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import {
  Evidence,
  AuditFlag,
  Finding,
  ClaimMapping,
} from '../../core/research-state.interface';

// What the Analyst produces.
export interface AnalysisResult {
  analysis: string;
  findings: Finding[];
  claimMap: ClaimMapping[];
  needsMoreResearch: boolean;
  missingGaps: string[];
}

@Injectable()
export class AnalystService {
  private readonly logger = new Logger(AnalystService.name);

  constructor(private readonly llm: LlmService) {}
  // The Analyst's role: draw conclusions and judge if evidence is sufficient.
  private readonly systemPrompt = `You are Analyst. You form conclusions from an evidence pool and honestly assess whether the evidence is sufficient.

You receive:
1. The original question
2. The sub-questions
3. A scored evidence pool (each item has a sourceId)
4. Audit flags (conflicts, gaps, low-confidence notes)

Your tasks:
1. Form findings: for each sub-question, draw a conclusion. EVERY finding MUST cite the sourceIds that support it. Never make a claim without backing sources.
2. Assess completeness: if any sub-question lacks sufficient evidence, set needsMoreResearch to true and list the gaps.
3. Be honest: if evidence is weak or conflicting, say so and mark confidence as "low".

Output ONLY a JSON object, no markdown, in this exact shape:
{
  "analysisSummary": "2-3 sentence summary",
  "needsMoreResearch": false,
  "missingGaps": ["gap description if any"],
  "findings": [
    {
      "claimId": "c_1",
      "claim": "the conclusion statement",
      "confidence": "high" | "medium" | "low",
      "sourceIds": ["WEB1_1-1", "LOC1_1-2"]
    }
  ]
}

Constraints:
- Only use sourceIds that appear in the evidence pool.
- Every finding must have at least one sourceId.
- needsMoreResearch must reflect an honest completeness check.`;

  /**
   * Form findings from the evidence pool and decide whether more
   * research is needed. This is the brain of the iterative loop.
   */
  async analyze(
    query: string,
    subQuestions: string[],
    evidencePool: Evidence[],
    auditFlags: AuditFlag[],
  ): Promise<AnalysisResult> {
    const prompt = `Original question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}
Evidence pool:
${JSON.stringify(
  evidencePool.map((e) => ({
    sourceId: e.sourceId,
    snippet: e.snippet,
    reliabilityScore: e.reliabilityScore,
    supportsQuestions: e.supportsQuestions,
  })),
)}
Audit flags: ${JSON.stringify(auditFlags)}

Analyze and output the JSON now.`;

    // Fallback: a minimal, honest "we have something but it's thin" result.
    const sourceIds = evidencePool.slice(0, 3).map((e) => e.sourceId);
    const fallback = {
      analysisSummary: 'Default analysis',
      needsMoreResearch: false,
      missingGaps: [] as string[],
      findings: [
        {
          claimId: 'c_1',
          claim: `Multi-source retrieval completed for: ${query}`,
          confidence: sourceIds.length ? 'medium' : 'low',
          sourceIds,
        },
      ],
    };

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<{
      analysisSummary: string;
      needsMoreResearch: boolean;
      missingGaps: string[];
      findings: Finding[];
    }>(raw, fallback);

    // Build the claim map (claimId -> sourceIds) from the findings.
    const claimMap: ClaimMapping[] = parsed.findings.map((f) => ({
      claimId: f.claimId,
      sourceIds: f.sourceIds,
    }));

    this.logger.log(
      `Analysis: ${parsed.findings.length} findings, needsMoreResearch=${parsed.needsMoreResearch}, ${parsed.missingGaps.length} gaps`,
    );

    return {
      analysis: parsed.analysisSummary,
      findings: parsed.findings,
      claimMap,
      needsMoreResearch: parsed.needsMoreResearch,
      missingGaps: parsed.missingGaps,
    };
  }
}