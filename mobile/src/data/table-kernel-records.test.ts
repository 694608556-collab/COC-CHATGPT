import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { readKernelRecordsGrid } from './table-kernel-records'
import { readTableGridStream } from './table-grid-stream'
import { performTableStreamJob } from './table-stream-job'
import { previewNativeTable } from './table-stream-client'
import { readWorkbookGrid } from '../../../src/shared/table-grid'
import { parseImportSheet } from '../../../src/shared/table-import'
import { decodeBase64 } from './bytes'
import type { NativeTableSource, TableStreamPort } from './table-stream-native'

afterEach(() => vi.unstubAllGlobals())
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const proof = (bytes: Uint8Array) => ({ bytes: bytes.length, sha256: hash(bytes) })
const escaped = (text: string) => text.replace(/_x/gi, '_x005F_x').replace(/\r/g, '_x000D_').replace(/\0/g, '_x0000_')
type Token = [string, string, string, string, string, boolean]
function fixture() {
  const header = ['模组名', '场次名', '海豹链接', '手动保存内容', '手动保存内容（续1）', 'KP1', 'PC1', 'PL1', '跑团状态', '链接状态', '跑团日期', '最近抓取时间']
  const data = [
    { name: '完整甲', rows: [{ index: 0, values: header },
      { index: 1, values: ['甲团', '首场', 'https://log.weizaima.com/?key=public-full', '首😀\r\n\0字面文本', '末尾', '主持', '角色', '玩家', '已完结', '已保存', '2026/10/23', '2026-10-23T01:02:03.000Z'] },
      { index: 121, values: ['甲团', '超过95行', '', '完整末场', '', '', '', '', '进行中', '', '', ''] }] },
    { name: '空工作表', rows: [] },
    { name: '完整乙', rows: [{ index: 0, values: header }, { index: 3, values: ['乙团', '另一场', '', '另一全文', '', 'KP2', 'PC2', 'PL2', '', '', '', ''] }] }
  ]
  const workbook = XLSX.utils.book_new(), strings: Record<string, string> = {}
  let stringCount = 0, validatedCells = 0
  const sheets = data.map((sheet, order) => {
    const ws: XLSX.WorkSheet = {}, rows = sheet.rows.map(row => ({ index: row.index, cells: row.values.map((value, column): Token => {
      const address = XLSX.utils.encode_cell({ r: row.index, c: column }), index = stringCount++
      ws[address] = { t: 's', v: value }
      strings[index] = escaped(value)
      validatedCells++
      return [address, 's', String(index), '', '', false]
    }) }))
    if (sheet.rows.length) ws['!ref'] = `A1:L${sheet.rows.at(-1)!.index + 1}`
    const mergedRanges = order === 0 ? ['M1:N1'] : []
    if (mergedRanges.length) ws['!merges'] = mergedRanges.map(XLSX.utils.decode_range)
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name)
    return { name: sheet.name, order, mergedRanges, rows }
  })
  strings[stringCount++] = '完整未引用SST尾😀_x0000_'
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', bookSST: true }))
  const payload = { version: 1, supported: true, projection: 'records', compact: true, stringCount, strings, validatedCells, sheets }
  return { bytes, payload, kernel: { source: proof(bytes), payloadJson: JSON.stringify(payload) }, data }
}
async function collect(value: ReturnType<typeof fixture>) {
  const sheets: Array<{ name: string; order: number; mergedRanges?: string[]; rows: Array<{ index: number; values: unknown[] }> }> = []
  await readKernelRecordsGrid(value.kernel, proof(value.bytes), {
    onSheetStart(info) { sheets.push({ ...info, rows: [] }) },
    onRow(row) { sheets.at(-1)!.rows.push(row) }, onSheetEnd() {}
  })
  return sheets
}
function attach(value: ReturnType<typeof fixture>) {
  value.kernel.payloadJson = JSON.stringify(value.payload)
  return value
}
async function run(value: ReturnType<typeof fixture>, maximumStageBytes = 64 * 1024 * 1024) {
  const chunks: Uint8Array[] = []
  const result = await performTableStreamJob({ source: { ...proof(value.bytes), url: 'https://localhost/_capacitor_file_/public.xlsx' },
    name: 'public.xlsx', format: 'xlsx', kind: 'records', maximumStageBytes, recordsKernel: value.kernel },
  async (key, bytes) => { if (key === 'candidate') chunks.push(bytes.slice()) }, async () => { throw Error('Unexpected SST disk read') })
  const bytes = Buffer.concat(chunks)
  expect(result.candidate).toEqual(proof(bytes))
  return { result, bytes, rows: bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line.slice(1))) }
}

it('完整各字段、工作簿顺序、合并范围、稀疏尾行及Unicode正文与旧导入oracle相同，保留完整候选证明', async () => {
  const value = fixture(), fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const projected = await collect(value), expected = readWorkbookGrid(value.bytes, 'public.xlsx')
  expect(projected.map(sheet => ({ name: sheet.name, mergedRanges: sheet.mergedRanges }))).toEqual(expected.sheets.map(sheet => ({ name: sheet.name, mergedRanges: sheet.mergedRanges })))
  expect(projected.map(sheet => sheet.order)).toEqual([0, 1, 2])
  expect(projected.map(sheet => sheet.rows)).toEqual(value.data.map(sheet => sheet.rows))
  const result = await run(value)
  expect(result.rows.map(row => row.value)).toEqual(expected.sheets.flatMap(sheet => parseImportSheet(sheet.name, sheet.rows)))
  expect(result.rows.map(row => [row.sheetOrder, row.rowOrder])).toEqual([[0, 1], [0, 121], [2, 3]])
  expect(result.rows[0].value.manualContent).toBe('首😀\r\n\0字面文本末尾')
  expect(result.result.candidates).toBe(3)
  expect(fetch).not.toHaveBeenCalled()
})

it('完整SST不能只保留引用子集，超分段正文原样进入完整候选，尾部不是前缀匹配', async () => {
  const value = fixture(), text = '中😀\r\n\0'.repeat(40000) + '完整尾部'
  value.payload.strings['15'] = escaped(text)
  const result = await run(attach(value))
  expect(result.rows[0].value.manualContent).toBe(text + '末尾')
  expect(result.bytes.length).toBeGreaterThan(262144)
  const broken = fixture(); delete broken.payload.strings[String(broken.payload.stringCount - 1)]
  await expect(collect(attach(broken))).rejects.toThrow('协议')
})

it('原单元格校验器保留数值空白、公式、日期、错误、布尔、内联与只解码一次的SST', async () => {
  const value = fixture(), cells: Token[] = [
    ['A8', '', '', '', '', false], ['B8', '', '42', '', '1+41', true],
    ['C8', 'b', 'TRUE', '', '', false], ['D8', 'e', '#VALUE!', '', '', false],
    ['E8', 'inlineStr', '', '甲_x0000_😀_x005F_x0041_', '', false],
    ['F8', 'str', '_x005F_x0041_', '', '_xlfn.TEXT(1)\r\n', true],
    ['G8', 'd', '2026-10-23T00:00:00Z', '', '', false], ['H8', '', '', '', '', true]
  ]
  value.payload.sheets = [{ name: '全部单元格', order: 0, mergedRanges: [], rows: [{ index: 7, cells }] }]
  value.payload.validatedCells = cells.length
  const output: unknown[] = [], rows: unknown[] = []
  await readKernelRecordsGrid(attach(value).kernel, proof(value.bytes), { onSheetStart() {}, onRow(row) { rows.push(row) }, onSheetEnd() {}, onCell(cell) { output.push(cell) } })
  // The original streaming reader is the date/formula oracle, including the
  // host's historical timezone offset. Never substitute a new date decoder.
  const files = unzipSync(value.bytes), escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  files['xl/worksheets/sheet1.xml'] = strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="8">' + cells.map(([address, type, raw, inline, formula, hasFormula]) =>
    `<c r="${address}"${type ? ` t="${type}"` : ''}>${hasFormula ? `<f>${escapeXml(formula)}</f>` : ''}${raw ? `<v>${escapeXml(raw)}</v>` : ''}${inline ? `<is><t>${escapeXml(inline)}</t></is>` : ''}</c>`).join('') + '</row></sheetData></worksheet>')
  const input = zipSync(files), strings: string[] = [], originalRows: unknown[] = [], originalCells: any[] = []
  let active = false
  await readTableGridStream({ name: 'oracle.xlsx', format: 'xlsx', expectedSource: proof(input), maximumExpandedBytes: 64 * 1024 * 1024,
    async *source() { for (let offset = 0; offset < input.length; offset += 65536) yield input.subarray(offset, offset + 65536) },
    writeString(index, text) { strings[index] = text }, readString(index) { return strings[index]! },
    onSheetStart(info) { active = info.order === 0 }, onSheetEnd() { active = false },
    onRow(row) { if (active) originalRows.push(row) }, onCell(cell) { if (active) originalCells.push(cell) } })
  expect(rows).toEqual(originalRows)
  expect(output).toEqual(originalCells)
  const date = originalCells.find(cell => cell.address === 'G8')!.value
  expect(Number.isFinite(date)).toBe(true)
  expect(rows).toEqual([{ index: 7, values: [null, 42, true, 15, '甲\0😀_x0041_', '_x0041_', date, null] }])
  expect(output).toEqual([
    { address: 'A8', type: 'n', hasFormula: false }, { address: 'B8', type: 'n', value: 42, hasFormula: true, formula: '1+41' },
    { address: 'C8', type: 'b', value: true, hasFormula: false }, { address: 'D8', type: 'e', value: 15, hasFormula: false },
    { address: 'E8', type: 's', value: '甲\0😀_x0041_', hasFormula: false },
    { address: 'F8', type: 's', value: '_x0041_', hasFormula: true, formula: 'TEXT(1)\n' },
    { address: 'G8', type: 'n', value: date, hasFormula: false }, { address: 'H8', type: 'n', hasFormula: true }
  ])
})

it('XML行顺序原样保留，不排序、丢弃空行或隐藏重复行', async () => {
  const value = fixture(), row = (index: number) => ({ index, cells: [[`A${index + 1}`, '', '', '', '', false] as Token] })
  value.payload.sheets = [{ name: '顺序', order: 0, mergedRanges: [], rows: [row(121), { index: 7, cells: [] }, row(0), row(0)] }]
  value.payload.validatedCells = 3
  expect((await collect(attach(value)))[0]!.rows).toEqual([{ index: 121, values: [null] }, { index: 7, values: [] }, { index: 0, values: [null] }, { index: 0, values: [null] }])
})

it('损坏的协议字段、完整SST索引、工作表顺序、总单元格数和最后一个tuple均拒绝', async () => {
  const mutations: Array<(p: any) => void> = [
    p => { p.version = 2 }, p => { p.projection = 'coc7' }, p => { p.compact = false },
    p => { p.stringCount = -1 }, p => { p.stringCount = 1.5 }, p => { p.strings = [] },
    p => { p.strings['extra'] = '未知SST' }, p => { delete p.strings[0]; p.strings['01'] = '错索引' },
    p => { p.strings[p.stringCount - 1] = false }, p => { p.validatedCells-- }, p => { p.validatedCells = Infinity },
    p => { p.sheets[1].order = 0 }, p => { p.sheets[2].name = null }, p => { p.sheets[0].mergedRanges = ['BAD'] },
    p => { p.sheets[2].rows.at(-1).index = -1 }, p => { p.sheets[2].rows.at(-1).cells = null },
    p => { p.sheets[2].rows.at(-1).cells.at(-1).push('extra') }
  ]
  for (let index = 0; index < 6; index++) mutations.push(p => { p.sheets[2].rows.at(-1).cells.at(-1)[index] = index === 5 ? 'false' : 42 })
  for (const mutate of mutations) {
    const value = fixture(); mutate(value.payload)
    await expect(collect(attach(value))).rejects.toThrow()
  }
})

it('原校验仍拒绝重复或错行坐标、未知类型、非有限数值和越界SST', async () => {
  for (const change of [
    (c: Token) => { c[0] = 'A1' }, (c: Token) => { c[0] = 'B2' }, (c: Token) => { c[1] = 'unknown' },
    (c: Token) => { c[1] = 'n'; c[2] = 'NaN' }, (c: Token) => { c[2] = '99999' }
  ]) {
    const value = fixture(); change(value.payload.sheets[0]!.rows[0]!.cells[1]!)
    await expect(collect(attach(value))).rejects.toThrow()
  }
})

it('unsupported完整回退仍校验来源SHA并产生相同完整候选；证明损坏或无效JSON绝不回退伪成功', async () => {
  const value = fixture(), expected = await run(value)
  vi.stubGlobal('location', new URL('https://localhost/'))
  const fetch = vi.fn(async () => new Response(value.bytes.slice().buffer))
  vi.stubGlobal('fetch', fetch)
  value.kernel.payloadJson = JSON.stringify({ version: 1, supported: false, reason: 'resident-budget' })
  expect((await run(value)).bytes).toEqual(expected.bytes)
  expect(fetch).toHaveBeenCalled()
  const changedSource = value.bytes.slice()
  changedSource[changedSource.length - 1] = changedSource[changedSource.length - 1]! ^ 1
  fetch.mockImplementation(async () => new Response(changedSource.buffer))
  await expect(run(value)).rejects.toThrow(/摘要|SHA|完整/)
  for (const change of [
    (v: ReturnType<typeof fixture>) => { v.kernel.source.sha256 = 'b'.repeat(64) },
    (v: ReturnType<typeof fixture>) => { v.kernel.source.bytes++ },
    (v: ReturnType<typeof fixture>) => { v.kernel.payloadJson = '{' }
  ]) {
    const broken = fixture(); change(broken)
    await expect(run(broken)).rejects.toThrow()
  }
  value.bytes = value.bytes.slice(); value.bytes[value.bytes.length - 1] = value.bytes[value.bytes.length - 1]! ^ 1
  // The source itself no longer matches the complete native snapshot proof.
  await expect(run(value)).rejects.toThrow('完整证明')
})

it('保留原完整候选finish与CAS预览复查、空间不足及取消清理，绝不直接提交', async () => {
  const value = fixture(), chunks: Uint8Array[] = []
  const source: NativeTableSource = { ...proof(value.bytes), id: 'public-record-owner', revision: 7, fileUri: 'file:///private/public.xlsx', name: 'public.xlsx', format: 'xlsx', maximumStageBytes: 64 * 1024 * 1024, recordsKernel: value.kernel }
  const port: Required<TableStreamPort> = {
    appendTableStage: vi.fn(async ({ key, base64 }) => { if (key === 'candidate') chunks.push(decodeBase64(base64)) }),
    readTableString: vi.fn(), readTablePreview: vi.fn(), commitTableStream: vi.fn(), cancelTableStage: vi.fn(async () => {}),
    finishTablePreview: vi.fn(async ({ id, candidate }) => {
      expect(candidate).toEqual(proof(Buffer.concat(chunks)))
      return { id, revision: 7, added: 3, updated: 0, skipped: 0, namesCount: 3, warningsCount: 0, names: ['首场', '超过95行', '另一场'], warnings: [] }
    })
  }
  expect((await previewNativeTable(port, source, 'records')).added).toBe(3)
  expect(port.finishTablePreview).toHaveBeenCalledOnce()
  expect(port.commitTableStream).not.toHaveBeenCalled()
  port.finishTablePreview = vi.fn(async () => { throw Error('CAS revision changed') })
  await expect(previewNativeTable(port, source, 'records')).rejects.toThrow('CAS')
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
  const small = { ...source, maximumStageBytes: 1 }
  await expect(previewNativeTable(port, small, 'records')).rejects.toThrow('空间')
  const controller = new AbortController(); controller.abort()
  await expect(previewNativeTable(port, source, 'records', controller.signal)).rejects.toThrow('取消')
  expect(port.commitTableStream).not.toHaveBeenCalled()
})

it('候选阶段仍使用原链接校验，并在分段ACK后取消时拒绝finish和提交', async () => {
  const invalidLink = fixture()
  invalidLink.payload.strings['14'] = 'https://example.com/unsupported-link'
  await expect(run(attach(invalidLink))).rejects.toThrow()
  const value = fixture(), controller = new AbortController(), source: NativeTableSource = {
    ...proof(value.bytes), id: 'public-cancel-owner', revision: 3, fileUri: 'file:///private/public.xlsx', name: 'public.xlsx',
    format: 'xlsx', maximumStageBytes: 64 * 1024 * 1024, recordsKernel: value.kernel
  }
  const port: Required<TableStreamPort> = {
    appendTableStage: vi.fn(async () => controller.abort()), readTableString: vi.fn(), readTablePreview: vi.fn(),
    finishTablePreview: vi.fn(), commitTableStream: vi.fn(), cancelTableStage: vi.fn(async () => {})
  }
  await expect(previewNativeTable(port, source, 'records', controller.signal)).rejects.toThrow('取消')
  expect(port.appendTableStage).toHaveBeenCalledOnce()
  expect(port.finishTablePreview).not.toHaveBeenCalled()
  expect(port.commitTableStream).not.toHaveBeenCalled()
  expect(port.cancelTableStage).toHaveBeenCalledExactlyOnceWith({ id: source.id })
})
