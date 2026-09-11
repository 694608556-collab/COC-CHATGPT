import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readWorkbookGrid, structureFingerprint } from '../src/shared/table-grid'

describe('unified workbook grid', () => {
  it.each(['xlsx', 'xls', 'csv'] as const)('reads %s into the same two-dimensional model', (format) => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['姓名', '属性'],
      ['林恩', 60]
    ])
    sheet['!merges'] = [XLSX.utils.decode_range('A1:A1')]
    XLSX.utils.book_append_sheet(workbook, sheet, '角色卡')
    const type = format === 'csv' ? 'string' : 'buffer'
    const output = XLSX.write(workbook, { type, bookType: format })
    const bytes = typeof output === 'string' ? new TextEncoder().encode(output) : new Uint8Array(output)
    const grid = readWorkbookGrid(bytes, `sample.${format}`)
    expect(grid.sheets[0]?.rows[1]).toEqual(['林恩', 60])
    expect(structureFingerprint(grid)).toMatch(/^[a-f0-9]{8}$/)
  })

  it('preserves multiple worksheets and merged ranges', () => {
    const workbook = XLSX.utils.book_new()
    for (const name of ['第一张', '第二张'])
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[name]]), name)
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    expect(readWorkbookGrid(bytes, 'multi.xlsx').sheets.map((sheet) => sheet.name)).toEqual([
      '第一张',
      '第二张'
    ])
  })

  it('uses cached formula values and rejects oversized or unsupported inputs', () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['total'], [null]])
    sheet.A2 = { t: 'n', f: '10+32', v: 42, w: '42' }
    sheet['!ref'] = 'A1:A2'
    XLSX.utils.book_append_sheet(workbook, sheet, 'Formula')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    expect(readWorkbookGrid(bytes, 'formula.xlsx').sheets[0]?.rows[1]?.[0]).toBe(42)
    expect(() => readWorkbookGrid(new Uint8Array(20 * 1024 * 1024 + 1), 'large.xlsx')).toThrow()
    expect(() => readWorkbookGrid(new Uint8Array(), 'bad.txt')).toThrow()
  })
  it('keeps readable worksheets when a later worksheet is too wide for import', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ok'], ['value']]), 'Readable')
    const huge = XLSX.utils.aoa_to_sheet([['skip me']])
    huge['!ref'] = 'A1:ZZ1000'
    XLSX.utils.book_append_sheet(workbook, huge, 'HugeLookup')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const grid = readWorkbookGrid(bytes, 'mixed.xlsx')
    expect(grid.sheets[0]?.rows[1]?.[0]).toBe('value')
    expect(grid.sheets[1]).toMatchObject({
      name: 'HugeLookup',
      rows: [],
      skippedReason: expect.stringContaining('200000')
    })
  })

  it('still rejects a single oversized worksheet', () => {
    const workbook = XLSX.utils.book_new()
    const huge = XLSX.utils.aoa_to_sheet([['too big']])
    huge['!ref'] = 'A1:ZZ1000'
    XLSX.utils.book_append_sheet(workbook, huge, 'HugeOnly')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    expect(() => readWorkbookGrid(bytes, 'huge.xlsx')).toThrow(/200000/)
  })

})
