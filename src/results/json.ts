// src/results/json.ts
import type { ResultFormatter } from './base.js'
import type { SearchResponse } from '../core/types.js'

export class JsonFormatter implements ResultFormatter {
  format(response: SearchResponse): string {
    return JSON.stringify(response, null, 2)
  }
}
