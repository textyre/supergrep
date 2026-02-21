// src/providers/sourcegraph.ts
import got from 'got'
import type { Provider, ProviderCapabilities } from './base.js'
import type { SearchQuery, SearchResult, ProviderName } from '../core/types.js'

const GQL_QUERY = `
query SearchCode($query: String!, $patternType: SearchPatternType!) {
  search(query: $query, patternType: $patternType) {
    results {
      results {
        __typename
        ... on FileMatch {
          repository { name stars }
          file { path url canonicalURL }
          lineMatches { lineNumber preview }
        }
      }
      limitHit
    }
  }
}
`

interface LineMatch {
  lineNumber: number
  preview: string
}

interface FileMatch {
  __typename: 'FileMatch'
  repository: { name: string; stars: number }
  file: { path: string; url: string; canonicalURL: string }
  lineMatches: LineMatch[]
}

interface GqlResponse {
  data: {
    search: {
      results: {
        results: Array<{ __typename: string } & Partial<Omit<FileMatch, '__typename'>>>
        limitHit: boolean
      }
    }
  }
}

export class SourcegraphProvider implements Provider {
  readonly name: ProviderName = 'sourcegraph'
  readonly capabilities: ProviderCapabilities = {
    regex: true,
    structural: true,
    symbolSearch: true,
    rateLimit: { requests: 100, windowMs: 60_000 },
  }

  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const sgQuery = buildQuery(query)
    const patternType = query.filters?.regex ? 'regexp' : 'literal'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) headers['Authorization'] = `token ${this.token}`

    try {
      const res = await got
        .post(`${this.baseUrl}/.api/graphql`, {
          headers,
          json: { query: GQL_QUERY, variables: { query: sgQuery, patternType } },
          timeout: { request: 10_000 },
        })
        .json<GqlResponse>()

      return res.data.search.results.results
        .filter((r): r is FileMatch => r.__typename === 'FileMatch')
        .slice(0, query.limit)
        .map((r) => normalize(r, this.baseUrl))
    } catch (err) {
      throw toProviderError(err)
    }
  }

  async validate(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (this.token) headers['Authorization'] = `token ${this.token}`
      await got.get(`${this.baseUrl}/.api/graphql`, {
        headers,
        timeout: { request: 5_000 },
      })
      return true
    } catch {
      return false
    }
  }
}

function buildQuery(query: SearchQuery): string {
  const parts = [query.q]
  const f = query.filters
  if (f?.language) parts.push(`lang:${f.language}`)
  if (f?.repo) parts.push(`repo:${f.repo}`)
  if (f?.org) parts.push(`repo:${f.org}/`)
  if (f?.path) parts.push(`file:${f.path}`)
  if (f?.filename) parts.push(`file:${f.filename}`)
  return parts.join(' ')
}

function normalize(r: FileMatch, baseUrl: string): SearchResult {
  const firstMatch = r.lineMatches[0]
  const lastMatch = r.lineMatches[r.lineMatches.length - 1] ?? firstMatch
  const snippet = r.lineMatches.map((m) => m.preview).join('\n')

  // Strip "github.com/" prefix from repo name
  const repo = r.repository.name.replace(/^github\.com\//, '')
  const rawUrl = `https://raw.githubusercontent.com/${repo}/HEAD/${r.file.path}`
  const url = `${baseUrl}${r.file.canonicalURL}`

  return {
    url,
    rawUrl,
    repo,
    path: r.file.path,
    lines: [firstMatch?.lineNumber ?? 1, lastMatch?.lineNumber ?? 1],
    snippet,
    language: r.file.path.split('.').pop() ?? 'unknown',
    stars: r.repository.stars,
    provider: 'sourcegraph',
    score: 0.8,
  }
}

function toProviderError(err: unknown): Error & { code: string; provider: ProviderName } {
  const base = { provider: 'sourcegraph' as ProviderName }
  if (err != null && typeof err === 'object' && 'response' in err) {
    const status = (err as { response: { statusCode: number } }).response.statusCode
    if (status === 401 || status === 403)
      return Object.assign(new Error('Auth failed'), { code: 'AUTH', ...base })
    if (status === 429)
      return Object.assign(new Error('Rate limited'), { code: 'RATE_LIMIT', ...base })
  }
  return Object.assign(new Error(String(err)), { code: 'UNKNOWN', ...base })
}
