import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node20',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'mcp/server': 'src/mcp/server.ts' },
    format: ['esm'],
    target: 'node20',
    sourcemap: true,
  },
])
