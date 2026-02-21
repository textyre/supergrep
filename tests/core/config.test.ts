import { describe, it, expect, afterEach } from 'vitest'
import { loadConfig } from '../../src/core/config.js'

describe('loadConfig', () => {
  const original = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, original)
  })

  it('reads GITHUB_TOKEN from env', () => {
    process.env['GITHUB_TOKEN'] = 'ghp_test'
    const cfg = loadConfig()
    expect(cfg.githubToken).toBe('ghp_test')
  })

  it('returns defaults when env not set', () => {
    delete process.env['CODESEARCH_CACHE_TTL']
    delete process.env['CODESEARCH_DEFAULT_LIMIT']
    const cfg = loadConfig()
    expect(cfg.defaultCacheTTL).toBe(3600)
    expect(cfg.defaultLimit).toBe(20)
  })

  it('defaults sourcegraphUrl to sourcegraph.com', () => {
    delete process.env['SOURCEGRAPH_URL']
    const cfg = loadConfig()
    expect(cfg.sourcegraphUrl).toBe('https://sourcegraph.com')
  })
})
