import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { nativeTableKernelCorpus } from './native-table-kernel-corpus'
import { readTableGridStream } from '../src/data/table-grid-stream'
import { projectKernelCoc7Sheet, previewKernelCoc7 } from '../src/data/table-kernel-preview'
import { previewCoc7Import } from '../src/data/coc7-import'
import { characterDraftProofText } from './character-draft-proof'
import { checkRecordKernel } from './table-record-kernel-differential'

const directory = process.argv[2]!, probe = process.argv[3], savedResponses = process.argv[4]
fs.mkdirSync(directory, { recursive: true })
const manifest = []
for (const item of nativeTableKernelCorpus()) {
  const file = path.resolve(directory, item.name + '.xlsx')
  fs.writeFileSync(file, item.bytes)
  const strings: string[] = [], sheet: Record<string, any> = {}
  let selected = false, full = true
  try {
    await readTableGridStream({
      name: 'public.xlsx', format: 'xlsx', collectMergedRanges: false,
      expectedSource: { bytes: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') },
      maximumExpandedBytes: 1024 * 1024 * 1024,
      async *source() { for (let at = 0; at < item.bytes.length; at += 262144) yield item.bytes.slice(at, at + 262144) },
      writeString(index, text) { strings[index] = text }, readString(index) { return strings[index]! },
      onSheetStart(info) { selected = info.name === '人物卡' }, onRow() {}, onSheetEnd() {},
      onCell(cell) {
        if (!selected || Number(cell.address.match(/\d+$/)?.[0]) > 95) return
        sheet[cell.address] = { t: cell.type, ...(cell.value === undefined ? {} : { v: cell.value }),
          ...(cell.hasFormula ? { f: cell.formula || 'SAVED_FORMULA' } : {}) }
      }
    })
  } catch { full = false }
  assert.equal(full, item.full, item.name + ': complete reader acceptance')
  if (probe || savedResponses) {
    let response: string
    if (savedResponses) response = fs.readFileSync(path.resolve(savedResponses, item.name + '.json'), 'utf8')
    else {
      const process = spawnSync(probe!, [file], { encoding: 'utf8' })
      assert.equal(process.status, 0, item.name + ': actual production kernel executable')
      response = process.stdout
    }
    const native = JSON.parse(response)
    assert.equal(native.supported, item.native, item.name + ': native capability/fallback')
    if (native.supported) {
      assert(full, item.name + ': native must never accept invalid complete input')
      const compact = (value: Record<string, any>) => Object.fromEntries(Object.entries(value).filter(([, cell]) => !(cell.t === 'n' && cell.v === undefined && !cell.f)))
      assert.deepEqual(compact(await projectKernelCoc7Sheet(native)), compact(sheet), item.name + ': every projected value/formula/error')
      if (item.draft) assert.equal(characterDraftProofText(await previewKernelCoc7(native)), characterDraftProofText(previewCoc7Import(item.bytes, 'public.xlsx')), item.name + ': independent complete draft')
    }
  }
  manifest.push({ name: item.name, bytes: item.bytes.length, native: item.native, full: item.full })
}
fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ cases: manifest.length, valid: manifest.filter(item => item.full).length,
  invalid: manifest.filter(item => !item.full).length, nativeDifferential: !!(probe || savedResponses), passed: true }))
await checkRecordKernel(directory, probe, savedResponses)
