import { zipSync, strToU8 } from 'fflate'
import { publicCoc7Workbook } from '../test-fixtures/coc7'
import * as XLSX from 'xlsx'

/** Fictional native/full-reader differential corpus. Never include real cards. */
export function nativeTableKernelCorpus() {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const xml = (body: string) => strToU8('<?xml version="1.0" encoding="UTF-8"?>' + body)
  function parts(body: string, sst = '<si><t>公开完整字符串</t></si>') {
    return {
      '_rels/.rels': xml(`<Relationships xmlns="${ns}"><Relationship Id="root" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/workbook.xml': xml(`<workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="人物卡" sheetId="1" r:id="one"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': xml(`<Relationships xmlns="${ns}"><Relationship Id="one" Type="${office}/worksheet" Target="worksheets/s.xml"/><Relationship Id="strings" Type="${office}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
      'xl/sharedStrings.xml': xml(`<sst xmlns="${main}">${sst}</sst>`),
      'xl/worksheets/s.xml': xml(`<worksheet xmlns="${main}">${body}</worksheet>`)
    } as Record<string, Uint8Array>
  }
  const standard = '<sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row></sheetData>'
  const corpus: Array<{ name: string; bytes: Uint8Array; native: boolean; full: boolean; draft?: boolean }> = []
  const add = (name: string, body: string, native = true, full = true, sst?: string) => corpus.push({ name, bytes: zipSync(parts(body, sst), { level: 6 }), native, full })
  corpus.push({ name: 'complete-public-character-draft', bytes: new Uint8Array(XLSX.write(publicCoc7Workbook(), { type: 'array', bookType: 'xlsx', compression: true, bookSST: true })), native: true, full: true, draft: true })
  add('complete-cell-semantics', '<sheetData><row r="1"><c r="A1"/><c r="B1" t="s"><v>00</v></c><c r="C1" t="str"><v>完整_x000D_正文</v></c><c r="D1" t="inlineStr"><is><r><t>第一行\r\n</t></r><rPh><t>拼音不属于正文</t></rPh><r><t><![CDATA[&literal;\r\n末尾😀]]></t></r></is></c><c r="E1"><f>_xlfn.TEXT(1)</f><v>-0</v></c><c r="F1"><f>1+1</f></c><c r="G1" t="e"><v>#VALUE!</v></c><c r="H1" t="b"><v>TRUE</v></c><c r="I1" t="b"/><c r="J1"><v>1e-999</v></c><c r="K1" t="s"><v></v></c></row></sheetData>', true, true,
    '<si><r><t>开始_x005F_x0041_\r\n</t></r><rPh><t>忽略拼音</t></rPh><r><t><![CDATA[&amp;\r\n原始尾部😀]]></t></r></si>')
  add('implicit-coordinates', '<sheetData><row><c/><c t="str"><v>第一行</v></c></row><row><c><v>1.25e+2</v></c></row></sheetData>')
  add('implicit-wide-row-compatible-fallback', '<sheetData><row>' + '<c/>'.repeat(16384) + '<c t="str"><v>完整宽行尾部</v></c></row></sheetData>', false)
  add('error-and-empty-formula-cache-retained', '<sheetData><row r="1"><c r="A1" t="e"/><c r="B1" t="str"><f>TEXT(1)</f></c><c r="C1"><f/></c></row></sheetData>')
  add('saved-date-compatible-fallback', '<sheetData><row><c t="d"><v>2026-10-22T00:00:00Z</v></c></row></sheetData>', false)
  add('numeric-prefix-compatible-fallback', '<sheetData><row><c><v>12compatible</v></c></row></sheetData>', false)
  const percent = parts(standard); percent['xl/_rels/workbook.xml.rels'] = xml(`<Relationships xmlns="${ns}"><Relationship Id="one" Type="${office}/worksheet" Target="worksheets/%73.xml"/><Relationship Id="strings" Type="${office}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
  corpus.push({ name: 'encoded-target-compatible-fallback', bytes: zipSync(percent), native: false, full: true })
  const large = parts(standard); large['public-large-unused.bin'] = new Uint8Array(9 * 1024 * 1024)
  corpus.push({ name: 'expanded-cache-overflow-is-full-fallback', bytes: zipSync(large, { level: 6 }), native: false, full: true })
  const sourceLarge = parts(standard); sourceLarge['public-large-unused.bin'] = new Uint8Array(2 * 1024 * 1024 + 1)
  corpus.push({ name: 'source-cache-overflow-is-full-fallback', bytes: zipSync(sourceLarge, { level: 0 }), native: false, full: true })
  for (const [name, raw, accepted] of [['invalid-auxiliary-sheet', '999', false], ['valid-auxiliary-sheet', '0', true]] as const) {
    const auxiliary=parts(standard)
    auxiliary['xl/workbook.xml']=xml(`<workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="人物卡" r:id="one"/><sheet name="辅助公开表" r:id="two"/></sheets></workbook>`)
    auxiliary['xl/_rels/workbook.xml.rels']=xml(`<Relationships xmlns="${ns}"><Relationship Id="one" Type="${office}/worksheet" Target="worksheets/s.xml"/><Relationship Id="two" Type="${office}/worksheet" Target="worksheets/aux.xml"/><Relationship Id="strings" Type="${office}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
    auxiliary['xl/worksheets/aux.xml']=xml(`<worksheet xmlns="${main}"><sheetData><row><c t="s"><v>${raw}</v></c></row></sheetData></worksheet>`)
    corpus.push({name,bytes:zipSync(auxiliary),native:accepted,full:accepted})
  }
  for (const [name, body] of [
    ['missing-sst', standard.replace('<v>0</v>', '<v>99</v>')],
    ['negative-sst', standard.replace('<v>0</v>', '<v>-1</v>')],
    ['whitespace-sst', standard.replace('<v>0</v>', '<v> 0</v>')],
    ['nan', standard.replace('<v>42</v>', '<v>NaN</v>')],
    ['infinity', standard.replace('<v>42</v>', '<v>Infinity</v>')],
    ['duplicate-cell', standard.replace('r="C1"', 'r="B1"')],
    ['cell-wrong-row', standard.replace('r="C1"', 'r="C2"')],
    ['column-outside-format', standard.replace('r="C1"', 'r="XFE1"')],
    ['unknown-cell-type', standard.replace('r="C1"', 'r="C1" t="unknown"')],
    ['explicit-empty-type', standard.replace('r="C1"', 'r="C1" t=""')],
    ['invalid-entity', standard.replace('<v>42</v>', '<v>&invalid;</v>')],
    ['duplicate-attribute', standard.replace('r="C1"', 'r="C1" r="C1"')],
    ['malformed-xml', standard.replace('</sheetData>', '')],
    ['invalid-merge', standard + '<mergeCells><mergeCell ref="XFE1:A1"/></mergeCells>'],
    ['dtd', '<!DOCTYPE worksheet [<!ENTITY x "forbidden">]>' + standard]
  ]) add(name!, body!, false, false)
  const corrupt = parts(standard); corrupt['unused.bin'] = strToU8('PUBLIC-CRC-PROOF')
  const crc = zipSync(corrupt, { level: 0 }), at = Buffer.from(crc).indexOf('PUBLIC-CRC-PROOF')
  if (at < 0) throw Error('CRC fixture missing payload')
  crc[at] = crc[at]! ^ 1
  corpus.push({ name: 'unused-payload-crc', bytes: crc, native: false, full: false })
  const unsafe = parts(standard); unsafe['../outside.bin'] = strToU8('public')
  corpus.push({ name: 'unsafe-archive-path', bytes: zipSync(unsafe), native: false, full: false })
  const mismatch = zipSync(parts(standard), { level: 0 }); mismatch[30] = mismatch[30]! ^ 1
  corpus.push({ name: 'local-central-name-mismatch', bytes: mismatch, native: false, full: false })
  const classic = zipSync(parts(standard), { level: 0 }), eocd = classic.length - 22
  const central = new DataView(classic.buffer, classic.byteOffset, classic.byteLength).getUint32(eocd + 16, true)
  for (const [name, offset] of [['central-offset-wraparound', eocd + 16], ['compressed-size-wraparound', central + 20], ['expanded-size-wraparound', central + 24]] as const) {
    const bytes = classic.slice(); new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, 0xfffffff8, true)
    corpus.push({ name, bytes, native: false, full: false })
  }
  return corpus
}
