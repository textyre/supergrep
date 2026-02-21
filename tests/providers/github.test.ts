import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { GitHubProvider } from '../../src/providers/github.js'

const SAMPLE_RESPONSE = {
  total_count: 1,
  items: [
    {
      name: 'nftables.conf.j2',
      path: 'templates/nftables.conf.j2',
      html_url: 'https://github.com/owner/repo/blob/main/templates/nftables.conf.j2',
      repository: { full_name: 'owner/repo' },
      text_matches: [
        {
          fragment: 'tcp dport 22 ct state new limit rate 4/minute accept',
          matches: [{ indices: [0, 10] }],
        },
      ],
    },
  ],
}

describe('GitHubProvider', () => {
  beforeEach(() => nock.cleanAll())
  afterEach(() => nock.cleanAll())

  it('searches, fetches star counts via REST, returns normalized results', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(200, SAMPLE_RESPONSE, { 'Content-Type': 'application/json' })

    nock('https://api.github.com')
      .get('/repos/owner/repo')
      .reply(200, { stargazers_count: 500 }, { 'Content-Type': 'application/json' })

    const provider = new GitHubProvider('ghp_test')
    const results = await provider.search({
      q: 'nftables limit rate',
      providers: ['github'],
      filters: { language: 'yaml' },
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.repo).toBe('owner/repo')
    expect(results[0]!.provider).toBe('github')
    expect(results[0]!.snippet).toBe('tcp dport 22 ct state new limit rate 4/minute accept')
    expect(results[0]!.stars).toBe(500)
    expect(results[0]!.score).toBe(1.0)
  })

  it('falls back to stars=0 when repo fetch fails', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(200, SAMPLE_RESPONSE, { 'Content-Type': 'application/json' })

    nock('https://api.github.com').get('/repos/owner/repo').reply(500)

    const provider = new GitHubProvider('ghp_test')
    const results = await provider.search({
      q: 'nftables limit rate',
      providers: ['github'],
      filters: {},
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.stars).toBe(0)
    expect(results[0]!.snippet).toBeTruthy()
  })

  it('throws with code AUTH on 403', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(403, { message: 'Forbidden' })

    const provider = new GitHubProvider('bad_token')
    await expect(
      provider.search({ q: 'test', providers: ['github'], filters: {}, limit: 5 })
    ).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('throws with code RATE_LIMIT on 429', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(429, { message: 'rate limit' })

    const provider = new GitHubProvider('ghp_test')
    await expect(
      provider.search({ q: 'test', providers: ['github'], filters: {}, limit: 5 })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })
})
