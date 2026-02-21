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
      repository: {
        full_name: 'owner/repo',
        stargazers_count: 500,
      },
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

  it('searches and returns normalized results', async () => {
    nock('https://api.github.com')
      .get('/search/code')
      .query(true)
      .reply(200, SAMPLE_RESPONSE, { 'Content-Type': 'application/json' })

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
    expect(results[0]!.snippet).toBeTruthy()
    expect(results[0]!.score).toBeGreaterThan(0)
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
