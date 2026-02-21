// src/results/base.ts
import type { SearchResponse } from '../core/types.js'

export interface ResultFormatter {
  format(response: SearchResponse): string
}
