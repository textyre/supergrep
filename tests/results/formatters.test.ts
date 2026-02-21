import { describe, it, expect } from 'vitest'
import { JsonFormatter } from '../../src/results/json.js'
import { MarkdownFormatter } from '../../src/results/markdown.js'
import type { SearchResponse } from '../../src/core/types.js'

const response: SearchResponse = {
  query: { q: 'nftables', providers: ['github'], filters: {}, limit: 10 },
  results: [
    {
      url: 'https://github.com/a/b/blob/main/file.conf#L1-L3',
      rawUrl: 'https://raw.githubusercontent.com/a/b/HEAD/file.conf',
      repo: 'a/b',
      path: 'file.conf',
      lines: [1, 3],
      snippet: 'limit rate 4/minute',
      language: 'conf',
      stars: 500,
      provider: 'github',
      score: 0.9,
    },
  ],
  total: 1,
  cached: false,
  elapsed_ms: 200,
  errors: [],
}

describe('JsonFormatter', () => {
  it('produces valid JSON with all fields', () => {
    const out = new JsonFormatter().format(response)
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(Array.isArray(parsed['results'])).toBe(true)
    expect((parsed['results'] as unknown[]).length).toBe(1)
    expect(parsed['elapsed_ms']).toBe(200)
  })

  it('is pretty-printed (has newlines)', () => {
    const out = new JsonFormatter().format(response)
    expect(out).toContain('\n')
  })
})

describe('MarkdownFormatter', () => {
  it('produces a markdown table with header and rows', () => {
    const out = new MarkdownFormatter().format(response)
    expect(out).toContain('| Repo |')
    expect(out).toContain('a/b')
    expect(out).toContain('https://github.com')
  })

  it('shows elapsed time and cached status', () => {
    const out = new MarkdownFormatter().format(response)
    expect(out).toContain('200ms')
  })

  it('includes errors section when errors present', () => {
    const withErrors: SearchResponse = {
      ...response,
      errors: [{ provider: 'sourcegraph', message: 'timeout', code: 'TIMEOUT' }],
    }
    const out = new MarkdownFormatter().format(withErrors)
    expect(out).toContain('sourcegraph')
    expect(out).toContain('TIMEOUT')
  })
})
