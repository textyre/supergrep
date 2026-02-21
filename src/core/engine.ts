// src/core/engine.ts
import { createHash } from 'node:crypto'
import type { Provider } from '../providers/base.js'
import type { CacheRepository } from '../cache/sqlite.js'
import type { SqliteMetrics } from './metrics.js'
import type { SearchQuery, SearchResponse, SearchResult, ProviderName, ProviderError } from './types.js'
import { normalizeQuery, isProviderError } from './types.js'
import { createLogger } from './logger.js'

const log = createLogger({ level: process.env['LOG_LEVEL'] ?? 'info' })

export class SearchEngine {
  constructor(
    private readonly providers: Partial<Record<ProviderName, Provider>>,
    private readonly cache: CacheRepository,
    private readonly metrics: SqliteMetrics,
    private readonly defaultTTL: number,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const normalized = normalizeQuery(query)
    const key = hashQuery(normalized)
    const t0 = Date.now()

    // 1. Cache check
    const cached = await this.cache.get(key).catch(() => null)
    if (cached) {
      log.debug({ key }, 'cache HIT')
      const firstProvider = normalized.providers[0]
      if (firstProvider) {
        await this.metrics
          .record({ provider: firstProvider, query: normalized.q, cacheHit: true, results: cached.results.length, elapsedMs: 0 })
          .catch(() => {})
      }
      return { ...cached, cached: true, elapsed_ms: Date.now() - t0, search_elapsed_ms: cached.elapsed_ms }
    }
    log.debug({ key }, 'cache MISS')

    // 2. Resolve active providers
    const activeProviders = normalized.providers
      .map((name) => this.providers[name])
      .filter((p): p is Provider => p !== undefined)

    log.info({ q: normalized.q, providers: normalized.providers }, 'search request')

    // 3. Fan-out in parallel (fault-tolerant)
    const settlements = await Promise.allSettled(
      activeProviders.map((p) => p.search(normalized)),
    )

    // 4. Collect results + errors
    const results: SearchResult[] = []
    const errors: ProviderError[] = []

    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i]!
      const provider = activeProviders[i]!
      const elapsed = Date.now() - t0

      if (s.status === 'fulfilled') {
        results.push(...s.value)
        log.info({ provider: provider.name, count: s.value.length, elapsed_ms: elapsed }, 'provider response')
        await this.metrics
          .record({ provider: provider.name, query: normalized.q, cacheHit: false, results: s.value.length, elapsedMs: elapsed })
          .catch(() => {})
      } else {
        const err = s.reason as unknown
        const provErr: ProviderError = isProviderError(err)
          ? (err as ProviderError)
          : { provider: provider.name, message: String(err), code: 'UNKNOWN' }
        errors.push(provErr)
        log.warn({ provider: provider.name, error: provErr.message }, 'provider error')
        await this.metrics
          .record({ provider: provider.name, query: normalized.q, cacheHit: false, error: provErr.message })
          .catch(() => {})
      }
    }

    // 5. Aggregate: deduplicate + re-rank + limit
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

    // 6. Store in cache
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

  // Re-rank: score * log(stars + 1)
  const ranked = unique
    .map((r) => ({ ...r, _rank: r.score * Math.log(r.stars + 1) }))
    .sort((a, b) => b._rank - a._rank)

  return ranked.slice(0, limit).map(({ _rank: _, ...r }) => r)
}
