import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as XLSX from 'xlsx'
import { nativeRecordKernelCorpus } from './native-record-kernel-corpus'
import { readTableGridStream } from '../src/data/table-grid-stream'
import type { TableGridStreamOptions } from '../src/data/table-grid-stream'
import { readKernelRecordsGrid } from '../src/data/table-kernel-records'
import { createImportSheetParser, parseImportWorkbook } from '../../src/shared/table-import'

type Row = { index: number; values: Array<string | number | boolean | null> }
type Cell = Parameters<NonNullable<TableGridStreamOptions['onCell']>>[0]
type Sheet = { name: string; order: number; mergedRanges: string[]; rows: Row[]; cells: Cell[] }
function collector() {
  const sheets: Sheet[] = []
  let active: Sheet | undefined
  return {
    sheets,
    events: {
      onSheetStart(info: { name: string; order: number; mergedRanges?: string[] }) {
        assert.equal(active, undefined, 'Previous complete sheet must end')
        active = { ...info, mergedRanges: info.mergedRanges ?? [], rows: [], cells: [] }; sheets.push(active)
      },
      onRow(row: Row) { assert(active); active.rows.push(row) },
      onCell(cell: Cell) { assert(active); active.cells.push(cell) },
      onSheetEnd() { assert(active); active = undefined }
    },
    complete() { assert.equal(active, undefined); return sheets.sort((a, b) => a.order - b.order) }
  }
}
function candidates(sheets: Sheet[]) {
  return sheets.flatMap(sheet => {
    const parse = createImportSheetParser(sheet.name)
    return sheet.rows.flatMap(row => {
      const value = parse(row.values)
      return value ? [{ sheetOrder: sheet.order, rowOrder: row.index, value }] : []
    })
  })
}

export async function checkRecordKernel(directory: string, probe?: string, savedResponses?: string) {
  const manifest = []
  for (const item of nativeRecordKernelCorpus()) {
    const file = path.resolve(directory, 'record-' + item.name + '.xlsx')
    fs.writeFileSync(file, item.bytes)
    const proof = { bytes: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') }
    const original = collector(), strings: string[] = []
    let full = true
    try {
      await readTableGridStream({
        name: 'public-record.xlsx', format: 'xlsx', collectMergedRanges: true,
        expectedSource: proof, maximumExpandedBytes: 1024 * 1024 * 1024,
        async *source() { for (let at = 0; at < item.bytes.length; at += 262144) yield item.bytes.slice(at, at + 262144) },
        writeString(index, value) { strings[index] = value }, readString(index) { return strings[index]! },
        ...original.events
      })
      original.complete()
    } catch { full = false }
    assert.equal(full, item.full, item.name + ': complete old reader acceptance')
    if (full && item.candidates !== undefined) {
      const parsed = candidates(original.sheets)
      assert.equal(parsed.length, item.candidates, item.name + ': every old candidate')
      assert.equal(parsed.find(row => row.value.sessionName === '完整长手动正文')?.value.manualContent, item.completeManual, item.name + ': old complete manual body')
      const independent = parseImportWorkbook(XLSX.read(item.bytes, { type: 'array', raw: true }))
      assert.deepEqual(parsed.map(row => row.value), independent, item.name + ': independent original SheetJS importer')
    }
    if (probe || savedResponses) {
      let response: string
      if (savedResponses) response = fs.readFileSync(path.resolve(savedResponses, 'record-' + item.name + '.json'), 'utf8')
      else {
        const process = spawnSync(probe!, [file, 'records'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
        assert.equal(process.status, 0, item.name + ': actual production records kernel executable')
        response = process.stdout
      }
      const native = JSON.parse(response)
      assert.equal(native.supported, item.native, item.name + ': complete records capability/fallback')
      if (native.supported) {
        assert(full, item.name + ': never accept invalid complete source')
        const projected = collector()
        assert.equal(await readKernelRecordsGrid({ source: proof, payloadJson: response }, proof, projected.events), true)
        const sheets = projected.complete()
        // No compaction: even trailing blank cells, empty rows, complete
        // formulas, errors and every merged range must match exactly.
        assert.deepEqual(sheets, original.sheets, item.name + ': every sheet/row/cell/value/formula/merge')
        assert.deepEqual(candidates(sheets), candidates(original.sheets), item.name + ': complete existing mapper candidates')
        assert.equal(sheets.reduce((total, sheet) => total + sheet.cells.length, 0), native.validatedCells, item.name + ': every native cell accounted')
        if (item.completeManual !== undefined)
          assert.equal(candidates(sheets).find(row => row.value.sessionName === '完整长手动正文')?.value.manualContent, item.completeManual, item.name + ': no truncation or newline normalization')
      } else {
        assert.deepEqual(native, { version: 1, supported: false }, item.name + ': no partial successful projection')
        const projected = collector()
        assert.equal(await readKernelRecordsGrid({ source: proof, payloadJson: response }, proof, projected.events), false)
        assert.deepEqual(projected.sheets, [], item.name + ': fallback emits no partial rows')
      }
    }
    manifest.push({ name: item.name, bytes: item.bytes.length, native: item.native, full: item.full,
      ...(item.candidates !== undefined ? { candidates: item.candidates } : {}) })
    if (item.completeManual !== undefined) fs.writeFileSync(path.resolve(directory, 'record-complete-manual.txt'), item.completeManual)
  }
  fs.writeFileSync(path.join(directory, 'record-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ recordsCases: manifest.length, valid: manifest.filter(item => item.full).length,
    invalid: manifest.filter(item => !item.full).length, nativeDifferential: !!(probe || savedResponses), passed: true }))
}
