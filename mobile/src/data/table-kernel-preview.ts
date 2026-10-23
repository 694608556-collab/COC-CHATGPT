import type { WorkSheet, CellObject } from 'xlsx'
import { createWorksheetEvents, xstring } from './table-worksheet'
import { previewCoc7Sheet } from './coc7-import'
declare const __COC_IMPORT_TEST_OBSERVER__: boolean

interface KernelToken { address: string; type: string; raw: string; inlineText: string; formula: string; hasFormula: boolean }
type CompactToken = [string,string,string,string,string,boolean]
interface KernelPayload { version: 1; supported: true; compact?: boolean; stringCount: number; strings: Record<string,string>; rows: Array<{ index: number; cells: Array<KernelToken|CompactToken> }> }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function invalid(): never { throw Error('原生角色卡草稿协议无效，未生成草稿。') }
/** Validate every primitive before use. No interpreter-generated deep clones:
 * this synchronous reader never exposes or yields the native JSON snapshot. */
function validatedPayload(value: unknown): KernelPayload {
  if (!object(value) || value.version !== 1 || value.supported !== true ||
      !Number.isSafeInteger(value.stringCount) || (value.stringCount as number) < 0 ||
      !object(value.strings) || !Array.isArray(value.rows)) invalid()
  if (value.compact !== undefined && typeof value.compact !== 'boolean') invalid()
  for (const text of Object.values(value.strings)) if (typeof text !== 'string') invalid()
  for (const row of value.rows) {
    // Existing fixed template projection only; never an input content quota.
    if (!object(row) || !Number.isSafeInteger(row.index) || (row.index as number) < 0 || (row.index as number) > 94 || !Array.isArray(row.cells)) invalid()
    for (const cell of row.cells) {
      if (value.compact) {
        if (!Array.isArray(cell) || cell.length !== 6 || typeof cell[0] !== 'string' || !cell[0] ||
            typeof cell[1] !== 'string' || typeof cell[2] !== 'string' || typeof cell[3] !== 'string' ||
            typeof cell[4] !== 'string' || typeof cell[5] !== 'boolean') invalid()
        continue
      }
      if (!object(cell) || typeof cell.address !== 'string' || typeof cell.type !== 'string' ||
          typeof cell.raw !== 'string' || typeof cell.inlineText !== 'string' ||
          typeof cell.formula !== 'string' || typeof cell.hasFormula !== 'boolean') invalid()
    }
  }
  return value as unknown as KernelPayload
}

/** Recheck every emitted cell with the existing validator before building the
 * exact old template. The native kernel must separately validate ALL cells,
 * relationships, complete ZIP payloads, and the immutable source proof. */
export async function projectKernelCoc7Sheet(value: unknown): Promise<WorkSheet> {
  const payload = validatedPayload(value), sheet: WorkSheet = {}
  const events = createWorksheetEvents({
    readString(index) {
      if (!Object.prototype.hasOwnProperty.call(payload.strings, String(index))) throw Error('原生草稿缺少完整共享字符串。')
      return xstring(payload.strings[String(index)]!)
    },
    onRow() {},
    onCell(cell) {
      sheet[cell.address] = {
        t: cell.type as CellObject['t'],
        ...(cell.value === undefined ? {} : { v: cell.value }),
        ...(cell.hasFormula ? { f: cell.formula || 'SAVED_FORMULA' } : {})
      }
    }
  }, payload.stringCount, 0, false)
  const sync = (pending: Promise<void> | void) => {
    if (pending) throw Error('原生草稿转换出现意外的异步数据访问。')
  }
  for (const row of payload.rows) {
    sync(events.start('row', { r: String(row.index + 1) }))
    for (const cell of row.cells) {
      const tuple = payload.compact ? cell as CompactToken : undefined, object = cell as KernelToken
      const address = tuple ? tuple[0] : object.address, type = tuple ? tuple[1] : object.type,
        raw = tuple ? tuple[2] : object.raw, inlineText = tuple ? tuple[3] : object.inlineText,
        formula = tuple ? tuple[4] : object.formula, hasFormula = tuple ? tuple[5] : object.hasFormula
      sync(events.start('c', { r: address, ...(type ? { t: type } : {}) }))
      if (hasFormula) {
        sync(events.start('f', {})); if (formula) sync(events.text(formula)); sync(events.end('f'))
      }
      // An absent text event and an empty text event have the same saved-cell
      // value. Avoid allocating empty TextValue buffers for every numeric cell;
      // coordinates, types, formulas and decoded values still use one validator.
      if (raw) { sync(events.start('v', {})); sync(events.text(raw)); sync(events.end('v')) }
      if (inlineText) { sync(events.start('t', {})); sync(events.text(inlineText)); sync(events.end('t')) }
      sync(events.end('c'))
    }
    sync(events.end('row'))
  }
  return sheet
}

export async function previewKernelCoc7(value: unknown) {
  const measured = typeof __COC_IMPORT_TEST_OBSERVER__ !== 'undefined' && __COC_IMPORT_TEST_OBSERVER__
  const started = measured ? performance.now() : 0
  const sheet = await projectKernelCoc7Sheet(value)
  const projected = measured ? performance.now() : 0
  const draft = previewCoc7Sheet(sheet)
  // Compiled OUT of ordinary/release builds. Instrumentation observes the
  // actual output instead of repeating the import on the measured UI thread.
  if (measured)
    (globalThis as unknown as { __publicIoObserveDraft?: (value: typeof draft, timing: Record<string,number>) => void }).__publicIoObserveDraft?.(draft, {
      projectionMs: projected - started, draftMs: performance.now() - projected
    })
  return draft
}
