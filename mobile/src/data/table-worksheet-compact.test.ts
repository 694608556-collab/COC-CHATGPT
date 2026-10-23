import { afterEach, expect, it, vi } from 'vitest'
import { createWorksheetEvents } from './table-worksheet'
import * as streamJson from './stream-json'

afterEach(() => vi.restoreAllMocks())
type Token = [string, string, string, string, string, boolean]

/** Replay one public row through either transport into the same worksheet boundary.
 * @param compact Select the complete native token entry point.
 * @param tokens Complete public token tuples, including unused raw/inline values.
 * @param details Whether formula/error metadata is required by the caller.
 * @returns Complete row values, optional cell details and checked arithmetic calls.
 */
async function replay(compact: boolean, tokens: Token[], details: boolean) {
  const rows: unknown[] = [], cells: unknown[] = [], reads: number[] = []
  const add = vi.spyOn(streamJson, 'addStreamBytes')
  const events = createWorksheetEvents({
    readString(index) { reads.push(index); return '完整共享字符串😀\r\n\0尾' },
    onRow(row) { rows.push(row) },
    ...(details ? { onCell(cell: unknown) { cells.push(cell) } } : {})
  }, 1, 0, false)
  try {
    await events.start('row', { r: '1' })
    for (const [address, type, raw, inline, formula, hasFormula] of tokens) {
      if (compact) await events.compactCell(address, type, raw, inline, formula, hasFormula)
      else {
        await events.start('c', { r: address, ...(type ? { t: type } : {}) })
        if (hasFormula) { await events.start('f', {}); if (formula) await events.text(formula); await events.end('f') }
        if (raw) { await events.start('v', {}); await events.text(raw); await events.end('v') }
        if (inline) { await events.start('t', {}); await events.text(inline); await events.end('t') }
        await events.end('c')
      }
    }
    await events.end('row')
    return { rows, cells, reads, arithmetic: add.mock.calls.map(args => [...args]) }
  } finally { add.mockRestore() }
}

it.each([false, true])('compact tokens preserve all row, formula, error and UTF-8 details: %s', async details => {
  const tokens: Token[] = [
    ['A1', '', '', '', '', false], ['C1', 'n', '42', '', '', false],
    ['D1', 'inlineStr', 'unused完整原始😀\0', '完整😀\r\n\0_x005F_x0041_', '', false],
    ['E1', 'str', '完整高\ud800x低\udc00_x0000_', 'unused内联😀\0', '_xlfn.SUM(1,2)\r\n', true],
    ['F1', 's', '0', '', '', false], ['G1', 'b', 'TRUE', '', '', false],
    ['H1', 'e', '#DIV/0!', '', '1/0', true], ['I1', 'n', '', '', '', true],
    ['J1', 'd', '2026-10-23T00:00:00Z', '', '', false], ['K1', 's', '', '', '', false]
  ]
  const original = await replay(false, tokens, details)
  expect(await replay(true, tokens, details)).toEqual(original)
  expect(original.rows).toHaveLength(1)
})

it.each<Token>([
  ['A2','n','1','','',false], ['A1','unknown','1','','',false],
  ['A1','s','1','','',false], ['A1','s','-1','','',false],
  ['A1','n','NaN','','',false], ['A1','n','1e309','','',false],
  ['A1','d','not a date','','',false], ['XFE1','n','1','','',false]
])('compact transport rejects the original invalid complete cell %j', async (...token) => {
  await expect(replay(false, [token], true)).rejects.toThrow()
  await expect(replay(true, [token], true)).rejects.toThrow()
})

it('compact transport cannot bypass duplicate or decreasing coordinates', async () => {
  for (const address of ['A1','B1']) {
    const tokens: Token[] = [['B1','inlineStr','','完整先行😀','',false],[address,'n','1','','',false]]
    await expect(replay(false,tokens,false)).rejects.toThrow()
    await expect(replay(true,tokens,false)).rejects.toThrow()
  }
})
