import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { SourcegraphProvider } from '../../src/providers/sourcegraph.js'

const SAMPLE_GQL_RESPONSE = {
  data: {
    search: {
      results: {
        results: [
          {
            __typename: 'FileMatch',
            repository: { name: 'github.com/owner/repo', stars: 1200 },
            file: {
              path: 'src/handler.py',
              url: '/github.com/owner/repo/-/blob/src/handler.py',
              canonicalURL: '/github.com/owner/repo/-/blob/src/handler.py',
            },
            lineMatches: [
              { lineNumber: 42, preview: 'def handle_request(req):' },
            ],
          },
        ],
        limitHit: false,
      },
    },
  },
}

describe('SourcegraphProvider', () => {
  beforeEach(() => nock.cleanAll())
  afterEach(() => nock.cleanAll())

  it('searches and returns normalized results', async () => {
    nock('https://sourcegraph.com')
      .post('/.api/graphql')
      .reply(200, SAMPLE_GQL_RESPONSE)

    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    const results = await provider.search({
      q: 'handle_request',
      providers: ['sourcegraph'],
      filters: { language: 'python' },
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.repo).toBe('owner/repo')
    expect(results[0]!.provider).toBe('sourcegraph')
    expect(results[0]!.lines[0]).toBe(42)
  })

  it('skips non-FileMatch results', async () => {
    const resp = {
      data: {
        search: {
          results: {
            results: [{ __typename: 'CommitSearchResult' }],
            limitHit: false,
          },
        },
      },
    }
    nock('https://sourcegraph.com').post('/.api/graphql').reply(200, resp)
    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    const results = await provider.search({
      q: 'x',
      providers: ['sourcegraph'],
      filters: {},
      limit: 5,
    })
    expect(results).toHaveLength(0)
  })

  it('sends Authorization header when token is provided', async () => {
    nock('https://sourcegraph.com')
      .post('/.api/graphql')
      .matchHeader('Authorization', 'token sgp_secret')
      .reply(200, SAMPLE_GQL_RESPONSE)

    const provider = new SourcegraphProvider('https://sourcegraph.com', 'sgp_secret')
    const results = await provider.search({
      q: 'handle_request',
      providers: ['sourcegraph'],
      limit: 10,
    })

    expect(results).toHaveLength(1)
  })

  it('builds query with language, repo, org, path, filename filters', async () => {
    let capturedBody: string | undefined
    nock('https://sourcegraph.com')
      .post('/.api/graphql', (body: Record<string, unknown>) => {
        capturedBody = JSON.stringify(body)
        return true
      })
      .reply(200, {
        data: { search: { results: { results: [], limitHit: false } } },
      })

    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    await provider.search({
      q: 'test',
      providers: ['sourcegraph'],
      filters: {
        language: 'go',
        repo: 'owner/repo',
        org: 'myorg',
        path: 'cmd/',
        filename: 'main.go',
      },
      limit: 10,
    })

    expect(capturedBody).toBeDefined()
    const parsed = JSON.parse(capturedBody!) as { variables: { query: string } }
    const q = parsed.variables.query
    expect(q).toContain('test')
    expect(q).toContain('lang:go')
    expect(q).toContain('repo:owner/repo')
    expect(q).toContain('repo:myorg/')
    expect(q).toContain('file:cmd/')
    expect(q).toContain('file:main.go')
  })

  it('uses regexp patternType when regex filter is set', async () => {
    let capturedBody: Record<string, unknown> | undefined
    nock('https://sourcegraph.com')
      .post('/.api/graphql', (body: Record<string, unknown>) => {
        capturedBody = body
        return true
      })
      .reply(200, {
        data: { search: { results: { results: [], limitHit: false } } },
      })

    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    await provider.search({
      q: 'func.*Handler',
      providers: ['sourcegraph'],
      filters: { regex: true },
      limit: 10,
    })

    expect(capturedBody).toBeDefined()
    const vars = (capturedBody as { variables: { patternType: string } }).variables
    expect(vars.patternType).toBe('regexp')
  })

  it('throws with code AUTH on 401', async () => {
    nock('https://sourcegraph.com')
      .post('/.api/graphql')
      .reply(401, { errors: [{ message: 'unauthorized' }] })

    const provider = new SourcegraphProvider('https://sourcegraph.com', 'bad_token')
    await expect(
      provider.search({ q: 'test', providers: ['sourcegraph'], limit: 5 })
    ).rejects.toMatchObject({ code: 'AUTH', provider: 'sourcegraph' })
  })

  it('throws with code RATE_LIMIT on 429', async () => {
    nock('https://sourcegraph.com')
      .post('/.api/graphql')
      .reply(429, { message: 'rate limited' })

    const provider = new SourcegraphProvider('https://sourcegraph.com', undefined)
    await expect(
      provider.search({ q: 'test', providers: ['sourcegraph'], limit: 5 })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT', provider: 'sourcegraph' })
  })
})
