import { zipSync, strToU8 } from 'fflate'
import * as XLSX from 'xlsx'
import { nativeTableKernelCorpus } from './native-table-kernel-corpus'

/** Public fictional records only. Native budget misses must retain full fallback. */
export function nativeRecordKernelCorpus() {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const xml = (body: string) => strToU8('<?xml version="1.0" encoding="UTF-8"?>' + body)
  type Case = { name: string; bytes: Uint8Array; native: boolean; full: boolean; candidates?: number; completeManual?: string }
  const corpus: Case[] = []
  function parts(sheets: Array<{ name: string; body: string; type?: string }>, sst = '', reverse = false) {
    const result: Record<string, Uint8Array> = {
      '_rels/.rels': xml(`<Relationships xmlns="${ns}"><Relationship Id="root" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/workbook.xml': xml(`<workbook xmlns="${main}" xmlns:r="${office}"><sheets>${sheets.map((sheet, order) => `<sheet name="${sheet.name}" r:id="s${order}"/>`).join('')}</sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': xml(`<Relationships xmlns="${ns}">${sheets.map((sheet, order) => `<Relationship Id="s${order}" Type="${office}/${sheet.type ?? 'worksheet'}" Target="worksheets/s${order}.xml"/>`).join('')}<Relationship Id="strings" Type="${office}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
      'xl/sharedStrings.xml': xml(`<sst xmlns="${main}">${sst}</sst>`)
    }
    for (const order of [...sheets.keys()].sort((a, b) => reverse ? b - a : a - b))
      result[`xl/worksheets/s${order}.xml`] = xml(`<worksheet xmlns="${main}">${sheets[order]!.body}</worksheet>`)
    return result
  }
  function add(name: string, sheets: Array<{ name: string; body: string; type?: string }>, native = true, full = true, sst = '', reverse = false) {
    corpus.push({ name, bytes: zipSync(parts(sheets, sst, reverse), { level: 6 }), native, full })
  }
  // The source may be tiny after compression while every complete UTF-8 body
  // still crosses the native/JS bridge and candidate staging unchanged.
  const completeManual = '  公开完整正文😀\r\n\u0000'.repeat(13000) + '末行不可截断\r\n '
  if (strToU8(completeManual).length < 334 * 1024) throw Error('Public manual fixture must exceed 334 KiB')
  const chunks: string[] = []
  for (let offset = 0; offset < completeManual.length;) {
    let end = Math.min(offset + 32767, completeManual.length)
    if (end < completeManual.length && /[\uD800-\uDBFF]/.test(completeManual[end - 1]!)) end--
    chunks.push(completeManual.slice(offset, end)); offset = end
  }
  const header = ['模组名', '场次名', '海豹链接', '手动保存内容', 'KP1', 'PC1', 'PL1',
    ...chunks.slice(1).map((_, index) => `手动保存内容（续${index + 1}）`)]
  const workbook = XLSX.utils.book_new()
  const rows: unknown[][] = [header]
  for (let index = 0; index < 114; index++) rows.push(['公开模组甲', `公开场次${index + 1}`, `https://log.weizaima.com/?key=public-record-kernel-${index}`, '', '公开KP', '公开PC', '公开PL'])
  rows.push(['公开模组甲', '完整长手动正文', '', chunks[0], '公开KP', '公开PC', '公开PL', ...chunks.slice(1)])
  rows.push(['公开模组甲', '手动末尾二', '', '第二篇完整正文\r\n😀'])
  const first = XLSX.utils.aoa_to_sheet(rows)
  first['!merges'] = [XLSX.utils.decode_range('K150:L151')]
  XLSX.utils.book_append_sheet(workbook, first, '公开模组甲')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header,
    ['公开模组乙', '手动末尾三', '', '第三篇完整正文\u0000尾'],
    ['公开模组乙', '手动末尾四', '', '第四篇完整正文\n尾']]), '公开模组乙')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['仅说明，完整验证']]), '公开说明')
  for (const bookSST of [false, true]) corpus.push({ name: `complete-118-rows-334k-${bookSST ? 'sst' : 'inline'}`,
    bytes: new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, bookSST })),
    native: true, full: true, candidates: 118, completeManual })
  const text = (value: string) => `<c t="inlineStr"><is><t>${value}</t></is></c>`
  const headings = '<row r="1">' + ['模组名', '场次名', '海豹链接', '手动保存内容'].map(text).join('') + '</row>'
  add('all-rows-coordinates-and-blank-cells', [{ name: '完整坐标', body: '<sheetData><row r="1"><c r="A1"/><c r="C1" t="s"><v>0</v></c><c r="XFD1"/></row><row r="96"><c/><c t="str"><v>第九十六行</v></c></row><row r="1048576"><c t="str"><v>完整末行</v></c></row><row r="2"/><row><c t="b"><v>TRUE</v></c><c t="e"><v>#VALUE!</v></c><c><f>1+1</f></c><c><v>-0</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B2"/><mergeCell ref="C96:D97"/></mergeCells>' }], true, true,
    '<si><r><t>完整_x005F_x0041_\r\n</t></r><rPh><t>拼音不属于正文</t></rPh><r><t><![CDATA[末行😀\r\n]]></t></r></si><si><t>未引用但完整SST</t></si>')
  add('all-sheets-book-order-physical-reverse', [
    { name: '先声明后存储', body: `<sheetData>${headings}<row r="100">${['甲', '第一场', 'https://log.weizaima.com/?key=public-a', ''].map(text).join('')}</row></sheetData>` },
    { name: '后声明先存储', body: `<sheetData>${headings}<row r="2">${['乙', '第二场', '', '完整正文😀'].map(text).join('')}</row></sheetData>` },
    { name: '空工作表', body: '<sheetData><row r="1"/><row r="2"/></sheetData>' },
    { name: '公开图表', type: 'chartsheet', body: '<mergeCells><mergeCell ref="A1:B2"/></mergeCells>' }
  ], true, true, '', true)
  add('nonmonotonic-and-duplicate-row-events-preserved', [{ name: '原始行序', body: '<sheetData><row r="100">' + text('先出现') + '</row><row r="2">' + text('后出现') + '</row><row r="2"/><row>' + text('隐式第三行') + '</row></sheetData>' }])
  add('tail-cell-after-note-still-validated', [{ name: '尾部不能漏检', body: `<sheetData>${headings}<row r="2">${text('# 填写说明')}</row><row r="1000"><c t="unknown"><v>1</v></c></row></sheetData>` }], false, false)
  add('last-sheet-invalid-sst-still-rejects', [
    { name: '首表有效', body: '<sheetData><row><c t="s"><v>0</v></c></row></sheetData>' },
    { name: '末表无效', body: '<sheetData><row r="200"><c t="s"><v>1</v></c></row></sheetData>' }
  ], false, false, '<si><t>完整公开字符串</t></si>')
  add('last-merge-still-rejects', [{ name: '全部合并范围', body: '<sheetData/><mergeCells><mergeCell ref="A1:B2"/><mergeCell ref="XFE1:A1"/></mergeCells>' }], false, false)
  add('combined-projection-budget-is-complete-fallback', Array.from({ length: 4 }, (_, index) => ({ name: `完整大表${index}`, body: '<sheetData><row>' + text('公开大表完整正文'.repeat(25000)) + '</row></sheetData>' })), false, true)
  add('empty-row-budget-is-complete-fallback', [{ name: '空行也计入资源', body: '<sheetData>' + '<row/>'.repeat(40000) + '</sheetData>' }], false, true)
  // Retain the original kernel corpus unchanged and extend its incompatible /
  // damaged cases to records. No output selection can bypass those checks.
  for (const item of nativeTableKernelCorpus().filter(item => !item.native))
    corpus.push({ name: 'existing-' + item.name, bytes: item.bytes, native: false, full: item.full })
  return corpus
}
