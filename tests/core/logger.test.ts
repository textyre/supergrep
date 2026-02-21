import { describe, it, expect } from 'vitest'
import { createLogger } from '../../src/core/logger.js'

describe('createLogger', () => {
  it('creates a logger without throwing', () => {
    expect(() => createLogger({ level: 'silent' })).not.toThrow()
  })

  it('logger has info, warn, error, debug methods', () => {
    const log = createLogger({ level: 'silent' })
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
  })
})
