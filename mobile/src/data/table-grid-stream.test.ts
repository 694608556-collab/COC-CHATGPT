import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { zipSync, unzipSync, deflateSync, strToU8, Inflate } from 'fflate'
import { readTableGridStream, type TableGridStreamOptions } from './table-grid-stream'
import { StreamCrc32 } from './stream-zip-proof'

vi.mock('xlsx', { spy: true })

const encode = (value: string) => new TextEncoder().encode(value)
const proof = (bytes: Uint8Array) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex')
})
function factory(bytes: Uint8Array, size = 17011) {
  return async function* () {
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size)
  }
}
type Sheet = {
  name: string
  order: number
  mergedRanges?: string[]
  rows: Array<{ index: number; values: Array<string | number | boolean | null> }>
}
async function read(bytes: Uint8Array, format: 'csv' | 'xlsx', extra: Partial<TableGridStreamOptions> = {}) {
  const strings: string[] = [],
    sheets: Sheet[] = []
  let active: Sheet | undefined
  await readTableGridStream({
    name: 'public.' + format,
    format,
    source: factory(bytes),
    expectedSource: proof(bytes),
    maximumExpandedBytes: 512 * 1024 * 1024,
    async writeString(index, value) {
      expect(index).toBe(strings.length)
      strings.push(value)
    },
    async readString(index) {
      if (strings[index] === undefined) throw new Error('Missing native string')
      return strings[index]!
    },
    async onSheetStart(info) {
      active = { ...info, rows: [] }
      sheets.push(active)
    },
    async onRow(row) {
      if (!active) throw new Error('No sheet')
      active.rows.push(row)
    },
    async onSheetEnd() {
      active = undefined
    },
    ...extra
  })
  return sheets
}
function raw(cell: XLSX.CellObject | undefined) {
  return cell?.v == null
    ? null
    : ['string', 'number', 'boolean'].includes(typeof cell.v)
      ? cell.v
      : String(cell.w ?? cell.v)
}
function oracle(bytes: Uint8Array, format: 'csv' | 'xlsx') {
  const book =
    format === 'csv'
      ? XLSX.read(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ''), {
          type: 'string',
          cellFormula: true,
          cellNF: false,
          cellStyles: false,
          dense: false
        })
      : XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: false, cellStyles: false, dense: false })
  return book
}
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relns = 'http://schemas.openxmlformats.org/package/2006/relationships'
const xml = (body: string) => '<?xml version="1.0" encoding="UTF-8"?>' + body

it('完整标量标签快速路径与通用词法路径输出一致，坐标、数值、实体和SST错误仍拒绝', async () => {
  const body = '<sheetData><row r="1"><c r="A1" s="1"/><c r="B1"/><c r="C1" s="2" t="s"><v>0</v></c><c r="D1" t="n"><v>42</v></c><c r="E1" t="b"><v>1</v></c><c r="F1" t="str"><v>完整正文</v></c><c r="G1" t="e"><v>#VALUE!</v></c></row></sheetData>'
  const pack = (text: string) => workbook({ 'xl/worksheets/s.xml': worksheet(text) }, [{ name: '公开', target: 'worksheets/s.xml' }], '<si><t>完整字符串</t></si>')
  const fast = pack(body), generic = pack(body.replace(/<c /g, "<c extra='compatible' "))
  expect(await read(fast, 'xlsx')).toEqual(await read(generic, 'xlsx'))
  for (const changed of [body.replace('r="D1"', 'r="B1"'), body.replace('<v>42</v>', '<v>NaN</v>'), body.replace('<v>0</v>', '<v>999</v>'), body.replace('完整正文', '&invalid;'), body.replace('s="2" t="s"', 's="2" t="s" t="n"')]) {
    await expect(read(pack(changed), 'xlsx')).rejects.toThrow()
  }
  expect((await read(fast, 'xlsx', { source: factory(fast, 1) }))[0]!.rows[0]!.values).toEqual([null, null, '完整字符串', 42, true, '完整正文', 15])
})
function workbook(
  parts: Record<string, string>,
  sheets: Array<{ name: string; target: string }>,
  sst?: string,
  compression: 0 | 6 = 6
) {
  const files: Record<string, Uint8Array> = {}
  // Deliberately put sheet XML before workbook metadata and shared strings.
  for (const [name, value] of Object.entries(parts)) files[name] = strToU8(value)
  files['[Content_Types].xml'] = strToU8(
    xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets
          .map(
            (s) =>
              '<Override PartName="/xl/' +
              s.target +
              '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
          )
          .join('') +
        (sst === undefined
          ? ''
          : '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>') +
        '</Types>'
    )
  )
  files['_rels/.rels'] = strToU8(
    xml(
      '<Relationships xmlns="' +
        relns +
        '"><Relationship Id="root" Type="' +
        office +
        '/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    )
  )
  files['xl/workbook.xml'] = strToU8(
    xml(
      '<workbook xmlns="' +
        main +
        '" xmlns:r="' +
        office +
        '"><sheets>' +
        sheets
          .map(
            (s, i) =>
              '<sheet name="' +
              s.name +
              '" sheetId="' +
              (i + 1) +
              '" r:id="r' +
              i +
              '"' +
              (i === 1 ? ' state="hidden"' : '') +
              '/>'
          )
          .join('') +
        '</sheets></workbook>'
    )
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    xml(
      '<Relationships xmlns="' +
        relns +
        '">' +
        sheets
          .map(
            (s, i) =>
              '<Relationship Id="r' + i + '" Type="' + office + '/worksheet" Target="' + s.target + '"/>'
          )
          .join('') +
        (sst === undefined
          ? ''
          : '<Relationship Id="strings" Type="' + office + '/sharedStrings" Target="sharedStrings.xml"/>') +
        '</Relationships>'
    )
  )
  if (sst !== undefined)
    files['xl/sharedStrings.xml'] = strToU8(xml('<sst xmlns="' + main + '">' + sst + '</sst>'))
  return zipSync(files, { level: compression })
}
const worksheet = (body: string, tail = '') =>
  xml('<worksheet xmlns="' + main + '">' + body + tail + '</worksheet>')

it('同一工作簿完整CRC证明的解压内容仅解压一次，后续来源变化仍拒绝', async () => {
  const bytes = workbook({ 'xl/worksheets/s.xml': worksheet('<sheetData>' + Array.from({ length: 600 }, (_, row) => '<row r="'+(row+1)+'"><c r="A'+(row+1)+'" t="str"><v>完整公开正文'+row+'</v></c></row>').join('') + '</sheetData>') }, [{ name: '公开', target: 'worksheets/s.xml' }])
  let compressedBytes = 0
  const original = Inflate.prototype.push
  const spy = vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate, chunk, final) { compressedBytes += chunk.length; original.call(this, chunk, final) })
  try {
    const result = await read(bytes, 'xlsx')
    expect(result[0]!.rows).toHaveLength(600)
    expect(result[0]!.rows[599]!.values[0]).toBe('完整公开正文599')
    expect(compressedBytes).toBeLessThan(bytes.length)
    let calls = 0
    await expect(read(bytes, 'xlsx', { source: async function* () {
      const next = bytes.slice()
      if (++calls >= 5) next[50] = next[50]! ^ 1
      yield next
    } })).rejects.toThrow()
  } finally { spy.mockRestore() }
})

it('decodes BOM-marked UTF-16 CSV across individual byte boundaries without losing Unicode or quoted newlines', async () => {
  const text = 'sep=;\r\n模组名;场次名;手动保存内容\r\n公开团;第一场;"正文😀\r\n下一行"\r\n'
  const expected = await read(encode(text), 'csv')
  for (const endian of ['le', 'be']) {
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set(endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff])
    const data = new DataView(bytes.buffer)
    for (let index = 0; index < text.length; index++)
      data.setUint16(2 + index * 2, text.charCodeAt(index), endian === 'le')
    expect(await read(bytes, 'csv', { source: factory(bytes, 1) })).toEqual(expected)
    const truncated = bytes.subarray(0, bytes.length - 1)
    await expect(read(truncated, 'csv', { source: factory(truncated, 1) })).rejects.toThrow()
  }
})

it('keeps workbook order and empty chart sheets while validating every chart payload', async () => {
  const original = workbook(
    {
      'xl/chartsheets/sheet1.xml': xml(
        `<chartsheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>`
      ),
      'xl/worksheets/sheet2.xml': worksheet(
        '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>完整正文</t></is></c></row></sheetData>'
      )
    },
    [
      { name: '图表', target: 'chartsheets/sheet1.xml' },
      { name: '正文', target: 'worksheets/sheet2.xml' }
    ]
  )
  const files = unzipSync(original)
  const relPath = 'xl/_rels/workbook.xml.rels'
  files[relPath] = encode(
    new TextDecoder()
      .decode(files[relPath])
      .replace('Type="' + office + '/worksheet"', 'Type="' + office + '/chartsheet"')
  )
  files['[Content_Types].xml'] = encode(
    new TextDecoder()
      .decode(files['[Content_Types].xml'])
      .replace(
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"',
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"'
      )
  )
  const bytes = zipSync(files)
  const result = await read(bytes, 'xlsx')
  expect(result.map((sheet) => [sheet.name, sheet.order, sheet.rows])).toEqual([
    ['图表', 0, []],
    ['正文', 1, [{ index: 0, values: ['完整正文'] }]]
  ])
  const old = oracle(bytes, 'xlsx')
  expect(old.SheetNames).toEqual(['图表', '正文'])
  expect(old.Sheets['图表']?.['!ref']).toBeUndefined()
  files['xl/chartsheets/sheet1.xml'] = encode('<chartsheet><bad></chartsheet>')
  await expect(read(zipSync(files), 'xlsx')).rejects.toThrow(/XML/)
})

function zip64Package(source: Uint8Array, hiddenSuffix = false) {
  const local: Uint8Array[] = [],
    central: Uint8Array[] = []
  let offset = 0,
    centralBytes = 0,
    count = 0
  for (const [name, bytes] of Object.entries(unzipSync(source))) {
    const fileName = encode(name),
      crc = new StreamCrc32()
    crc.update(bytes)
    const compressed = deflateSync(bytes),
      payload = new Uint8Array(compressed.length + (hiddenSuffix ? 1 : 0))
    payload.set(compressed)
    const head = new Uint8Array(30 + fileName.length + 20),
      h = new DataView(head.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 45, true)
    h.setUint16(6, 0x808, true)
    h.setUint16(8, 8, true)
    h.setUint32(18, 0xffffffff, true)
    h.setUint32(22, 0xffffffff, true)
    h.setUint16(26, fileName.length, true)
    h.setUint16(28, 20, true)
    head.set(fileName, 30)
    h.setUint16(30 + fileName.length, 1, true)
    h.setUint16(32 + fileName.length, 16, true)
    h.setBigUint64(34 + fileName.length, BigInt(bytes.length), true)
    h.setBigUint64(42 + fileName.length, BigInt(payload.length), true)
    const descriptor = new Uint8Array(24),
      d = new DataView(descriptor.buffer)
    d.setUint32(0, 0x08074b50, true)
    d.setUint32(4, crc.value, true)
    d.setBigUint64(8, BigInt(payload.length), true)
    d.setBigUint64(16, BigInt(bytes.length), true)
    const directory = new Uint8Array(46 + fileName.length + 28),
      c = new DataView(directory.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 45, true)
    c.setUint16(6, 45, true)
    c.setUint16(8, 0x808, true)
    c.setUint16(10, 8, true)
    c.setUint32(16, crc.value, true)
    c.setUint32(20, 0xffffffff, true)
    c.setUint32(24, 0xffffffff, true)
    c.setUint16(28, fileName.length, true)
    c.setUint16(30, 28, true)
    c.setUint32(42, 0xffffffff, true)
    directory.set(fileName, 46)
    c.setUint16(46 + fileName.length, 1, true)
    c.setUint16(48 + fileName.length, 24, true)
    c.setBigUint64(50 + fileName.length, BigInt(bytes.length), true)
    c.setBigUint64(58 + fileName.length, BigInt(payload.length), true)
    c.setBigUint64(66 + fileName.length, BigInt(offset), true)
    local.push(head, payload, descriptor)
    central.push(directory)
    offset += head.length + payload.length + descriptor.length
    centralBytes += directory.length
    count++
  }
  const record = new Uint8Array(56),
    r = new DataView(record.buffer)
  r.setUint32(0, 0x06064b50, true)
  r.setBigUint64(4, BigInt(44), true)
  r.setUint16(12, 45, true)
  r.setUint16(14, 45, true)
  r.setBigUint64(24, BigInt(count), true)
  r.setBigUint64(32, BigInt(count), true)
  r.setBigUint64(40, BigInt(centralBytes), true)
  r.setBigUint64(48, BigInt(offset), true)
  const locator = new Uint8Array(20),
    l = new DataView(locator.buffer)
  l.setUint32(0, 0x07064b50, true)
  l.setBigUint64(8, BigInt(offset + centralBytes), true)
  l.setUint32(16, 1, true)
  const end = new Uint8Array(22),
    e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, 0xffff, true)
  e.setUint16(10, 0xffff, true)
  e.setUint32(12, 0xffffffff, true)
  e.setUint32(16, 0xffffffff, true)
  return new Uint8Array(Buffer.concat([...local, ...central, record, locator, end]))
}

it('CSV分块引号/换行/BOM/分隔符与锁定SheetJS原始值等价，且保持空白和公式语义', async () => {
  for (const separator of [',', ';', '\t', '|']) {
    const text =
      '\uFEFFsep=' +
      separator +
      '\r\n' +
      ['模组名', '场次名', '手动保存内容', '数字', '布尔', '公式', '日期'].join(separator) +
      '\r\n' +
      ['公开团', '第1场', '"第一行\r\n第二行😀\r第三行""引号"', '"001"', 'TRUE', '=1+1', '2026-10-22'].join(
        separator
      ) +
      '\r\n' +
      ['ID', 'sep=', '<tag>', '1%', 'FALSE', '="全文"', ''].join(separator)
    const bytes = encode(text),
      old = oracle(bytes, 'csv'),
      sheet = old.Sheets[old.SheetNames[0]!]!
    const actual = (await read(bytes, 'csv', { source: factory(bytes, 1) }))[0]!
    expect(actual.rows).toHaveLength(3)
    for (const row of actual.rows)
      for (let col = 0; col < 7; col++)
        expect(row.values[col] ?? null).toEqual(raw(sheet[XLSX.utils.encode_cell({ r: row.index, c: col })]))
  }
})

it('CSV首次完整导入不为每行重复启动SheetJS，所有原始值与逐行兼容解析一致', async () => {
  const lines = ['模组名,场次名,正文,数值,布尔,公式']
  for (let index = 0; index < 115; index++)
    lines.push(['公开团', '场' + index, '"完整😀正文\n第二行"', '001', 'TRUE', '=1+1'].join(','))
  const expected = lines.map((line, index) => {
    const book = XLSX.read('__COC_STREAM_ROW__\n' + line + '\n', { type: 'string', FS: ',', cellFormula: true, cellNF: false, cellStyles: false, dense: false })
    const sheet = book.Sheets[book.SheetNames[0]!]!, range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
    return { index, values: Array.from({ length: range.e.c + 1 }, (_, column) => raw(sheet[XLSX.utils.encode_cell({ r: 1, c: column })])) }
  })
  const parse = vi.mocked(XLSX.read)
  parse.mockClear()
  try {
    const actual = await read(encode(lines.join('\r\n') + '\r\n'), 'csv')
    expect(actual[0]!.rows).toEqual(expected)
    // Bound expensive parser invocations for the public-size first import;
    // all rows still pass the same SheetJS value/formula conversion and oracle.
    expect(parse.mock.calls.length).toBeLessThan(10)
  } finally { parse.mockClear() }
})

it('CSV批处理保留每行宽度、空行、公式坐标与超出临时预算的完整大字段', async () => {
  const body = '完整😀正文'.repeat(12000)
  const lines = ['name,body,tail', 'one', '', 'two,,', 'three,TRUE,=A1', 'four,"' + body + '",end', 'five,"a\r\nb"']
  const expected = lines.map((line, index) => {
    const book = XLSX.read('__COC_STREAM_ROW__\n' + line + '\n', { type: 'string', FS: ',', cellFormula: true, cellNF: false, cellStyles: false, dense: false })
    const sheet = book.Sheets[book.SheetNames[0]!]!, range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
    return { index, values: Array.from({ length: range.e.c + 1 }, (_, column) => raw(sheet[XLSX.utils.encode_cell({ r: 1, c: column })])) }
  })
  const bytes = encode(lines.join('\r\n') + '\r\n')
  for (const size of [1, 17011, 262144]) expect((await read(bytes, 'csv', { source: factory(bytes, size) }))[0]!.rows).toEqual(expected)
})

it('CSV批量与逐行SheetJS对照保留全部标量、逐行宽度及原始公式坐标', async () => {
  const scalars = ['', ' ', '001', 'TRUE', 'FALSE', '=A1', '1%', '2026-10-22', 'ID', 'sep=', '<tag>', '全文😀\0', '带"引号', '跨\r\n行']
  for (const separator of [',', ';', '\t', '|']) {
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
    const lines = Array.from({ length: 140 }, (_, index) => Array.from({ length: 1 + index % 9 }, (_, column) => quote(scalars[(index * 7 + column) % scalars.length]!)).join(separator))
    const expectedRows: Sheet['rows'] = [], expectedCells: unknown[] = []
    for (const [index, line] of lines.entries()) {
      const book = XLSX.read('__COC_STREAM_ROW__\n' + line + '\n', { type: 'string', FS: separator, cellFormula: true, cellNF: false, cellStyles: false, dense: false })
      const sheet = book.Sheets[book.SheetNames[0]!]!, range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
      const values = Array.from({ length: range.e.c + 1 }, (_, column) => raw(sheet[XLSX.utils.encode_cell({ r: 1, c: column })]))
      expectedRows.push({ index, values: values as Sheet['rows'][number]['values'] })
      for (let column = 0; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: column })]
        if (cell) expectedCells.push({ address: XLSX.utils.encode_cell({ r: index, c: column }), type: cell.t, ...(cell.f ? { formula: cell.f } : {}), hasFormula: !!cell.f, ...(cell.v == null ? {} : { value: values[column] }) })
      }
    }
    const actualCells: unknown[] = []
    const actual = await read(encode('\uFEFFsep=' + separator + '\r\n' + lines.join('\r\n') + '\r\n'), 'csv', { onCell: (cell) => { actualCells.push(cell) } })
    expect(actual[0]!.rows).toEqual(expectedRows)
    expect(actualCells).toEqual(expectedCells)
  }
})

it('CSV批处理中取消立即停止回调，不再读取下一块或结束工作表', async () => {
  const bytes = encode(Array.from({ length: 100 }, (_, index) => '公开完整正文'.repeat(12) + ',' + index).join('\n') + '\n')
  expect(bytes.length).toBeGreaterThan(1024) // Complete the original delimiter sniff in the first chunk.
  const controller = new AbortController(), seen: number[] = []
  let ended = false, reads = 0
  await expect(read(bytes, 'csv', {
    signal: controller.signal,
    source: async function* () { reads++; yield bytes; throw Error('Must not request another input chunk after cancellation') },
    onRow: (row) => { seen.push(row.index); if (row.index === 2) controller.abort() },
    onSheetEnd: () => { ended = true }
  })).rejects.toThrow('取消')
  expect(seen).toEqual([0, 1, 2]); expect(reads).toBe(1); expect(ended).toBe(false)
})

it('CSV支持超过旧20MiB门槛，消费者背压且不保留整文件/全行数组', async () => {
  const body = '公开正文😀'.repeat(6500),
    line = encode('公开团,一场,"' + body + '"\n'),
    header = encode('模组名,场次名,手动保存内容\n')
  const count = 300,
    digest = createHash('sha256').update(header)
  for (let i = 0; i < count; i++) digest.update(line)
  const bytes = header.length + line.length * count
  expect(bytes).toBeGreaterThan(20 * 1024 * 1024)
  let reads = 0,
    consumed = 0,
    inCallback = false
  await readTableGridStream({
    name: 'public.csv',
    format: 'csv',
    expectedSource: { bytes, sha256: digest.digest('hex') },
    maximumExpandedBytes: bytes + 1,
    source: async function* () {
      yield header
      for (let i = 0; i < count; i++) {
        expect(inCallback).toBe(false)
        reads++
        yield line
      }
    },
    async writeString() {
      throw new Error('CSV needs no SST')
    },
    async readString() {
      throw new Error('CSV needs no SST')
    },
    async onSheetStart() {},
    async onSheetEnd() {},
    async onRow(row) {
      inCallback = true
      await Promise.resolve()
      if (row.index) {
        expect(row.values[2]).toBe(body)
        consumed++
        expect(reads - consumed).toBeLessThanOrEqual(1)
      }
      inCallback = false
    }
  })
  expect(consumed).toBe(count)
}, 60000)

it('XLSX rich/inline/SST/公式缓存/错误/日期raw语义等价，SST在sheet后且工作簿顺序与ZIP不同', async () => {
  const text =
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t xml:space="preserve"> 空白&amp;</t></r><rPh sb="0" eb="1"><t>拼音不属于正文</t></rPh><r><t>😀尾部 </t></r></is></c><c r="C1"><v>123.5</v></c><c r="D1" s="0"><v>46000</v></c><c r="E1"><f>1+1</f><v>2</v></c><c r="F1"><f>1+1</f></c><c r="G1" t="n"><f>1+1</f></c><c r="H1" t="e"><v>#DIV/0!</v></c><c r="I1" t="b"><v>1</v></c><c r="J1" t="d"><v>2026-10-22T00:00:00Z</v></c><c r="K1" t="s"><v>1</v></c><c r="L1" t="str"><f>TEXT(1)</f><v>缓存&amp;文字</v></c></row>'
  const bytes = workbook(
    {
      'xl/worksheets/second.xml': worksheet(
        '<sheetData><row><c t="inlineStr"><is><t>隐藏页</t></is></c></row></sheetData>'
      ),
      'xl/worksheets/first.xml': worksheet(
        '<sheetData>' + text + '</sheetData>',
        '<mergeCells count="1"><mergeCell ref="A3:B4"/></mergeCells>'
      )
    },
    [
      { name: '第一表', target: 'worksheets/first.xml' },
      { name: '隐藏第二表', target: 'worksheets/second.xml' }
    ],
    '<si><r><t>公开</t></r><rPh sb="0" eb="1"><t>gong</t></rPh><r><t>全文</t></r></si><si><t>_x005F_x0041__x000A_&#x1F600;</t></si>'
  )
  const old = oracle(bytes, 'xlsx'),
    actual = await read(bytes, 'xlsx', { source: factory(bytes, 37) })
  expect(actual.map((s) => [s.name, s.order])).toEqual([
    ['隐藏第二表', 1],
    ['第一表', 0]
  ])
  for (const sheet of actual)
    for (const row of sheet.rows)
      for (let col = 0; col < row.values.length; col++) {
        // SheetJS 0.18.5 truncates supplementary numeric entities with fromCharCode.
        // Preserve the real character so imported/manual/backed-up text never loses it.
        if (sheet.name === '第一表' && col === 10) expect(row.values[col]).toBe('_x0041_\n😀')
        else
          expect(
            row.values[col],
            sheet.name + ':' + XLSX.utils.encode_cell({ r: row.index, c: col })
          ).toEqual(raw(old.Sheets[sheet.name]![XLSX.utils.encode_cell({ r: row.index, c: col })]))
      }
  expect(actual[1]!.mergedRanges).toEqual(['A3:B4'])
})

it('XLSX超过100张工作表且稀疏末格不展开dimension矩形', async () => {
  const parts: Record<string, string> = {},
    sheets = []
  for (let i = 0; i < 103; i++) {
    const target = 'worksheets/s' + i + '.xml'
    sheets.push({ name: '公开表' + i, target })
    parts['xl/' + target] = worksheet(
      '<dimension ref="A1:XFD1048576"/><sheetData><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>末格' +
        i +
        '</t></is></c></row></sheetData>'
    )
  }
  const actual = await read(workbook(parts, sheets), 'xlsx')
  expect(actual).toHaveLength(103)
  for (const [index, sheet] of actual.entries()) {
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]!.index).toBe(1048575)
    expect(sheet.rows[0]!.values[16383]).toBe('末格' + index)
  }
}, 30000)

it('ZIP中央目录超过4MiB仍完整核验，不以目录大小拒绝工作簿', async () => {
  const parts: Record<string, string> = {
    'xl/worksheets/s.xml': worksheet(
      '<sheetData><row><c t="inlineStr"><is><t>完整</t></is></c></row></sheetData>'
    )
  }
  for (let i = 0; i < 71; i++) parts['padding/' + 'a'.repeat(60000) + i] = ''
  const bytes = workbook(parts, [{ name: '公开表', target: 'worksheets/s.xml' }], undefined, 0)
  expect(bytes.length).toBeGreaterThan(8 * 1024 * 1024)
  expect((await read(bytes, 'xlsx'))[0]!.rows[0]!.values[0]).toBe('完整')
}, 60000)

it('未使用条目的CRC错误、来源变化、无效SST、解压空间不足都失败，取消不继续读取', async () => {
  const bytes = workbook(
    {
      'unused.bin': 'UNUSED-PUBLIC-DATA',
      'xl/worksheets/s.xml': worksheet('<sheetData><row><c t="s"><v>3</v></c></row></sheetData>')
    },
    [{ name: '公开', target: 'worksheets/s.xml' }],
    '<si><t>一条</t></si>',
    0
  )
  await expect(read(bytes, 'xlsx')).rejects.toThrow('共享字符串')
  const bad = bytes.slice(),
    at = Buffer.from(bad).indexOf('UNUSED-PUBLIC-DATA')
  expect(at).toBeGreaterThan(0)
  bad[at] = bad[at]! ^ 1
  await expect(read(bad, 'xlsx')).rejects.toThrow('CRC')
  await expect(read(bytes, 'xlsx', { maximumExpandedBytes: 20 })).rejects.toThrow('空间')
  await expect(
    read(bytes, 'xlsx', { expectedSource: { bytes: bytes.length, sha256: '0'.repeat(64) } })
  ).rejects.toThrow('SHA-256')
  const controller = new AbortController()
  let calls = 0
  await expect(
    read(encode('a,b\n1,2\n3,4'), 'csv', {
      signal: controller.signal,
      async onRow() {
        calls++
        controller.abort()
      }
    })
  ).rejects.toThrow('取消')
  expect(calls).toBe(1)
})

it('XML不允许重复属性、DTD、未闭合节点、SST损坏或未知外部worksheet关系', async () => {
  for (const body of [
    '<sheetData><row r="1" r="1"/></sheetData>',
    '<!DOCTYPE worksheet [<!ENTITY x "bad">]><sheetData/>',
    '<sheetData><row></sheetData>'
  ]) {
    const bytes = workbook({ 'xl/worksheets/s.xml': worksheet(body) }, [
      { name: '公开', target: 'worksheets/s.xml' }
    ])
    await expect(read(bytes, 'xlsx')).rejects.toThrow('XML')
  }
})

it('ZIP64中央/本地扩展和64位描述符完整通过，额外DEFLATE后缀拒绝', async () => {
  const original = workbook(
    { 'xl/worksheets/s.xml': worksheet('<sheetData><row><c t="s"><v>0</v></c></row></sheetData>') },
    [{ name: '公开', target: 'worksheets/s.xml' }],
    '<si><t>ZIP64完整正文😀</t></si>'
  )
  expect(
    (await read(zip64Package(original), 'xlsx', { source: factory(zip64Package(original), 13) }))[0]!.rows[0]!
      .values[0]
  ).toBe('ZIP64完整正文😀')
  await expect(read(zip64Package(original, true), 'xlsx')).rejects.toThrow('额外数据')
})

it('逐单元格回调保留错误类型、公式存在性和缺缓存，早于行回调且不计算公式', async () => {
  const bytes = workbook(
    {
      'xl/worksheets/s.xml': worksheet(
        '<sheetData><row r="3"><c r="E3" t="e"><v>#VALUE!</v></c><c r="F3"><f>2+2</f></c><c r="G3"><f t="shared" si="0"/></c><c r="H3"><f>3+3</f><v>6</v></c><c r="I3" t="str"><f>TEXT(1)</f><v></v></c></row></sheetData>'
      )
    },
    [{ name: '人物卡', target: 'worksheets/s.xml' }]
  )
  const cells: Array<Parameters<NonNullable<TableGridStreamOptions['onCell']>>[0]> = []
  await read(bytes, 'xlsx', {
    async onCell(cell) {
      cells.push(cell)
    },
    async onRow() {
      expect(cells).toHaveLength(5)
    }
  })
  expect(cells).toEqual([
    { address: 'E3', type: 'e', hasFormula: false, value: 15 },
    { address: 'F3', type: 'n', hasFormula: true, formula: '2+2' },
    { address: 'G3', type: 'n', hasFormula: true },
    { address: 'H3', type: 'n', hasFormula: true, formula: '3+3', value: 6 },
    { address: 'I3', type: 's', hasFormula: true, formula: 'TEXT(1)', value: '' }
  ])
})

it('SST索引逐条落盘接口背压，缺UTF8字节和CSV未闭合引号明确失败', async () => {
  const count = 1200,
    parts =
      '<sheetData>' +
      Array.from(
        { length: count },
        (_, index) => '<row r="' + (index + 1) + '"><c t="s"><v>' + index + '</v></c></row>'
      ).join('') +
      '</sheetData>'
  const bytes = workbook(
    { 'xl/worksheets/s.xml': worksheet(parts) },
    [{ name: '公开', target: 'worksheets/s.xml' }],
    Array.from({ length: count }, (_, index) => '<si><t>独立字符串' + index + '😀</t></si>').join('')
  )
  const strings: string[] = []
  let waiting = false,
    reads = 0
  const actual = await read(bytes, 'xlsx', {
    async writeString(index, value) {
      expect(waiting).toBe(false)
      waiting = true
      await Promise.resolve()
      expect(index).toBe(strings.length)
      strings.push(value)
      waiting = false
    },
    async readString(index) {
      expect(waiting).toBe(false)
      reads++
      return strings[index]!
    }
  })
  expect(reads).toBeGreaterThan(count)
  expect(actual[0]!.rows).toHaveLength(count)
  expect(actual[0]!.rows.at(-1)!.values[0]).toBe('独立字符串1199😀')
  await expect(
    read(encode('a,b\n"缺少结束,b'), 'csv', { source: factory(encode('a,b\n"缺少结束,b'), 1) })
  ).rejects.toThrow('未结束')
  const invalid = Uint8Array.from([0x61, 0x2c, 0xe4, 0xbd])
  await expect(read(invalid, 'csv', { source: factory(invalid, 1) })).rejects.toThrow()
})
