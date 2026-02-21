// src/core/engine-factory.ts
import { loadConfig } from './config.js'
import { SearchEngine } from './engine.js'
import { GitHubProvider } from '../providers/github.js'
import { SourcegraphProvider } from '../providers/sourcegraph.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from './metrics.js'
import type { ProviderName } from './types.js'
import type { Provider } from '../providers/base.js'

export function buildEngine(): SearchEngine {
  const cfg = loadConfig()
  const providers: Partial<Record<ProviderName, Provider>> = {}
  if (cfg.githubToken) providers['github'] = new GitHubProvider(cfg.githubToken)
  providers['sourcegraph'] = new SourcegraphProvider(cfg.sourcegraphUrl, cfg.sourcegraphToken)
  const cache = new SqliteCacheRepository(cfg.cachePath)
  const metrics = new SqliteMetrics(cfg.cachePath)
  return new SearchEngine(providers, cache, metrics, cfg.defaultCacheTTL)
}
