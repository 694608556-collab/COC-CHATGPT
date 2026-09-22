import * as XLSX from 'xlsx'
import type { ParticipantPair } from './types'

// 空白模板默认提供 1 位 KP、3 对 PC/PL 的位置
export const TABLE_TEMPLATE_KP_COUNT = 1
export const TABLE_TEMPLATE_PAIR_COUNT = 3

export const TABLE_TEMPLATE_HEADERS = [
  '模组名',
  '场次名',
  '海豹链接',
  'KP1',
  'PC1',
  'PL1',
  'PC2',
  'PL2',
  'PC3',
  'PL3'
] as const

// 仅出现在导出文件、空白模板不提供的三列；导入导出再导入时需要原样带回
export const TABLE_EXPORT_ONLY_HEADERS = ['状态', '跑团日期', '最近抓取时间'] as const

export interface TableImportRow {
  sheet: string
  moduleName: string
  sessionName: string
  link: string
  kps: string[]
  pairs: ParticipantPair[]
  status?: string
  playDate?: string
  fetchedAt?: string
}

export interface ImportedParticipants {
  kps: string[]
  pairs: ParticipantPair[]
}

type RawCell = unknown

function text(value: RawCell): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

const moduleAliases = ['模组名', '模组名称', '模组', '团名', 'module']
const sessionAliases = ['场次名', '场次', '场次名称', '名称', 'session']
const linkAliases = ['海豹链接', '日志链接', '链接', '地址', '网址', 'url', 'link']
const statusAliases = ['状态', 'status']
const dateAliases = ['跑团日期', '日期', 'date']
const fetchedAtAliases = ['最近抓取时间', '抓取时间', 'fetchedat']
const legacyParticipantAliases = ['参与者', '参与人', '玩家', 'participants']

function matchAlias(value: string, aliases: readonly string[]): boolean {
  const normalized = value.trim().toLowerCase()
  return aliases.some((alias) => alias.toLowerCase() === normalized)
}

interface SheetColumnMap {
  module: number
  session: number
  link: number
  status?: number
  playDate?: number
  fetchedAt?: number
  legacyParticipants?: number
  kpColumns: Map<number, number>
  pcColumns: Map<number, number>
  plColumns: Map<number, number>
}

function findHeaderRow(rows: RawCell[][]): number {
  return rows.findIndex((row) => {
    const cells = row.map((cell) => text(cell))
    const hasModule = cells.some((cell) => matchAlias(cell, moduleAliases))
    const hasSession = cells.some((cell) => matchAlias(cell, sessionAliases))
    return hasModule && hasSession
  })
}

function mapColumns(header: RawCell[]): SheetColumnMap {
  const map: SheetColumnMap = {
    module: -1,
    session: -1,
    link: -1,
    kpColumns: new Map(),
    pcColumns: new Map(),
    plColumns: new Map()
  }
  header.forEach((cell, index) => {
    const label = text(cell)
    if (!label) return
    if (map.module < 0 && matchAlias(label, moduleAliases)) map.module = index
    else if (map.session < 0 && matchAlias(label, sessionAliases)) map.session = index
    else if (map.link < 0 && matchAlias(label, linkAliases)) map.link = index
    else if (map.status === undefined && matchAlias(label, statusAliases)) map.status = index
    else if (map.playDate === undefined && matchAlias(label, dateAliases)) map.playDate = index
    else if (map.fetchedAt === undefined && matchAlias(label, fetchedAtAliases)) map.fetchedAt = index
    else if (map.legacyParticipants === undefined && matchAlias(label, legacyParticipantAliases))
      map.legacyParticipants = index
    const kp = label.match(/^KP\s*(\d+)$/i)
    if (kp) map.kpColumns.set(Number(kp[1]), index)
    const pc = label.match(/^PC\s*(\d+)$/i)
    if (pc) map.pcColumns.set(Number(pc[1]), index)
    const pl = label.match(/^PL\s*(\d+)$/i)
    if (pl) map.plColumns.set(Number(pl[1]), index)
  })
  return map
}

function participantsFromRow(values: RawCell[], columnMap: SheetColumnMap): ImportedParticipants {
  const kps: string[] = []
  const pairs = new Map<number, ParticipantPair>()
  for (const column of columnMap.kpColumns.values()) {
    const name = text(values[column])
    if (name) kps.push(name)
  }
  for (const [index, column] of columnMap.pcColumns) {
    pairs.set(index, { ...(pairs.get(index) ?? { pc: '', pl: '' }), pc: text(values[column]) })
  }
  for (const [index, column] of columnMap.plColumns) {
    pairs.set(index, { ...(pairs.get(index) ?? { pc: '', pl: '' }), pl: text(values[column]) })
  }
  const orderedPairs = [...pairs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pair]) => pair)
    .filter((pair) => pair.pc || pair.pl)
  let result: ImportedParticipants = { kps, pairs: orderedPairs }
  if (columnMap.legacyParticipants !== undefined) {
    result = mergeImportedParticipants(result, parseImportedParticipants(text(values[columnMap.legacyParticipants])))
  }
  return {
    kps: uniq(result.kps),
    pairs: uniqPairs(result.pairs)
  }
}

const validStatuses = new Set(['pending', 'valid', 'fetch_failed', 'manual'])

function isNoteRow(values: RawCell[]): boolean {
  const first = values.map((cell) => text(cell)).find(Boolean)
  if (!first) return false
  return /^#|^填写说明|^说明[：:]/.test(first)
}

export function parseImportSheet(sheetName: string, rows: RawCell[][]): TableImportRow[] {
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) return []
  const columnMap = mapColumns(rows[headerIndex] ?? [])
  const result: TableImportRow[] = []
  for (const values of rows.slice(headerIndex + 1)) {
    if (isNoteRow(values)) break
    const moduleName = columnMap.module >= 0 ? text(values[columnMap.module]) : ''
    const sessionName = columnMap.session >= 0 ? text(values[columnMap.session]) : ''
    const link = columnMap.link >= 0 ? text(values[columnMap.link]) : ''
    if (!moduleName && !sessionName && !link) continue
    const participants = participantsFromRow(values, columnMap)
    const status = columnMap.status !== undefined ? text(values[columnMap.status]) : ''
    const playDate = columnMap.playDate !== undefined ? text(values[columnMap.playDate]) : ''
    const fetchedAt = columnMap.fetchedAt !== undefined ? text(values[columnMap.fetchedAt]) : ''
    result.push({
      sheet: sheetName,
      moduleName,
      sessionName,
      link,
      kps: participants.kps,
      pairs: participants.pairs,
      ...(status && validStatuses.has(status) ? { status } : {}),
      ...(playDate ? { playDate } : {}),
      ...(fetchedAt && /^\d{4}-\d{2}-\d{2}T/.test(fetchedAt) ? { fetchedAt } : {})
    })
  }
  return result
}

export function parseImportWorkbook(workbook: XLSX.WorkBook): TableImportRow[] {
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name]
    if (!sheet) return []
    const rows = XLSX.utils.sheet_to_json<RawCell[]>(sheet, { header: 1, defval: '', raw: true })
    return parseImportSheet(name, rows)
  })
}

export function validateTableImportRow(row: TableImportRow): string | undefined {
  if (!row.moduleName) return '缺少模组名称'
  if (!row.sessionName) return '缺少场次名'
  if (!/^https?:\/\//i.test(row.link)) return '缺少完整海豹链接'
  return undefined
}

// 兼容旧版“参与者”一列的自由文本写法
export function parseImportedParticipants(value: string): ImportedParticipants {
  const kps: string[] = []
  const pairs: ParticipantPair[] = []
  for (const raw of value.split(/[;；\n]+/)) {
    const segment = raw.trim()
    if (!segment) continue
    const kp = segment.match(/^KP\s*[:：]?\s*(.+)$/i)
    if (kp?.[1]) {
      kps.push(kp[1].trim())
      continue
    }
    const pl = segment.match(/^PL\s*[:：]?\s*(.+)$/i)
    if (pl?.[1]) {
      pairs.push({ pc: '', pl: pl[1].trim() })
      continue
    }
    const pair = segment.match(
      /^(?:PC\s*[:：]?\s*)?(.+?)\s*[/／|｜]\s*(?:PL\s*[:：]?\s*)?(.+)$/i
    )
    if (pair?.[1] && pair?.[2]) {
      pairs.push({ pc: pair[1].trim(), pl: pair[2].trim() })
      continue
    }
    const names = segment
      .replace(/^PC\s*[:：]?\s*/i, '')
      .split(/[、,，]+/)
      .map((name) => name.trim())
      .filter(Boolean)
    for (const name of names) pairs.push({ pc: name, pl: '' })
  }
  return {
    kps: uniq(kps),
    pairs: uniqPairs(pairs)
  }
}

export function mergeImportedParticipants(
  current: ImportedParticipants,
  incoming: ImportedParticipants
): ImportedParticipants {
  return {
    kps: uniq([...current.kps, ...incoming.kps]),
    pairs: uniqPairs([...current.pairs, ...incoming.pairs])
  }
}

const templateNotes = [
  '填写说明：',
  '1. 每行一场；PC/PL 必须按列成对填写：PC1/PL1、PC2/PL2、PC3/PL3，没有对应人员的格子留空。',
  '2. KP 填在 KP1 列；人员更多时按 KP2、PC4/PL4 的规律自行加列。',
  '3. 状态、跑团日期、最近抓取时间由软件导出时自动记录，空白模板无需填写。',
  '4. 每个模组可使用一个独立工作表，工作表名称建议与模组名一致。',
  '5. 导入前请删除示例行。'
]

export function buildTableImportTemplateCsv(): string {
  const example = ['暗影循迹', '第一场', 'https://log.weizaima.com/?key=...', '阿默', '艾伦', '李四', '夏恩', '王五', '', '']
  const lines = [TABLE_TEMPLATE_HEADERS.join(','), example.join(','), '', ...templateNotes.map((line) => `# ${line}`)]
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

export function buildTableImportTemplateXlsx(): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const example = ['暗影循迹', '第一场', 'https://log.weizaima.com/?key=...', '阿默', '艾伦', '李四', '夏恩', '王五', '', '']
  const aoa: RawCell[][] = [
    [...TABLE_TEMPLATE_HEADERS],
    example,
    [''],
    ...templateNotes.map((line) => [line])
  ]
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!cols'] = TABLE_TEMPLATE_HEADERS.map((header) => ({
    wch: Math.max(12, header.length * 2 + 8)
  }))
  XLSX.utils.book_append_sheet(workbook, sheet, '导入模板')
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  return new Uint8Array(output)
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function uniqPairs(values: ParticipantPair[]): ParticipantPair[] {
  const seen = new Set<string>()
  return values.filter((pair) => {
    const key = `${pair.pc}\u0000${pair.pl}`
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(pair.pc || pair.pl)
  })
}
