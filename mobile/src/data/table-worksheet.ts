import * as XLSX from 'xlsx'
import { addStreamBytes, utf8Size } from './stream-json'
import type { TableGridStreamOptions } from './table-grid-stream'
export class TextValue {
  private parts: string[] = []
  private bytes = 0
  add(value: string) {
    this.bytes = addStreamBytes(this.bytes, utf8Size(value))
    this.parts.push(value)
  }
  value() {
    return this.parts.join('')
  }
  /** Reuse exact accounting only when decoding left one complete token unchanged.
   * @param decoded Final cell text after the original OOXML decoder.
   * @returns Checked UTF-8 bytes, or undefined when a full recount is required.
   */
  unchangedSinglePartBytes(decoded: string): number | undefined {
    // Separate fragments may join surrogate halves: 3 + 3 bytes becomes 4.
    return this.parts.length === 1 && this.parts[0] === decoded ? this.bytes : undefined
  }
}
export function safeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('表格' + label + '无效。')
  return value
}
type Cell = string | number | boolean | null
export interface WorksheetEvents {
  start(name: string, attrs: Record<string, string>): Promise<void> | void
  text(value: string): Promise<void> | void
  end(name: string): Promise<void> | void
  emptyNumericCell?(address: string): Promise<void> | void
}
export const xstring = (value: string) => value.replace(/_x([a-f0-9]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
export function cellAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(address)
  if (!match) throw new Error('工作表单元格地址无效。')
  let column = 0
  for (const letter of match[1]!) column = column * 26 + letter.charCodeAt(0) - 64
  if (column > 16384) throw new Error('单元格列地址超过XLSX格式范围。')
  return { row: safeInteger(Number(match[2]) - 1, '行号'), column: column - 1 }
}
export function checkedMergeRange(range: string | undefined) {
  if (!range) throw new Error('工作表合并范围缺失。')
  const [first, last] = range.split(':')
  cellAddress(first!)
  if (last) cellAddress(last)
  return range
}
function excelDate(value: string) {
  const date = new Date(value)
  date.setTime(date.getTime() + date.getTimezoneOffset() * 60000)
  const base = new Date(1899, 11, 30, 0, 0, 0)
  const result =
    (date.getTime() - (base.getTime() + (date.getTimezoneOffset() - base.getTimezoneOffset()) * 60000)) /
    86400000
  if (!Number.isFinite(result)) throw new Error('工作表日期值无效。')
  return result
}
const errors: Record<string, number> = {
  '#NULL!': 0,
  '#DIV/0!': 7,
  '#VALUE!': 15,
  '#REF!': 23,
  '#NAME?': 29,
  '#NUM!': 36,
  '#N/A': 42,
  '#GETTING_DATA': 43,
  '#WTF?': 255
}

/** The same complete cell/coordinate/type/row validation serves streaming
 * XML and the bounded native DOM tokenizer. Consumers select output only. */
export function createWorksheetEvents(options: Pick<TableGridStreamOptions, 'readString' | 'onCell' | 'onRow'>, strings: number, sstBase: number, collectMerges: boolean): WorksheetEvents {
    let row = -1,
      column = -1,
      values: Cell[] = [],
      rowBytes = 0
    let cell:
      | {
          type?: string
          value?: TextValue
          inline?: TextValue
          column: number
          formula?: TextValue
          hasFormula: boolean
        }
      | undefined
    let inFormula = false,
      inValue = false,
      inText = false,
      phonetic = 0
    function finishCell(value: Cell, unchangedBytes?: number): Promise<void> | void {
      const current = cell
      if (!current) throw new Error('工作表单元格未开始。')
      rowBytes = addStreamBytes(rowBytes, typeof value === 'string' ? (unchangedBytes ?? utf8Size(value)) : 16)
      while (values.length < current.column) values.push(null)
      values[current.column] = value
      if (options.onCell) {
        const formula = current.formula?.value().replace(/\r\n/g, '\n').replace(/\b_xlfn\./g, '')
        const type = current.type
        const pending = options.onCell({
          address: XLSX.utils.encode_cell({ r: row, c: current.column }),
          type: type === 'inlineStr' || type === 'str' || type === 's' ? 's' : type === 'd' ? 'n' : (type ?? 'n'),
          ...(formula ? { formula } : {}), hasFormula: current.hasFormula,
          ...(value !== null ? { value } : {})
        })
        if (pending) return pending.then(() => { cell = undefined })
      }
      cell = undefined
    }
    const events: WorksheetEvents = {
      emptyNumericCell(address) {
        if (cell || row < 0) throw new Error('工作表单元格位置无效。')
        const parsed = cellAddress(address)
        if (parsed.row !== row || parsed.column <= column) throw new Error('工作表单元格顺序或行号无效。')
        column = parsed.column
        rowBytes = addStreamBytes(rowBytes, 16)
        while (values.length <= column) values.push(null)
        return options.onCell?.({ address, type: 'n', hasFormula: false })
      },
      start(name, attrs) {
        if (!collectMerges && name === 'mergeCell') checkedMergeRange(attrs.ref)
        if (name === 'row') {
          row = attrs.r === undefined ? row + 1 : safeInteger(Number(attrs.r) - 1, '行号')
          column = -1
          values = []
          rowBytes = 0
        } else if (name === 'c') {
          if (cell || row < 0) throw new Error('工作表单元格位置无效。')
          if (attrs.r) {
            const address = cellAddress(attrs.r)
            if (address.row !== row || address.column <= column)
              throw new Error('工作表单元格顺序或行号无效。')
            column = address.column
          } else column++
          cell = { type: attrs.t, column, hasFormula: false }
        } else if (cell && name === 'v') inValue = true
        else if (cell && name === 't') inText = true
        else if (cell && name === 'f') {
          inFormula = true
          cell.hasFormula = true
          if (options.onCell) cell.formula = new TextValue()
        } else if (name === 'rPh') phonetic++
      },
      text(value) {
        if (!cell) return
        if (inValue) (cell.value ??= new TextValue()).add(value)
        if (inText && !phonetic) (cell.inline ??= new TextValue()).add(value)
        if (inFormula) cell.formula?.add(value)
      },
      end(name) {
        if (name === 'v') inValue = false
        if (name === 't') inText = false
        if (name === 'f') inFormula = false
        if (name === 'rPh') phonetic--
        if (name === 'c') {
          if (!cell) throw new Error('工作表单元格未开始。')
          let value: Cell = null
          let unchangedBytes: number | undefined
          const type = cell.type,
            raw = cell.value?.value() ?? ''
          if (type === 's' && raw !== '') {
            if (!/^\d+$/.test(raw) || Number(raw) >= strings) throw new Error('共享字符串索引缺失或无效。')
            const decoded = options.readString(sstBase + Number(raw))
            return typeof decoded === 'string' ? finishCell(decoded) : decoded.then(finishCell)
          } else if (type === 'inlineStr') {
            value = xstring(cell.inline?.value() ?? '')
            unchangedBytes = cell.inline?.unchangedSinglePartBytes(value)
          } else if (type === 'str') {
            value = xstring(raw)
            unchangedBytes = cell.value?.unchangedSinglePartBytes(value)
          }
          else if (type === 'b') value = ['1', 'true', 'TRUE'].includes(raw)
          else if (type === 'd') value = excelDate(raw)
          else if (type === 'e') value = errors[raw] ?? null
          else if (type === undefined || type === 'n') {
            if (raw !== '') {
              value = parseFloat(raw)
              if (!Number.isFinite(value)) throw new Error('工作表数字无效。')
            }
            // SheetJS 0.18.5's missing-cache formula stub is omitted by its
            // numeric blank-cell check. Preserve null rather than inventing 0.
          } else if (type !== 's') throw new Error('工作表单元格类型不受支持。')
          return finishCell(value, unchangedBytes)
        } else if (name === 'row') {
          if (cell) throw new Error('工作表单元格未结束。')
          const complete = values
          values = []
          return options.onRow({ index: row, values: complete })
        }
      }
    }
    return events
}
