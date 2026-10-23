import { createHook } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readTableGridStream } from './table-grid-stream'

it('完整扫描12张表86400个单元格，不为同步XML事件创建逐标签Promise', async () => {
  const book = XLSX.utils.book_new()
  for (let sheet = 0; sheet < 12; sheet++) XLSX.utils.book_append_sheet(book,
    XLSX.utils.aoa_to_sheet(Array.from({ length: 200 }, (_, row) =>
      Array.from({ length: 36 }, (_, column) => sheet * 7200 + row * 36 + column))), '公开表' + sheet)
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }))
  const strings: string[] = []
  let cells = 0, last: unknown, promises = 0
  const hook = createHook({ init(_id, type) { if (type === 'PROMISE') promises++ } })
  hook.enable()
  try {
    await readTableGridStream({
      name: 'public-large-cell-count.xlsx', format: 'xlsx',
      expectedSource: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      maximumExpandedBytes: 64 * 1024 * 1024,
      async *source() { for (let at = 0; at < bytes.length; at += 262144) yield bytes.subarray(at, at + 262144) },
      async writeString(index, text) { expect(index).toBe(strings.length); strings.push(text) },
      async readString(index) { return strings[index]! },
      async onSheetStart() {}, async onRow() {}, async onSheetEnd() {},
      onCell(cell) { cells++; last = cell.value }
    })
  } finally { hook.disable() }
  expect(cells).toBe(86400)
  expect(last).toBe(86399)
  expect(promises, 'full XML validation should await actual asynchronous work, not every tag').toBeLessThan(100000)
})
