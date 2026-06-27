# DeepResearch-TS

An enterprise-grade multi-agent deep research system built with TypeScript, NestJS, and GraphQL. Given a single natural-language question, eight specialized AI agents collaborate to autonomously plan the research, retrieve evidence from both the live web and an internal vector knowledge base, cross-verify and score that evidence, iteratively fill gaps, and produce a fully-cited deep research report.

The system is API-first: the entire pipeline is exposed through a single GraphQL query, making it straightforward for other services to embed deep research as a capability.

## Why this exists

Generative models answer fast but hallucinate, and they cannot show where their claims come from. Analysts, on the other hand, work across scattered sources, cross-check facts, and cite everything, but that work is slow and hard to keep comprehensive. DeepResearch-TS automates the analyst workflow: intent routing decides whether a query even needs deep research, a planner decomposes it, parallel scouts gather evidence from the web and a private knowledge base, an evidence judge scores reliability and flags conflicts, an analyst draws source-backed conclusions, a reflect step generates supplementary queries when evidence is thin, and a writer produces a report whose every citation is validated against the real source index.

## Architecture

The system is organized as a state-machine-style orchestration over eight agents that share a single typed `ResearchState`. Each agent reads what it needs from the state and writes back its results.

```
                          GraphQL Query
                                |
                                v
                        IntentRouter            (rules + LLM dual-mode routing)
                                |
                  direct <-----+-----> multiagent
                                          |
                                          v
                                       Planner   (decompose into sub-questions + search plan)
                                          |
                          +---------------+---------------+
                          v                               v
                       WebScout                       LocalScout
                  (Tavily web search)           (Voyage embed + Milvus vector search)
                          |                               |
                          +---------------+---------------+
                                          v
                                    EvidenceJudge   (rule-based scoring, dedup, conflict detection)
                                          |
                                          v
                                       Analyst      (source-backed findings + completeness check)
                                          |
                          enough? --------+-------- not enough?
                            |                            |
                            |                            v
                            |                         Reflect   (generate non-duplicate supplementary queries)
                            |                            |
                            |                            +---> loop back to retrieval (capped iterations)
                            v
                                        Writer       (cited report + citation validation)
                                          |
                                          v
                                   Final Report (Markdown + reference list)
```

### The eight agents

1. **IntentRouter** — Classifies a query as `direct` (greeting, simple fact) or `multiagent` (needs research). Uses a rule-based keyword pre-check first, then an LLM for the final decision, reducing unnecessary deep-research calls.
2. **Planner** — Decomposes the question into an objective, sub-questions, a report outline, and a concrete search plan.
3. **WebScout** — Runs the search plan against the Tavily API, then has the LLM filter results for relevance and tag each with the sub-questions it supports. Real source data is kept from the API; only the LLM's relevance judgment is trusted (anti-hallucination).
4. **LocalScout** — Embeds each query with Voyage, runs a vector similarity search against a Milvus knowledge base, then filters the same way. Demonstrates dual-source retrieval (web + private knowledge).
5. **EvidenceJudge** — Scores every piece of evidence by source type (local 0.92, official 0.88, mainstream media 0.72, general web 0.58), deduplicates, and uses the LLM to detect conflicts and coverage gaps across the combined pool.
6. **Analyst** — Forms conclusions where every finding must cite the source IDs that back it, then honestly assesses whether the evidence is sufficient and lists any gaps.
7. **Reflect** — When the Analyst reports insufficient evidence, generates new, non-duplicate search queries targeting the specific gaps, driving the iterative research loop.
8. **Writer** — Produces the final Markdown report, then validates every citation against the real source index with a regex pass, stripping any hallucinated citations, and appends an auto-generated reference list.

## Tech stack

- **Language:** TypeScript
- **Framework:** NestJS (dependency injection, modular agents)
- **API:** GraphQL (code-first, Apollo Server)
- **LLM:** Anthropic Claude (via the official SDK)
- **Web search:** Tavily
- **Vector database:** Milvus (run via Docker)
- **Embeddings:** Voyage AI
- **Infrastructure:** Docker Compose (Milvus + etcd + MinIO)

## Key design decisions

**Rules + LLM hybrid.** Intent routing and reliability scoring use deterministic rules first, falling back to the LLM only where judgment is genuinely needed. Rules are fast, free, and consistent; the LLM handles the fuzzy cases. The same source type always gets the same reliability score.

**Anti-hallucination in depth.** Multiple layers guard against fabrication: scouts keep real source data from the APIs and trust the LLM only for relevance judgments; every Analyst finding must cite real source IDs; the Writer validates all citations against the source index and removes invented ones.

**Source/logic separation.** Each retrieval agent separates "where the data comes from" from "how it is processed." Swapping the web provider or vector store touches only the retrieval function, not the agent logic.

**Capped iterative loop.** The Analyst decides whether more research is needed; Reflect generates fresh queries; the loop is hard-capped to prevent infinite re-search and runaway token cost.

**Honest uncertainty.** Conflicts between sources and gaps in coverage are surfaced explicitly in the final report rather than smoothed over.

## Setup

### Prerequisites

- Node.js 20+
- Docker Desktop
- API keys: Anthropic, Tavily, Voyage AI

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your_anthropic_key
TAVILY_API_KEY=your_tavily_key
VOYAGE_API_KEY=your_voyage_key
```

### 3. Start the vector database

```bash
docker compose up -d
```

This starts Milvus, etcd, and MinIO. Wait until Milvus reports healthy:

```bash
docker ps --filter name=milvus-standalone --format "{{.Status}}"
```

### 4. Ingest the knowledge base

Place `.txt` documents in the `knowledge-base/` folder, then:

```bash
npx ts-node src/scripts/ingest.ts
```

This embeds each document with Voyage and loads it into Milvus.

### 5. Run the server

```bash
npm run dev
```

The GraphQL playground is available at `http://localhost:3000/graphql`.

## Usage

Send a GraphQL query:

```graphql
query {
  research(question: "Investigate the best AI products of 2026 and compare them") {
    route
    iterations
    evidenceCount
    citationsUsed
    report
  }
}
```

The response includes the routing decision, the number of research iterations run, the evidence and citation counts, and the full Markdown report.

## Sample output

[examples/research-report.md](examples/research-report.md) is a real report generated by the system — useful for understanding the format and depth of output before running the pipeline yourself.

## Project structure

```
src/
├── core/
│   └── research-state.interface.ts   # Shared typed state across all agents
├── llm/
│   ├── llm.service.ts                # Claude wrapper + safe JSON parsing
│   └── llm.module.ts
├── agents/
│   ├── intent-router/
│   ├── planner/
│   ├── web-scout/
│   ├── local-scout/
│   ├── evidence-judge/
│   ├── analyst/
│   ├── reflect/
│   └── writer/
├── orchestrator/
│   ├── orchestrator.service.ts       # State-machine orchestration of all agents
│   ├── research.resolver.ts          # GraphQL resolver
│   └── research.model.ts             # GraphQL output type
├── scripts/
│   └── ingest.ts                     # Knowledge-base ingestion
└── main.ts
```
