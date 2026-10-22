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

function cellValue(cell: XLSX.CellObject | undefined): string | number | boolean | null {
  if (!cell) return null
  if (cell.v === undefined || cell.v === null) return null
  if (['string', 'number', 'boolean'].includes(typeof cell.v)) return cell.v as string | number | boolean
  return String(cell.w ?? cell.v)
}

export function readWorkbookGrid(input: ArrayBuffer | Uint8Array, fileName: string): WorkbookGrid {
  const extension = fileName.toLowerCase().split('.').pop()
  if (!['xlsx', 'xls', 'csv'].includes(extension ?? ''))
    throw new Error('\u4ec5\u652f\u6301 XLSX\u3001XLS \u6216 CSV \u6587\u4ef6')
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
  return {
    sheets: workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]
      if (!sheet) return { name, rows: [], mergedRanges: [] }
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
      const mergedRanges = (sheet['!merges'] ?? []).map(XLSX.utils.encode_range)
      // Preserve actual coordinates without expanding a sparse !ref rectangle.
      const rows: GridSheet['rows'] = []
      for (const address of Object.keys(sheet)) {
        if (address.startsWith('!') || !/^[A-Z]+[1-9][0-9]*$/.test(address)) continue
        const point = XLSX.utils.decode_cell(address)
        const row = point.r - range.s.r
        const column = point.c - range.s.c
        if (row < 0 || column < 0) continue
        ;(rows[row] ??= [])[column] = cellValue(sheet[address])
      }
      return { name, rows, mergedRanges }
    })
  }
}

export function structureFingerprint(workbook: WorkbookGrid): string {
  const signature = workbook.sheets.map((sheet) => ({
    name: sheet.name.toLocaleLowerCase(),
    rows: sheet.rows.length,
    columns: sheet.rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0),
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
