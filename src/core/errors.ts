// src/core/errors.ts
import type { ProviderName } from './types.js'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class CacheError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CacheError'
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}
