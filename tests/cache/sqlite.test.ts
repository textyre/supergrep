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

  afterEach(() => {
    repo.close()
    rmSync(dir, { recursive: true })
  })

  it('returns null for missing key', async () => {
    expect(await repo.get('missing')).toBeNull()
  })

  it('stores and retrieves a response', async () => {
    const r = makeResponse('hello')
    await repo.set('key1', r, 3600)
    const result = await repo.get('key1')
    expect(result?.query.q).toBe('hello')
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
