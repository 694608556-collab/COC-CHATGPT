import { randomUUID } from 'node:crypto'
import type { StatementSync } from 'node:sqlite'
import type {
  AppSettings,
  AppSnapshot,
  ArchiveEntry,
  CharacterData,
  ModulePlayStatus,
  NoteImage,
  NoteRecord,
  ModuleRecord,
  ParticipantPair,
  SessionRecord,
  SettingsPatch
} from '../shared/types'
import { DEFAULT_FILTER_PRESET } from '../shared/types'
import { parseDateFromText, parseSeaLogUrl } from '../shared/sea-log'
import { calculateDerived, convertCharacterEdition, createEmptyCharacter } from '../shared/coc-rules'
import { sessionNameFor, sessionNumberFromName } from '../shared/session-number'
import { realignRecordSequences } from './database'
import type { AppDatabase } from './database'

function now(): string {
  return new Date().toISOString()
}

function today(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

function rowToNote(row: Record<string, unknown>): NoteRecord {
  return {
    id: String(row.id),
    moduleName: String(row.module_name ?? ''),
    content: String(row.content ?? ''),
    images: parseJson<NoteImage[]>(row.images_json, []),
    noteDate: String(row.note_date),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function rowToModule(row: Record<string, unknown>): ModuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    // 老库由 v4 迁移补列，理论上不会为空；仍兜底成 not_started 以免界面崩掉
    playStatus: normalizePlayStatus(row.play_status),
    kps: parseJson(row.kps_json, []),
    pairs: parseJson(row.pairs_json, []),
    order: Number(row.sort_order),
    collapsed: Boolean(row.collapsed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function normalizePlayStatus(value: unknown): ModulePlayStatus {
  return value === 'finished' || value === 'running' || value === 'not_started'
    ? value
    : 'not_started'
}

/** 跑团状态是必选项：界面强制用户选择，后端再挡一道，避免写入非法值。 */
function assertPlayStatus(value: unknown): ModulePlayStatus {
  if (value === 'finished' || value === 'running' || value === 'not_started') return value
  throw new Error('请选择跑团状态')
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
    previousStatus: row.previous_status ? (row.previous_status as SessionRecord['previousStatus']) : undefined,
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
    const notes = this.listNotes()
    const importMappings = this.connection
      .prepare('SELECT data_json FROM import_mappings ORDER BY created_at')
      .all()
      .map((row) => parseJson((row as Record<string, unknown>).data_json, {}))
    return {
      schemaVersion: 2,
      exportedAt: now(),
      modules,
      records,
      characters,
      notes,
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

  createModule(input: {
    name: string
    playStatus: ModulePlayStatus
    kps?: string[]
    pairs?: ParticipantPair[]
  }): ModuleRecord {
    const name = input.name.trim()
    if (!name) throw new Error('模组名不能为空')
    const playStatus = assertPlayStatus(input.playStatus)
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
        .prepare(
          'INSERT INTO modules (id,name,play_status,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)'
        )
        .run(
          id,
          name,
          playStatus,
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
    patch: {
      name?: string
      playStatus?: ModulePlayStatus
      kps?: string[]
      pairs?: ParticipantPair[]
      collapsed?: boolean
    }
  ): ModuleRecord {
    const current = this.getModule(id)
    const name = patch.name === undefined ? current.name : patch.name.trim()
    if (!name) throw new Error('模组名不能为空')
    const playStatus =
      patch.playStatus === undefined ? current.playStatus : assertPlayStatus(patch.playStatus)
    const duplicate = this.connection
      .prepare('SELECT id FROM modules WHERE lower(name) = lower(?) AND id <> ?')
      .get(name, id)
    if (duplicate) throw new Error('已有同名模组')
    this.connection
      .prepare(
        'UPDATE modules SET name=?, play_status=?, kps_json=?, pairs_json=?, collapsed=?, updated_at=? WHERE id=?'
      )
      .run(
        name,
        playStatus,
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
    sequenceNo?: number
    status?: SessionRecord['status']
    fetchedAt?: string
  }): SessionRecord {
    const module = this.getModule(input.moduleId)
    const timestamp = now()
    const id = randomUUID()
    return this.database.transaction(() => {
      const sequenceRow = this.connection
        .prepare('SELECT maximum FROM module_sequences WHERE module_id = ?')
        .get(input.moduleId) as { maximum: number }
      const storedMaximum = Number(sequenceRow.maximum)
      const usedRows = this.connection
        .prepare('SELECT sequence_no FROM records WHERE module_id = ?')
        .all(input.moduleId) as Array<{ sequence_no: number }>
      const usedNumbers = new Set(usedRows.map((row) => Number(row.sequence_no)))
      // 默认接续现存场次的最大编号。0.6.2 起不再参考 module_sequences 的历史最大值：
      // 删除末尾场次不会留下空缺，界面不会弹出编号选择窗口，历史最大值会让编号
      // 凭空跳到“第 17 场”这类从未存在过的号段。删除场次造成的中间空缺仍由界面
      // 提示用户主动选择是否填补。
      const largestUsed = usedRows.reduce((value, row) => Math.max(value, Number(row.sequence_no)), 0)
      let sequenceNo: number
      if (input.sequenceNo !== undefined && input.sequenceNo !== null) {
        const requested = Number(input.sequenceNo)
        if (!Number.isInteger(requested) || requested < 1)
          throw new Error('场次编号必须是大于 0 的整数')
        if (requested > 9999) throw new Error('场次编号不能超过 9999')
        if (usedNumbers.has(requested))
          throw new Error(`第 ${requested} 场已存在，请选择其他编号`)
        sequenceNo = requested
      } else {
        // 0.6.6：名称里的“第 N 场”优先于“接续最大编号”。导入表格带进来的场次名
        // 已经写明了它是第几场，编号必须跟着名称走，否则名称连续、编号却有空洞，
        // 界面就会误判“编号缺失”并弹出选择窗口。名称没写编号（用户自己起的名）
        // 或该编号已被占用时，才退回接续最大编号。
        const named = sessionNumberFromName(input.name)
        sequenceNo = named !== undefined && !usedNumbers.has(named) ? named : largestUsed + 1
      }
      const nextMaximum = Math.max(storedMaximum, sequenceNo)
      this.connection
        .prepare('UPDATE module_sequences SET maximum = ? WHERE module_id = ?')
        .run(nextMaximum, input.moduleId)
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
      // 0.6.2 起导入不再采信表格里的历史状态：链接必须重新检测才能抓取正文。
      // 手动记录始终为 manual，其余情况默认 pending。
      const status = manualContent ? 'manual' : input.status ?? 'pending'
      const parsedDate = !input.playDate && manualContent ? parseDateFromText(manualContent) : undefined
      const playDate = input.playDate || parsedDate
      const dateSource = input.playDate ? 'manual' : parsedDate ? 'parsed' : 'none'
      const fetchedAt = input.fetchedAt?.trim() || undefined
      const name = input.name?.trim() || sessionNameFor(module.name, sequenceNo)
      this.connection
        .prepare(
          `INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,play_date,date_source,fetched_at,manual_content,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
          fetchedAt ?? null,
          manualContent ?? null,
          order,
          timestamp,
          timestamp
        )
      return this.getRecord(id)
    })
  }

  /**
   * 同一模组内该编号是否已被别的场次占用。改名推导编号时用来避让，
   * 编号是模组内唯一的，撞号时宁可保留原编号也不能写重复值。
   */
  private sequenceNumberTaken(moduleId: string, sequenceNo: number, excludingId: string): boolean {
    const row = this.connection
      .prepare('SELECT 1 AS found FROM records WHERE module_id=? AND sequence_no=? AND id<>? LIMIT 1')
      .get(moduleId, sequenceNo, excludingId) as { found?: number } | undefined
    return Boolean(row?.found)
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
    const name = patch.name?.trim() || current.name
    // 0.6.6：改名时编号跟着名称里的“第 N 场”走。导入表格按“场次名”重排编号后，
    // 若只改名称不改编号，两者就会分家，界面随即误判“编号缺失”。名称里没有编号、
    // 或该编号已被同一模组的其他场次占用时，保持原编号不动。
    const named = patch.name === undefined ? undefined : sessionNumberFromName(name)
    const sequenceNo =
      named !== undefined && named !== current.sequenceNo && !this.sequenceNumberTaken(current.moduleId, named, id)
        ? named
        : current.sequenceNo
    this.connection
      .prepare(
        `UPDATE records SET name=?,sequence_no=?,link=?,source_type=?,status=?,previous_status=?,play_date=?,date_source=?,fetched_at=?,raw_json=?,manual_content=?,cache_source_url=?,last_error=?,updated_at=? WHERE id=?`
      )
      .run(
        name,
        sequenceNo,
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

  /**
   * 重新导入表格后，链接必须重新检测才能抓取正文：把记录恢复成干净的“待检测”，
   * 一并清空已抓取的正文、抓取时间、缓存来源、错误信息和上一次状态。
   * 手动正文的场次不会被在线内容覆盖，保持 manual 不变。
   */
  resetRecordProbeState(id: string): SessionRecord {
    const current = this.getRecord(id)
    if (current.sourceType === 'manual' || current.manualContent) return current
    this.connection
      .prepare(
        `UPDATE records SET status='pending', previous_status=NULL, raw_json=NULL, fetched_at=NULL, cache_source_url=NULL, last_error=NULL, updated_at=? WHERE id=?`
      )
      .run(now(), id)
    return this.getRecord(id)
  }

  /**
   * 0.6.6：导入表格后统一校正一次编号。
   *
   * 导入是按行逐条改名改号的，遇到“两场编号互换”这类情况，逐条处理时目标编号
   * 还被对方占着，谁都动不了。整批改完再统一重排一次就能正确换过来。
   */
  realignModuleSequences(moduleId: string): number {
    this.getModule(moduleId)
    return this.database.transaction(() => realignRecordSequences(this.connection, moduleId))
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

  listNotes(): NoteRecord[] {
    return this.connection
      .prepare('SELECT * FROM notes ORDER BY created_at DESC')
      .all()
      .map((row) => rowToNote(row as Record<string, unknown>))
  }

  findNote(id: string): NoteRecord {
    const row = this.connection.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    if (!row) throw new Error('闲记不存在')
    return rowToNote(row as Record<string, unknown>)
  }

  createNote(input: {
    moduleName?: string
    content?: string
    noteDate?: string
    images?: NoteImage[]
  }): NoteRecord {
    const id = randomUUID()
    const timestamp = now()
    this.connection
      .prepare(
        'INSERT INTO notes (id,module_name,content,images_json,note_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      )
      .run(
        id,
        input.moduleName?.trim() ?? '',
        input.content ?? '',
        JSON.stringify(input.images ?? []),
        input.noteDate?.trim() || today(),
        timestamp,
        timestamp
      )
    return this.findNote(id)
  }

  updateNote(
    id: string,
    patch: {
      moduleName?: string
      content?: string
      noteDate?: string
      images?: NoteImage[]
    }
  ): NoteRecord {
    const current = this.findNote(id)
    this.connection
      .prepare('UPDATE notes SET module_name=?, content=?, images_json=?, note_date=?, updated_at=? WHERE id=?')
      .run(
        patch.moduleName === undefined ? current.moduleName : patch.moduleName,
        patch.content === undefined ? current.content : patch.content,
        JSON.stringify(patch.images === undefined ? current.images : patch.images),
        patch.noteDate === undefined ? current.noteDate : patch.noteDate.trim() || current.noteDate,
        now(),
        id
      )
    return this.findNote(id)
  }

  deleteNote(id: string): void {
    this.connection.prepare('DELETE FROM notes WHERE id = ?').run(id)
  }

  replaceFromBackup(
    snapshot: AppSnapshot,
    options: { restoreSettings: boolean; archiveDirectory: string }
  ): void {
    if (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2)
      throw new Error('备份版本不受支持')
    this.database.transaction(() => {
      this.connection.exec(
        'DELETE FROM records; DELETE FROM characters; DELETE FROM notes; DELETE FROM module_sequences; DELETE FROM modules; DELETE FROM import_mappings; DELETE FROM archive_entries;'
      )
      for (const module of snapshot.modules) {
        this.connection
          .prepare(
            'INSERT INTO modules (id,name,play_status,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
          )
          .run(
            module.id,
            module.name,
            // 旧备份没有这个字段，恢复时统一落到 not_started
            normalizePlayStatus(module.playStatus),
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
      for (const note of snapshot.notes ?? []) {
        this.connection
          .prepare(
            'INSERT INTO notes (id,module_name,content,images_json,note_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            note.id,
            note.moduleName ?? '',
            note.content ?? '',
            JSON.stringify(note.images ?? []),
            note.noteDate,
            note.createdAt,
            note.updatedAt
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
        'DELETE FROM records; DELETE FROM characters; DELETE FROM notes; DELETE FROM module_sequences; DELETE FROM modules; DELETE FROM archive_entries;'
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

  private syncCharacterLinks(character: CharacterData): void {
    const selected = new Set(character.moduleIds)
    for (const module of this.snapshot().modules) {
      if (selected.has(module.id)) continue
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
