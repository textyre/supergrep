// src/mcp/handlers.ts
import got from 'got'
import { loadConfig } from '../core/config.js'
import { SearchEngine } from '../core/engine.js'
import { GitHubProvider } from '../providers/github.js'
import { SourcegraphProvider } from '../providers/sourcegraph.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from '../core/metrics.js'
import type { z } from 'zod'
import type { Provider } from '../providers/base.js'
import type { ProviderName } from '../core/types.js'
import type { SearchCodeInput, FetchFileInput, CacheClearInput } from './tools.js'

function buildEngine(): SearchEngine {
  const cfg = loadConfig()
  const providers: Partial<Record<ProviderName, Provider>> = {}
  if (cfg.githubToken) providers['github'] = new GitHubProvider(cfg.githubToken)
  providers['sourcegraph'] = new SourcegraphProvider(cfg.sourcegraphUrl, cfg.sourcegraphToken)
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  return new SearchEngine(providers, cache, metrics, cfg.defaultCacheTTL)
}

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
  const [cacheStats, metricStats] = await Promise.all([cache.stats(), metrics.stats()])
  cache.close()
  metrics.close()
  return JSON.stringify({ cache: cacheStats, metrics: metricStats }, null, 2)
}

export async function handleCacheClear(
  input: z.infer<typeof CacheClearInput>,
): Promise<string> {
  const cfg = loadConfig()
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const deleted = await cache.clear(input.pattern)
  cache.close()
  return JSON.stringify({ deleted })
}
