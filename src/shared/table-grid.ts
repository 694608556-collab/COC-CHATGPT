import * as XLSX from 'xlsx'

export interface GridSheet {
  name: string
  rows: Array<Array<string | number | boolean | null>>
  mergedRanges: string[]
  skippedReason?: string
}

export interface WorkbookGrid {
  sheets: GridSheet[]
}

const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024
const MAX_SHEET_CELLS = 200_000

function cellValue(cell: XLSX.CellObject | undefined): string | number | boolean | null {
  if (!cell) return null
  if (cell.v === undefined || cell.v === null) return null
  if (['string', 'number', 'boolean'].includes(typeof cell.v)) return cell.v as string | number | boolean
  return String(cell.w ?? cell.v)
}

export function readWorkbookGrid(input: ArrayBuffer | Uint8Array, fileName: string): WorkbookGrid {
  const extension = fileName.toLowerCase().split('.').pop()
  if (!['xlsx', 'xls', 'csv'].includes(extension ?? '')) throw new Error('\u4ec5\u652f\u6301 XLSX\u3001XLS \u6216 CSV \u6587\u4ef6')
  if (input.byteLength > MAX_WORKBOOK_BYTES) throw new Error('\u8868\u683c\u6587\u4ef6\u4e0d\u80fd\u8d85\u8fc7 20 MB')
  const workbook =
    extension === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(input).replace(/^\uFEFF/, ''), {
          type: 'string',
          cellFormula: true,
          cellNF: false,
          cellStyles: false,
          dense: false
        })
      : XLSX.read(input, { type: 'array', cellFormula: true, cellNF: false, cellStyles: false, dense: false })
  if (workbook.SheetNames.length > 100) throw new Error('\u5de5\u4f5c\u8868\u6570\u91cf\u4e0d\u80fd\u8d85\u8fc7 100')
  return {
    sheets: workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]
      if (!sheet) return { name, rows: [], mergedRanges: [] }
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
      const mergedRanges = (sheet['!merges'] ?? []).map(XLSX.utils.encode_range)
      const sheetCells = (range.e.r + 1) * (range.e.c + 1)
      if (sheetCells > MAX_SHEET_CELLS) {
        const reason = '\u5de5\u4f5c\u8868\u201c' + name + '\u201d\u7684\u5355\u5143\u683c\u6570\u91cf\u8d85\u8fc7 200000'
        if (workbook.SheetNames.length === 1) throw new Error(reason)
        return { name, rows: [], mergedRanges, skippedReason: reason }
      }
      const rows: GridSheet['rows'] = []
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const values: GridSheet['rows'][number] = []
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          values.push(cellValue(sheet[XLSX.utils.encode_cell({ r: row, c: column })]))
        }
        rows.push(values)
      }
      return { name, rows, mergedRanges }
    })
  }
}

export function structureFingerprint(workbook: WorkbookGrid): string {
  const signature = workbook.sheets.map((sheet) => ({
    name: sheet.name.toLocaleLowerCase(),
    rows: sheet.rows.length,
    columns: Math.max(0, ...sheet.rows.map((row) => row.length)),
    labels: sheet.rows
      .slice(0, 20)
      .flat()
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean)
      .slice(0, 80)
  }))
  let hash = 2166136261
  for (const character of JSON.stringify(signature)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
