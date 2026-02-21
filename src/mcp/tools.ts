// src/mcp/tools.ts
import { z } from 'zod'

export const SearchCodeInput = z.object({
  q: z.string().describe('Search query'),
  providers: z
    .array(z.enum(['github', 'sourcegraph']))
    .optional()
    .describe('Providers to search (default: github)'),
  language: z.string().optional().describe('Filter by programming language'),
  repo: z.string().optional().describe('Filter by repo (owner/repo)'),
  org: z.string().optional().describe('Filter by organization'),
  path: z.string().optional().describe('Filter by file path'),
  regex: z.boolean().optional().describe('Use regex matching (Sourcegraph only)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results (default: 20)'),
})

export const FetchFileInput = z.object({
  url: z.string().url().describe('Raw file URL from a search result (use the rawUrl field)'),
})

export const CacheClearInput = z.object({
  pattern: z.string().optional().describe('SQL LIKE pattern to filter cache keys'),
})

export const tools = [
  {
    name: 'search_code',
    description:
      'Search GitHub and Sourcegraph for code examples. Returns URLs with snippets. Use rawUrl field to fetch full file content.',
    inputSchema: SearchCodeInput,
  },
  {
    name: 'fetch_file',
    description: 'Fetch the raw content of a file from a URL returned by search_code.',
    inputSchema: FetchFileInput,
  },
  {
    name: 'cache_stats',
    description:
      'Return cache and metrics statistics (request counts, P50/P95/P99, cache hit rates).',
    inputSchema: z.object({}),
  },
  {
    name: 'cache_clear',
    description: 'Clear cache entries, optionally filtered by a SQL LIKE pattern.',
    inputSchema: CacheClearInput,
  },
] as const
