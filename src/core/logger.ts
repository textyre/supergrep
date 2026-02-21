// src/core/logger.ts
import pino from 'pino'

export interface LoggerOptions {
  level?: string
  file?: string
}

export function createLogger(opts: LoggerOptions = {}): pino.Logger {
  const level = opts.level ?? 'info'

  if (opts.file) {
    return pino({ level }, pino.destination(opts.file))
  }

  // Always log to stderr — never pollute stdout (reserved for JSON results)
  return pino({ level }, process.stderr)
}
