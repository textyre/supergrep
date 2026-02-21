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
