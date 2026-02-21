// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { tools, SearchCodeInput, FetchFileInput, CacheClearInput } from './tools.js'
import {
  handleSearchCode,
  handleFetchFile,
  handleCacheStats,
  handleCacheClear,
} from './handlers.js'
import { createLogger } from '../core/logger.js'

export async function startMcpServer(): Promise<void> {
  const log = createLogger({ level: process.env['LOG_LEVEL'] ?? 'info' })

  const server = new Server(
    { name: 'supergrep', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema) as Record<string, unknown>,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    log.info({ tool: name }, 'MCP tool call')

    try {
      let result: string
      switch (name) {
        case 'search_code':
          result = await handleSearchCode(SearchCodeInput.parse(args))
          break
        case 'fetch_file':
          result = await handleFetchFile(FetchFileInput.parse(args))
          break
        case 'cache_stats':
          result = await handleCacheStats()
          break
        case 'cache_clear':
          result = await handleCacheClear(CacheClearInput.parse(args ?? {}))
          break
        default:
          throw new Error(`Unknown tool: ${name}`)
      }
      return { content: [{ type: 'text' as const, text: result }] }
    } catch (err) {
      log.error({ tool: name, error: String(err) }, 'tool error')
      return {
        content: [{ type: 'text' as const, text: `Error: ${String(err)}` }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log.info('MCP server running on stdio')
}
