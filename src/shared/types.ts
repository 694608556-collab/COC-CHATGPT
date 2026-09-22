export type RecordStatus = 'pending' | 'valid' | 'invalid' | 'fetch_failed' | 'manual'
export type Edition = 6 | 7

/** 模组的跑团进度，用于在模组列表里一眼看出这个团跑到哪了。 */
export type ModulePlayStatus = 'finished' | 'running' | 'not_started'

export const MODULE_PLAY_STATUS_LABELS: Record<ModulePlayStatus, string> = {
  finished: '已完成',
  running: '进行中',
  not_started: '未开始'
}

export const MODULE_PLAY_STATUSES: ModulePlayStatus[] = ['not_started', 'running', 'finished']

/**
 * 表格里既可能写中文标签（进行中）也可能写英文枚举值（running），两者都认。
 * 认不出来或留空时返回 undefined，由调用方决定默认值。
 */
export function parseModulePlayStatus(value: unknown): ModulePlayStatus | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  if (text === 'finished' || text === 'running' || text === 'not_started') return text
  const matched = MODULE_PLAY_STATUSES.find((status) => MODULE_PLAY_STATUS_LABELS[status] === text)
  return matched
}

export interface ParticipantPair {
  pc: string
  pl: string
  characterId?: string
}

export interface ModuleRecord {
  id: string
  name: string
  playStatus: ModulePlayStatus
  kps: string[]
  pairs: ParticipantPair[]
  order: number
  collapsed: boolean
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  id: string
  moduleId: string
  name: string
  sequenceNo: number
  link?: string
  sourceType: 'online' | 'manual'
  status: RecordStatus
  previousStatus?: RecordStatus
  playDate?: string
  dateSource: 'parsed' | 'manual' | 'none'
  fetchedAt?: string
  rawContent?: NormalizedLog
  manualContent?: string
  cacheSourceUrl?: string
  lastError?: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface LogImage {
  url: string
  alt?: string
}

export interface LogMessage {
  id: string
  order: number
  timestamp?: string
  displayName: string
  platformAccount?: string
  text: string
  type: string
  isDiceCommand: boolean
  isOffTopic: boolean
  images: LogImage[]
  raw?: unknown
}

export interface NormalizedLog {
  title?: string
  messages: LogMessage[]
  sourceUrl?: string
  responseHash?: string
  parserVersion: number
}

export interface FilterPreset {
  hideDiceCommands: boolean
  hideImages: boolean
  hideOffTopic: boolean
  hideTime: boolean
  hidePlatformAccount: boolean
  hideYearMonthDay: boolean
  indentFirstLine: boolean
  darkDisplay: boolean
}

export const DEFAULT_FILTER_PRESET: FilterPreset = {
  hideDiceCommands: false,
  hideImages: false,
  hideOffTopic: false,
  hideTime: false,
  hidePlatformAccount: true,
  hideYearMonthDay: true,
  indentFirstLine: false,
  darkDisplay: false
}

export interface Skill {
  id: string
  name: string
  base: number
  occupation: number
  interest: number
  growth: number
  hidden?: boolean
  builtIn?: boolean
  mappingState?: 'ok' | 'review' | 'unmapped'
}

export interface CharacterData {
  id: string
  moduleId?: string
  moduleIds: string[]
  edition: Edition
  basic: {
    name: string
    occupation: string
    age: string
    gender: string
    birthplace: string
    residence: string
  }
  attrs: Record<'STR' | 'CON' | 'SIZ' | 'DEX' | 'APP' | 'INT' | 'POW' | 'EDU', number>
  editionSnapshots: Partial<Record<Edition, Record<string, number>>>
  derived: {
    hpCurrent: number
    mpCurrent: number
    sanCurrent: number
    luck6?: number
    luck7?: number
    db: string
  }
  occupationFormula: string
  occupationPointOverride?: number
  skills: Skill[]
  weapons: Array<Record<string, string | number>>
  items: string[]
  background: Record<string, string>
  story: string
  createdAt: string
  updatedAt: string
}

export interface NoteImage {
  path: string
  name: string
}

export interface NoteRecord {
  id: string
  moduleName: string
  content: string
  images: NoteImage[]
  noteDate: string
  createdAt: string
  updatedAt: string
}

export interface ArchiveEntry {
  id: string
  ownerType: 'record' | 'module' | 'character' | 'backup'
  ownerId: string
  path: string
  format: string
  size: number
  hash?: string
  exists: boolean
  createdAt: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  archiveDirectory: string
  filterPreset: FilterPreset
  autoBackup: {
    enabled: boolean
    interval: 'idle' | 'daily' | 'weekly'
    retention: number
  }
  windowState?: {
    x?: number
    y?: number
    width: number
    height: number
    maximized: boolean
  }
}

export interface SettingsPatch {
  theme?: AppSettings['theme']
  archiveDirectory?: string
  filterPreset?: Partial<FilterPreset>
  autoBackup?: Partial<AppSettings['autoBackup']>
  windowState?: AppSettings['windowState']
}

export interface AppSnapshot {
  schemaVersion: 1 | 2
  exportedAt: string
  modules: ModuleRecord[]
  records: SessionRecord[]
  characters: CharacterData[]
  notes: NoteRecord[]
  settings: AppSettings
  importMappings: unknown[]
  archiveEntries: ArchiveEntry[]
}
