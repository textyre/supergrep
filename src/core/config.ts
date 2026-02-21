import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// Load .env from package root into process.env (does not override existing vars)
function loadEnvFile(): void {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const content = readFileSync(join(pkgRoot, '.env'), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && process.env[key] === undefined) process.env[key] = val
    }
  } catch { /* .env not found, skip */ }
}

loadEnvFile()

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
    cachePath: join(homedir(), '.cache', 'supergrep', 'cache.db'),
    defaultCacheTTL: Number(process.env['SUPERGREP_CACHE_TTL'] ?? 3600),
    defaultLimit: Number(process.env['SUPERGREP_DEFAULT_LIMIT'] ?? 20),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    logFile: process.env['LOG_FILE'] || undefined,
    otelEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] || undefined,
  }
}
