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
  snippet: string           // matched code +/-3 lines
  language: string
  stars: number
  provider: ProviderName
  score: number             // normalized 0-1
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
