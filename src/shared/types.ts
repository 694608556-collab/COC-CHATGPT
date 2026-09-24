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

/**
 * 模组资料的类型。
 *
 * - mindmap：EdrawMind 导图（.emmx），可解析出矢量预览与大纲文字
 * - link：网页链接（Notion 等），只存地址，点击用浏览器打开
 * - file：其他本地文件（PDF/Word/图片等），点击用系统默认程序打开
 */
export type ModuleResourceKind = 'mindmap' | 'link' | 'file'

export const MODULE_RESOURCE_KIND_LABELS: Record<ModuleResourceKind, string> = {
  mindmap: '思维导图',
  link: '链接',
  file: '文件'
}

export const MODULE_RESOURCE_KINDS: ModuleResourceKind[] = ['mindmap', 'link', 'file']

/**
 * 挂在模组下的一条资料。
 *
 * 软件只记路径、不复制文件：原文件改了立刻生效，但被移走时链接会失效，
 * 界面据此提示「文件找不到了」并让用户重新指定。
 *
 * 0.7.0 起 moduleId 可省略：资料允许不归属任何模组。
 */
export interface ModuleResource {
  id: string
  /** 省略表示未归属任何模组 */
  moduleId?: string
  kind: ModuleResourceKind
  title: string
  /** 本地文件的绝对路径；link 类型为空 */
  path?: string
  /** link 类型的网址 */
  url?: string
  note?: string
  sortOrder: number
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
  /**
   * 在「资料汇总」页被移除的分组。
   *
   * 分组是从模组列表实时算出来的，不记一笔的话删掉后一刷新又回来。
   * 这里只影响资料汇总页的显示：模组本身、场次、角色卡都不受影响。
   * 若之后又给这个分组添加资料，分组会自动重新出现（新资料总得有地方放）。
   *
   * 0.7.1：除了模组 id，还可以放 UNASSIGNED_GROUP 这个哨兵，用来记住
   * 「未归属模组」分组也被删掉了——它没有模组 id，0.7.0 因此删不掉。
   */
  hiddenResourceGroups?: string[]
  /**
   * 0.7.0 的字段名（当时只能存模组 id）。
   *
   * 保留是为了兼容旧数据：读取时会把这里的值合并进 hiddenResourceGroups，
   * 否则升级后用户此前删掉的分组会全部复活。
   */
  hiddenResourceModules?: string[]
  windowState?: {
    x?: number
    y?: number
    width: number
    height: number
    maximized: boolean
  }
}

/**
 * 「未归属模组」分组的哨兵标记。
 *
 * 未归属分组没有模组 id，但用户同样可以把它整个删掉；用这个固定值占一个位置，
 * 就能和模组分组共用同一份隐藏列表与同一套增删逻辑。
 * 取值刻意不是 uuid 的形状，避免与真实模组 id 相撞。
 */
export const UNASSIGNED_GROUP = '__unassigned__'

export interface SettingsPatch {
  theme?: AppSettings['theme']
  archiveDirectory?: string
  filterPreset?: Partial<FilterPreset>
  autoBackup?: Partial<AppSettings['autoBackup']>
  hiddenResourceGroups?: string[]
  hiddenResourceModules?: string[]
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
  resources: ModuleResource[]
}
