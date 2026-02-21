// src/mcp/tools.ts
import { z } from 'zod'

export const SearchCodeInput = z.object({
  q: z.string().describe(
    'Search query string. Plain keywords work well (e.g. "pam authenticate"). ' +
    'Do NOT embed GitHub qualifiers here — use the dedicated filter fields instead.',
  ),
  providers: z
    .array(z.enum(['github', 'sourcegraph']))
    .optional()
    .describe('Providers to search. Default: ["github"]. Add "sourcegraph" for regex or structural search.'),
  language: z.string().optional().describe(
    'Filter by programming language (GitHub language name). Examples: "yaml", "python", "shell", "ruby".',
  ),
  repo: z.string().optional().describe('Limit to one repository. Format: "owner/repo".'),
  org: z.string().optional().describe('Limit to a GitHub organization. Example: "ansible".'),
  path: z.string().optional().describe(
    'Substring match on file path (GitHub path: qualifier). ' +
    'A result matches if its path CONTAINS this string. ' +
    'Examples: "roles/" → Ansible role files (roles/ntp/tasks/main.yml); ' +
    '"tasks/" → task files; ".github/workflows/" → CI pipelines; ' +
    '"defaults/" → Ansible defaults; "templates/" → Jinja2 templates.',
  ),
  filename: z.string().optional().describe(
    'Filter by exact filename (without directory). Examples: "main.yml", "Dockerfile", "requirements.txt".',
  ),
  regex: z.boolean().optional().describe('Use regex matching. Sourcegraph only — set providers=["sourcegraph"].'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results to return (default: 20, max: 100). For 50 results issue two parallel calls of 25 each.'),
})

export const FetchFileInput = z.object({
  url: z.string().url().describe(
    'Raw file URL from the rawUrl field of a search_code result. ' +
    'Returns the full file content. Use when a snippet is not enough.',
  ),
})

export const CacheClearInput = z.object({
  pattern: z.string().optional().describe('SQL LIKE pattern to filter cache keys to delete. Omit to clear all.'),
})

export const tools = [
  {
    name: 'search_code',
    description:
      'Search GitHub (and optionally Sourcegraph) for code across public repositories. ' +
      'Results are ranked by stars and include: repo (owner/repo), path, snippet, stars, url (permalink), rawUrl, provider. ' +
      'Use the path filter to scope by directory — e.g. path="roles/" finds Ansible role files, path="tasks/" finds task files. ' +
      'To get 50 results: issue two parallel calls with different path/keyword constraints (max 100 per call). ' +
      'To read a full file after finding it: call fetch_file(rawUrl). ' +
      'Errors field will be non-empty if a provider is misconfigured (e.g. missing GITHUB_TOKEN).',
    inputSchema: SearchCodeInput,
  },
  {
    name: 'fetch_file',
    description:
      'Fetch the full raw content of a file by URL. ' +
      'Pass the rawUrl field from a search_code result. ' +
      'Use when the snippet is too short and you need to read the complete file.',
    inputSchema: FetchFileInput,
  },
  {
    name: 'cache_stats',
    description:
      'Return cache and request-metrics statistics: total entries, size, hit rate, P50/P95/P99 latencies per provider.',
    inputSchema: z.object({}),
  },
  {
    name: 'cache_clear',
    description: 'Clear cached search results. Optionally filter by SQL LIKE pattern on cache key. Omit pattern to clear all.',
    inputSchema: CacheClearInput,
  },
] as const
