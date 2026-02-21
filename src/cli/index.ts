// src/cli/index.ts
import { Command } from 'commander'
import { loadConfig } from '../core/config.js'
import { SqliteCacheRepository } from '../cache/sqlite.js'
import { SqliteMetrics } from '../core/metrics.js'
import { GitHubProvider } from '../providers/github.js'
import { SourcegraphProvider } from '../providers/sourcegraph.js'
import { JsonFormatter } from '../results/json.js'
import { MarkdownFormatter } from '../results/markdown.js'
import { buildEngine } from '../core/engine-factory.js'
import type { SearchQuery, SearchResponse, ProviderName } from '../core/types.js'

interface CliDeps {
  search?: (q: SearchQuery) => Promise<SearchResponse>
  write?: (s: string) => void
}

export function buildCli(deps: CliDeps = {}): Command {
  const program = new Command()
  program
    .name('codesearch')
    .description('Search GitHub code for agents and subagents')
    .version('0.1.0')

  // ---- search command ----
  program
    .command('search <query>')
    .description('Search for code examples')
    .option('-p, --provider <name>', 'provider to use (repeatable)', collect, [] as string[])
    .option('-l, --lang <lang>', 'filter by language')
    .option('-r, --repo <repo>', 'filter by repo (owner/repo)')
    .option('--org <org>', 'filter by org')
    .option('--path <path>', 'filter by file path')
    .option('--filename <filename>', 'filter by filename')
    .option('--limit <n>', 'max results', '20')
    .option('--output <fmt>', 'output format: json | markdown', 'json')
    .option('--regex', 'use regex matching (Sourcegraph only)')
    .option('--no-cache', 'skip cache for this query')
    .action(async (queryStr: string, opts: Record<string, unknown>) => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))

      const providers = opts['provider'] as string[]
      const query: SearchQuery = {
        q: queryStr,
        providers: providers.length > 0
          ? providers as ProviderName[]
          : ['github'],
        filters: {
          language: opts['lang'] as string | undefined,
          repo: opts['repo'] as string | undefined,
          org: opts['org'] as string | undefined,
          path: opts['path'] as string | undefined,
          filename: opts['filename'] as string | undefined,
          regex: opts['regex'] as boolean | undefined,
        },
        limit: Number(opts['limit'] ?? 20),
        cacheTTL: opts['cache'] === false ? 0 : undefined,
      }

      if (deps.search) {
        const result = await deps.search(query)
        write(JSON.stringify(result, null, 2))
        return
      }

      const engine = buildEngine()
      const response = await engine.search(query)
      const formatter = opts['output'] === 'markdown'
        ? new MarkdownFormatter()
        : new JsonFormatter()
      write(formatter.format(response))
    })

  // ---- validate command ----
  program
    .command('validate')
    .description('Check provider tokens and connectivity')
    .action(async () => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))
      const cfg = loadConfig()
      const results: Record<string, boolean> = {}
      if (cfg.githubToken) {
        results['github'] = await new GitHubProvider(cfg.githubToken).validate()
      }
      results['sourcegraph'] = await new SourcegraphProvider(
        cfg.sourcegraphUrl,
        cfg.sourcegraphToken,
      ).validate()
      write(JSON.stringify(results, null, 2))
    })

  // ---- cache sub-commands ----
  const cacheCmd = program.command('cache').description('Manage cache')

  cacheCmd
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))
      const cfg = loadConfig()
      const repo = new SqliteCacheRepository(cfg.cachePath)
      const stats = await repo.stats()
      repo.close()
      write(JSON.stringify(stats, null, 2))
    })

  cacheCmd
    .command('clear')
    .description('Clear cache entries')
    .option('--pattern <glob>', 'SQL LIKE pattern')
    .action(async (opts: { pattern?: string }) => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))
      const cfg = loadConfig()
      const repo = new SqliteCacheRepository(cfg.cachePath)
      const deleted = await repo.clear(opts.pattern)
      repo.close()
      write(JSON.stringify({ deleted }, null, 2))
    })

  // ---- stats command ----
  program
    .command('stats')
    .description('Show request metrics')
    .option('--since <hours>', 'hours to look back', '24')
    .action(async (opts: { since: string }) => {
      const write = deps.write ?? ((s: string) => process.stdout.write(s + '\n'))
      const cfg = loadConfig()
      const metrics = new SqliteMetrics(cfg.cachePath)
      const stats = await metrics.stats(Number(opts.since) * 3600)
      metrics.close()
      const formatted = stats.map((s) => ({
        ...s,
        cacheHitRate: `${(s.cacheHitRate * 100).toFixed(0)}%`,
        p50: `${s.p50}ms`,
        p95: `${s.p95}ms`,
        p99: `${s.p99}ms`,
      }))
      write(JSON.stringify(formatted, null, 2))
    })

  // ---- mcp-serve command ----
  program
    .command('mcp-serve')
    .description('Start MCP server (stdio transport)')
    .action(async () => {
      const mod = await import('../mcp/server.js') as { startMcpServer: () => Promise<void> }
      await mod.startMcpServer()
    })

  return program
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val]
}

// Direct entrypoint - only runs when file is executed directly
const isMain = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')
if (isMain) {
  const program = buildCli()
  program.parseAsync(process.argv).catch((e: unknown) => {
    process.stderr.write(String(e) + '\n')
    process.exit(1)
  })
}
