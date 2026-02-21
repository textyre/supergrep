# codesearch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a modular TypeScript CLI + MCP server that searches GitHub and Sourcegraph for code examples and returns structured JSON results (URL + snippet) to agents/subagents.

**Architecture:** Single-package TypeScript project using Adapter pattern for providers, Facade pattern in the engine, Repository pattern for SQLite cache. CLI and MCP server share the same engine core — no logic duplication.

**Tech Stack:** Node.js 20+, TypeScript, Commander.js (CLI), @modelcontextprotocol/sdk (MCP), got (HTTP), better-sqlite3 (cache+metrics), pino (logging), zod (validation), vitest (tests), tsup (build).

**Design doc:** `docs/plans/2026-02-21-codesearch-design.md`

---

## Task 0: Project scaffold

**Files:**
- Create: `d:/projects/codesearch/package.json`
- Create: `d:/projects/codesearch/tsconfig.json`
- Create: `d:/projects/codesearch/tsup.config.ts`
- Create: `d:/projects/codesearch/vitest.config.ts`
- Create: `d:/projects/codesearch/.env.example`
- Create: `d:/projects/codesearch/.gitignore`

**Step 1: Create project directory and init git**

```bash
mkdir -p d:/projects/codesearch && cd d:/projects/codesearch
git init
```

**Step 2: Create `package.json`**

```json
{
  "name": "codesearch",
  "version": "0.1.0",
  "description": "Search GitHub code — CLI + MCP server for agents",
  "type": "module",
  "bin": {
    "codesearch": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^9.4.3",
    "commander": "^12.0.0",
    "got": "^14.4.2",
    "pino": "^9.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.0.0",
    "nock": "^13.5.0",
    "tsup": "^8.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'mcp/server': 'src/mcp/server.ts',
  },
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
```

**Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
})
```

**Step 6: Create `.env.example`**

```bash
# Required for GitHub Search provider
GITHUB_TOKEN=ghp_your_token_here

# Optional — higher rate limits on sourcegraph.com
SOURCEGRAPH_TOKEN=sgp_your_token_here

# Sourcegraph instance (default: sourcegraph.com)
SOURCEGRAPH_URL=https://sourcegraph.com

# Logging
LOG_LEVEL=info
LOG_FILE=

# Cache
CODESEARCH_CACHE_TTL=3600
CODESEARCH_DEFAULT_LIMIT=20

# OpenTelemetry tracing (disabled if empty)
OTEL_EXPORTER_OTLP_ENDPOINT=
```

**Step 7: Create `.gitignore`**

```
node_modules/
dist/
.env
*.db
```

**Step 8: Create directory structure**

```bash
mkdir -p src/{core,providers,cache,results,cli,mcp}
mkdir -p tests/{core,providers,cache,results,cli}
```

**Step 9: Install dependencies**

```bash
npm install
```

Expected: clean install, no errors.

**Step 10: Commit**

```bash
git add .
git commit -m "chore: project scaffold — package.json, tsconfig, tsup, vitest"
```

---

## Task 1: Core types and errors

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/errors.ts`
- Create: `tests/core/types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/types.test.ts
import { describe, it, expect } from 'vitest'
import { isProviderError, normalizeQuery } from '../../src/core/types.js'

describe('normalizeQuery', () => {
  it('sorts providers and filters for deterministic cache keys', () => {
    const q1 = normalizeQuery({ q: 'foo', providers: ['sourcegraph', 'github'], filters: {}, limit: 10 })
    const q2 = normalizeQuery({ q: 'foo', providers: ['github', 'sourcegraph'], filters: {}, limit: 10 })
    expect(JSON.stringify(q1)).toBe(JSON.stringify(q2))
  })

  it('strips undefined filters', () => {
    const q = normalizeQuery({ q: 'foo', providers: ['github'], filters: { language: undefined }, limit: 10 })
    expect(q.filters).not.toHaveProperty('language')
  })
})

describe('isProviderError', () => {
  it('returns true for valid ProviderError', () => {
    expect(isProviderError({ provider: 'github', message: 'fail', code: 'TIMEOUT' })).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isProviderError(new Error('fail'))).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/types.test.ts
```

Expected: FAIL — `normalizeQuery` not found.

**Step 3: Implement `src/core/types.ts`**

```typescript
// src/core/types.ts

export type ProviderName = 'github' | 'sourcegraph'

export interface SearchFilters {
  language?: string
  repo?: string       // "owner/repo"
  org?: string
  path?: string
  filename?: string
  extension?: string
  regex?: boolean
}

export interface SearchQuery {
  q: string
  providers: ProviderName[]
  filters: SearchFilters
  limit: number
  cacheTTL?: number
}

export interface SearchResult {
  url: string               // permalink with #L26-L30
  rawUrl: string            // raw content URL
  repo: string              // "owner/repo"
  path: string
  lines: [number, number]   // [startLine, endLine]
  snippet: string           // matched code ±3 lines
  language: string
  stars: number
  provider: ProviderName
  score: number             // normalized 0–1
}

export interface ProviderError {
  provider: ProviderName
  message: string
  code: 'RATE_LIMIT' | 'AUTH' | 'TIMEOUT' | 'UNKNOWN'
}

export interface SearchResponse {
  query: SearchQuery
  results: SearchResult[]
  total: number
  cached: boolean
  elapsed_ms: number
  errors: ProviderError[]
}

/** Normalize query for deterministic cache key generation */
export function normalizeQuery(query: SearchQuery): SearchQuery {
  const filters: SearchFilters = {}
  for (const [k, v] of Object.entries(query.filters)) {
    if (v !== undefined) (filters as Record<string, unknown>)[k] = v
  }
  return {
    ...query,
    providers: [...query.providers].sort(),
    filters,
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    'message' in value &&
    'code' in value
  )
}
```

**Step 4: Implement `src/core/errors.ts`**

```typescript
// src/core/errors.ts
import type { ProviderName } from './types.js'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class CacheError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CacheError'
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run tests/core/types.test.ts
```

Expected: PASS, 3 tests.

**Step 6: Commit**

```bash
git add src/core/types.ts src/core/errors.ts tests/core/types.test.ts
git commit -m "feat(core): types, errors — SearchQuery, SearchResult, SearchResponse"
```

---

## Task 2: Config

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/core/config.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../../src/core/config.js'

describe('loadConfig', () => {
  const original = { ...process.env }

  afterEach(() => {
    // restore env
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, original)
  })

  it('reads GITHUB_TOKEN from env', () => {
    process.env.GITHUB_TOKEN = 'ghp_test'
    const cfg = loadConfig()
    expect(cfg.githubToken).toBe('ghp_test')
  })

  it('returns defaults when env not set', () => {
    delete process.env.CODESEARCH_CACHE_TTL
    delete process.env.CODESEARCH_DEFAULT_LIMIT
    const cfg = loadConfig()
    expect(cfg.defaultCacheTTL).toBe(3600)
    expect(cfg.defaultLimit).toBe(20)
  })

  it('defaults sourcegraphUrl to sourcegraph.com', () => {
    delete process.env.SOURCEGRAPH_URL
    const cfg = loadConfig()
    expect(cfg.sourcegraphUrl).toBe('https://sourcegraph.com')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/config.test.ts
```

Expected: FAIL — `loadConfig` not found.

**Step 3: Implement `src/core/config.ts`**

```typescript
// src/core/config.ts
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  githubToken: string | undefined
  sourcegraphToken: string | undefined
  sourcegraphUrl: string
  cachePath: string
  defaultCacheTTL: number
  defaultLimit: number
  logLevel: string
  logFile: string | undefined
  otelEndpoint: string | undefined
}

export function loadConfig(): Config {
  return {
    githubToken: process.env.GITHUB_TOKEN,
    sourcegraphToken: process.env.SOURCEGRAPH_TOKEN,
    sourcegraphUrl: process.env.SOURCEGRAPH_URL ?? 'https://sourcegraph.com',
    cachePath: join(homedir(), '.cache', 'codesearch', 'cache.db'),
    defaultCacheTTL: Number(process.env.CODESEARCH_CACHE_TTL ?? 3600),
    defaultLimit: Number(process.env.CODESEARCH_DEFAULT_LIMIT ?? 20),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    logFile: process.env.LOG_FILE || undefined,
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/config.test.ts
```

Expected: PASS, 3 tests.

**Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat(core): config — env-driven, typed, with defaults"
```

---

## Task 3: Logger

**Files:**
- Create: `src/core/logger.ts`
- Create: `tests/core/logger.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/logger.test.ts
import { describe, it, expect } from 'vitest'
import { createLogger } from '../../src/core/logger.js'

describe('createLogger', () => {
  it('creates a logger without throwing', () => {
    expect(() => createLogger({ level: 'silent' })).not.toThrow()
  })

  it('logger has info, warn, error, debug methods', () => {
    const log = createLogger({ level: 'silent' })
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/logger.test.ts
```

Expected: FAIL.

**Step 3: Implement `src/core/logger.ts`**

```typescript
// src/core/logger.ts
import pino from 'pino'

interface LoggerOptions {
  level?: string
  file?: string
}

export function createLogger(opts: LoggerOptions = {}): pino.Logger {
  const level = opts.level ?? 'info'

  if (opts.file) {
    return pino({ level }, pino.destination(opts.file))
  }

  // Always log to stderr — never pollute stdout (reserved for JSON results)
  return pino({ level }, process.stderr)
}

// Singleton for app use — imported by engine, providers, etc.
import { loadConfig } from './config.js'

let _logger: pino.Logger | undefined

export function getLogger(): pino.Logger {
  if (!_logger) {
    const cfg = loadConfig()
    _logger = createLogger({ level: cfg.logLevel, file: cfg.logFile })
  }
  return _logger
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/logger.test.ts
```

Expected: PASS, 2 tests.

**Step 5: Commit**

```bash
git add src/core/logger.ts tests/core/logger.test.ts
git commit -m "feat(core): logger — pino to stderr, file log optional, singleton"
```

---

## Task 4: Cache repository

**Files:**
- Create: `src/cache/sqlite.ts`
- Create: `tests/cache/sqlite.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cache/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCacheRepository } from '../../src/cache/sqlite.js'
import type { SearchResponse } from '../../src/core/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeResponse(q: string): SearchResponse {
  return {
    query: { q, providers: ['github'], filters: {}, limit: 10 },
    results: [],
    total: 0,
    cached: false,
    elapsed_ms: 100,
    errors: [],
  }
}

describe('SqliteCacheRepository', () => {
  let dir: string
  let repo: SqliteCacheRepository

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codesearch-test-'))
    repo = new SqliteCacheRepository(join(dir, 'cache.db'))
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it('returns null for missing key', async () => {
    expect(await repo.get('missing')).toBeNull()
  })

  it('stores and retrieves a response', async () => {
    const r = makeResponse('hello')
    await repo.set('key1', r, 3600)
    const got = await repo.get('key1')
    expect(got?.query.q).toBe('hello')
  })

  it('returns null for expired entry', async () => {
    const r = makeResponse('expired')
    await repo.set('key2', r, -1) // already expired
    expect(await repo.get('key2')).toBeNull()
  })

  it('clear() removes matching entries and returns count', async () => {
    await repo.set('abc-1', makeResponse('a'), 3600)
    await repo.set('abc-2', makeResponse('b'), 3600)
    await repo.set('xyz-1', makeResponse('c'), 3600)
    const deleted = await repo.clear('abc-%')
    expect(deleted).toBe(2)
    expect(await repo.get('xyz-1')).not.toBeNull()
  })

  it('stats() returns entry count and size', async () => {
    await repo.set('s1', makeResponse('s'), 3600)
    const stats = await repo.stats()
    expect(stats.entries).toBeGreaterThan(0)
    expect(stats.sizeBytes).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cache/sqlite.test.ts
```

Expected: FAIL — `SqliteCacheRepository` not found.

**Step 3: Implement `src/cache/sqlite.ts`**

```typescript
// src/cache/sqlite.ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SearchResponse } from '../core/types.js'

export interface CacheStats {
  entries: number
  sizeBytes: number
  oldestEntry: Date | null
}

export interface CacheRepository {
  get(key: string): Promise<SearchResponse | null>
  set(key: string, value: SearchResponse, ttlSec: number): Promise<void>
  clear(pattern?: string): Promise<number>
  stats(): Promise<CacheStats>
}

export class SqliteCacheRepository implements CacheRepository {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)
  }

  async get(key: string): Promise<SearchResponse | null> {
    const now = Math.floor(Date.now() / 1000)
    const row = this.db
      .prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?')
      .get(key, now) as { value: string } | undefined
    if (!row) return null
    return JSON.parse(row.value) as SearchResponse
  }

  async set(key: string, value: SearchResponse, ttlSec: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .prepare(
        'INSERT OR REPLACE INTO cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(key, JSON.stringify(value), now, now + ttlSec)
  }

  async clear(pattern?: string): Promise<number> {
    const stmt = pattern
      ? this.db.prepare("DELETE FROM cache WHERE key LIKE ?")
      : this.db.prepare('DELETE FROM cache')
    const result = pattern ? stmt.run(pattern) : stmt.run()
    return result.changes
  }

  async stats(): Promise<CacheStats> {
    const row = this.db
      .prepare('SELECT COUNT(*) as entries, MIN(created_at) as oldest FROM cache WHERE expires_at > ?')
      .get(Math.floor(Date.now() / 1000)) as { entries: number; oldest: number | null }

    const sizeRow = this.db
      .prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
      .get() as { size: number }

    return {
      entries: row.entries,
      sizeBytes: sizeRow.size,
      oldestEntry: row.oldest ? new Date(row.oldest * 1000) : null,
    }
  }

  close(): void {
    this.db.close()
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cache/sqlite.test.ts
```

Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add src/cache/sqlite.ts tests/cache/sqlite.test.ts
git commit -m "feat(cache): SQLite repository — get/set/clear/stats with TTL"
```

---

## Task 5: Metrics

**Files:**
- Create: `src/core/metrics.ts`
- Create: `tests/core/metrics.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/metrics.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteMetrics } from '../../src/core/metrics.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('SqliteMetrics', () => {
  let dir: string
  let metrics: SqliteMetrics

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codesearch-metrics-test-'))
    metrics = new SqliteMetrics(join(dir, 'cache.db'))
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it('records an entry without throwing', async () => {
    await expect(
      metrics.record({ provider: 'github', query: 'foo', cacheHit: false, results: 5, elapsedMs: 300 })
    ).resolves.toBeUndefined()
  })

  it('stats returns percentiles for recorded data', async () => {
    for (let i = 0; i < 10; i++) {
      await metrics.record({ provider: 'github', query: 'foo', cacheHit: false, results: 3, elapsedMs: (i + 1) * 100 })
    }
    const stats = await metrics.stats()
    const g = stats.find(s => s.provider === 'github')!
    expect(g.requests).toBe(10)
    expect(g.p50).toBeGreaterThan(0)
    expect(g.p95).toBeGreaterThanOrEqual(g.p50)
    expect(g.p99).toBeGreaterThanOrEqual(g.p95)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/metrics.test.ts
```

Expected: FAIL.

**Step 3: Implement `src/core/metrics.ts`**

```typescript
// src/core/metrics.ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ProviderName } from './types.js'

export interface MetricRecord {
  provider: ProviderName
  query?: string
  cacheHit: boolean
  results?: number
  elapsedMs?: number
  error?: string
}

export interface ProviderStats {
  provider: ProviderName
  requests: number
  errors: number
  p50: number
  p95: number
  p99: number
  cacheHitRate: number
}

export class SqliteMetrics {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         INTEGER NOT NULL,
        provider   TEXT NOT NULL,
        query      TEXT,
        cache_hit  INTEGER NOT NULL,
        results    INTEGER,
        elapsed_ms INTEGER,
        error      TEXT
      );
    `)
  }

  async record(m: MetricRecord): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO metrics (ts, provider, query, cache_hit, results, elapsed_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        Math.floor(Date.now() / 1000),
        m.provider,
        m.query ?? null,
        m.cacheHit ? 1 : 0,
        m.results ?? null,
        m.elapsedMs ?? null,
        m.error ?? null,
      )
  }

  async stats(sinceSec = 86400): Promise<ProviderStats[]> {
    const since = Math.floor(Date.now() / 1000) - sinceSec
    const rows = this.db
      .prepare(
        `SELECT provider,
                COUNT(*) as requests,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
                SUM(cache_hit) as hits,
                GROUP_CONCAT(elapsed_ms ORDER BY elapsed_ms) as latencies
         FROM metrics
         WHERE ts >= ?
         GROUP BY provider`,
      )
      .all(since) as Array<{
        provider: ProviderName
        requests: number
        errors: number
        hits: number
        latencies: string | null
      }>

    return rows.map((r) => {
      const lats = r.latencies
        ? r.latencies.split(',').map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
        : []
      return {
        provider: r.provider,
        requests: r.requests,
        errors: r.errors,
        p50: percentile(lats, 0.5),
        p95: percentile(lats, 0.95),
        p99: percentile(lats, 0.99),
        cacheHitRate: r.requests > 0 ? r.hits / r.requests : 0,
      }
    })
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/metrics.test.ts
```

Expected: PASS, 2 tests.

**Step 5: Commit**

```bash
git add src/core/metrics.ts tests/core/metrics.test.ts
git commit -m "feat(core): metrics — SQLite, P50/P95/P99 per provider"
```

---

## Task 6: Provider interface and GitHub provider

**Files:**
- Create: `src/providers/base.ts`
- Create: `src/providers/github.ts`
- Create: `tests/providers/github.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/github.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { GitHubProvider } from '../../src/providers/github.js'

const SAMPLE_RESPONSE = {
  total_count: 1,
  items: [
    {
      name: 'nftables.conf.j2',
      path: 'templates/nftables.conf.j2',
      html_url: 'https://github.com/owner/repo/blob/main/templates/nftables.conf.j2',
      repository: {
        full_name: 'owner/repo',
        stargazers_count: 500,
      },
      text_matches: [
        {
          fragment: 'tcp dport 22 ct state new limit rate 4/minute accept',
          matches: [{ indices: [0, 10] }],
        },
      ],
    },
  ],
}

describe('GitHubProvider', () => {
  beforeEach(() => nock.cleanAll())
  afterEach(() => nock.cleanAll())

  it('searches and returns normalized results', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(200, SAMPLE_RESPONSE, { 'Content-Type': 'application/json' })

    const provider = new GitHubProvider('ghp_test')
    const results = await provider.search({
      q: 'nftables limit rate',
      providers: ['github'],
      filters: { language: 'yaml' },
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0].repo).toBe('owner/repo')
    expect(results[0].provider).toBe('github')
    expect(results[0].snippet).toBeTruthy()
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('throws ProviderHttpError on 403', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(403, { message: 'Forbidden' })

    const provider = new GitHubProvider('bad_token')
    await expect(provider.search({ q: 'test', providers: ['github'], filters: {}, limit: 5 }))
      .rejects.toMatchObject({ code: 'AUTH' })
  })

  it('throws ProviderHttpError with RATE_LIMIT on 429', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(429, { message: 'rate limit' })

    const provider = new GitHubProvider('ghp_test')
    await expect(provider.search({ q: 'test', providers: ['github'], filters: {}, limit: 5 }))
      .rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/providers/github.test.ts
```

Expected: FAIL.

**Step 3: Create `src/providers/base.ts`**

```typescript
// src/providers/base.ts
import type { ProviderName, SearchQuery, SearchResult } from '../core/types.js'

export interface ProviderCapabilities {
  regex: boolean
  structural: boolean
  symbolSearch: boolean
  rateLimit: { requests: number; windowMs: number }
}

export interface Provider {
  readonly name: ProviderName
  readonly capabilities: ProviderCapabilities
  search(query: SearchQuery): Promise<SearchResult[]>
  validate(): Promise<boolean>
}
```

**Step 4: Create `src/providers/github.ts`**

```typescript
// src/providers/github.ts
import got, { type Response } from 'got'
import type { Provider, ProviderCapabilities } from './base.js'
import type { SearchQuery, SearchResult } from '../core/types.js'
import type { ProviderName } from '../core/types.js'

const BASE = 'https://api.github.com'

interface GithubCodeItem {
  name: string
  path: string
  html_url: string
  repository: { full_name: string; stargazers_count: number }
  text_matches?: Array<{ fragment: string; matches: Array<{ indices: [number, number] }> }>
}

interface GithubSearchResponse {
  total_count: number
  items: GithubCodeItem[]
}

export class GitHubProvider implements Provider {
  readonly name: ProviderName = 'github'
  readonly capabilities: ProviderCapabilities = {
    regex: false,
    structural: false,
    symbolSearch: false,
    rateLimit: { requests: 30, windowMs: 60_000 },
  }

  constructor(private readonly token: string) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const q = buildQuery(query)

    let res: Response<GithubSearchResponse>
    try {
      res = await got.get(`${BASE}/search/code`, {
        searchParams: { q, per_page: Math.min(query.limit, 100) },
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'X-GitHub-Media-Type': 'github.v3.text-match+json',
        },
        responseType: 'json',
        timeout: { request: 10_000 },
      }) as Response<GithubSearchResponse>
    } catch (err: unknown) {
      throw toProviderError(err)
    }

    return res.body.items.map((item) => normalize(item, query.q))
  }

  async validate(): Promise<boolean> {
    try {
      await got.get(`${BASE}/user`, {
        headers: { Authorization: `Bearer ${this.token}` },
        responseType: 'json',
        timeout: { request: 5_000 },
      })
      return true
    } catch {
      return false
    }
  }
}

function buildQuery(query: SearchQuery): string {
  const parts = [query.q]
  const f = query.filters
  if (f.language) parts.push(`language:${f.language}`)
  if (f.repo) parts.push(`repo:${f.repo}`)
  if (f.org) parts.push(`org:${f.org}`)
  if (f.path) parts.push(`path:${f.path}`)
  if (f.filename) parts.push(`filename:${f.filename}`)
  if (f.extension) parts.push(`extension:${f.extension}`)
  return parts.join(' ')
}

function normalize(item: GithubCodeItem, q: string): SearchResult {
  const fragment = item.text_matches?.[0]?.fragment ?? q
  const match = item.text_matches?.[0]?.matches?.[0]
  const lineApprox = 1  // GitHub API doesn't return exact line numbers in search results

  const [owner, repoName] = item.repository.full_name.split('/')
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/HEAD/${item.path}`

  return {
    url: item.html_url,
    rawUrl,
    repo: item.repository.full_name,
    path: item.path,
    lines: [lineApprox, lineApprox + (fragment.split('\n').length - 1)],
    snippet: fragment,
    language: item.path.split('.').pop() ?? 'unknown',
    stars: item.repository.stargazers_count,
    provider: 'github',
    score: match ? 1.0 : 0.5,
  }
}

function toProviderError(err: unknown): Error & { code: string; provider: ProviderName } {
  const base = { provider: 'github' as ProviderName }
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response: { statusCode: number } }).response.statusCode
    if (status === 401 || status === 403) return Object.assign(new Error('Auth failed'), { code: 'AUTH', ...base })
    if (status === 429) return Object.assign(new Error('Rate limited'), { code: 'RATE_LIMIT', ...base })
  }
  return Object.assign(new Error(String(err)), { code: 'UNKNOWN', ...base })
}
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run tests/providers/github.test.ts
```

Expected: PASS, 3 tests.

**Step 6: Commit**

```bash
git add src/providers/base.ts src/providers/github.ts tests/providers/github.test.ts
git commit -m "feat(providers): Provider interface + GitHub Search adapter"
```

---

## Task 7: Sourcegraph provider

**Files:**
- Create: `src/providers/sourcegraph.ts`
- Create: `tests/providers/sourcegraph.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/sourcegraph.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { SourcegraphProvider } from '../../src/providers/sourcegraph.js'

const SAMPLE_GQL_RESPONSE = {
  data: {
    search: {
      results: {
        results: [
          {
            __typename: 'FileMatch',
            repository: { name: 'github.com/owner/repo', stars: 1200 },
            file: {
              path: 'src/handler.py',
              url: '/github.com/owner/repo/-/blob/src/handler.py',
              canonicalURL: '/github.com/owner/repo/-/blob/src/handler.py',
            },
            lineMatches: [
              { lineNumber: 42, preview: 'def handle_request(req):' },
            ],
          },
        ],
        limitHit: false,
      },
    },
  },
}

describe('SourcegraphProvider', () => {
  beforeEach(() => nock.cleanAll())
  afterEach(() => nock.cleanAll())

  it('searches and returns normalized results', async () => {
    nock('https://sourcegraph.com')
      .post('/.api/graphql')
      .reply(200, SAMPLE_GQL_RESPONSE)

    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    const results = await provider.search({
      q: 'handle_request',
      providers: ['sourcegraph'],
      filters: { language: 'python' },
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0].repo).toBe('owner/repo')
    expect(results[0].provider).toBe('sourcegraph')
    expect(results[0].lines[0]).toBe(42)
  })

  it('skips non-FileMatch results', async () => {
    const resp = {
      data: {
        search: {
          results: {
            results: [{ __typename: 'CommitSearchResult' }],
            limitHit: false,
          },
        },
      },
    }
    nock('https://sourcegraph.com').post('/.api/graphql').reply(200, resp)
    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    const results = await provider.search({ q: 'x', providers: ['sourcegraph'], filters: {}, limit: 5 })
    expect(results).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/providers/sourcegraph.test.ts
```

Expected: FAIL.

**Step 3: Implement `src/providers/sourcegraph.ts`**

```typescript
// src/providers/sourcegraph.ts
import got from 'got'
import type { Provider, ProviderCapabilities } from './base.js'
import type { SearchQuery, SearchResult, ProviderName } from '../core/types.js'

const QUERY = `
query SearchCode($query: String!, $patternType: SearchPatternType!) {
  search(query: $query, patternType: $patternType) {
    results {
      results {
        __typename
        ... on FileMatch {
          repository { name stars }
          file { path url canonicalURL }
          lineMatches { lineNumber preview }
        }
      }
      limitHit
    }
  }
}
`

interface FileMatch {
  __typename: 'FileMatch'
  repository: { name: string; stars: number }
  file: { path: string; url: string; canonicalURL: string }
  lineMatches: Array<{ lineNumber: number; preview: string }>
}

interface GqlResponse {
  data: {
    search: {
      results: {
        results: Array<{ __typename: string } & Partial<FileMatch>>
        limitHit: boolean
      }
    }
  }
}

export class SourcegraphProvider implements Provider {
  readonly name: ProviderName = 'sourcegraph'
  readonly capabilities: ProviderCapabilities = {
    regex: true,
    structural: true,
    symbolSearch: true,
    rateLimit: { requests: 100, windowMs: 60_000 },
  }

  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const sgQuery = buildQuery(query)
    const patternType = query.filters.regex ? 'regexp' : 'literal'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) headers['Authorization'] = `token ${this.token}`

    let res: GqlResponse
    try {
      res = await got.post(`${this.baseUrl}/.api/graphql`, {
        headers,
        json: { query: QUERY, variables: { query: sgQuery, patternType } },
        responseType: 'json',
        timeout: { request: 10_000 },
      }).json<GqlResponse>()
    } catch (err) {
      throw toProviderError(err)
    }

    return res.data.search.results.results
      .filter((r): r is FileMatch => r.__typename === 'FileMatch')
      .slice(0, query.limit)
      .map((r) => normalize(r, this.baseUrl))
  }

  async validate(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (this.token) headers['Authorization'] = `token ${this.token}`
      await got.get(`${this.baseUrl}/.api/graphql`, { headers, timeout: { request: 5_000 } })
      return true
    } catch {
      return false
    }
  }
}

function buildQuery(query: SearchQuery): string {
  const parts = [query.q]
  const f = query.filters
  if (f.language) parts.push(`lang:${f.language}`)
  if (f.repo) parts.push(`repo:${f.repo}`)
  if (f.org) parts.push(`repo:${f.org}/`)
  if (f.path) parts.push(`file:${f.path}`)
  if (f.filename) parts.push(`file:${f.filename}`)
  return parts.join(' ')
}

function normalize(r: FileMatch, baseUrl: string): SearchResult {
  const firstMatch = r.lineMatches[0]
  const lastMatch = r.lineMatches[r.lineMatches.length - 1] ?? firstMatch
  const snippet = r.lineMatches.map((m) => m.preview).join('\n')

  // Strip "github.com/" prefix from repo name
  const repo = r.repository.name.replace(/^github\.com\//, '')
  const rawUrl = `https://raw.githubusercontent.com/${repo}/HEAD/${r.file.path}`
  const url = `${baseUrl}${r.file.canonicalURL}`

  return {
    url,
    rawUrl,
    repo,
    path: r.file.path,
    lines: [firstMatch?.lineNumber ?? 1, lastMatch?.lineNumber ?? 1],
    snippet,
    language: r.file.path.split('.').pop() ?? 'unknown',
    stars: r.repository.stars,
    provider: 'sourcegraph',
    score: 0.8,
  }
}

function toProviderError(err: unknown): Error & { code: string; provider: ProviderName } {
  const base = { provider: 'sourcegraph' as ProviderName }
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response: { statusCode: number } }).response.statusCode
    if (status === 401 || status === 403) return Object.assign(new Error('Auth failed'), { code: 'AUTH', ...base })
    if (status === 429) return Object.assign(new Error('Rate limited'), { code: 'RATE_LIMIT', ...base })
  }
  return Object.assign(new Error(String(err)), { code: 'UNKNOWN', ...base })
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/providers/sourcegraph.test.ts
```

Expected: PASS, 2 tests.

**Step 5: Commit**

```bash
git add src/providers/sourcegraph.ts tests/providers/sourcegraph.test.ts
git commit -m "feat(providers): Sourcegraph GraphQL adapter — regex, structural search"
```

---

## Task 8: Result aggregator and engine

**Files:**
- Create: `src/core/engine.ts`
- Create: `tests/core/engine.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/core/engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchEngine } from '../../src/core/engine.js'
import type { Provider } from '../../src/providers/base.js'
import type { SearchResult, SearchQuery } from '../../src/core/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteCacheRepository } from '../../src/cache/sqlite.js'
import { SqliteMetrics } from '../../src/core/metrics.js'

function makeResult(url: string, stars = 100): SearchResult {
  return { url, rawUrl: url, repo: 'owner/repo', path: 'file.ts', lines: [1, 3], snippet: 'code', language: 'ts', stars, provider: 'github', score: 0.9 }
}

function makeProvider(name: 'github' | 'sourcegraph', results: SearchResult[]): Provider {
  return {
    name,
    capabilities: { regex: false, structural: false, symbolSearch: false, rateLimit: { requests: 10, windowMs: 60000 } },
    search: vi.fn().mockResolvedValue(results),
    validate: vi.fn().mockResolvedValue(true),
  }
}

describe('SearchEngine', () => {
  let dir: string
  let cache: SqliteCacheRepository
  let metrics: SqliteMetrics

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engine-test-'))
    cache = new SqliteCacheRepository(join(dir, 'cache.db'))
    metrics = new SqliteMetrics(join(dir, 'cache.db'))
  })

  afterEach(() => rmSync(dir, { recursive: true }))

  it('returns results from a single provider', async () => {
    const provider = makeProvider('github', [makeResult('https://github.com/a/b/1')])
    const engine = new SearchEngine({ github: provider }, cache, metrics, 3600)

    const res = await engine.search({ q: 'foo', providers: ['github'], filters: {}, limit: 10 })
    expect(res.results).toHaveLength(1)
    expect(res.cached).toBe(false)
  })

  it('deduplicates results from multiple providers by URL', async () => {
    const sharedUrl = 'https://github.com/a/b/shared'
    const p1 = makeProvider('github', [makeResult(sharedUrl)])
    const p2 = makeProvider('sourcegraph', [makeResult(sharedUrl)])
    const engine = new SearchEngine({ github: p1, sourcegraph: p2 }, cache, metrics, 3600)

    const res = await engine.search({ q: 'foo', providers: ['github', 'sourcegraph'], filters: {}, limit: 10 })
    expect(res.results.filter(r => r.url === sharedUrl)).toHaveLength(1)
  })

  it('returns cached result on second identical query', async () => {
    const provider = makeProvider('github', [makeResult('https://github.com/x')])
    const engine = new SearchEngine({ github: provider }, cache, metrics, 3600)
    const query: SearchQuery = { q: 'bar', providers: ['github'], filters: {}, limit: 5 }

    await engine.search(query)
    const res2 = await engine.search(query)

    expect(res2.cached).toBe(true)
    expect(provider.search).toHaveBeenCalledTimes(1)  // not called again
  })

  it('partial failure: one provider fails, other succeeds', async () => {
    const good = makeProvider('github', [makeResult('https://github.com/ok')])
    const bad: Provider = { ...makeProvider('sourcegraph', []), search: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'TIMEOUT', provider: 'sourcegraph' })) }
    const engine = new SearchEngine({ github: good, sourcegraph: bad }, cache, metrics, 3600)

    const res = await engine.search({ q: 'foo', providers: ['github', 'sourcegraph'], filters: {}, limit: 10 })
    expect(res.results).toHaveLength(1)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].provider).toBe('sourcegraph')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/core/engine.test.ts
```

Expected: FAIL.

**Step 3: Implement `src/core/engine.ts`**

```typescript
// src/core/engine.ts
import { createHash } from 'node:crypto'
import type { Provider } from '../providers/base.js'
import type { CacheRepository } from '../cache/sqlite.js'
import type { SqliteMetrics } from './metrics.js'
import type { SearchQuery, SearchResponse, SearchResult, ProviderName, ProviderError } from './types.js'
import { normalizeQuery, isProviderError } from './types.js'
import { getLogger } from './logger.js'

export class SearchEngine {
  constructor(
    private readonly providers: Partial<Record<ProviderName, Provider>>,
    private readonly cache: CacheRepository,
    private readonly metrics: SqliteMetrics,
    private readonly defaultTTL: number,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const log = getLogger()
    const normalized = normalizeQuery(query)
    const key = hashQuery(normalized)
    const t0 = Date.now()

    // 1. Cache check
    const cached = await this.cache.get(key).catch(() => null)
    if (cached) {
      log.debug({ key }, 'cache HIT')
      await this.metrics.record({ provider: normalized.providers[0], query: normalized.q, cacheHit: true, results: cached.results.length, elapsedMs: 0 })
      return { ...cached, cached: true }
    }
    log.debug({ key }, 'cache MISS')

    // 2. Resolve providers
    const activeProviders = normalized.providers
      .map((name) => this.providers[name])
      .filter((p): p is Provider => p !== undefined)

    log.info({ q: normalized.q, providers: normalized.providers }, 'search request')

    // 3. Fan-out (parallel, fault-tolerant)
    const settlements = await Promise.allSettled(
      activeProviders.map((p) => p.search(normalized))
    )

    // 4. Collect results + errors
    const results: SearchResult[] = []
    const errors: ProviderError[] = []

    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i]
      const provider = activeProviders[i]
      if (s.status === 'fulfilled') {
        results.push(...s.value)
        const elapsed = Date.now() - t0
        log.info({ provider: provider.name, count: s.value.length, elapsed_ms: elapsed }, 'provider response')
        await this.metrics.record({ provider: provider.name, query: normalized.q, cacheHit: false, results: s.value.length, elapsedMs: elapsed }).catch(() => {})
      } else {
        const err = s.reason
        const provErr: ProviderError = isProviderError(err)
          ? err as unknown as ProviderError
          : { provider: provider.name, message: String(err), code: 'UNKNOWN' }
        errors.push(provErr)
        log.warn({ provider: provider.name, error: provErr.message }, 'provider error')
        await this.metrics.record({ provider: provider.name, query: normalized.q, cacheHit: false, error: provErr.message }).catch(() => {})
      }
    }

    // 5. Aggregate
    const merged = aggregate(results, normalized.limit)
    const elapsed_ms = Date.now() - t0

    const response: SearchResponse = {
      query: normalized,
      results: merged,
      total: merged.length,
      cached: false,
      elapsed_ms,
      errors,
    }

    // 6. Cache
    await this.cache.set(key, response, query.cacheTTL ?? this.defaultTTL).catch(() => {})

    return response
  }
}

function hashQuery(query: SearchQuery): string {
  return createHash('sha256').update(JSON.stringify(query)).digest('hex')
}

function aggregate(results: SearchResult[], limit: number): SearchResult[] {
  // Deduplicate by URL
  const seen = new Set<string>()
  const unique = results.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })

  // Re-rank: score × log(stars + 1), normalized
  const ranked = unique
    .map((r) => ({ ...r, _rank: r.score * Math.log(r.stars + 1) }))
    .sort((a, b) => b._rank - a._rank)

  return ranked.slice(0, limit).map(({ _rank, ...r }) => r)
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/core/engine.test.ts
```

Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add src/core/engine.ts tests/core/engine.test.ts
git commit -m "feat(core): SearchEngine — fan-out, dedup, re-rank, cache, partial failure"
```

---

## Task 9: Result formatters

**Files:**
- Create: `src/results/base.ts`
- Create: `src/results/json.ts`
- Create: `src/results/markdown.ts`
- Create: `tests/results/formatters.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/results/formatters.test.ts
import { describe, it, expect } from 'vitest'
import { JsonFormatter } from '../../src/results/json.js'
import { MarkdownFormatter } from '../../src/results/markdown.js'
import type { SearchResponse } from '../../src/core/types.js'

const response: SearchResponse = {
  query: { q: 'nftables', providers: ['github'], filters: {}, limit: 10 },
  results: [
    { url: 'https://github.com/a/b/blob/main/file.conf#L1-L3', rawUrl: 'https://raw.githubusercontent.com/a/b/HEAD/file.conf', repo: 'a/b', path: 'file.conf', lines: [1, 3], snippet: 'limit rate 4/minute', language: 'conf', stars: 500, provider: 'github', score: 0.9 },
  ],
  total: 1,
  cached: false,
  elapsed_ms: 200,
  errors: [],
}

describe('JsonFormatter', () => {
  it('produces valid JSON with all fields', () => {
    const out = new JsonFormatter().format(response)
    const parsed = JSON.parse(out)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0].url).toBeTruthy()
    expect(parsed.elapsed_ms).toBe(200)
  })
})

describe('MarkdownFormatter', () => {
  it('produces a markdown table with header and rows', () => {
    const out = new MarkdownFormatter().format(response)
    expect(out).toContain('| Repo |')
    expect(out).toContain('a/b')
    expect(out).toContain('https://github.com')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/results/formatters.test.ts
```

Expected: FAIL.

**Step 3: Create `src/results/base.ts`**

```typescript
// src/results/base.ts
import type { SearchResponse } from '../core/types.js'

export interface ResultFormatter {
  format(response: SearchResponse): string
}
```

**Step 4: Create `src/results/json.ts`**

```typescript
// src/results/json.ts
import type { ResultFormatter } from './base.js'
import type { SearchResponse } from '../core/types.js'

export class JsonFormatter implements ResultFormatter {
  format(response: SearchResponse): string {
    return JSON.stringify(response, null, 2)
  }
}
```

**Step 5: Create `src/results/markdown.ts`**

```typescript
// src/results/markdown.ts
import type { ResultFormatter } from './base.js'
import type { SearchResponse } from '../core/types.js'

export class MarkdownFormatter implements ResultFormatter {
  format(response: SearchResponse): string {
    const lines: string[] = [
      `## Search results for \`${response.query.q}\``,
      `> ${response.total} result(s) — ${response.elapsed_ms}ms${response.cached ? ' (cached)' : ''}`,
      '',
      '| Repo | Path | Lines | Stars | Provider | Snippet |',
      '|---|---|---|---|---|---|',
    ]

    for (const r of response.results) {
      const snippet = r.snippet.split('\n')[0].slice(0, 60).replace(/\|/g, '\\|')
      lines.push(`| [${r.repo}](${r.url}) | \`${r.path}\` | ${r.lines[0]}–${r.lines[1]} | ${r.stars} | ${r.provider} | \`${snippet}\` |`)
    }

    if (response.errors.length > 0) {
      lines.push('', '### Errors', '')
      for (const e of response.errors) {
        lines.push(`- **${e.provider}** (${e.code}): ${e.message}`)
      }
    }

    return lines.join('\n')
  }
}
```

**Step 6: Run test to verify it passes**

```bash
npx vitest run tests/results/formatters.test.ts
```

Expected: PASS, 2 tests.

**Step 7: Commit**

```bash
git add src/results/ tests/results/formatters.test.ts
git commit -m "feat(results): JSON + Markdown formatters — Strategy pattern"
```

---

## Task 10: CLI

**Files:**
- Create: `src/cli/index.ts`
- Create: `tests/cli/cli.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli/cli.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildCli } from '../../src/cli/index.js'

describe('CLI', () => {
  it('search command exits 0 and writes JSON to stdout', async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      query: { q: 'foo', providers: ['github'], filters: {}, limit: 10 },
      results: [],
      total: 0,
      cached: false,
      elapsed_ms: 50,
      errors: [],
    })
    const write = vi.fn()

    const program = buildCli({ search: mockSearch, write })
    await program.parseAsync(['node', 'codesearch', 'search', 'foo', '--no-cache'], { from: 'user' })

    expect(mockSearch).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledOnce()
    const output = JSON.parse(write.mock.calls[0][0])
    expect(output.query.q).toBe('foo')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/cli.test.ts
```

Expected: FAIL.

**Step 3: Implement `src/cli/index.ts`**

```typescript
// src/cli/index.ts
import { Command } from 'commander'
import { loadConfig } from '../core/config.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from '../core/metrics.js'
import { SearchEngine } from '../core/engine.js'
import { GitHubProvider } from '../providers/github.js'
import { SourcegraphProvider } from '../providers/sourcegraph.js'
import { JsonFormatter } from '../results/json.js'
import { MarkdownFormatter } from '../results/markdown.js'
import type { SearchQuery } from '../core/types.js'

interface CliDeps {
  search?: (q: SearchQuery) => Promise<unknown>
  write?: (s: string) => void
}

export function buildCli(deps: CliDeps = {}): Command {
  const program = new Command()
  program.name('codesearch').description('Search GitHub code for agents and subagents').version('0.1.0')

  program
    .command('search <query>')
    .description('Search for code examples')
    .option('-p, --provider <name>', 'provider to use (repeatable)', collect, [])
    .option('-l, --lang <lang>', 'filter by language')
    .option('-r, --repo <repo>', 'filter by repo (owner/repo)')
    .option('--org <org>', 'filter by org')
    .option('--path <path>', 'filter by file path')
    .option('--limit <n>', 'max results', '20')
    .option('--output <fmt>', 'output format: json | markdown', 'json')
    .option('--no-cache', 'skip cache for this query')
    .action(async (q: string, opts: Record<string, unknown>) => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))

      const query: SearchQuery = {
        q,
        providers: (opts.provider as string[]).length > 0
          ? (opts.provider as string[]) as SearchQuery['providers']
          : ['github'],
        filters: {
          language: opts.lang as string | undefined,
          repo: opts.repo as string | undefined,
          org: opts.org as string | undefined,
          path: opts.path as string | undefined,
          regex: false,
        },
        limit: Number(opts.limit),
        cacheTTL: opts.cache === false ? 0 : undefined,
      }

      if (deps.search) {
        const result = await deps.search(query)
        write(JSON.stringify(result, null, 2))
        return
      }

      const engine = buildEngine()
      const response = await engine.search(query)
      const formatter = opts.output === 'markdown' ? new MarkdownFormatter() : new JsonFormatter()
      write(formatter.format(response))
    })

  program
    .command('validate')
    .description('Check provider tokens and connectivity')
    .action(async () => {
      const cfg = loadConfig()
      const results: Record<string, boolean> = {}
      if (cfg.githubToken) {
        const p = new GitHubProvider(cfg.githubToken)
        results.github = await p.validate()
      }
      const sg = new SourcegraphProvider(cfg.sourcegraphUrl, cfg.sourcegraphToken)
      results.sourcegraph = await sg.validate()
      process.stdout.write(JSON.stringify(results, null, 2) + '\n')
    })

  const cacheCmd = program.command('cache').description('Manage cache')

  cacheCmd
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      const cfg = loadConfig()
      const repo = new SqliteCacheRepository(cfg.cachePath)
      const stats = await repo.stats()
      process.stdout.write(JSON.stringify(stats, null, 2) + '\n')
    })

  cacheCmd
    .command('clear')
    .description('Clear cache entries')
    .option('--pattern <glob>', 'SQL LIKE pattern to filter keys')
    .action(async (opts: { pattern?: string }) => {
      const cfg = loadConfig()
      const repo = new SqliteCacheRepository(cfg.cachePath)
      const deleted = await repo.clear(opts.pattern)
      process.stdout.write(JSON.stringify({ deleted }, null, 2) + '\n')
    })

  program
    .command('stats')
    .description('Show request metrics')
    .option('--since <hours>', 'hours to look back', '24')
    .action(async (opts: { since: string }) => {
      const cfg = loadConfig()
      const metrics = new SqliteMetrics(cfg.cachePath)
      const stats = await metrics.stats(Number(opts.since) * 3600)
      const formatted = stats.map((s) => ({
        ...s,
        cacheHitRate: `${(s.cacheHitRate * 100).toFixed(0)}%`,
        p50: `${s.p50}ms`,
        p95: `${s.p95}ms`,
        p99: `${s.p99}ms`,
      }))
      process.stdout.write(JSON.stringify(formatted, null, 2) + '\n')
    })

  program
    .command('mcp-serve')
    .description('Start MCP server (stdio transport)')
    .action(async () => {
      const { startMcpServer } = await import('../mcp/server.js')
      await startMcpServer()
    })

  return program
}

function buildEngine(): SearchEngine {
  const cfg = loadConfig()
  const providers: Parameters<typeof SearchEngine>[0] = {}
  if (cfg.githubToken) providers.github = new GitHubProvider(cfg.githubToken)
  providers.sourcegraph = new SourcegraphProvider(cfg.sourcegraphUrl, cfg.sourcegraphToken)
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  return new SearchEngine(providers, cache, metrics, cfg.defaultCacheTTL)
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val]
}

// Entrypoint
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  const program = buildCli()
  program.parseAsync(process.argv).catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1) })
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/cli.test.ts
```

Expected: PASS, 1 test.

**Step 5: Commit**

```bash
git add src/cli/index.ts tests/cli/cli.test.ts
git commit -m "feat(cli): Commander — search, validate, cache, stats, mcp-serve commands"
```

---

## Task 11: MCP server

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/mcp/handlers.ts`
- Create: `src/mcp/server.ts`

No unit tests here — MCP server relies on stdio transport. Tested via `mcp-serve` integration below.

**Step 1: Create `src/mcp/tools.ts`**

```typescript
// src/mcp/tools.ts
import { z } from 'zod'

export const SearchCodeInput = z.object({
  q: z.string().describe('Search query'),
  providers: z.array(z.enum(['github', 'sourcegraph'])).optional().describe('Providers to search (default: github)'),
  language: z.string().optional().describe('Filter by programming language'),
  repo: z.string().optional().describe('Filter by repo (owner/repo)'),
  org: z.string().optional().describe('Filter by organization'),
  path: z.string().optional().describe('Filter by file path'),
  regex: z.boolean().optional().describe('Use regex matching (Sourcegraph only)'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results (default: 20)'),
})

export const FetchFileInput = z.object({
  url: z.string().url().describe('Raw file URL from a search result (use rawUrl field)'),
})

export const CacheClearInput = z.object({
  pattern: z.string().optional().describe('SQL LIKE pattern to filter cache keys'),
})

export const tools = [
  {
    name: 'search_code',
    description:
      'Search GitHub and Sourcegraph for code examples. Returns URLs with snippets. Use rawUrl to fetch full file content.',
    inputSchema: SearchCodeInput,
  },
  {
    name: 'fetch_file',
    description: 'Fetch the raw content of a file from a URL returned by search_code.',
    inputSchema: FetchFileInput,
  },
  {
    name: 'cache_stats',
    description: 'Return cache and metrics statistics (request counts, P50/P95/P99, cache hit rates).',
    inputSchema: z.object({}),
  },
  {
    name: 'cache_clear',
    description: 'Clear cache entries, optionally filtered by a SQL LIKE pattern.',
    inputSchema: CacheClearInput,
  },
]
```

**Step 2: Create `src/mcp/handlers.ts`**

```typescript
// src/mcp/handlers.ts
import got from 'got'
import { loadConfig } from '../core/config.js'
import { SearchEngine } from '../core/engine.js'
import { GitHubProvider } from '../providers/github.js'
import { SourcegraphProvider } from '../providers/sourcegraph.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from '../core/metrics.js'
import type { SearchCodeInput, FetchFileInput, CacheClearInput } from './tools.js'
import type { z } from 'zod'

function buildEngine(cfg: ReturnType<typeof loadConfig>): SearchEngine {
  const providers: Parameters<typeof SearchEngine>[0] = {}
  if (cfg.githubToken) providers.github = new GitHubProvider(cfg.githubToken)
  providers.sourcegraph = new SourcegraphProvider(cfg.sourcegraphUrl, cfg.sourcegraphToken)
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  return new SearchEngine(providers, cache, metrics, cfg.defaultCacheTTL)
}

let _engine: SearchEngine | undefined
function getEngine(): SearchEngine {
  if (!_engine) _engine = buildEngine(loadConfig())
  return _engine
}

export async function handleSearchCode(input: z.infer<typeof SearchCodeInput>): Promise<string> {
  const engine = getEngine()
  const response = await engine.search({
    q: input.q,
    providers: input.providers ?? ['github'],
    filters: {
      language: input.language,
      repo: input.repo,
      org: input.org,
      path: input.path,
      regex: input.regex,
    },
    limit: input.limit ?? 20,
  })
  return JSON.stringify(response, null, 2)
}

export async function handleFetchFile(input: z.infer<typeof FetchFileInput>): Promise<string> {
  const content = await got.get(input.url, { timeout: { request: 10_000 } }).text()
  return content
}

export async function handleCacheStats(): Promise<string> {
  const cfg = loadConfig()
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  const [cacheStats, metricStats] = await Promise.all([cache.stats(), metrics.stats()])
  return JSON.stringify({ cache: cacheStats, metrics: metricStats }, null, 2)
}

export async function handleCacheClear(input: z.infer<typeof CacheClearInput>): Promise<string> {
  const cfg = loadConfig()
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const deleted = await cache.clear(input.pattern)
  return JSON.stringify({ deleted })
}
```

**Step 3: Create `src/mcp/server.ts`**

```typescript
// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, SearchCodeInput, FetchFileInput, CacheClearInput } from './tools.js'
import { handleSearchCode, handleFetchFile, handleCacheStats, handleCacheClear } from './handlers.js'
import { getLogger } from '../core/logger.js'
import { zodToJsonSchema } from 'zod-to-json-schema'

export async function startMcpServer(): Promise<void> {
  const log = getLogger()
  const server = new Server(
    { name: 'codesearch', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    log.info({ tool: name }, 'MCP tool call')

    try {
      let result: string
      switch (name) {
        case 'search_code':
          result = await handleSearchCode(SearchCodeInput.parse(args))
          break
        case 'fetch_file':
          result = await handleFetchFile(FetchFileInput.parse(args))
          break
        case 'cache_stats':
          result = await handleCacheStats()
          break
        case 'cache_clear':
          result = await handleCacheClear(CacheClearInput.parse(args))
          break
        default:
          throw new Error(`Unknown tool: ${name}`)
      }
      return { content: [{ type: 'text', text: result }] }
    } catch (err) {
      log.error({ tool: name, error: String(err) }, 'tool error')
      return {
        content: [{ type: 'text', text: `Error: ${String(err)}` }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.info('MCP server running on stdio')
}
```

**Step 4: Install missing dep**

```bash
npm install zod-to-json-schema
```

**Step 5: Commit**

```bash
git add src/mcp/
git commit -m "feat(mcp): MCP server — tools, handlers, stdio transport"
```

---

## Task 12: Telemetry (no-op)

**Files:**
- Create: `src/core/telemetry.ts`

```typescript
// src/core/telemetry.ts
// OpenTelemetry tracing — no-op by default.
// Enable by setting OTEL_EXPORTER_OTLP_ENDPOINT.
// When enabled, install: @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node

export function initTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return
  // Dynamic import to avoid loading OTEL when not needed
  // import('@opentelemetry/sdk-node').then(({ NodeSDK }) => { ... })
}
```

```bash
git add src/core/telemetry.ts
git commit -m "feat(core): telemetry — no-op stub, OTEL-ready"
```

---

## Task 13: Build and smoke test

**Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests PASS.

**Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

**Step 3: Build**

```bash
npm run build
```

Expected: `dist/cli/index.js` and `dist/mcp/server.js` created.

**Step 4: Smoke test CLI (requires GITHUB_TOKEN)**

```bash
export GITHUB_TOKEN=ghp_your_token
node dist/cli/index.js search "nftables limit rate" --lang nix --limit 5
```

Expected: JSON output with `results` array, each entry with `url`, `snippet`, `repo`.

**Step 5: Smoke test MCP via stdin**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  node dist/mcp/server.js
```

Expected: JSON response listing `search_code`, `fetch_file`, `cache_stats`, `cache_clear`.

**Step 6: Final commit**

```bash
git add -A
git commit -m "build: production build verified, all tests passing"
```

---

## Summary

| Task | Files | Tests |
|---|---|---|
| 0: Scaffold | package.json, tsconfig, tsup, vitest | — |
| 1: Types + errors | core/types.ts, core/errors.ts | ✓ |
| 2: Config | core/config.ts | ✓ |
| 3: Logger | core/logger.ts | ✓ |
| 4: Cache | cache/sqlite.ts | ✓ |
| 5: Metrics | core/metrics.ts | ✓ |
| 6: GitHub provider | providers/base.ts, providers/github.ts | ✓ |
| 7: Sourcegraph provider | providers/sourcegraph.ts | ✓ |
| 8: Engine | core/engine.ts | ✓ |
| 9: Formatters | results/base.ts, results/json.ts, results/markdown.ts | ✓ |
| 10: CLI | cli/index.ts | ✓ |
| 11: MCP | mcp/tools.ts, mcp/handlers.ts, mcp/server.ts | smoke test |
| 12: Telemetry | core/telemetry.ts | — |
| 13: Build | — | smoke test |
