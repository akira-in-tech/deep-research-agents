/**
 * A single search instruction produced by the Planner.
 * Tells a Scout what to search and where.
 */
export interface SearchQuery {
  sectionId: string; // Which outline section this query belongs to
  query: string; // The natural-language search term
  sourcePreference: string; // "web" | "local" | "hybrid"
  reason: string; // Why this query helps (for traceability)
}
/**
 * One section of the report outline, produced by the Planner.
 * Each section carries its own search queries.
 */
export interface OutlineSection {
  id: string; // Section id, e.g. "sec_1"
  title: string; // Section heading
  description: string; // What this section covers
  sectionType: string; // e.g. "mixed" | "data" | "analysis"
  priority: number; // Order/importance of this section
  searchQueries: string[]; // Search terms for this section
  status: string; // "pending" | "done", tracks progress
}
/**
 * Resource limits that cap how deep the research can go.
 * Prevents the agent loop from running forever / burning tokens.
 */
export interface ResearchBudget {
  maxRounds: number; // Max number of supplementary search rounds
  maxSources: number; // Max number of sources to collect
  maxTokens: number; // Token budget
  maxSeconds: number; // Time budget in seconds
}
/**
 * A single piece of evidence collected by a Scout and scored by EvidenceJudge.
 * source_id naming: WEB{iteration}_{queryIndex}-{resultIndex} for web,
 *                   LOC{iteration}_{queryIndex}-{resultIndex} for local.
 */
export interface Evidence {
  sourceId: string; // Unique id, e.g. "WEB1_1-1"
  sourceType: string; // "web" | "local"
  title: string; // Title of the source
  url?: string; // URL (web sources only)
  docId?: string; // Document id (local sources only)
  snippet: string; // Content excerpt
  supportsQuestions: string[]; // Which sub-questions this evidence supports
  reliabilityScore?: number; // 0.0 - 1.0, assigned by EvidenceJudge
  reliabilityReason?: string; // Why this score was given
}
/**
 * A marker raised by EvidenceJudge when something needs attention:
 * low-confidence evidence, conflicting sources, or a gap with no support.
 */
export interface AuditFlag {
  type: string; // "low_confidence" | "conflict" | "missing_evidence"
  target: string; // What it points to (a question or source)
  reason: string; // Explanation of the issue
}
/**
 * A lightweight reference to one source, used to render citations.
 * The Writer uses this index to produce the reference list at the end.
 */
export interface SourceRef {
  sourceId: string; // Matches an Evidence.sourceId
  label: string; // Display name of the source
  locator: string; // URL (web) or docId (local)
  sourceType: string; // "web" | "local"
}
/**
 * A conclusion drawn by the Analyst from the evidence pool.
 * Every finding must be backed by source ids — this is the core
 * anti-hallucination mechanism: no claim without a source.
 */
export interface Finding {
  claimId: string; // Unique id, e.g. "c_1"
  claim: string; // The actual conclusion statement
  confidence: string; // "high" | "medium" | "low"
  sourceIds: string[]; // Evidence source ids backing this claim
}
/**
 * Maps a claim to the evidence sources that back it.
 * Used to verify every conclusion is traceable.
 */
export interface ClaimMapping {
  claimId: string; // Matches a Finding.claimId
  sourceIds: string[]; // Source ids backing that claim
}
/**
 * One message in the running log/history shared across agents.
 * Mirrors the accumulating message list from the reference architecture.
 */
export interface AgentMessage {
  role: string; // "system" | "user" | "assistant"
  content: string; // The message text
  agentName?: string; // Which agent produced it (optional)
}
/**
 * ResearchState — the shared "briefcase" passed between all agents.
 * Each agent reads the fields it needs and writes back its results.
 * This mirrors the Python TypedDict ResearchState from the reference architecture.
 */
export interface ResearchState {
  // ===== Basic input: what the user asked =====
  query: string; // The user's original question
  intent: string; // Intent result: "direct" or "multiagent"
  phase: string; // Current stage label, for logging/debugging
  // ===== Planning stage: Planner breaks down the task =====
  plan: string; // One-line summary of the research objective
  subQuestions: string[]; // The original question + 2-3 derived sub-questions
  outline: OutlineSection[]; // Report structure, each section has its own search queries
  searchPlan: SearchQuery[]; // Concrete list of search queries to execute
  budget: ResearchBudget; // Resource limits: rounds, sources, tokens, time
  // ===== Retrieval stage: Scouts collect, EvidenceJudge scores =====
  webSearch: string; // Web search summary text
  localRag: string; // Local knowledge base summary text
  webEvidence: Evidence[]; // Raw evidence from WebScout
  localEvidence: Evidence[]; // Raw evidence from LocalScout
  evidencePool: Evidence[]; // Unified, scored, deduplicated evidence
  auditFlags: AuditFlag[]; // Conflict / low-confidence markers
  sourceIndex: SourceRef[]; // Index of all sources, for citations
  // ===== Analysis stage: Analyst concludes, Reflect supplements =====
  analysis: string; // Analyst's summary text
  findings: Finding[]; // Conclusions, each backed by sources
  claimMap: ClaimMapping[]; // Maps each claim id to its source ids
  needsMoreResearch: boolean; // Analyst's verdict: is evidence enough?
  missingGaps: string[]; // Information gaps Analyst identified
  supplementaryQueries: SearchQuery[]; // New queries from Reflect to fill gaps
  // ===== Output stage: Writer produces report, loop control =====
  draft: string; // Report draft (may still be revised)
  final: string; // Final report with validated citations
  iteration: number; // Current supplementary-search round
  maxIterations: number; // Hard cap on rounds, prevents infinite loops

  // ===== Message history (shared across all agents) =====
  messages: AgentMessage[]; // Accumulated conversation/log messages
}
