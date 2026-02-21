// src/results/markdown.ts
import type { ResultFormatter } from './base.js'
import type { SearchResponse } from '../core/types.js'

export class MarkdownFormatter implements ResultFormatter {
  format(response: SearchResponse): string {
    const lines: string[] = [
      `## Search results for \`${response.query.q}\``,
      `> ${response.total} result(s) — ${response.elapsed_ms}ms${response.cached ? ` (cached, search: ${response.search_elapsed_ms}ms)` : ''}`,
      '',
      '| Repo | Path | Lines | Stars | Provider | Snippet |',
      '|---|---|---|---|---|---|',
    ]

    for (const r of response.results) {
      const snippet = r.snippet.split('\n')[0]?.slice(0, 60).replace(/\|/g, '\\|') ?? ''
      lines.push(
        `| [${r.repo}](${r.url}) | \`${r.path}\` | ${r.lines[0]}–${r.lines[1]} | ${r.stars} | ${r.provider} | \`${snippet}\` |`
      )
    }

    if (response.errors.length > 0) {
      lines.push('', '### Errors', '')
      for (const e of response.errors) {
        lines.push(`- **${e.provider}** (${e.code}): ${e.message}`)
      }
    }

    return lines.join('\n')
  }
}
