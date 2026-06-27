import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import { Finding, SourceRef, AuditFlag } from '../../core/research-state.interface';

@Injectable()
export class WriterService {
  private readonly logger = new Logger(WriterService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Remove any citation in the report body that is NOT in the list of
   * valid source ids. This strips hallucinated citations the model may
   * have invented — the last line of defense against fabrication.
   * Mirrors the reference _validate_and_fix_citations().
   */
  private validateCitations(
    content: string,
    validSourceIds: Set<string>,
  ): string {
    // Matches citation patterns like [WEB1_1-1] or [LOC1_2-3].
    const citationPattern = /\[([A-Z]+\d+_\d+-\d+)\]/g;

    return content.replace(citationPattern, (match, id: string) => {
      // Keep the citation if it's valid; otherwise remove it.
      return validSourceIds.has(id) ? match : '';
    });
  }

  /**
   * Build the reference list from the source index, keeping only the
   * sources actually cited in the report body.
   */
  private buildReferenceList(
    content: string,
    sourceIndex: SourceRef[],
  ): string {
    const citationPattern = /\[([A-Z]+\d+_\d+-\d+)\]/g;
    const citedIds = new Set<string>();
    let match;
    while ((match = citationPattern.exec(content)) !== null) {
      citedIds.add(match[1]);
    }

    const lines = ['## References', ''];
    for (const ref of sourceIndex) {
      if (citedIds.has(ref.sourceId)) {
        const locator = ref.locator || 'local knowledge base';
        lines.push(`- [${ref.sourceId}] ${ref.label} | ${locator}`);
      }
    }

    return lines.length > 2 ? lines.join('\n') : '## References\n\n- No references cited';
  }
  // The Writer's role: produce a deep, well-cited Markdown report.
  private readonly systemPrompt = `You are a senior research analyst and report writer. You produce the final deep-research report.

You receive:
1. The core question
2. The sub-questions
3. The findings (each with a claim, confidence, and sourceIds)
4. The available source index (legal citation ids)
5. Risk/conflict audit flags

Writing requirements:
1. Title: concise and insightful.
2. Executive summary (~150 words): the most important findings.
3. Detailed analysis (the main body): expand each finding into coherent paragraphs with real depth. Do NOT just list — analyze, add context, reason through the evidence.
4. Conclusion: key takeaways, risks, and outlook.

CRITICAL citation rules:
- When citing evidence, use ONLY the legal citation ids in the format [WEB1_1-1] or [LOC1_2-3].
- NEVER invent citation ids that are not in the provided source index.
- Do NOT write a reference list yourself — the system appends it automatically.
- Where audit flags note conflicts, acknowledge them honestly in the text.

Output the report body as Markdown. Do NOT output JSON or code fences.`;

  /**
   * Write the final report: call Claude, strip any hallucinated
   * citations, then append an auto-generated reference list.
   */
  async write(
    query: string,
    subQuestions: string[],
    findings: Finding[],
    sourceIndex: SourceRef[],
    auditFlags: AuditFlag[],
  ): Promise<{ draft: string; final: string }> {
    const validSourceIds = new Set(sourceIndex.map((s) => s.sourceId));

    const prompt = `Core question: ${query}
Sub-questions: ${JSON.stringify(subQuestions)}

Findings:
${JSON.stringify(findings)}

Available source index (legal citation ids):
${JSON.stringify(sourceIndex.map((s) => ({ sourceId: s.sourceId, label: s.label })))}

Audit flags (conflicts/risks to acknowledge):
${JSON.stringify(auditFlags)}

Write the full Markdown report now. Use only the legal citation ids.`;

    // Step 1: Claude writes the report (this is the longest call).
    const draft = await this.llm.chat(this.systemPrompt, prompt);

    // Step 2: strip hallucinated citations not in the valid set.
    const cleaned = this.validateCitations(draft, validSourceIds);

    // Step 3: append the auto-generated reference list.
    const referenceList = this.buildReferenceList(cleaned, sourceIndex);
    const final = `${cleaned}\n\n${referenceList}`;

    this.logger.log(`Report written: ${final.length} characters`);

    return { draft, final };
  }
}