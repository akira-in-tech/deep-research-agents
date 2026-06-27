import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import {
  Evidence,
  AuditFlag,
  SourceRef,
} from '../../core/research-state.interface';

// What EvidenceJudge produces.
export interface JudgeResult {
  evidencePool: Evidence[];
  auditFlags: AuditFlag[];
  sourceIndex: SourceRef[];
}

@Injectable()
export class EvidenceJudgeService {
  private readonly logger = new Logger(EvidenceJudgeService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Rule-based reliability scoring. Deterministic and consistent —
   * the same source type always gets the same score.
   * Mirrors the reference _score_evidence() design.
   */
  private scoreEvidence(evidence: Evidence): {
    score: number;
    reason: string;
  } {
    // Local knowledge base = highest trust.
    if (evidence.sourceType === 'local') {
      return { score: 0.92, reason: 'Internal knowledge base, high trust' };
    }

    const url = (evidence.url ?? '').toLowerCase();

    // Official / government / education domains.
    if (url.includes('.gov') || url.includes('.edu')) {
      return { score: 0.88, reason: 'Official or authoritative domain' };
    }

    // Mainstream media / known tech outlets.
    const mediaDomains = [
      'reuters', 'bloomberg', 'microsoft', 'ibm', 'deloitte',
      'forbes', 'techcrunch', 'wired', 'theverge',
    ];
    if (mediaDomains.some((d) => url.includes(d))) {
      return { score: 0.72, reason: 'Mainstream media domain' };
    }

    // Any other reachable web source.
    if (url) {
      return { score: 0.58, reason: 'General web source, cross-check needed' };
    }

    // Unknown / incomplete source.
    return { score: 0.45, reason: 'Incomplete source information' };
  }
  // EvidenceJudge's role: detect conflicts and gaps across the evidence.
  private readonly systemPrompt = `You are EvidenceJudge. You receive a pool of already-scored evidence and the sub-questions it should answer.

Your job is NOT to re-score. Focus on auditing:
1. Conflict detection: find evidence items that contradict each other.
2. Gap detection: find sub-questions that have weak or no supporting evidence.
3. Low-confidence flags: note evidence with reliabilityScore below 0.6.

Output ONLY a JSON object, no markdown, in this exact shape:
{
  "summary": "2-3 sentence audit summary",
  "auditFlags": [
    {
      "type": "conflict" | "low_confidence" | "missing_evidence",
      "target": "the question or sourceId involved",
      "reason": "short explanation"
    }
  ]
}

Constraints:
- Only reference sourceIds that appear in the input.
- If no issues are found, return an empty auditFlags array.`;

  /**
   * Score, deduplicate, audit, and index the combined evidence.
   * Scoring + dedup are rule-based (deterministic); conflict/gap
   * detection is delegated to Claude.
   */
  async judge(
    query: string,
    subQuestions: string[],
    webEvidence: Evidence[],
    localEvidence: Evidence[],
  ): Promise<JudgeResult> {
    // Step 1: combine both sources.
    const combined = [...webEvidence, ...localEvidence];

    // Step 2: rule-based scoring.
    const scored = combined.map((e) => {
      const { score, reason } = this.scoreEvidence(e);
      return { ...e, reliabilityScore: score, reliabilityReason: reason };
    });

    // Step 3: deduplicate by url (web) or docId (local).
    const seen = new Set<string>();
    const evidencePool = scored.filter((e) => {
      const key = e.url || e.docId || e.sourceId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Step 4: ask Claude to audit for conflicts and gaps.
    const prompt = `Original question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}
Scored evidence pool:
${JSON.stringify(
  evidencePool.map((e) => ({
    sourceId: e.sourceId,
    snippet: e.snippet,
    reliabilityScore: e.reliabilityScore,
    supportsQuestions: e.supportsQuestions,
  })),
)}

Audit the evidence. Output the JSON now.`;

    const raw = await this.llm.chat(this.systemPrompt, prompt);
    const parsed = this.llm.extractJson<{
      summary: string;
      auditFlags: AuditFlag[];
    }>(raw, { summary: '', auditFlags: [] });

    // Step 5: build the source index for citations.
    const sourceIndex: SourceRef[] = evidencePool.map((e) => ({
      sourceId: e.sourceId,
      label: e.title,
      locator: e.url || e.docId || '',
      sourceType: e.sourceType,
    }));

    this.logger.log(
      `Judged: ${evidencePool.length} evidence after dedup, ${parsed.auditFlags.length} audit flags`,
    );

    return {
      evidencePool,
      auditFlags: parsed.auditFlags,
      sourceIndex,
    };
  }
}