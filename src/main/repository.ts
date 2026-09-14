import { randomUUID } from 'node:crypto'
import type { StatementSync } from 'node:sqlite'
import type {
  AppSettings,
  AppSnapshot,
  ArchiveEntry,
  CharacterData,
  ModuleRecord,
  ParticipantPair,
  SessionRecord,
  SettingsPatch
} from '../shared/types'
import { DEFAULT_FILTER_PRESET } from '../shared/types'
import { parseDateFromText, parseSeaLogUrl } from '../shared/sea-log'
import { calculateDerived, convertCharacterEdition, createEmptyCharacter } from '../shared/coc-rules'
import type { AppDatabase } from './database'

function now(): string {
  return new Date().toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function cleanKps(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

function cleanPairs(values: ParticipantPair[]): ParticipantPair[] {
  return values
    .map((pair) => ({ pc: pair.pc.trim(), pl: pair.pl.trim(), characterId: pair.characterId }))
    .filter((pair) => pair.pc || pair.pl || pair.characterId)
}

function normalizeCharacter(value: CharacterData): CharacterData {
  const moduleIds = [
    ...new Set(
      (Array.isArray(value.moduleIds) ? value.moduleIds : value.moduleId ? [value.moduleId] : []).filter(
        Boolean
      )
    )
  ]
  return { ...value, moduleIds, moduleId: moduleIds[0] }
}

function rowToModule(row: Record<string, unknown>): ModuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    kps: parseJson(row.kps_json, []),
    pairs: parseJson(row.pairs_json, []),
    order: Number(row.sort_order),
    collapsed: Boolean(row.collapsed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function rowToRecord(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    moduleId: String(row.module_id),
    name: String(row.name),
    sequenceNo: Number(row.sequence_no),
    link: row.link ? String(row.link) : undefined,
    sourceType: row.source_type as SessionRecord['sourceType'],
    status: row.status as SessionRecord['status'],
    previousStatus: row.previous_status as SessionRecord['previousStatus'],
    playDate: row.play_date ? String(row.play_date) : undefined,
    dateSource: row.date_source as SessionRecord['dateSource'],
    fetchedAt: row.fetched_at ? String(row.fetched_at) : undefined,
    rawContent: parseJson(row.raw_json, undefined),
    manualContent: row.manual_content ? String(row.manual_content) : undefined,
    cacheSourceUrl: row.cache_source_url ? String(row.cache_source_url) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    order: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function defaultSettings(archiveDirectory: string): AppSettings {
  return {
    theme: 'light',
    archiveDirectory,
    filterPreset: { ...DEFAULT_FILTER_PRESET },
    autoBackup: { enabled: true, interval: 'idle', retention: 10 }
  }
}

export class AppRepository {
  private readonly connection

  constructor(
    private readonly database: AppDatabase,
    private readonly fallbackArchiveDirectory: string
  ) {
    this.connection = database.connection
    this.ensureSettings()
  }

  snapshot(): AppSnapshot {
    const modules = this.connection
      .prepare('SELECT * FROM modules ORDER BY sort_order')
      .all()
      .map((row) => rowToModule(row as Record<string, unknown>))
    const records = this.connection
      .prepare('SELECT * FROM records ORDER BY module_id, sort_order')
      .all()
      .map((row) => rowToRecord(row as Record<string, unknown>))
    const characters = this.connection
      .prepare('SELECT data_json FROM characters ORDER BY created_at')
      .all()
      .map((row) =>
        normalizeCharacter(parseJson((row as Record<string, unknown>).data_json, {} as CharacterData))
      )
    const archiveEntries = this.connection
      .prepare('SELECT * FROM archive_entries ORDER BY created_at')
      .all()
      .map((raw) => {
        const row = raw as Record<string, unknown>
        return {
          id: String(row.id),
          ownerType: row.owner_type as ArchiveEntry['ownerType'],
          ownerId: String(row.owner_id),
          path: String(row.path),
          format: String(row.format),
          size: Number(row.size),
          hash: row.hash ? String(row.hash) : undefined,
          exists: Boolean(row.exists_flag),
          createdAt: String(row.created_at)
        }
      })
    const importMappings = this.connection
      .prepare('SELECT data_json FROM import_mappings ORDER BY created_at')
      .all()
      .map((row) => parseJson((row as Record<string, unknown>).data_json, {}))
    return {
      schemaVersion: 1,
      exportedAt: now(),
      modules,
      records,
      characters,
      settings: this.getSettings(),
      importMappings,
      archiveEntries
    }
  }

  getSettings(): AppSettings {
    const row = this.connection.prepare('SELECT data_json FROM settings WHERE id = 1').get() as
      | { data_json?: string }
      | undefined
    return parseJson(row?.data_json, defaultSettings(this.fallbackArchiveDirectory))
  }

  updateSettings(patch: SettingsPatch): AppSettings {
    const current = this.getSettings()
    const next: AppSettings = {
      ...current,
      ...patch,
      filterPreset: { ...current.filterPreset, ...patch.filterPreset },
      autoBackup: { ...current.autoBackup, ...patch.autoBackup }
    }
    this.connection
      .prepare('UPDATE settings SET data_json = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(next), now())
    return next
  }

  createModule(input: { name: string; kps?: string[]; pairs?: ParticipantPair[] }): ModuleRecord {
    const name = input.name.trim()
    if (!name) throw new Error('模组名不能为空')
    const existing = this.connection.prepare('SELECT id FROM modules WHERE lower(name) = lower(?)').get(name)
    if (existing) throw new Error('已有同名模组')
    const id = randomUUID()
    const timestamp = now()
    const order = Number(
      (
        this.connection.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM modules').get() as {
          next: number
        }
      ).next
    )
    this.database.transaction(() => {
      this.connection
        .prepare('INSERT INTO modules VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(
          id,
          name,
          JSON.stringify(cleanKps(input.kps ?? [])),
          JSON.stringify(cleanPairs(input.pairs ?? [])),
          order,
          timestamp,
          timestamp
        )
      this.connection.prepare('INSERT INTO module_sequences (module_id, maximum) VALUES (?, 0)').run(id)
    })
    return this.getModule(id)
  }

  updateModule(
    id: string,
    patch: { name?: string; kps?: string[]; pairs?: ParticipantPair[]; collapsed?: boolean }
  ): ModuleRecord {
    const current = this.getModule(id)
    const name = patch.name === undefined ? current.name : patch.name.trim()
    if (!name) throw new Error('模组名不能为空')
    const duplicate = this.connection
      .prepare('SELECT id FROM modules WHERE lower(name) = lower(?) AND id <> ?')
      .get(name, id)
    if (duplicate) throw new Error('已有同名模组')
    this.connection
      .prepare('UPDATE modules SET name=?, kps_json=?, pairs_json=?, collapsed=?, updated_at=? WHERE id=?')
      .run(
        name,
        JSON.stringify(patch.kps ? cleanKps(patch.kps) : current.kps),
        JSON.stringify(patch.pairs ? cleanPairs(patch.pairs) : current.pairs),
        patch.collapsed === undefined ? Number(current.collapsed) : Number(patch.collapsed),
        now(),
        id
      )
    return this.getModule(id)
  }

  deleteModule(id: string): void {
    this.database.transaction(() => {
      this.connection
        .prepare(
          "UPDATE characters SET module_id = NULL, data_json = json_set(data_json, '$.moduleId', NULL) WHERE module_id = ?"
        )
        .run(id)
      this.connection.prepare('DELETE FROM modules WHERE id = ?').run(id)
      this.compactOrders('modules', 'sort_order')
    })
  }

  moveModule(id: string, direction: -1 | 1): void {
    this.moveRow('modules', id, direction)
  }

  createRecord(input: {
    moduleId: string
    name?: string
    link?: string
    manualContent?: string
    playDate?: string
  }): SessionRecord {
    const module = this.getModule(input.moduleId)
    const timestamp = now()
    const id = randomUUID()
    return this.database.transaction(() => {
      const sequenceRow = this.connection
        .prepare('SELECT maximum FROM module_sequences WHERE module_id = ?')
        .get(input.moduleId) as { maximum: number }
      const sequenceNo = Number(sequenceRow.maximum) + 1
      this.connection
        .prepare('UPDATE module_sequences SET maximum = ? WHERE module_id = ?')
        .run(sequenceNo, input.moduleId)
      const order = Number(
        (
          this.connection
            .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM records WHERE module_id = ?')
            .get(input.moduleId) as { next: number }
        ).next
      )
      const manualContent = input.manualContent?.trim() || undefined
      const link = input.link?.trim() || undefined
      if (link) parseSeaLogUrl(link)
      const sourceType = manualContent ? 'manual' : 'online'
      const status = manualContent ? 'manual' : 'pending'
      const parsedDate = !input.playDate && manualContent ? parseDateFromText(manualContent) : undefined
      const playDate = input.playDate || parsedDate
      const dateSource = input.playDate ? 'manual' : parsedDate ? 'parsed' : 'none'
      const name = input.name?.trim() || `${module.name}第 ${sequenceNo} 场`
      this.connection
        .prepare(
          `INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,play_date,date_source,manual_content,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          input.moduleId,
          name,
          sequenceNo,
          link ?? null,
          sourceType,
          status,
          playDate ?? null,
          dateSource,
          manualContent ?? null,
          order,
          timestamp,
          timestamp
        )
      return this.getRecord(id)
    })
  }

  updateRecord(
    id: string,
    patch: Partial<
      Pick<
        SessionRecord,
        | 'name'
        | 'link'
        | 'manualContent'
        | 'playDate'
        | 'dateSource'
        | 'status'
        | 'rawContent'
        | 'fetchedAt'
        | 'lastError'
        | 'cacheSourceUrl'
      >
    >
  ): SessionRecord {
    const current = this.getRecord(id)
    const link = patch.link === undefined ? current.link : patch.link?.trim() || undefined
    if (link) parseSeaLogUrl(link)
    const linkChanged = patch.link !== undefined && link !== current.link
    const manualContent =
      patch.manualContent === undefined ? current.manualContent : patch.manualContent?.trim() || undefined
    const sourceType = manualContent ? 'manual' : current.sourceType
    const status = manualContent ? 'manual' : linkChanged ? 'pending' : (patch.status ?? current.status)
    const rawContent = patch.rawContent === undefined ? current.rawContent : patch.rawContent
    this.connection
      .prepare(
        `UPDATE records SET name=?,link=?,source_type=?,status=?,previous_status=?,play_date=?,date_source=?,fetched_at=?,raw_json=?,manual_content=?,cache_source_url=?,last_error=?,updated_at=? WHERE id=?`
      )
      .run(
        patch.name?.trim() || current.name,
        link ?? null,
        sourceType,
        status,
        linkChanged || status === 'fetch_failed'
          ? current.status
          : status === 'valid'
            ? null
            : (current.previousStatus ?? null),
        patch.playDate === undefined ? (current.playDate ?? null) : patch.playDate || null,
        patch.dateSource ?? current.dateSource,
        patch.fetchedAt === undefined ? (current.fetchedAt ?? null) : (patch.fetchedAt ?? null),
        rawContent ? JSON.stringify(rawContent) : null,
        manualContent ?? null,
        linkChanged
          ? (current.cacheSourceUrl ?? null)
          : (patch.cacheSourceUrl ?? current.cacheSourceUrl ?? null),
        status === 'valid'
          ? null
          : patch.lastError === undefined
            ? (current.lastError ?? null)
            : (patch.lastError ?? null),
        now(),
        id
      )
    return this.getRecord(id)
  }

  deleteRecord(id: string): void {
    const record = this.getRecord(id)
    this.database.transaction(() => {
      this.connection.prepare('DELETE FROM records WHERE id = ?').run(id)
      this.compactRecordOrders(record.moduleId)
    })
  }

  moveRecord(id: string, direction: -1 | 1): void {
    const record = this.getRecord(id)
    this.moveRow('records', id, direction, 'module_id', record.moduleId)
  }

  createCharacter(input: {
    edition: 6 | 7
    moduleId?: string
    moduleIds?: string[]
    name?: string
  }): CharacterData {
    const moduleIds = [...new Set(input.moduleIds ?? (input.moduleId ? [input.moduleId] : []))].filter(
      Boolean
    )
    for (const moduleId of moduleIds) this.getModule(moduleId)
    const character = createEmptyCharacter({ ...input, moduleIds })
    this.database.transaction(() => {
      this.connection
        .prepare(
          'INSERT INTO characters (id,module_id,edition,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)'
        )
        .run(
          character.id,
          character.moduleIds[0] ?? null,
          character.edition,
          JSON.stringify(character),
          character.createdAt,
          character.updatedAt
        )
      if (character.moduleId && character.basic.name) this.linkCharacterToModule(character)
    })
    return this.getCharacter(character.id)
  }

  updateCharacter(id: string, nextData: CharacterData): CharacterData {
    const current = this.getCharacter(id)
    const next = structuredClone(nextData)
    next.id = id
    next.moduleIds = [...new Set(next.moduleIds ?? current.moduleIds ?? [])].filter(Boolean)
    for (const moduleId of next.moduleIds) this.getModule(moduleId)
    next.moduleId = next.moduleIds[0]
    next.createdAt = current.createdAt
    next.updatedAt = now()
    next.basic.name = next.basic.name.trim()
    next.basic.occupation = next.basic.occupation.trim()
    next.editionSnapshots = { ...next.editionSnapshots, [next.edition]: { ...next.attrs } }
    const limits = calculateDerived(next.edition, next.attrs, next.derived.luck7 ?? 50)
    next.derived.hpCurrent = Math.max(0, Math.min(next.derived.hpCurrent, limits.hp))
    next.derived.mpCurrent = Math.max(0, Math.min(next.derived.mpCurrent, limits.mp))
    next.derived.sanCurrent = Math.max(0, Math.min(next.derived.sanCurrent, limits.san))
    next.derived.db = limits.db
    if (next.edition === 6) next.derived.luck6 = next.attrs.POW * 5
    this.database.transaction(() => {
      this.writeCharacter(next)
      this.syncCharacterLinks(next)
      this.syncCharacterName(id, next.basic.name)
    })
    return this.getCharacter(id)
  }

  convertCharacter(id: string, target: 6 | 7): CharacterData {
    const current = this.getCharacter(id)
    const converted = convertCharacterEdition(current, target)
    this.writeCharacter(converted)
    return this.getCharacter(id)
  }

  moveCharacter(
    id: string,
    moduleId: string | undefined,
    oldModulePolicy: 'remove' | 'retain-name' | 'cancel'
  ): CharacterData {
    const current = this.getCharacter(id)
    if (oldModulePolicy === 'cancel') return current
    if (moduleId) this.getModule(moduleId)
    if (moduleId === current.moduleId) return current
    const next = {
      ...structuredClone(current),
      moduleId,
      moduleIds: moduleId ? [moduleId] : [],
      updatedAt: now()
    }
    this.database.transaction(() => {
      if (current.moduleId) {
        const oldModule = this.getModule(current.moduleId)
        const pairs =
          oldModulePolicy === 'remove'
            ? oldModule.pairs.filter((pair) => pair.characterId !== id)
            : oldModule.pairs.map((pair) => (pair.characterId === id ? { pc: pair.pc, pl: pair.pl } : pair))
        this.writeModulePairs(oldModule.id, pairs)
      }
      this.writeCharacter(next)
      if (moduleId && next.basic.name) this.linkCharacterToModule(next)
    })
    return this.getCharacter(id)
  }

  deleteCharacter(id: string): void {
    this.getCharacter(id)
    this.database.transaction(() => {
      const modules = this.snapshot().modules
      for (const module of modules) {
        const pairs = module.pairs.map((pair) =>
          pair.characterId === id ? { pc: pair.pc, pl: pair.pl } : pair
        )
        this.writeModulePairs(module.id, pairs)
      }
      this.connection.prepare('DELETE FROM characters WHERE id=?').run(id)
    })
  }

  findCharacter(id: string): CharacterData {
    return this.getCharacter(id)
  }

  findDuplicateLink(moduleId: string, link: string, excludingId?: string): SessionRecord | undefined {
    const row = excludingId
      ? this.connection
          .prepare('SELECT * FROM records WHERE module_id=? AND link=? AND id<>? LIMIT 1')
          .get(moduleId, link, excludingId)
      : this.connection
          .prepare('SELECT * FROM records WHERE module_id=? AND link=? LIMIT 1')
          .get(moduleId, link)
    return row ? rowToRecord(row as Record<string, unknown>) : undefined
  }

  findRecord(id: string): SessionRecord {
    return this.getRecord(id)
  }

  findModule(id: string): ModuleRecord {
    return this.getModule(id)
  }

  addArchiveEntry(input: Omit<ArchiveEntry, 'id' | 'createdAt'>): ArchiveEntry {
    const entry: ArchiveEntry = { ...input, id: randomUUID(), createdAt: now() }
    this.connection
      .prepare(
        'INSERT INTO archive_entries (id,owner_type,owner_id,path,format,size,hash,exists_flag,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run(
        entry.id,
        entry.ownerType,
        entry.ownerId,
        entry.path,
        entry.format,
        entry.size,
        entry.hash ?? null,
        Number(entry.exists),
        entry.createdAt
      )
    return entry
  }

  archiveEntriesFor(ownerType?: ArchiveEntry['ownerType'], ownerId?: string): ArchiveEntry[] {
    return this.snapshot().archiveEntries.filter(
      (entry) => (!ownerType || entry.ownerType === ownerType) && (!ownerId || entry.ownerId === ownerId)
    )
  }

  saveImportMapping(data: Record<string, unknown>): void {
    this.connection
      .prepare('INSERT INTO import_mappings (id,data_json,created_at) VALUES (?,?,?)')
      .run(randomUUID(), JSON.stringify(data), now())
  }

  replaceFromBackup(
    snapshot: AppSnapshot,
    options: { restoreSettings: boolean; archiveDirectory: string }
  ): void {
    if (snapshot.schemaVersion !== 1) throw new Error('备份版本不受支持')
    this.database.transaction(() => {
      this.connection.exec(
        'DELETE FROM records; DELETE FROM characters; DELETE FROM module_sequences; DELETE FROM modules; DELETE FROM import_mappings; DELETE FROM archive_entries;'
      )
      for (const module of snapshot.modules) {
        this.connection
          .prepare('INSERT INTO modules VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            module.id,
            module.name,
            JSON.stringify(cleanKps(module.kps)),
            JSON.stringify(cleanPairs(module.pairs)),
            module.order,
            Number(module.collapsed),
            module.createdAt,
            module.updatedAt
          )
        const maximum = snapshot.records
          .filter((record) => record.moduleId === module.id)
          .reduce((value, record) => Math.max(value, record.sequenceNo), 0)
        this.connection
          .prepare('INSERT INTO module_sequences (module_id,maximum) VALUES (?,?)')
          .run(module.id, maximum)
      }
      for (const record of snapshot.records) {
        this.connection
          .prepare(
            `INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,previous_status,play_date,date_source,fetched_at,raw_json,manual_content,cache_source_url,last_error,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            record.id,
            record.moduleId,
            record.name,
            record.sequenceNo,
            record.link ?? null,
            record.sourceType,
            record.status,
            record.previousStatus ?? null,
            record.playDate ?? null,
            record.dateSource,
            null,
            null,
            record.manualContent ?? null,
            null,
            record.lastError ?? null,
            record.order,
            record.createdAt,
            record.updatedAt
          )
      }
      for (const character of snapshot.characters) {
        this.connection
          .prepare(
            'INSERT INTO characters (id,module_id,edition,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)'
          )
          .run(
            character.id,
            character.moduleId ?? null,
            character.edition,
            JSON.stringify(character),
            character.createdAt,
            character.updatedAt
          )
      }
      for (const mapping of snapshot.importMappings) {
        this.connection
          .prepare('INSERT INTO import_mappings (id,data_json,created_at) VALUES (?,?,?)')
          .run(randomUUID(), JSON.stringify(mapping), now())
      }
      for (const entry of snapshot.archiveEntries) {
        this.connection
          .prepare(
            'INSERT INTO archive_entries (id,owner_type,owner_id,path,format,size,hash,exists_flag,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
          )
          .run(
            entry.id,
            entry.ownerType,
            entry.ownerId,
            entry.path,
            entry.format,
            entry.size,
            entry.hash ?? null,
            Number(entry.exists),
            entry.createdAt
          )
      }
      if (options.restoreSettings) {
        const nextSettings = { ...snapshot.settings, archiveDirectory: options.archiveDirectory }
        this.connection
          .prepare('UPDATE settings SET data_json=?,updated_at=? WHERE id=1')
          .run(JSON.stringify(nextSettings), now())
      }
    })
  }

  clearBusinessData(options: { resetSettings: boolean; clearMappings: boolean }): void {
    this.database.transaction(() => {
      this.connection.exec(
        'DELETE FROM records; DELETE FROM characters; DELETE FROM module_sequences; DELETE FROM modules; DELETE FROM archive_entries;'
      )
      if (options.clearMappings) this.connection.exec('DELETE FROM import_mappings;')
      if (options.resetSettings)
        this.connection
          .prepare('UPDATE settings SET data_json=?,updated_at=? WHERE id=1')
          .run(JSON.stringify(defaultSettings(this.fallbackArchiveDirectory)), now())
    })
  }

  private ensureSettings(): void {
    const exists = this.connection.prepare('SELECT 1 AS found FROM settings WHERE id = 1').get()
    if (!exists)
      this.connection
        .prepare('INSERT INTO settings (id,data_json,updated_at) VALUES (1,?,?)')
        .run(JSON.stringify(defaultSettings(this.fallbackArchiveDirectory)), now())
  }

  private getModule(id: string): ModuleRecord {
    const row = this.connection.prepare('SELECT * FROM modules WHERE id = ?').get(id)
    if (!row) throw new Error('模组不存在')
    return rowToModule(row as Record<string, unknown>)
  }

  private getRecord(id: string): SessionRecord {
    const row = this.connection.prepare('SELECT * FROM records WHERE id = ?').get(id)
    if (!row) throw new Error('场次不存在')
    return rowToRecord(row as Record<string, unknown>)
  }

  private getCharacter(id: string): CharacterData {
    const row = this.connection.prepare('SELECT data_json FROM characters WHERE id=?').get(id) as
      | { data_json: string }
      | undefined
    if (!row) throw new Error('角色卡不存在')
    return parseJson(row.data_json, {} as CharacterData)
  }

  private writeCharacter(character: CharacterData): void {
    character = normalizeCharacter(character)
    this.connection
      .prepare('UPDATE characters SET module_id=?,edition=?,data_json=?,updated_at=? WHERE id=?')
      .run(
        character.moduleIds[0] ?? null,
        character.edition,
        JSON.stringify(character),
        character.updatedAt,
        character.id
      )
  }

  private writeModulePairs(moduleId: string, pairs: ParticipantPair[]): void {
    this.connection
      .prepare('UPDATE modules SET pairs_json=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(cleanPairs(pairs)), now(), moduleId)
  }

  private linkCharacterToModule(character: CharacterData): void {
    for (const moduleId of character.moduleIds) {
      const module = this.getModule(moduleId)
      const existing = module.pairs.findIndex((pair) => pair.characterId === character.id)
      const pair = {
        pc: character.basic.name,
        pl: existing >= 0 ? module.pairs[existing]!.pl : '',
        characterId: character.id
      }
      const pairs = [...module.pairs]
      if (existing >= 0) pairs[existing] = pair
      else pairs.push(pair)
      this.writeModulePairs(module.id, pairs)
    }
  }

  private syncCharacterLinks(character: CharacterData): void {
    const selected = new Set(character.moduleIds)
    for (const module of this.snapshot().modules) {
      if (selected.has(module.id)) {
        this.linkCharacterToModule(character)
        continue
      }
      if (!module.pairs.some((pair) => pair.characterId === character.id)) {
        continue
      }
      this.writeModulePairs(
        module.id,
        module.pairs.map((pair) => (pair.characterId === character.id ? { pc: pair.pc, pl: pair.pl } : pair))
      )
    }
  }

  private syncCharacterName(characterId: string, name: string): void {
    const modules = this.snapshot().modules
    for (const module of modules) {
      if (!module.pairs.some((pair) => pair.characterId === characterId)) continue
      this.writeModulePairs(
        module.id,
        module.pairs.map((pair) => (pair.characterId === characterId ? { ...pair, pc: name } : pair))
      )
    }
  }

  private compactOrders(table: 'modules', column: 'sort_order'): void {
    const rows = this.connection.prepare(`SELECT id FROM ${table} ORDER BY ${column}`).all() as Array<{
      id: string
    }>
    const statement = this.connection.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`)
    rows.forEach((row, index) => statement.run(index, row.id))
  }

  private compactRecordOrders(moduleId: string): void {
    const rows = this.connection
      .prepare('SELECT id FROM records WHERE module_id=? ORDER BY sort_order')
      .all(moduleId) as Array<{ id: string }>
    const statement = this.connection.prepare('UPDATE records SET sort_order=? WHERE id=?')
    rows.forEach((row, index) => statement.run(index, row.id))
  }

  private moveRow(
    table: 'modules' | 'records',
    id: string,
    direction: -1 | 1,
    scopeColumn?: string,
    scopeValue?: string
  ): void {
    const where = scopeColumn ? `WHERE ${scopeColumn}=?` : ''
    const rows = this.connection
      .prepare(`SELECT id, sort_order FROM ${table} ${where} ORDER BY sort_order`)
      .all(...(scopeValue ? [scopeValue] : [])) as Array<{ id: string; sort_order: number }>
    const index = rows.findIndex((row) => row.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= rows.length) return
    const first = rows[index]!
    const second = rows[target]!
    const statement: StatementSync = this.connection.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`)
    this.database.transaction(() => {
      statement.run(-1, first.id)
      statement.run(first.sort_order, second.id)
      statement.run(second.sort_order, first.id)
    })
  }
}

export { cleanKps, cleanPairs, defaultSettings }
