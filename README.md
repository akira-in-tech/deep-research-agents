# Deep Research Agents

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
- **Persistence:** PostgreSQL + TypeORM migrations
- **Background execution:** BullMQ + Redis (durable jobs, retries, multi-instance progress events)
- **Infrastructure:** Docker Compose (app + PostgreSQL + Redis + Milvus + etcd + MinIO)

## Key design decisions

**Rules + LLM hybrid.** Intent routing and reliability scoring use deterministic rules first, falling back to the LLM only where judgment is genuinely needed. Rules are fast, free, and consistent; the LLM handles the fuzzy cases. The same source type always gets the same reliability score.

**Anti-hallucination in depth.** Multiple layers guard against fabrication: scouts keep real source data from the APIs and trust the LLM only for relevance judgments; every Analyst finding must cite real source IDs; the Writer validates all citations against the source index and removes invented ones.

**Source/logic separation.** Each retrieval agent separates "where the data comes from" from "how it is processed." Swapping the web provider or vector store touches only the retrieval function, not the agent logic.

**Capped iterative loop.** The Analyst decides whether more research is needed; Reflect generates fresh queries; the loop is hard-capped to prevent infinite re-search and runaway token cost.

**Honest uncertainty.** Conflicts between sources and gaps in coverage are surfaced explicitly in the final report rather than smoothed over.

## Setup

### Prerequisites

- Node.js 20.19+ or 22.13+ (`nvm use` reads the checked-in `.nvmrc`)
- Docker Desktop
- API keys: Anthropic, Tavily, Voyage AI

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the checked-in template, then add your API keys:

```bash
cp .env.example .env
```

```dotenv
ANTHROPIC_API_KEY=your_anthropic_key
TAVILY_API_KEY=your_tavily_key
VOYAGE_API_KEY=your_voyage_key

# Optional overrides for the local PostgreSQL service
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=research
POSTGRES_PASSWORD=research
POSTGRES_DB=research_memory

# Redis-backed durable jobs and cross-instance subscriptions
REDIS_URL=redis://localhost:6379
QUEUE_ENABLED=true
QUEUE_CONCURRENCY=2
REDIS_EVENTS_ENABLED=true

# Optional Milvus semantic-memory overrides
MILVUS_ADDRESS=localhost:19530
SEMANTIC_MEMORY_COLLECTION=semantic_memory
```

### 3. Start local infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, Milvus, etcd, and MinIO. Wait until the services report healthy:

```bash
docker ps --filter name=milvus-standalone --format "{{.Status}}"
```

### 4. Apply database migrations

```bash
npm run migration:run
npm run migration:show
```

`TYPEORM_SYNC` is convenient for local development, but production uses migrations with schema synchronization disabled.

### 5. Ingest the knowledge base

Place `.txt` documents in the `knowledge-base/` folder, then:

```bash
npx ts-node src/scripts/ingest.ts
```

This embeds each document with Voyage and loads it into Milvus.

### 6. Run the server

```bash
npm run dev
```

The GraphQL playground is available at `http://localhost:3000/graphql`.

## Usage

Send a GraphQL query:

```graphql
query {
  research(
    question: "Investigate the best AI products of 2026 and compare them"
    sessionId: "research-session-1"
    userId: "user-1"
  ) {
    sessionId
    userId
    route
    iterations
    evidenceCount
    webEvidenceCount
    localEvidenceCount
    executedQueries
    citationsUsed
    report
  }
}
```

Reuse the returned `sessionId` for follow-up questions. When `userId` is supplied, saved long-term user facts are also included in the agent context.

For persisted background research, start a task and poll or subscribe to its progress:

```graphql
mutation {
  startResearch(
    question: "Compare the leading AI coding assistants"
    sessionId: "research-session-1"
    userId: "user-1"
  ) {
    id
    status
    phase
    progress
  }
}

query {
  researchRun(runId: "RUN_ID") {
    id
    status
    phase
    progress
    report
    error
  }
}

subscription {
  researchProgress(runId: "RUN_ID") {
    id
    status
    phase
    progress
    evidenceCount
  }
}
```

Every completed research iteration writes a PostgreSQL checkpoint. A failed or interrupted run can continue from its latest checkpoint:

```graphql
mutation {
  resumeResearch(runId: "RUN_ID") {
    id
    status
    phase
    progress
  }
}
```

Inspect aggregate run health and latency:

```graphql
query {
  researchMetrics {
    totalRuns
    runningRuns
    completedRuns
    failedRuns
    averageDurationMs
  }
}
```

Long-term facts can be stored and inspected through GraphQL:

```graphql
mutation {
  rememberFact(userId: "user-1", fact: "Prefers concise technical reports") {
    id
    fact
    semanticIndexed
  }
}

query {
  longTermMemories(userId: "user-1") {
    id
    fact
    updatedAt
  }
}

query {
  semanticMemories(
    userId: "user-1"
    query: "How should reports be written?"
    limit: 5
  ) {
    id
    text
    score
  }
}
```

To verify PostgreSQL memory without making an LLM request:

```bash
npm run memory:smoke

# Also calls Voyage and Milvus to verify vector memory end to end
npm run semantic-memory:smoke

# Verifies Redis and BullMQ without making an LLM request
npm run queue:smoke
```

## CLI and evaluation

Run one research task from the terminal:

```bash
npm run cli -- --question "Compare PostgreSQL and MongoDB for event storage" --session demo --user user-1
```

Omit `--question` for an interactive session. Run the checked-in evaluation dataset with:

```bash
npm run eval

# Limit cost while iterating
EVAL_LIMIT=2 npm run eval
```

Each evaluation writes an ignored `evaluation/results-*.json` artifact containing routing accuracy, latency, evidence count, citation count, and report size.

## Testing and production

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The GitHub Actions workflow runs formatting, lint, build, unit tests, and PostgreSQL/Milvus integration tests. To build and run the full production-style stack locally:

```bash
docker compose --profile app up --build -d
docker compose --profile app ps
```

The app container starts with `NODE_ENV=production`, `TYPEORM_SYNC=false`, and `TYPEORM_MIGRATIONS_RUN=true`.
Set `APP_PORT=3100` before the Compose command when port 3000 is already in use.

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
│   ├── research-run.service.ts       # Persisted task status and checkpoints
│   ├── research-task.service.ts      # Background start/resume API
│   ├── research-queue.service.ts     # BullMQ producer and worker
│   ├── research-execution.service.ts # Checkpoint-aware job execution
│   ├── research-progress.service.ts  # Local + Redis progress subscriptions
│   ├── research.resolver.ts          # GraphQL resolver
│   └── research.model.ts             # GraphQL output type
├── database/
│   ├── data-source.ts                 # TypeORM migration data source
│   ├── migrate.ts                     # Migration run/show/revert command
│   └── migrations/                    # Versioned PostgreSQL schema
├── scripts/
│   ├── ingest.ts                     # Knowledge-base ingestion
│   ├── evaluate.ts                   # Repeatable quality evaluation
│   └── queue-smoke.ts                # Redis/BullMQ health check
├── cli.ts                            # One-shot and interactive terminal client
└── main.ts
```
