import type { ParticipantPair } from './types'

export const TABLE_IMPORT_HEADERS = [
  '\u6a21\u7ec4\u540d\u79f0',
  '\u573a\u6b21',
  '\u6d77\u8c79\u94fe\u63a5',
  '\u53c2\u4e0e\u8005'
] as const

export interface TableImportRow {
  moduleName: string
  sessionName: string
  link: string
  participants: string
}

export interface ImportedParticipants {
  kps: string[]
  pairs: ParticipantPair[]
}

type RawRow = Record<string, unknown>

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function pick(row: RawRow, aliases: readonly string[]): string {
  const entries = Object.entries(row)
  for (const alias of aliases) {
    const match = entries.find(([key]) => key.trim().toLowerCase() === alias.toLowerCase())
    if (match) return text(match[1])
  }
  return ''
}

export function normalizeTableImportRows(rows: RawRow[]): TableImportRow[] {
  return rows.map((row) => ({
    moduleName: pick(row, [
      '\u6a21\u7ec4\u540d\u79f0',
      '\u6a21\u7ec4\u540d',
      '\u6a21\u7ec4',
      '\u56e2\u540d',
      'module'
    ]),
    sessionName: pick(row, ['\u573a\u6b21', '\u573a\u6b21\u540d\u79f0', '\u540d\u79f0', 'session']),
    link: pick(row, [
      '\u6d77\u8c79\u94fe\u63a5',
      '\u94fe\u63a5',
      '\u5730\u5740',
      '\u7f51\u5740',
      'link',
      'url'
    ]),
    participants: pick(row, ['\u53c2\u4e0e\u8005', '\u53c2\u4e0e\u4eba', '\u73a9\u5bb6', 'participants'])
  }))
}

export function validateTableImportRow(row: TableImportRow): string | undefined {
  if (!row.moduleName) return '\u7f3a\u5c11\u6a21\u7ec4\u540d\u79f0'
  if (!row.sessionName) return '\u7f3a\u5c11\u573a\u6b21'
  if (!/^https?:\/\//i.test(row.link)) {
    return '\u7f3a\u5c11\u5b8c\u6574\u6d77\u8c79\u94fe\u63a5'
  }
  return undefined
}

export function parseImportedParticipants(value: string): ImportedParticipants {
  const kps: string[] = []
  const pairs: ParticipantPair[] = []
  for (const raw of value.split(/[;\uff1b\n]+/)) {
    const segment = raw.trim()
    if (!segment) continue
    const kp = segment.match(/^KP\s*[:\uff1a]?\s*(.+)$/i)
    if (kp?.[1]) {
      kps.push(kp[1].trim())
      continue
    }
    const pl = segment.match(/^PL\s*[:\uff1a]?\s*(.+)$/i)
    if (pl?.[1]) {
      pairs.push({ pc: '', pl: pl[1].trim() })
      continue
    }
    const pair = segment.match(
      /^(?:PC\s*[:\uff1a]?\s*)?(.+?)\s*[/\uff0f|\uff5c]\s*(?:PL\s*[:\uff1a]?\s*)?(.+)$/i
    )
    if (pair?.[1] && pair[2]) {
      pairs.push({ pc: pair[1].trim(), pl: pair[2].trim() })
      continue
    }
    const names = segment
      .replace(/^PC\s*[:\uff1a]?\s*/i, '')
      .split(/[\u3001,\uff0c]+/)
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

export function buildTableImportTemplate(): string {
  return '\ufeff' + TABLE_IMPORT_HEADERS.join(',') + '\r\n'
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
