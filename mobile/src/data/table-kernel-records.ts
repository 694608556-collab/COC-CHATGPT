import type { StreamProof } from './backup-stream'
import type { TableGridStreamOptions } from './table-grid-stream'
import { checkedMergeRange, createWorksheetEvents, xstring } from './table-worksheet'
import { addStreamBytes, checkStreamCancelled } from './stream-json'

export interface RecordsKernelSource { source: StreamProof; payloadJson: string }
type Cell = [string, string, string, string, string, boolean]
interface Payload {
  version: 1; supported: true; projection: 'records'; compact: true
  stringCount: number; strings: Record<string, string>; validatedCells: number
  sheets: Array<{ name: string; order: number; mergedRanges: string[]; rows: Array<{ index: number; cells: Cell[] }> }>
}
type Events = Pick<TableGridStreamOptions, 'onSheetStart' | 'onRow' | 'onSheetEnd'> & {
  onCell?: (cell: Parameters<NonNullable<TableGridStreamOptions['onCell']>>[0]) => void
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 }
function invalid(): never { throw new Error('原生场次表格协议不完整或无效，不能确认导入。') }

/** The native reader proves the complete immutable XLSX, including every ZIP
 * entry and cell. Validate its entire transport before emitting private rows.
 * Unsupported/resource-budget results retain the original complete reader. */
function payload(kernel: RecordsKernelSource, source: StreamProof, signal?: AbortSignal): Payload | undefined {
  checkStreamCancelled(signal)
  if (!integer(source.bytes) || source.bytes < 1 || !/^[0-9a-f]{64}$/.test(source.sha256) ||
      !object(kernel) || !object(kernel.source) || kernel.source.bytes !== source.bytes ||
      kernel.source.sha256 !== source.sha256 || typeof kernel.payloadJson !== 'string')
    throw new Error('原生场次表格来源完整证明不一致。')
  // Keep the bridge payload opaque until this worker; avoid main-thread deep
  // parsing/cloning and retain exactly one JSON parse here.
  let value: unknown
  try { value = JSON.parse(kernel.payloadJson) } catch { invalid() }
  if (!object(value) || value.version !== 1 || typeof value.supported !== 'boolean') invalid()
  if (!value.supported) return
  if (value.projection !== 'records' || value.compact !== true || !integer(value.stringCount) ||
      !integer(value.validatedCells) || !object(value.strings) || !Array.isArray(value.sheets)) invalid()
  if (Object.keys(value.strings).length !== value.stringCount) invalid()
  for (let index = 0; index < value.stringCount; index++) {
    checkStreamCancelled(signal)
    if (!Object.prototype.hasOwnProperty.call(value.strings, String(index)) || typeof value.strings[String(index)] !== 'string') invalid()
  }
  let cells = 0
  for (const [order, sheet] of value.sheets.entries()) {
    checkStreamCancelled(signal)
    if (!object(sheet) || typeof sheet.name !== 'string' || sheet.order !== order ||
        !Array.isArray(sheet.mergedRanges) || !Array.isArray(sheet.rows)) invalid()
    for (const range of sheet.mergedRanges) {
      if (typeof range !== 'string') invalid()
      checkedMergeRange(range)
    }
    for (const row of sheet.rows) {
      if (!object(row) || !integer(row.index) || !Array.isArray(row.cells)) invalid()
      for (const cell of row.cells) {
        if (!Array.isArray(cell) || cell.length !== 6 || typeof cell[0] !== 'string' || !cell[0] ||
            typeof cell[1] !== 'string' || typeof cell[2] !== 'string' || typeof cell[3] !== 'string' ||
            typeof cell[4] !== 'string' || typeof cell[5] !== 'boolean') invalid()
        cells = addStreamBytes(cells, 1)
      }
    }
  }
  if (cells !== value.validatedCells) invalid()
  return value as unknown as Payload
}

/** Replay all native tokens through the SAME cell decoder used by streaming
 * XML, then the caller's existing table parser/candidate writer. No business
 * authorization, candidate validation or commit is performed by this adapter. */
export async function readKernelRecordsGrid(kernel: RecordsKernelSource, source: StreamProof, options: Events, signal?: AbortSignal): Promise<boolean> {
  const value = payload(kernel, source, signal)
  if (!value) return false
  // Complete SST, decoded once: escaped escape markers must not decode twice.
  const strings = Array.from({ length: value.stringCount }, (_, index) => xstring(value.strings[String(index)]!))
  const sync = (pending: Promise<void> | void) => {
    if (pending) throw new Error('原生表格转换出现意外的异步单元格访问。')
  }
  for (const sheet of value.sheets) {
    checkStreamCancelled(signal)
    await options.onSheetStart({ name: sheet.name, order: sheet.order, mergedRanges: sheet.mergedRanges })
    const events = createWorksheetEvents({
      readString(index) {
        if (!integer(index) || index >= strings.length) invalid()
        return strings[index]!
      },
      onRow: options.onRow,
      onCell: options.onCell
    }, strings.length, 0, false)
    for (const row of sheet.rows) {
      checkStreamCancelled(signal)
      sync(events.start('row', { r: String(row.index + 1) }))
      for (const [address, type, raw, inlineText, formula, hasFormula] of row.cells) {
        checkStreamCancelled(signal)
        sync(events.compactCell(address, type, raw, inlineText, formula, hasFormula))
      }
      const pending = events.end('row')
      if (pending) await pending
    }
    await options.onSheetEnd()
  }
  checkStreamCancelled(signal)
  return true
}
