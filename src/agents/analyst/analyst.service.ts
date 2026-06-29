import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import {
  Evidence,
  AuditFlag,
  Finding,
  ClaimMapping,
} from '../../core/research-state.interface';
import { isRecord, nonEmptyStrings } from '../../core/validation';

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
      needsMoreResearch: sourceIds.length === 0,
      missingGaps:
        sourceIds.length === 0
          ? ['No valid evidence was collected for the question.']
          : ([] as string[]),
      findings: sourceIds.length
        ? [
            {
              claimId: 'c_1',
              claim: `Multi-source retrieval completed for: ${query}`,
              confidence: 'medium',
              sourceIds,
            },
          ]
        : [],
    };

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<unknown>(raw, fallback);
    const record = isRecord(parsed) ? parsed : fallback;
    const allowedSourceIds = new Set(evidencePool.map((e) => e.sourceId));
    const rawFindings = Array.isArray(record.findings) ? record.findings : [];
    const findings = rawFindings
      .filter(isRecord)
      .map((item, index): Finding | undefined => {
        const claim = typeof item.claim === 'string' ? item.claim.trim() : '';
        const validSourceIds = nonEmptyStrings(item.sourceIds).filter((id) =>
          allowedSourceIds.has(id),
        );
        if (!claim || validSourceIds.length === 0) {
          return undefined;
        }

        const confidence =
          typeof item.confidence === 'string'
            ? item.confidence.toLowerCase()
            : 'low';
        return {
          claimId:
            typeof item.claimId === 'string' && item.claimId.trim()
              ? item.claimId.trim()
              : `c_${index + 1}`,
          claim,
          confidence: ['high', 'medium', 'low'].includes(confidence)
            ? confidence
            : 'low',
          sourceIds: validSourceIds,
        };
      })
      .filter((item): item is Finding => item !== undefined);

    const safeFindings = findings.length > 0 ? findings : fallback.findings;
    const missingGaps = nonEmptyStrings(record.missingGaps);
    const needsMoreResearch =
      safeFindings.length === 0 ||
      record.needsMoreResearch === true ||
      missingGaps.length > 0;

    // Build the claim map (claimId -> sourceIds) from the findings.
    const claimMap: ClaimMapping[] = safeFindings.map((f) => ({
      claimId: f.claimId,
      sourceIds: f.sourceIds,
    }));

    this.logger.log(
      `Analysis: ${safeFindings.length} findings, needsMoreResearch=${needsMoreResearch}, ${missingGaps.length} gaps`,
    );

    return {
      analysis:
        typeof record.analysisSummary === 'string'
          ? record.analysisSummary
          : fallback.analysisSummary,
      findings: safeFindings,
      claimMap,
      needsMoreResearch,
      missingGaps: missingGaps.length > 0 ? missingGaps : fallback.missingGaps,
    };
  }
}
