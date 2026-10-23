import type { LogbookPort } from '../data/native'
import type { MobileSnapshot } from '../data/types'
import type { NativeTablePreview } from '../data/table-stream-native'
import type { TableImportRow } from '../../../src/shared/table-import'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import { decodeBase64, encodeBase64 } from '../data/bytes'
import { importTable } from '../data/tables'
import { publicCoc7Workbook } from '../../test-fixtures/coc7'
import * as XLSX from 'xlsx'
import type { TablePreview } from '../data/tables'

/** Public browser fixture only. The real Worker/parser runs; native SQLite is
 * simulated with the existing small-file import oracle and IndexedDB port.
 * It must never be reported as native capacity, authorization or phone timing. */
export const publicTableStreamPath = '/_capacitor_file_/public-table-stream.csv'
export const publicTableStreamCardPath = '/_capacitor_file_/public-table-stream-card.xlsx'
export function publicTableStreamCardBytes() {
  const book = publicCoc7Workbook()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(
    Array.from({ length: 65 }, (_, i) => [`public-auxiliary-${i}-`.padEnd(10000, 'x')])
  ), '公开辅助说明')
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true }))
}
const encoder = new TextEncoder()
function csvCell(value: string) {
  return '"' + value.replace(/"/g, '""') + '"'
}
export function publicTableStreamCSV(count = 205): string {
  return [
    '模组名,场次名,海豹链接,手动保存内容,KP1,PC1,PL1',
    ...Array.from({ length: count }, (_, index) =>
      [
        '公开流式团',
        `公开完整场次${index}`,
        '',
        `公开完整正文 ${index}\n保留逗号,引号"和😀末尾`,
        '公开KP',
        '公开PC',
        '公开PL'
      ]
        .map(csvCell)
        .join(',')
    )
  ].join('\r\n')
}
interface Options {
  pickerDelayMs: number
  commitDelayMs: number
  rows: number
  badSourceHash: boolean
  badCandidateHash: boolean
}
interface Stats {
  opened: number
  chunks: number
  candidateBytes: number
  frames: number
  previews: number
  commits: number
  cancellations: number
  pages: number[]
  active: boolean
}
interface FixtureControl {
  options: Options
  stats: Stats
  state(): ReturnType<LogbookPort['getState']>
}
declare global {
  interface Window {
    __publicTableStreamFixture?: FixtureControl
  }
}
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)),
    (value) => value.toString(16).padStart(2, '0')
  ).join('')
}
function join(chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
function oracleCSV(rows: TableImportRow[]) {
  const kps = Math.max(0, ...rows.map((row) => row.kps.length)),
    pairs = Math.max(0, ...rows.map((row) => row.pairs.length))
  const headers = [
    '模组名',
    '场次名',
    '海豹链接',
    '手动保存内容',
    '跑团日期',
    ...Array.from({ length: kps }, (_, i) => `KP${i + 1}`),
    ...Array.from({ length: pairs }, (_, i) => [`PC${i + 1}`, `PL${i + 1}`]).flat()
  ]
  return [
    headers,
    ...rows.map((row) => [
      row.moduleName,
      row.sessionName,
      row.link,
      row.manualContent ?? '',
      row.playDate ?? '',
      ...Array.from({ length: kps }, (_, i) => row.kps[i] ?? ''),
      ...Array.from({ length: pairs }, (_, i) => [row.pairs[i]?.pc ?? '', row.pairs[i]?.pl ?? '']).flat()
    ])
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')
}
export function createTableStreamFixture(base: LogbookPort): LogbookPort {
  const options: Options = {
    pickerDelayMs: 0,
    commitDelayMs: 0,
    rows: 205,
    badSourceHash: false,
    badCandidateHash: false
  }
  const stats: Stats = {
    opened: 0,
    chunks: 0,
    candidateBytes: 0,
    frames: 0,
    previews: 0,
    commits: 0,
    cancellations: 0,
    pages: [],
    active: false
  }
  type Lease = {
    id: string
    revision: number
    archive: string
    chunks: { candidate: Uint8Array[]; strings: Uint8Array[] }
    preview?: TablePreview
    summary?: NativeTablePreview
  }
  let lease: Lease | undefined
  window.__publicTableStreamFixture = { options, stats, state: () => base.getState() }
  function owner(id: string) {
    if (!lease || lease.id !== id) throw new Error('公开测试表格租约已失效。')
    return lease
  }
  async function check(id: string) {
    const current = owner(id),
      state = await base.getState()
    if (state.revision !== current.revision || !state.archive.valid || state.archive.uri !== current.archive)
      throw new Error('数据或测试目录已变化，请重新预览。')
    return { current, state }
  }
  return {
    ...base,
    async getState() {
      return { ...(await base.getState()), tableStreamVersion: 1 }
    },
    async getOverview() {
      return { ...(await base.getOverview()), tableStreamVersion: 1 }
    },
    async openBackup(request) {
      if (!request?.stream || !['record-table', 'character-table'].includes(request.kind ?? '')) return base.openBackup(request)
      await new Promise((resolve) => setTimeout(resolve, options.pickerDelayMs))
      const state = await base.getState()
      if (lease || !state.archive.valid || state.revision !== request.expectedRevision)
        throw new Error('公开测试表格状态无效。')
      const card = request.kind === 'character-table'
      const bytes = card ? publicTableStreamCardBytes() : encoder.encode(publicTableStreamCSV(options.rows)),
        id = crypto.randomUUID()
      lease = {
        id,
        revision: state.revision,
        archive: state.archive.uri,
        chunks: { candidate: [], strings: [] }
      }
      stats.opened++
      stats.active = true
      return {
        cancelled: false,
        tableSource: {
          id,
          revision: state.revision,
          name: card ? '公开七版角色卡.xlsx' : '公开流式.csv',
          format: card ? 'xlsx' : 'csv',
          bytes: bytes.length,
          sha256: options.badSourceHash ? '0'.repeat(64) : await digest(bytes),
          fileUri: new URL(card ? publicTableStreamCardPath : publicTableStreamPath + '?rows=' + options.rows, location.href).href,
          maximumStageBytes: 128 * 1024 * 1024
        }
      }
    },
    async appendTableStage({ id, key, index, base64 }) {
      const { current } = await check(id),
        bytes = decodeBase64(base64)
      if (index !== current.chunks[key].length || !bytes.length || bytes.length > 256 * 1024)
        throw new Error('公开测试表格分段顺序或长度无效。')
      current.chunks[key].push(bytes)
      stats.chunks++
      if (key === 'candidate') stats.candidateBytes += bytes.length
    },
    async readTableString({ id, stringIndex, offset }) {
      const { current } = await check(id)
      const rows = new TextDecoder('utf-8', { fatal: true })
        .decode(join(current.chunks.strings))
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as [number, string])
      if (rows[stringIndex]?.[0] !== stringIndex) throw new Error('公开测试共享字符串缺失。')
      const bytes = encoder.encode(rows[stringIndex]![1]),
        chunk = bytes.subarray(offset, offset + 256 * 1024)
      return {
        base64: encodeBase64(chunk),
        bytes: bytes.length,
        done: offset + chunk.length === bytes.length
      }
    },
    async finishTablePreview({ id, candidate }) {
      const { current, state } = await check(id),
        bytes = join(current.chunks.candidate)
      if (
        options.badCandidateHash ||
        candidate.bytes !== bytes.length ||
        candidate.sha256 !== (await digest(bytes))
      )
        throw new Error('公开测试候选长度或摘要不符，未写入。')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (!text.endsWith('\n')) throw new Error('公开测试候选不完整。')
      const frames = text
        .slice(0, -1)
        .split('\n')
        .map((line) => {
          if (!line.startsWith('T')) throw new Error('公开测试只接受场次候选。')
          return JSON.parse(line.slice(1)) as { sheetOrder: number; rowOrder: number; value: TableImportRow }
        })
        .sort((a, b) => a.sheetOrder - b.sheetOrder || a.rowOrder - b.rowOrder)
      if (
        new Set(frames.map((frame) => JSON.stringify([frame.sheetOrder, frame.rowOrder]))).size !==
        frames.length
      )
        throw new Error('公开测试坐标重复。')
      stats.frames += frames.length
      const baseline: MobileSnapshot = state.json
        ? JSON.parse(state.json)
        : {
            schemaVersion: 2,
            exportedAt: new Date().toISOString(),
            modules: [],
            records: [],
            characters: [],
            settings: { theme: 'light', filterPreset: DEFAULT_FILTER_PRESET }
          }
      current.preview = await importTable(
        baseline,
        encoder.encode(oracleCSV(frames.map((frame) => frame.value))),
        '公开候选.csv',
        'records'
      )
      const added = current.preview.next.records.length - baseline.records.length,
        updated = current.preview.updated
      current.summary = {
        id,
        revision: current.revision,
        added,
        updated,
        skipped: frames.length - added - updated,
        namesCount: current.preview.names.length,
        warningsCount: current.preview.warnings.length,
        names: current.preview.names.slice(0, 100),
        warnings: current.preview.warnings.slice(0, 100)
      }
      stats.previews++
      return current.summary
    },
    async readTablePreview({ id, kind, offset, limit }) {
      const { current } = await check(id)
      if (!current.preview || !Number.isSafeInteger(offset) || offset < 0)
        throw new Error('公开测试预览分页无效。')
      stats.pages.push(offset)
      return {
        values: current.preview[kind].slice(offset, offset + Math.min(100, limit)),
        total: current.preview[kind].length
      }
    },
    async commitTableStream({ id, confirmed }) {
      await new Promise((resolve) => setTimeout(resolve, options.commitDelayMs))
      const { current } = await check(id)
      if (!confirmed || !current.preview || !base.commitTable) throw new Error('请先确认完整预览。')
      const result = await base.commitTable({
        json: JSON.stringify(current.preview.next),
        expectedRevision: current.revision
      })
      stats.commits++
      stats.active = false
      lease = undefined
      return { revision: result.revision }
    },
    async cancelTableStage({ id }) {
      stats.cancellations++
      if (lease?.id === id) {
        lease = undefined
        stats.active = false
      }
    }
  }
}
