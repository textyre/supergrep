// src/providers/github.ts
import got from 'got'
import type { Provider, ProviderCapabilities } from './base.js'
import type { SearchQuery, SearchResult, ProviderName } from '../core/types.js'

const BASE = 'https://api.github.com'

interface GithubCodeItem {
  name: string
  path: string
  html_url: string
  repository: { full_name: string }
  text_matches?: Array<{ fragment: string; matches: Array<{ indices: [number, number] }> }>
}

interface GithubSearchResponse {
  total_count: number
  items: GithubCodeItem[]
}

export class GitHubProvider implements Provider {
  readonly name: ProviderName = 'github'
  readonly capabilities: ProviderCapabilities = {
    regex: false,
    structural: false,
    symbolSearch: false,
    rateLimit: { requests: 30, windowMs: 60_000 },
  }

  constructor(private readonly token: string) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const q = buildQuery(query)
    try {
      const res = await got
        .get(`${BASE}/search/code`, {
          searchParams: { q, per_page: Math.min(query.limit, 100) },
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github.text-match+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          retry: { limit: 0 },
          timeout: { request: 10_000 },
        })
        .json<GithubSearchResponse>()

      const repoNames = [...new Set(res.items.map((i) => i.repository.full_name))]
      const starMap = await fetchStarCounts(repoNames, this.token)

      return res.items.map((item) => normalize(item, starMap))
    } catch (err: unknown) {
      throw toProviderError(err)
    }
  }

  async validate(): Promise<boolean> {
    try {
      await got.get(`${BASE}/user`, {
        headers: { Authorization: `Bearer ${this.token}` },
        retry: { limit: 0 },
        timeout: { request: 5_000 },
      })
      return true
    } catch {
      return false
    }
  }
}

async function fetchStarCounts(repos: string[], token: string): Promise<Map<string, number>> {
  if (repos.length === 0) return new Map()
  const settled = await Promise.allSettled(
    repos.map((repo) =>
      got
        .get(`${BASE}/repos/${repo}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          retry: { limit: 0 },
          timeout: { request: 5_000 },
        })
        .json<{ stargazers_count: number }>()
        .then((data) => [repo, data.stargazers_count] as const)
    )
  )
  const map = new Map<string, number>()
  for (const r of settled) {
    if (r.status === 'fulfilled') map.set(r.value[0], r.value[1])
  }
  return map
}

function buildQuery(query: SearchQuery): string {
  const parts = [query.q]
  const f = query.filters ?? {}
  if (f.language) parts.push(`language:${f.language}`)
  if (f.repo) parts.push(`repo:${f.repo}`)
  if (f.org) parts.push(`org:${f.org}`)
  if (f.path) parts.push(`path:${f.path}`)
  if (f.filename) parts.push(`filename:${f.filename}`)
  if (f.extension) parts.push(`extension:${f.extension}`)
  return parts.join(' ')
}

function normalize(item: GithubCodeItem, starMap: Map<string, number>): SearchResult {
  const firstMatch = item.text_matches?.[0]
  const fragment = firstMatch?.fragment ?? ''
  const hasMatch = (firstMatch?.matches?.length ?? 0) > 0
  const lineCount = fragment.split('\n').length

  const slash = item.repository.full_name.indexOf('/')
  const owner = item.repository.full_name.slice(0, slash)
  const repoName = item.repository.full_name.slice(slash + 1)
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/HEAD/${item.path}`

  return {
    url: item.html_url,
    rawUrl,
    repo: item.repository.full_name,
    path: item.path,
    lines: [1, Math.max(1, lineCount)],
    snippet: fragment || item.name,
    language: item.path.split('.').pop() ?? 'unknown',
    stars: starMap.get(item.repository.full_name) ?? 0,
    provider: 'github',
    score: hasMatch ? 1.0 : 0.5,
  }
}

function toProviderError(err: unknown): Error & { code: string; provider: ProviderName } {
  const base = { provider: 'github' as ProviderName }
  if (err != null && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const response = obj['response']
    if (response != null && typeof response === 'object') {
      const status = (response as Record<string, unknown>)['statusCode']
      if (typeof status === 'number') {
        if (status === 401 || status === 403)
          return Object.assign(new Error('Auth failed'), { code: 'AUTH', ...base })
        if (status === 429)
          return Object.assign(new Error('Rate limited'), { code: 'RATE_LIMIT', ...base })
      }
    }
  }
  return Object.assign(new Error(String(err)), { code: 'UNKNOWN', ...base })
}
