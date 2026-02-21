import { describe, it, expect } from 'vitest'
import { isProviderError, normalizeQuery } from '../../src/core/types.js'

describe('normalizeQuery', () => {
  it('sorts providers and filters for deterministic cache keys', () => {
    const q1 = normalizeQuery({ q: 'foo', providers: ['sourcegraph', 'github'], filters: {}, limit: 10 })
    const q2 = normalizeQuery({ q: 'foo', providers: ['github', 'sourcegraph'], filters: {}, limit: 10 })
    expect(JSON.stringify(q1)).toBe(JSON.stringify(q2))
  })

  it('strips undefined filters', () => {
    const q = normalizeQuery({ q: 'foo', providers: ['github'], filters: { language: undefined }, limit: 10 })
    expect(q.filters).not.toHaveProperty('language')
  })
})

describe('isProviderError', () => {
  it('returns true for valid ProviderError', () => {
    expect(isProviderError({ provider: 'github', message: 'fail', code: 'TIMEOUT' })).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isProviderError(new Error('fail'))).toBe(false)
  })
})
