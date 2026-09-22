import type {
  AppSettings,
  AppSnapshot,
  ArchiveEntry,
  CharacterData,
  ModuleRecord,
  NoteImage,
  NoteRecord,
  ParticipantPair,
  SessionRecord,
  SettingsPatch
} from './types'
import type { SerializedAppError } from './errors'
import type { CharacterField } from './character-template'

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: SerializedAppError }
export type RecordExportFormat = 'raw' | 'doc' | 'dialogue-doc' | 'docx' | 'txt' | 'pdf'
export type CombinedExportFormat = 'txt' | 'docx' | 'pdf'

export interface BatchExportResult {
  id: string
  type: string
  state: 'queued' | 'running' | 'completed' | 'cancelled'
  total: number
  completed: number
  currentItem?: string
  results: Array<{
    id: string
    state: 'success' | 'skipped' | 'failed'
    value?: ArchiveEntry
    reason?: string
  }>
}

export interface CombinedExportApiResult {
  entry: ArchiveEntry
  included: string[]
  failed: Array<{ id: string; reason: string }>
}

export interface CharacterImportPreviewApi {
  token: string
  fileName: string
  sheets: Array<{
    sheetName: string
    edition: 6 | 7
    confidence: number
    mapping: Partial<Record<CharacterField, string>>
    values: Partial<Record<CharacterField, string | number>>
    skillHeaderRow?: number
    warnings: string[]
    cells: Array<{ address: string; value: string | number }>
  }>
}

export interface BackupPreviewApi {
  token: string
  format: 'json' | 'zip'
  exportedAt: string
  modules: number
  records: number
  characters: number
  archiveFiles: number
  archiveBytes: number
  warnings: string[]
}

export interface CocApi {
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    getBounds(): Promise<{
      x: number
      y: number
      width: number
      height: number
    }>
    setBounds(bounds: {
      x: number
      y: number
      width: number
      height: number
    }): Promise<void>
    isMaximized(): Promise<boolean>
  }
  app: {
    snapshot(): Promise<AppSnapshot>
    version(): Promise<string>
  }
  modules: {
    create(input: { name: string; kps?: string[]; pairs?: ParticipantPair[] }): Promise<ModuleRecord>
    update(
      id: string,
      patch: { name?: string; kps?: string[]; pairs?: ParticipantPair[]; collapsed?: boolean }
    ): Promise<ModuleRecord>
    delete(id: string): Promise<void>
    move(id: string, direction: -1 | 1): Promise<void>
  }
  records: {
    create(input: {
      moduleId: string
      name?: string
      link?: string
      manualContent?: string
      playDate?: string
      sequenceNo?: number
      status?: SessionRecord['status']
      fetchedAt?: string
    }): Promise<SessionRecord>
    update(
      id: string,
      patch: Partial<
        Pick<
          SessionRecord,
          'name' | 'link' | 'manualContent' | 'playDate' | 'dateSource' | 'status' | 'fetchedAt'
        >
      >
    ): Promise<SessionRecord>
    delete(id: string): Promise<void>
    move(id: string, direction: -1 | 1): Promise<void>
    findDuplicate(moduleId: string, link: string, excludingId?: string): Promise<SessionRecord | undefined>
    probe(id: string): Promise<SessionRecord>
    resetProbe(id: string): Promise<SessionRecord>
  }
  characters: {
    create(input: {
      edition: 6 | 7
      moduleId?: string
      moduleIds?: string[]
      name?: string
    }): Promise<CharacterData>
    update(id: string, data: CharacterData): Promise<CharacterData>
    convert(id: string, edition: 6 | 7): Promise<CharacterData>
    move(
      id: string,
      moduleId: string | undefined,
      oldModulePolicy: 'remove' | 'retain-name' | 'cancel'
    ): Promise<CharacterData>
    delete(id: string): Promise<void>
  }
  notes: {
    create(input: {
      moduleName?: string
      content?: string
      noteDate?: string
      images?: NoteImage[]
    }): Promise<NoteRecord>
    update(
      id: string,
      patch: {
        moduleName?: string
        content?: string
        noteDate?: string
        images?: NoteImage[]
      }
    ): Promise<NoteRecord>
    delete(id: string): Promise<void>
  }
  settings: {
    update(patch: SettingsPatch): Promise<AppSettings>
  }
  files: {
    exportRecord(id: string, format: RecordExportFormat): Promise<ArchiveEntry>
    batchExport(ids: string[], format: RecordExportFormat): Promise<BatchExportResult>
    exportCombined(ids: string[], format: CombinedExportFormat): Promise<CombinedExportApiResult>
    exportTable(ids: string[] | undefined, format: 'csv' | 'xlsx'): Promise<ArchiveEntry>
    exportCharacter(id: string, format: 'xlsx' | 'pdf'): Promise<ArchiveEntry>
    saveCharacterTemplate(edition: 6 | 7): Promise<ArchiveEntry>
    chooseCharacterImport(): Promise<CharacterImportPreviewApi | undefined>
    commitCharacterImport(
      token: string,
      selections: Array<{
        sheetName: string
        edition: 6 | 7
        moduleId?: string
        mapping: Partial<Record<CharacterField, string>>
        skillHeaderRow?: number
        mappingName?: string
      }>
    ): Promise<CharacterData[]>
    chooseNoteImage(): Promise<NoteImage[]>
    pasteNoteImage(input: { name: string; bytes: Uint8Array }): Promise<NoteImage>
    chooseArchiveDirectory(): Promise<string | undefined>
    openDirectory(kind: 'archive' | 'data' | 'logs' | 'module', moduleId?: string): Promise<void>
    showItem(targetPath: string): Promise<void>
  }
  backup: {
    create(includeArchives: boolean): Promise<{ path: string; format: 'json' | 'zip'; size: number }>
    chooseRestore(): Promise<BackupPreviewApi | undefined>
    restore(token: string, options: { restoreSettings: boolean; archiveDirectory?: string }): Promise<void>
    cacheStats(): Promise<{ bytes: number; files: number }>
    clearCache(): Promise<{ bytes: number; files: number }>
    clearData(options: {
      resetSettings: boolean
      clearMappings: boolean
      deleteRegisteredArchives: boolean
    }): Promise<number>
  }
}
