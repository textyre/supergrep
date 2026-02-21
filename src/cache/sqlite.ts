// src/cache/sqlite.ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SearchResponse } from '../core/types.js'

export interface CacheStats {
  entries: number
  sizeBytes: number
  oldestEntry: Date | null
}

export interface CacheRepository {
  get(key: string): Promise<SearchResponse | null>
  set(key: string, value: SearchResponse, ttlSec: number): Promise<void>
  clear(pattern?: string): Promise<number>
  stats(): Promise<CacheStats>
}

export class SqliteCacheRepository implements CacheRepository {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)
  }

  async get(key: string): Promise<SearchResponse | null> {
    const now = Math.floor(Date.now() / 1000)
    const row = this.db
      .prepare('SELECT value FROM cache WHERE key = ? AND expires_at > ?')
      .get(key, now) as { value: string } | undefined
    if (!row) return null
    return JSON.parse(row.value) as SearchResponse
  }

  async set(key: string, value: SearchResponse, ttlSec: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    this.db
      .prepare(
        'INSERT OR REPLACE INTO cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(key, JSON.stringify(value), now, now + ttlSec)
  }

  async clear(pattern?: string): Promise<number> {
    const stmt = pattern
      ? this.db.prepare('DELETE FROM cache WHERE key LIKE ?')
      : this.db.prepare('DELETE FROM cache')
    const result = pattern ? stmt.run(pattern) : stmt.run()
    return result.changes
  }

  async stats(): Promise<CacheStats> {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as entries, MIN(created_at) as oldest FROM cache WHERE expires_at > ?',
      )
      .get(Math.floor(Date.now() / 1000)) as { entries: number; oldest: number | null }

    const sizeRow = this.db
      .prepare(
        'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()',
      )
      .get() as { size: number }

    return {
      entries: row.entries,
      sizeBytes: sizeRow.size,
      oldestEntry: row.oldest != null ? new Date(row.oldest * 1000) : null,
    }
  }

  close(): void {
    this.db.close()
  }
}
