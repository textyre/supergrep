import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  githubToken: string | undefined
  sourcegraphToken: string | undefined
  sourcegraphUrl: string
  cachePath: string
  defaultCacheTTL: number
  defaultLimit: number
  logLevel: string
  logFile: string | undefined
  otelEndpoint: string | undefined
}

export function loadConfig(): Config {
  return {
    githubToken: process.env['GITHUB_TOKEN'],
    sourcegraphToken: process.env['SOURCEGRAPH_TOKEN'],
    sourcegraphUrl: process.env['SOURCEGRAPH_URL'] ?? 'https://sourcegraph.com',
    cachePath: join(homedir(), '.cache', 'codesearch', 'cache.db'),
    defaultCacheTTL: Number(process.env['CODESEARCH_CACHE_TTL'] ?? 3600),
    defaultLimit: Number(process.env['CODESEARCH_DEFAULT_LIMIT'] ?? 20),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    logFile: process.env['LOG_FILE'] || undefined,
    otelEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || undefined,
  }
}
