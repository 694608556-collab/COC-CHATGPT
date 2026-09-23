import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ParticipantPair } from '../shared/types'
import { sessionNumberFromName } from '../shared/session-number'

const SCHEMA_VERSION = 7

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
 * 0.6.8：模组资料汇总（EdrawMind 导图、Notion 链接、其他本地文件）。
 *
 * 只登记路径、不复制文件，所以表里存的是 path/url 而不是内容。
 */
const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS module_resources (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  path TEXT,
  url TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_module ON module_resources(module_id, sort_order);
`

/**
 * 0.7.0：资料可以不归属任何模组（module_id 允许为空）。
 *
 * SQLite 不能直接去掉列的 NOT NULL，只能重建表再搬数据。
 * 外键仍保留 ON DELETE CASCADE：module_id 为 NULL 时不会匹配任何模组，
 * 所以未归属的资料不会因为删模组被连带删掉——这正是想要的行为。
 */
const MIGRATION_V7 = `
CREATE TABLE IF NOT EXISTS module_resources_v7 (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES modules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  path TEXT,
  url TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO module_resources_v7 (id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at)
  SELECT id,module_id,kind,title,path,url,note,sort_order,created_at,updated_at FROM module_resources;
DROP TABLE module_resources;
ALTER TABLE module_resources_v7 RENAME TO module_resources;
CREATE INDEX IF NOT EXISTS idx_resources_module ON module_resources(module_id, sort_order);
`

/**
 * 0.6.6：把历史库里“场次名说第 10 场、编号却是 17”这类名称与编号分家的场次修正回来。
 *
 * 起因：导入表格只按“场次名”改名，编号原样保留。用户把场次名重排成 1-16 后，
 * 编号仍是 1-9、17-23，界面按编号判断“缺 10-16”，新增场次时平白弹出编号选择窗口。
 *
 * 以名称里的“第 N 场”为准重排编号，并且两阶段落库：先把要动的场次算完再统一写入，
 * 因此互换编号（第 1 场改成第 2 场、第 2 场改成第 1 场）这类情况也能正确换过来。
 *
 * 只做无歧义的修正，宁可少改也不错改：
 * - 名称里没有“第 N 场”（用户自己起的名字）→ 不动，保留原编号；
 * - 两个场次都叫“第 N 场”→ 目标编号有歧义，两者都不动；
 * - 目标编号落在“不动”的场次手里 → 不动，绝不写重号。
 */
export function realignRecordSequences(connection: DatabaseSync, moduleId?: string): number {
  const rows = (
    moduleId
      ? connection
          .prepare('SELECT id, module_id, name, sequence_no FROM records WHERE module_id=? ORDER BY sort_order')
          .all(moduleId)
      : connection
          .prepare('SELECT id, module_id, name, sequence_no FROM records ORDER BY module_id, sort_order')
          .all()
  ) as Array<Record<string, unknown>>

  const byModule = new Map<string, Array<{ id: string; current: number; desired?: number }>>()
  for (const row of rows) {
    const key = String(row.module_id)
    const entry = {
      id: String(row.id),
      current: Number(row.sequence_no),
      desired: sessionNumberFromName(row.name === null ? undefined : String(row.name))
    }
    const list = byModule.get(key)
    if (list) list.push(entry)
    else byModule.set(key, [entry])
  }

  const fixes: Array<{ id: string; sequenceNo: number }> = []
  for (const list of byModule.values()) {
    const wantedCounts = new Map<number, number>()
    for (const entry of list) {
      if (entry.desired === undefined) continue
      wantedCounts.set(entry.desired, (wantedCounts.get(entry.desired) ?? 0) + 1)
    }
    // 目标编号唯一、且名称确实写了编号的场次，才允许移动
    const movable = list.filter(
      (entry) =>
        entry.desired !== undefined &&
        wantedCounts.get(entry.desired) === 1 &&
        entry.desired !== entry.current
    )
    const movableIds = new Set(movable.map((entry) => entry.id))
    // 不动的那批场次手里的编号必须避开，否则会写出重号
    const reserved = new Set(
      list.filter((entry) => !movableIds.has(entry.id)).map((entry) => entry.current)
    )
    for (const entry of movable) {
      const desired = entry.desired as number
      if (reserved.has(desired)) continue
      fixes.push({ id: entry.id, sequenceNo: desired })
    }
  }

  const update = connection.prepare('UPDATE records SET sequence_no=? WHERE id=?')
  for (const fix of fixes) update.run(fix.sequenceNo, fix.id)
  return fixes.length
}


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
    if (currentVersion < 5) {
      this.transaction(() => {
        realignRecordSequences(this.connection)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(5, new Date().toISOString())
      })
    }
    if (currentVersion < 6) {
      this.transaction(() => {
        this.connection.exec(MIGRATION_V6)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(6, new Date().toISOString())
      })
    }
    if (currentVersion < 7) {
      this.transaction(() => {
        this.connection.exec(MIGRATION_V7)
        this.connection
          .prepare('INSERT OR REPLACE INTO schema_meta (id, version, migrated_at) VALUES (1, ?, ?)')
          .run(7, new Date().toISOString())
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
