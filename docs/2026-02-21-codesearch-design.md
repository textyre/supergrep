# codesearch — Design Document

**Date:** 2026-02-21
**Status:** Approved
**Location:** Separate repo/folder — `d:/projects/codesearch/`

---

## Overview

A modular TypeScript CLI + MCP server that searches GitHub for code examples and returns structured results (URL + snippet) to agents and subagents. Primary consumers are Claude agents/subagents via MCP tool calls or CLI stdout piping.

---

## Goals

- Agent-first output: clean JSON to stdout, logs to stderr only
- Two integration modes: CLI (pipe-friendly) and MCP (native tool_call)
- Multi-provider fan-out with partial failure tolerance
- SQLite-backed cache with configurable TTL to protect rate limits
- Structured logging (pino) + SQLite metrics with P50/P95/P99

---

## Non-Goals (MVP)

- Web UI or HTTP API
- grep.app backend (unofficial API, unstable)
- Local repo indexing
- Authentication management UI

---

## Stack

| Concern | Library |
|---|---|
| CLI | Commander.js |
| MCP server | `@modelcontextprotocol/sdk` |
| HTTP client | `got` |
| Cache + metrics | `better-sqlite3` |
| Logging | `pino` |
| Schema validation | `zod` |
| Build | `tsup` |
| Runtime | Node.js 20+ |

---

## Project Structure

```
codesearch/
├── src/
│   ├── core/
│   │   ├── types.ts          # SearchQuery, SearchResult, SearchResponse
│   │   ├── config.ts         # Env vars + ~/.config/codesearch/config.json
│   │   ├── engine.ts         # Facade: cache → fan-out → aggregate → return
│   │   ├── errors.ts         # ProviderError, ConfigError, CacheError
│   │   ├── logger.ts         # pino singleton (stderr / file)
│   │   ├── metrics.ts        # SQLite metrics writer + stats queries
│   │   └── telemetry.ts      # OpenTelemetry (no-op by default)
│   ├── providers/
│   │   ├── base.ts           # Provider interface + ProviderCapabilities
│   │   ├── github.ts         # GitHub Search REST API v3
│   │   └── sourcegraph.ts    # Sourcegraph GraphQL API
│   ├── cache/
│   │   └── sqlite.ts         # CacheRepository: get/set/clear/stats
│   ├── results/
│   │   ├── base.ts           # ResultFormatter interface
│   │   ├── json.ts           # Machine-readable JSON (default)
│   │   └── markdown.ts       # Human-readable table
│   ├── cli/
│   │   └── index.ts          # Commander entrypoint
│   └── mcp/
│       ├── server.ts         # Transport init, stdio MCP server startup
│       ├── tools.ts          # Tool definitions: name, description, inputSchema (zod)
│       └── handlers.ts       # Tool call handlers → SearchEngine calls
├── package.json              # bin: { "codesearch": "./dist/cli/index.js" }
├── tsconfig.json
├── tsup.config.ts
└── .env.example
```

---

## Data Models

```typescript
type ProviderName = 'github' | 'sourcegraph'

interface SearchQuery {
  q: string
  providers: ProviderName[]
  filters: {
    language?: string
    repo?: string           // "owner/repo"
    org?: string
    path?: string
    filename?: string
    extension?: string
    regex?: boolean
  }
  limit: number             // default: 20, max: 100
  cacheTTL?: number         // override default TTL (seconds)
}

interface SearchResult {
  url: string               // permalink with #L26-L30
  rawUrl: string            // raw file content URL
  repo: string              // "owner/repo"
  path: string              // "templates/nftables.conf.j2"
  lines: [number, number]   // [startLine, endLine]
  snippet: string           // matched code with context (±3 lines)
  language: string
  stars: number
  provider: ProviderName
  score: number             // normalized 0–1
}

interface SearchResponse {
  query: SearchQuery
  results: SearchResult[]
  total: number
  cached: boolean
  elapsed_ms: number
  errors: ProviderError[]   // partial provider failures, never fatal
}

interface ProviderError {
  provider: ProviderName
  message: string
  code: 'RATE_LIMIT' | 'AUTH' | 'TIMEOUT' | 'UNKNOWN'
}
```

---

## Design Patterns

| Pattern | Where | Purpose |
|---|---|---|
| **Adapter** | `providers/base.ts` + implementations | Uniform interface over different APIs |
| **Facade** | `core/engine.ts` | Hides cache, fan-out, aggregation complexity from CLI/MCP |
| **Strategy** | `results/base.ts` + formatters | Swappable output formats |
| **Repository** | `cache/sqlite.ts` | Isolates SQLite behind a clean interface |
| **Factory** | `core/engine.ts` | Resolves Provider instances from config |

---

## Provider Interface

```typescript
interface Provider {
  name: ProviderName
  capabilities: {
    regex: boolean
    structural: boolean
    symbolSearch: boolean
    rateLimit: { requests: number; windowMs: number }
  }
  search(query: SearchQuery): Promise<SearchResult[]>
  validate(): Promise<boolean>    // health check: token + connectivity
}
```

Each provider is responsible for:
- Translating `SearchQuery.filters` to provider-specific query syntax
- Normalizing raw API results into `SearchResult[]`
- Throwing `ProviderError` on failures (caught by engine)

---

## Engine: Data Flow

```
SearchEngine.search(query: SearchQuery): Promise<SearchResponse>

1. key = sha256(normalizeQuery(query))
2. cached = CacheRepository.get(key)
   └── HIT → return { ...cached, cached: true }

3. providers = ProviderFactory.resolve(query.providers)

4. settlements = await Promise.allSettled(
     providers.map(p => p.search(query))  ← parallel fan-out
   )

5. results  = settlements.filter(fulfilled).flatMap(r => r.value)
   errors   = settlements.filter(rejected).map(r => toProviderError(r))

6. merged = ResultAggregator.merge(results, query)
   ├── deduplicate by URL
   ├── normalize scores (0–1 per provider)
   ├── re-rank: score × log(stars + 1) × recencyBoost
   └── slice to query.limit

7. response = { query, results: merged, total, cached: false, elapsed_ms, errors }

8. CacheRepository.set(key, response, query.cacheTTL ?? config.defaultCacheTTL)
   metrics.record(provider, elapsed_ms, results.length, errors)

9. return response
```

---

## Cache

**Implementation:** `better-sqlite3`
**Location:** `~/.cache/codesearch/cache.db`

```sql
CREATE TABLE cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,         -- JSON SearchResponse
  created_at INTEGER NOT NULL,      -- unix timestamp
  expires_at INTEGER NOT NULL
);

CREATE TABLE metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  provider   TEXT NOT NULL,
  query      TEXT,
  cache_hit  INTEGER NOT NULL,      -- 0 | 1
  results    INTEGER,
  elapsed_ms INTEGER,
  error      TEXT
);
```

Cache key: `sha256(JSON.stringify(sortedQuery))` — deterministic, provider-agnostic.

---

## Logging

**Library:** `pino`
**Output:** stderr by default (never pollutes stdout JSON)
**File log:** enabled via `LOG_FILE=~/.local/share/codesearch/codesearch.log`

| Event | Level | Fields |
|---|---|---|
| Search request | `info` | q, providers, filters |
| Cache HIT | `debug` | key, age_sec |
| Cache MISS | `debug` | key |
| Provider request | `debug` | provider, url |
| Provider response | `info` | provider, count, elapsed_ms |
| Provider error | `warn` | provider, error, attempt |
| Rate limit | `warn` | provider, retry_after_ms |
| Missing token | `error` | provider |

---

## Metrics & Stats

`codesearch stats` output:

```
Provider       Requests   Errors   P50    P95    P99     Cache HIT
github         142        3        320ms  890ms  1.4s    67%
sourcegraph    89         1        180ms  540ms  980ms   71%

Last 24h: 231 requests, 4 errors (1.7%), avg 280ms
Cache: 1,204 entries, 2.1 MB, oldest 3h ago
```

Percentiles computed via sorted slice over `metrics` table (last N rows per provider).

---

## CLI Commands

```bash
# Search
codesearch search "nftables limit rate" \
  --provider github \
  --provider sourcegraph \
  --lang yaml \
  --repo ansible/ansible \
  --limit 20 \
  --output json          # json (default) | markdown
  --no-cache             # skip cache for this query

# Provider health check
codesearch validate

# Cache management
codesearch cache stats
codesearch cache clear [--pattern "nftables*"]

# Metrics
codesearch stats [--since 24h]

# MCP server (stdio transport)
codesearch mcp-serve
```

Exit codes: `0` success (even with partial provider errors), `1` fatal (no token, no providers available).

---

## MCP Tools

| Tool | Input Schema | Description |
|---|---|---|
| `search_code` | `q, providers?, filters?, limit?` | Search for code examples across providers |
| `fetch_file` | `url: string` | Download raw file content from a result URL |
| `cache_stats` | — | Return cache and metrics summary |
| `cache_clear` | `pattern?: string` | Clear cache entries matching pattern |

All tools return JSON. Errors returned as MCP error responses, never thrown.

---

## Configuration

Priority: env vars > `~/.config/codesearch/config.json` > defaults

```bash
GITHUB_TOKEN=ghp_...            # required for GitHub backend
SOURCEGRAPH_TOKEN=sgp_...       # optional (higher rate limits)
SOURCEGRAPH_URL=https://sourcegraph.com  # default
LOG_LEVEL=info                  # debug | info | warn | error
LOG_FILE=                       # empty = stderr only
CODESEARCH_CACHE_TTL=3600       # seconds
CODESEARCH_DEFAULT_LIMIT=20
OTEL_EXPORTER_OTLP_ENDPOINT=   # empty = tracing disabled
```

---

## Error Handling Strategy

- **Provider failure** → `errors[]` in response, other providers continue
- **Rate limit** → exponential backoff, 2 retries, then `ProviderError { code: 'RATE_LIMIT' }`
- **Timeout** → 10s per provider, caught, treated as failure
- **Missing token** → `error` log + skip provider (not crash)
- **Cache failure** → log + bypass cache, search proceeds normally
- **No results** → `{ results: [], total: 0, errors: [] }` — never an error condition

---

## OpenTelemetry (optional)

Enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Zero-cost no-op otherwise.

Trace structure:
```
search [root span]
  ├── cache.get
  ├── provider.github.search
  ├── provider.sourcegraph.search
  ├── aggregator.merge
  └── cache.set
```
