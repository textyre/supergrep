// src/mcp/handlers.ts
import got from 'got'
import { loadConfig } from '../core/config.js'
import { buildEngine } from '../core/engine-factory.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from '../core/metrics.js'
import type { SearchEngine } from '../core/engine.js'
import type { z } from 'zod'
import type { SearchCodeInput, FetchFileInput, CacheClearInput } from './tools.js'

// Lazy singleton -- one engine per MCP server process
let _engine: SearchEngine | undefined
function getEngine(): SearchEngine {
  if (!_engine) _engine = buildEngine()
  return _engine
}

export async function handleSearchCode(
  input: z.infer<typeof SearchCodeInput>,
): Promise<string> {
  const engine = getEngine()
  const response = await engine.search({
    q: input.q,
    providers: input.providers ?? ['github'],
    filters: {
      language: input.language,
      repo: input.repo,
      org: input.org,
      path: input.path,
      filename: input.filename,
      regex: input.regex,
    },
    limit: input.limit ?? 20,
  })
  return JSON.stringify(response, null, 2)
}

export async function handleFetchFile(
  input: z.infer<typeof FetchFileInput>,
): Promise<string> {
  return got.get(input.url, { retry: { limit: 0 }, timeout: { request: 10_000 } }).text()
}

export async function handleCacheStats(): Promise<string> {
  const cfg = loadConfig()
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  try {
    const [cacheStats, metricStats] = await Promise.all([cache.stats(), metrics.stats()])
    return JSON.stringify({ cache: cacheStats, metrics: metricStats }, null, 2)
  } finally {
    cache.close()
    metrics.close()
  }
}

export async function handleCacheClear(
  input: z.infer<typeof CacheClearInput>,
): Promise<string> {
  const cfg = loadConfig()
  const cache = new SqliteCacheRepository(cfg.cachePath)
  try {
    const deleted = await cache.clear(input.pattern)
    return JSON.stringify({ deleted })
  } finally {
    cache.close()
  }
}
