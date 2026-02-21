// tests/cli/cli.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildCli } from '../../src/cli/index.js'
import type { SearchQuery } from '../../src/core/types.js'

describe('CLI', () => {
  it('search command calls search and writes JSON to output', async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      query: { q: 'foo', providers: ['github'], filters: {}, limit: 10 },
      results: [],
      total: 0,
      cached: false,
      elapsed_ms: 50,
      errors: [],
    })
    const written: string[] = []
    const write = (s: string) => { written.push(s) }

    const program = buildCli({ search: mockSearch, write })
    await program.parseAsync(['search', 'foo'], { from: 'user' })

    expect(mockSearch).toHaveBeenCalledOnce()
    const call = mockSearch.mock.calls[0] as [SearchQuery]
    expect(call[0].q).toBe('foo')
    expect(written.length).toBeGreaterThan(0)
    const output = JSON.parse(written[0]!) as Record<string, unknown>
    expect(output['query']).toBeDefined()
  })

  it('search command passes --provider flag', async () => {
    const mockSearch = vi.fn().mockResolvedValue({
      query: { q: 'bar', providers: ['sourcegraph'], filters: {}, limit: 20 },
      results: [], total: 0, cached: false, elapsed_ms: 10, errors: [],
    })
    const program = buildCli({ search: mockSearch, write: () => {} })
    await program.parseAsync(
      ['search', 'bar', '--provider', 'sourcegraph'],
      { from: 'user' },
    )
    const call = mockSearch.mock.calls[0] as [SearchQuery]
    expect(call[0].providers).toContain('sourcegraph')
  })
})
