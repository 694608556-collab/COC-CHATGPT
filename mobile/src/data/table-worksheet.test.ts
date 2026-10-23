import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { strToU8, unzipSync, zipSync } from 'fflate'
import * as streamJson from './stream-json'
import { createWorksheetEvents } from './table-worksheet'
import { readKernelRecordsGrid } from './table-kernel-records'
import { readTableGridStream } from './table-grid-stream'
import type { TableGridStreamOptions } from './table-grid-stream'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

type CellValue = string | number | boolean | null
type Token = [string, string, string, string, string, boolean]

/** Decode complete public text through the production worksheet event path.
 * @param type Which original OOXML text representation to replay.
 * @param parts Raw text callback fragments, in their original order.
 * @returns Complete rows emitted by the production decoder.
 */
async function decode(type: 'str' | 'inlineStr', parts: string[]) {
  const rows: Array<{ index: number; values: CellValue[] }> = []
  const events = createWorksheetEvents({ readString: () => { throw Error('Unexpected SST read') }, onRow: row => { rows.push(row) } }, 0, 0, false)
  const tag = type === 'str' ? 'v' : 't'
  await events.start('row', { r: '1' })
  await events.start('c', { r: 'A1', t: type })
  await events.start(tag, {})
  for (const part of parts) await events.text(part)
  await events.end(tag)
  await events.end('c')
  await events.end('row')
  return rows
}

it.each([16383, 16384, 2 * 1024 * 1024, 2 * 1024 * 1024 + 1])(
  'Worker text accounting keeps all %s UTF-16 units and exact checked UTF-8 bytes',
  async length => {
    const raw = '公开😀\r\n\0\ufeff\ud800x\udc00'.repeat(Math.ceil(length / 8)).slice(0, length)
    const expected = new TextEncoder().encode(raw).length, NativeBlob = Blob, calls: BlobPart[][] = []
    vi.stubGlobal('FileReaderSync', class {})
    vi.stubGlobal('Blob', class extends NativeBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options); calls.push(parts); expect(options?.endings).toBe('transparent')
      }
    })
    const add = vi.spyOn(streamJson, 'addStreamBytes')
    expect(await decode('inlineStr', [raw])).toEqual([{ index: 0, values: [raw] }])
    // Content and checked totals remain the contract across encoding choices.
    expect(add.mock.calls).toEqual([[0, expected], [0, expected]])
  }
)

it('large native counts are recomputed after cross-fragment surrogates and OOXML escapes join', async () => {
  vi.stubGlobal('FileReaderSync', class {})
  const head='公开正文\r\n'.repeat(5000), tail='完整尾部'.repeat(5000)
  const parts=[head+'\ud83d', '\ude00'+tail+'_x0000__x005F_x0041_']
  const expected=head+'😀'+tail+'\0_x0041_', add=vi.spyOn(streamJson,'addStreamBytes')
  expect(await decode('inlineStr',parts)).toEqual([{index:0,values:[expected]}])
  expect(add.mock.calls.at(-1)).toEqual([0,new TextEncoder().encode(expected).length])
})

it('a failed optional native byte counter uses the original complete count without losing checks', async () => {
  vi.stubGlobal('FileReaderSync',class {})
  vi.stubGlobal('Blob',class {constructor(){throw Error('public native counter unavailable')}})
  const raw='公开😀\r\n\0\ud800x\udc00'.repeat(5000), size=vi.spyOn(streamJson,'utf8Size'), add=vi.spyOn(streamJson,'addStreamBytes')
  expect(await decode('str',[raw])).toEqual([{index:0,values:[raw]}])
  expect(size.mock.calls).toEqual([[raw]])
  const expected=new TextEncoder().encode(raw).length
  expect(add.mock.calls).toEqual([[0,expected],[0,expected]])
})

for (const type of ['str', 'inlineStr'] as const) {
  it(`${type}: unchanged single text fragment is measured once with exact complete UTF-8 row accounting`, async () => {
    const raw = '公开😀\r\n\0\uFEFF孤立高\ud800末尾低\udc00', bytes = Buffer.byteLength(raw)
    const size = vi.spyOn(streamJson, 'utf8Size'), add = vi.spyOn(streamJson, 'addStreamBytes')
    expect(await decode(type, [raw])).toEqual([{ index: 0, values: [raw] }])
    expect(size.mock.calls).toEqual([[raw]])
    // The raw token and the completed row must BOTH retain checked arithmetic.
    expect(add.mock.calls).toEqual([[0, bytes], [0, bytes]])
  })

  it.each([
    { parts: ['公开', '😀\r\n\0尾'], decoded: '公开😀\r\n\0尾' },
    { parts: ['\ud83d', '\ude00'], decoded: '😀' },
    { parts: ['_xD83D_', '_xDE00_'], decoded: '😀' },
    { parts: ['_x00', '0D_'], decoded: '\r' },
    { parts: ['_x000D_\n_x0000__x005F_x0041_'], decoded: '\r\n\0_x0041_' },
    { parts: [''], decoded: '' },
    { parts: ['', '😀'], decoded: '😀' }
  ])(`${type}: original full decoder and byte accounting survive fallback $parts`, async ({ parts, decoded }) => {
    const size = vi.spyOn(streamJson, 'utf8Size'), add = vi.spyOn(streamJson, 'addStreamBytes')
    expect(await decode(type, parts)).toEqual([{ index: 0, values: [decoded] }])
    const unchangedSingle = parts.length === 1 && parts[0] === decoded
    expect(size.mock.calls).toEqual([...parts.map(part => [part]), ...(unchangedSingle ? [] : [[decoded]])])
    expect(add.mock.calls.at(-1)).toEqual([0, Buffer.byteLength(decoded)])
    if (parts[0] === '\ud83d') {
      expect(add.mock.calls.slice(0, 2)).toEqual([[0, 3], [3, 3]])
      expect(add.mock.calls.at(-1)).toEqual([0, 4])
    }
  })
}

it('reused single-fragment counts still reject an inexact row sum before emitting the row', async () => {
  // Inject only the size boundary; real checked addition still rejects overflow.
  vi.spyOn(streamJson, 'utf8Size').mockReturnValue(Number.MAX_SAFE_INTEGER)
  const onRow = vi.fn(), onCell = vi.fn()
  const events = createWorksheetEvents({ readString: () => '', onRow, onCell }, 0, 0, false)
  await events.start('row', { r: '1' })
  for (const address of ['A1', 'B1']) {
    await events.start('c', { r: address, t: 'str' })
    await events.start('v', {})
    await events.text(address)
    await events.end('v')
    if (address === 'A1') await events.end('c')
  }
  expect(() => events.end('c')).toThrow('精确计量')
  expect(onCell).toHaveBeenCalledOnce()
  expect(onRow).not.toHaveBeenCalled()
})

it.each(['str', 'inlineStr'] as const)('%s uses the correct token count when both raw and inline text are present', async type => {
  const onRow = vi.fn(), add = vi.spyOn(streamJson, 'addStreamBytes')
  const events = createWorksheetEvents({ readString: () => '', onRow }, 0, 0, false)
  await events.start('row', { r: '1' })
  await events.start('c', { r: 'A1', t: type })
  await events.start('v', {})
  await events.text('原值😀')
  await events.end('v')
  await events.start('t', {})
  await events.text('内联完整值😀')
  await events.end('t')
  await events.end('c')
  await events.end('row')
  const decoded = type === 'str' ? '原值😀' : '内联完整值😀'
  expect(onRow).toHaveBeenCalledExactlyOnceWith({ index: 0, values: [decoded] })
  expect(add.mock.calls.at(-1)).toEqual([0, Buffer.byteLength(decoded)])
})

/** Build complete public XML and the equivalent untrusted records transport.
 * @returns A real XLSX source, its exact proof, and complete decoder tokens.
 */
function fixture() {
  const cells: Token[] = [
    ['A1', 'str', '公开😀完整尾部', '', '', false],
    ['B1', 'inlineStr', '', '内联😀完整尾部', '', false],
    ['C1', 'str', '_xD83D__xDE00__x000D_\n_x0000__xD800_X_xDC00_', '', '', false],
    ['D1', 'inlineStr', '', '_x005F_x0041_', '', false]
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['public']]), '公开工作表')
  const files = unzipSync(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })))
  files['xl/worksheets/sheet1.xml'] = strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">' +
    cells.map(([address, type, raw, inline]) => `<c r="${address}" t="${type}">${raw ? `<v>${raw}</v>` : `<is><r><t>${inline.slice(0, 2)}</t></r><r><t>${inline.slice(2)}</t></r></is>`}</c>`).join('') +
    '</row><row r="2"><c r="A2" t="str"><v>第二行完整尾部</v></c></row></sheetData></worksheet>')
  const bytes = zipSync(files), source = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  const payload = { version: 1, supported: true, projection: 'records', compact: true, stringCount: 0, strings: {}, validatedCells: cells.length + 1,
    sheets: [{ name: '公开工作表', order: 0, mergedRanges: [], rows: [{ index: 0, cells }, { index: 1, cells: [['A2', 'str', '第二行完整尾部', '', '', false]] }] }] }
  return { bytes, source, kernel: { source, payloadJson: JSON.stringify(payload) } }
}

it('complete native single-fragment tokens match the real streaming XML decoder with rich-text fragments and escapes', async () => {
  const input = fixture(), recordsRows: unknown[] = [], recordsCells: unknown[] = [], xmlRows: unknown[] = [], xmlCells: unknown[] = [], strings: string[] = []
  const shared: Pick<TableGridStreamOptions, 'onSheetStart' | 'onSheetEnd'> = { onSheetStart() {}, onSheetEnd() {} }
  await readKernelRecordsGrid(input.kernel, input.source, { ...shared, onRow: row => { recordsRows.push(row) }, onCell: cell => { recordsCells.push(cell) } })
  await readTableGridStream({ ...shared, name: 'public.xlsx', format: 'xlsx', expectedSource: input.source, maximumExpandedBytes: Number.MAX_SAFE_INTEGER,
    async *source() { for (let offset = 0; offset < input.bytes.length; offset += 127) yield input.bytes.subarray(offset, offset + 127) },
    writeString(index, value) { strings[index] = value }, readString(index) { return strings[index]! },
    onRow: row => { xmlRows.push(row) }, onCell: cell => { xmlCells.push(cell) } })
  expect(recordsRows).toEqual(xmlRows)
  expect(recordsCells).toEqual(xmlCells)
  expect(recordsRows).toEqual([{ index: 0, values: ['公开😀完整尾部', '内联😀完整尾部', '😀\r\n\0\ud800X\udc00', '_x0041_'] }, { index: 1, values: ['第二行完整尾部'] }])
})

it.each(['before', 'cell', 'row'] as const)('records cancellation at the %s boundary still rejects without later cell or row output', async boundary => {
  const input = fixture(), controller = new AbortController(), onSheetStart = vi.fn(), onSheetEnd = vi.fn()
  const onCell = vi.fn(() => { if (boundary === 'cell') controller.abort() })
  const onRow = vi.fn(() => { if (boundary === 'row') controller.abort() })
  if (boundary === 'before') controller.abort()
  await expect(readKernelRecordsGrid(input.kernel, input.source, { onSheetStart, onSheetEnd, onCell, onRow }, controller.signal)).rejects.toThrow('取消')
  expect(onCell).toHaveBeenCalledTimes(boundary === 'before' ? 0 : boundary === 'cell' ? 1 : 4)
  expect(onRow).toHaveBeenCalledTimes(boundary === 'row' ? 1 : 0)
  expect(onSheetEnd).not.toHaveBeenCalled()
})
