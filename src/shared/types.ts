export type RecordStatus = 'pending' | 'valid' | 'invalid' | 'fetch_failed' | 'manual'
export type Edition = 6 | 7

export interface ParticipantPair {
  pc: string
  pl: string
  characterId?: string
}

export interface ModuleRecord {
  id: string
  name: string
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
