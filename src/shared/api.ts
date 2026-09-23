import type {
  AppSettings,
  AppSnapshot,
  ArchiveEntry,
  CharacterData,
  ModulePlayStatus,
  ModuleRecord,
  ModuleResource,
  ModuleResourceKind,
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

/** 导图的一个画布：矢量 SVG 与统计信息 */
export interface MindmapPageApi {
  name: string
  title: string
  width: number
  height: number
  svg: string
  textCount: number
  /** 该画布的全部节点文字，供查看器内的节点搜索使用 */
  texts: string[]
}

export interface MindmapPreviewApi {
  /** html = EdrawMind 网页导出（图形完整）；emmx = 源文件解析 */
  format: 'html' | 'emmx'
  modifiedAt?: string
  /** 带层级的全部节点文字，供搜索、大纲展示与导出 */
  outline: Array<{ text: string; depth: number }>
  pages: MindmapPageApi[]
}

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
    create(input: {
      name: string
      playStatus: ModulePlayStatus
      kps?: string[]
      pairs?: ParticipantPair[]
    }): Promise<ModuleRecord>
    update(
      id: string,
      patch: {
        name?: string
        playStatus?: ModulePlayStatus
        kps?: string[]
        pairs?: ParticipantPair[]
        collapsed?: boolean
      }
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
    realignSequences(moduleId: string): Promise<number>
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
  resources: {
    create(input: {
      moduleId?: string
      kind: ModuleResourceKind
      title?: string
      path?: string
      url?: string
      note?: string
    }): Promise<ModuleResource>
    update(
      id: string,
      patch: { title?: string; path?: string; url?: string; note?: string }
    ): Promise<ModuleResource>
    delete(id: string): Promise<void>
    move(id: string, targetIndex: number): Promise<void>
    /** 把一个模组分组从资料汇总页移除（只影响该页显示，不动模组本身） */
    removeGroup(moduleId: string): Promise<AppSettings>
    /** 改归属模组；传 undefined 表示不属于任何模组 */
    setModule(id: string, moduleId: string | undefined): Promise<ModuleResource>
    /** 打开系统的文件选择框；导图与普通文件都用它 */
    chooseFiles(kind: ModuleResourceKind): Promise<Array<{ path: string; title: string }>>
    /** 读取导图并转成矢量 SVG 与层级大纲；只读，不改动原文件 */
    readMindmap(targetPath: string): Promise<MindmapPreviewApi>
    /** 读取任意本地图片为 data URL，供资料缩略图使用 */
    readImage(targetPath: string): Promise<string>
    /** 让用户重新选一个文件来更新这条资料；取消时返回 undefined */
    chooseReplacement(id: string): Promise<{ path: string; title: string } | undefined>
    /** 把资料指向新的文件 */
    relink(id: string, path: string, title?: string): Promise<ModuleResource>
    /** 把大纲导出成 markdown，返回文件路径 */
    exportOutline(targetPath: string, title: string): Promise<string>
    /** 取文件的系统真实图标（data URL）；读不到的位置为 undefined */
    fileIcons(paths: string[]): Promise<Array<string | undefined>>
    /** 用系统默认程序打开：导图交给 EdrawMind，链接交给浏览器 */
    open(id: string): Promise<void>
    checkPaths(paths: string[]): Promise<boolean[]>
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
    archiveStatus(): Promise<{ ok: boolean; reason?: string }>
    archiveDefault(): Promise<string>
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
