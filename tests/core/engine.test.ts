// tests/core/engine.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SearchEngine } from '../../src/core/engine.js'
import type { Provider } from '../../src/providers/base.js'
import type { SearchResult, SearchQuery } from '../../src/core/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteCacheRepository } from '../../src/cache/sqlite.js'
import { SqliteMetrics } from '../../src/core/metrics.js'

function makeResult(url: string, stars = 100): SearchResult {
  return {
    url, rawUrl: url, repo: 'owner/repo', path: 'file.ts',
    lines: [1, 3], snippet: 'code', language: 'ts',
    stars, provider: 'github', score: 0.9,
  }
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

  afterEach(() => {
    cache.close()
    metrics.close()
    rmSync(dir, { recursive: true })
  })

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
    expect(provider.search).toHaveBeenCalledTimes(1)
  })

  it('partial failure: one provider fails, other succeeds', async () => {
    const good = makeProvider('github', [makeResult('https://github.com/ok')])
    const bad: Provider = {
      ...makeProvider('sourcegraph', []),
      search: vi.fn().mockRejectedValue(
        Object.assign(new Error('timeout'), { code: 'TIMEOUT', provider: 'sourcegraph' })
      ),
    }
    const engine = new SearchEngine({ github: good, sourcegraph: bad }, cache, metrics, 3600)
    const res = await engine.search({ q: 'foo', providers: ['github', 'sourcegraph'], filters: {}, limit: 10 })
    expect(res.results).toHaveLength(1)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.provider).toBe('sourcegraph')
  })

  it('re-ranks results by score * log(stars + 1)', async () => {
    const lowStars = makeResult('https://github.com/low', 10)
    const highStars = makeResult('https://github.com/high', 10000)
    const provider = makeProvider('github', [lowStars, highStars])
    const engine = new SearchEngine({ github: provider }, cache, metrics, 3600)
    const res = await engine.search({ q: 'foo', providers: ['github'], filters: {}, limit: 10 })
    expect(res.results[0]!.url).toBe('https://github.com/high')
  })
})
