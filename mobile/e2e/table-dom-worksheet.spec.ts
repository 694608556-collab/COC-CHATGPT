import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { readTableGridStream } from '../src/data/table-grid-stream'

let script = ''
test.beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), contents: "import {projectCoc7WorksheetDOM} from './src/data/table-dom-worksheet'; window.__domWorksheet=projectCoc7WorksheetDOM;", loader: 'ts' }, bundle: true, write: false, target: 'chrome69' })
  script = result.outputFiles[0]!.text
})
const sheet = (body: string) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
async function original(xml: string, strings: string[]) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([strings]), '人物卡')
  const files = unzipSync(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true })))
  files['xl/worksheets/sheet1.xml'] = strToU8(xml)
  const bytes = zipSync(files), index: string[] = [], cells: unknown[] = []
  await readTableGridStream({ name: 'public.xlsx', format: 'xlsx',
    expectedSource: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    maximumExpandedBytes: 16 * 1024 * 1024, collectMergedRanges: false,
    async *source() { yield bytes },
    writeString(key, value) { index[key] = value }, readString(key) { return index[key]! },
    onSheetStart() {}, onRow() {}, onSheetEnd() {}, onCell(cell) { cells.push(cell) }
  })
  return cells
}
test('有界原生XML分词与完整Worker校验器逐格等价，含公式、错误、空样式、富文本和CDATA', async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ content: script })
  const xml = sheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t>完整😀</t></r><rPh><t>不计读音</t></rPh><r><t>尾行</t></r></is></c><c r="C1"><f>_xlfn.SUM(A2)</f><v>4</v></c><c r="D1" t="e"><v>#DIV/0!</v></c></row><row r="2"><c r="A2" s="0"/><c r="B2" t="inlineStr"><is><t><![CDATA[<!DOCTYPE只是正文]]></t></is></c></row>')
  const strings = ['公开中文😀\n全文']
  const expected = await original(xml, strings)
  const received = await page.evaluate(async ({ xml, strings }) => (window as any).__domWorksheet({ bytes: new TextEncoder().encode(xml), strings, name: '人物卡' }), { xml, strings })
  expect(received).toEqual(expected)
  const auxiliary = await page.evaluate(async ({ xml, strings }) => (window as any).__domWorksheet({ bytes: new TextEncoder().encode(xml), strings, name: '未导入辅助表' }), { xml, strings })
  expect(auxiliary).toEqual([])
})

for (const [label, xml] of [
  ['重复属性', sheet('<row r="1"><c r="A1" r="B1"/></row>')],
  ['越界SST', sheet('<row r="1"><c r="A1" t="s"><v>99</v></c></row>')],
  ['坐标倒退', sheet('<row r="1"><c r="B1" s="0"/><c r="A1" s="0"/></row>')],
  ['行号不符', sheet('<row r="1"><c r="A2"/></row>')],
  ['无效数字', sheet('<row r="1"><c r="A1"><v>NaN</v></c></row>')],
  ['未知类型', sheet('<row r="1"><c r="A1" t="unknown"/></row>')],
  ['损坏合并范围', sheet('<row r="1"><c r="A1"/></row>').replace('</worksheet>', '<mergeCells><mergeCell ref="A0:B1"/></mergeCells></worksheet>')],
  ['DTD外部实体', '<!DOCTYPE worksheet SYSTEM "https://example.invalid/private"><worksheet/>']
] as const) {
  test(`${label}不能得到成功投影，完整流式校验仍明确拒绝`, async ({ page }) => {
    let external = 0
    await page.route('https://example.invalid/**', route => { external++; return route.abort() })
    await page.goto('/')
    await page.addScriptTag({ content: script })
    const received = await page.evaluate(async xml => (window as any).__domWorksheet({ bytes: new TextEncoder().encode(xml), strings: ['公开'], name: '人物卡' }), xml)
    expect(received).toBeUndefined()
    await expect(original(xml, ['公开'])).rejects.toThrow()
    expect(external).toBe(0)
  })
}

test('超过分词缓存预算只选择完整流式路径，不构成新的内容配额', async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ content: script })
  const result = await page.evaluate(async () => (window as any).__domWorksheet({ bytes: new Uint8Array(512 * 1024 + 1), strings: [], name: '人物卡' }))
  expect(result).toBeUndefined()
})
