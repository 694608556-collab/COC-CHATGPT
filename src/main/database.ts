import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ParticipantPair } from '../shared/types'

const SCHEMA_VERSION = 4

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  migrated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kps_json TEXT NOT NULL DEFAULT '[]',
  pairs_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_sort ON modules(sort_order);

CREATE TABLE IF NOT EXISTS module_sequences (
  module_id TEXT PRIMARY KEY REFERENCES modules(id) ON DELETE CASCADE,
  maximum INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  link TEXT,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  previous_status TEXT,
  play_date TEXT,
  date_source TEXT NOT NULL,
  fetched_at TEXT,
  raw_json TEXT,
  manual_content TEXT,
  cache_source_url TEXT,
  last_error TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_module_order ON records(module_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_records_module_link ON records(module_id, link);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
  edition INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_characters_created ON characters(created_at);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_mappings (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_entries (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  path TEXT NOT NULL,
  format TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  hash TEXT,
  exists_flag INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_owner ON archive_entries(owner_type, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_path ON archive_entries(path);
`

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  module_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  note_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at);
`

/**
 * 0.6.3：模组增加跑团状态。已有模组一律补成 not_started（未开始），
 * 因为无法从历史数据推断这个团跑到哪了，交给用户自己改。
 */
const MIGRATION_V4 = `
ALTER TABLE modules ADD COLUMN play_status TEXT NOT NULL DEFAULT 'not_started';
`


/**
 * Character cards used to append a PC/PL row to every linked module. That row
 * is not something the user asked for, so drop the untouched leftovers and
 * drop the link from the rows the user did keep. The module list is then
 * owned by the module editor only.
 */
export function cleanLinkedPairs(
  pairs: ParticipantPair[],
  characterName: (id: string) => string | undefined
): ParticipantPair[] {
  const cleaned: ParticipantPair[] = []
  for (const pair of pairs) {
    if (!pair || typeof pair !== 'object') continue
    const characterId = pair.characterId
    if (!characterId) {
      cleaned.push({ pc: pair.pc ?? '', pl: pair.pl ?? '' })
      continue
    }
    const name = characterName(characterId)
    const untouched = name !== undefined && !String(pair.pl ?? '').trim() && pair.pc === name
    if (untouched) continue
    cleaned.push({ pc: pair.pc ?? '', pl: pair.pl ?? '' })
  }
  return cleaned
}
function cleanLinkedPairsInDatabase(connection: DatabaseSync): void {
  const names = new Map<string, string>()
  for (const row of connection.prepare('SELECT id, data_json FROM characters').all() as Array<Record<string, unknown>>) {
    try {
      const data = JSON.parse(String(row.data_json ?? '{}')) as { basic?: { name?: string } }
      names.set(String(row.id), String(data.basic?.name ?? ''))
    } catch {
      // ignore unreadable rows
    }
  }
  for (const row of connection
    .prepare('SELECT id, pairs_json FROM modules')
    .all() as Array<Record<string, unknown>>) {
    let pairs: ParticipantPair[]
    try {
      const parsed = JSON.parse(String(row.pairs_json ?? '[]'))
      pairs = Array.isArray(parsed) ? (parsed as ParticipantPair[]) : []
    } catch {
      continue
    }
    if (!pairs.some((pair) => pair && pair.characterId)) continue
    const cleaned = cleanLinkedPairs(pairs, (id) => names.get(id))
    connection
      .prepare('UPDATE modules SET pairs_json = ? WHERE id = ?')
      .run(JSON.stringify(cleaned), String(row.id))
  }
}
export class AppDatabase {
  readonly connection: DatabaseSync

  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.connection = new DatabaseSync(filePath)
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
  }

  initialize(): void {
    const currentVersion = this.getVersion()
    if (currentVersion > SCHEMA_VERSION)
      throw new Error(`数据库版本 ${currentVersion} 高于应用支持的版本 ${SCHEMA_VERSION}`)
    if (
      currentVersion < SCHEMA_VERSION &&
      fs.existsSync(this.filePath) &&
      fs.statSync(this.filePath).size > 0
    ) {
      this.connection.exec('PRAGMA wal_checkpoint(FULL)')
      fs.copyFileSync(this.filePath, `${this.filePath}.before-v${SCHEMA_VERSION}.bak`)
    }
    if (currentVersion < 1) {
      this.transaction(() => {
        this.connection.exec(MIGRATION_V1)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(1, new Date().toISOString())
      })
    }
    if (currentVersion < 2) {
      this.transaction(() => {
        this.connection.exec(MIGRATION_V2)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(2, new Date().toISOString())
      })
    }
    if (currentVersion < 3) {
      this.transaction(() => {
        cleanLinkedPairsInDatabase(this.connection)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(3, new Date().toISOString())
      })
    }
    if (currentVersion < 4) {
      this.transaction(() => {
        // 全新数据库由 MIGRATION_V1 建表后立即走到这里；升级库则在此补列。
        if (!this.hasColumn('modules', 'play_status')) this.connection.exec(MIGRATION_V4)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(4, new Date().toISOString())
      })
    }
    const integrity = this.integrityCheck()
    if (integrity !== 'ok') throw new Error(`数据库完整性检查失败：${integrity}`)
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
    return rows.some((row) => String(row.name) === column)
  }

  integrityCheck(): string {
    const row = this.connection.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined
    return String(row?.integrity_check ?? row?.['integrity_check'] ?? 'unknown')
  }

  transaction<T>(action: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const value = action()
      this.connection.exec('COMMIT')
      return value
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.connection.close()
  }

  private getVersion(): number {
    const exists = this.connection
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='schema_meta'")
      .get() as { found?: number } | undefined
    if (!exists?.found) return 0
    const row = this.connection.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as
      | { version?: number }
      | undefined
    return row?.version ?? 0
  }
}

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION
