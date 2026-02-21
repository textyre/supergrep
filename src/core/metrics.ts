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

  close(): void {
    this.db.close()
  }

  async stats(sinceSec = 86400): Promise<ProviderStats[]> {
    const since = Math.floor(Date.now() / 1000) - sinceSec
    const rows = this.db
      .prepare(
        `SELECT provider,
                COUNT(*) as requests,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
                SUM(cache_hit) as hits,
                GROUP_CONCAT(elapsed_ms) as latencies
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
        ? r.latencies
            .split(',')
            .map(Number)
            .filter((n) => !isNaN(n))
            .sort((a, b) => a - b)
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
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0
}
