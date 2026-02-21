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
    metrics = new SqliteMetrics(join(dir, 'metrics.db'))
  })

  afterEach(() => {
    metrics.close()
    rmSync(dir, { recursive: true })
  })

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
    const g = stats.find(s => s.provider === 'github')
    expect(g).toBeDefined()
    expect(g!.requests).toBe(10)
    expect(g!.p50).toBeGreaterThan(0)
    expect(g!.p95).toBeGreaterThanOrEqual(g!.p50)
    expect(g!.p99).toBeGreaterThanOrEqual(g!.p95)
  })
})
