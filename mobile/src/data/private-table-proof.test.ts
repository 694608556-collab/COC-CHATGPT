import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  privateTableRowsText,
  privateTableSummary,
  requirePrivateTableExpectation,
  verifyPrivateTableCandidate
} from '../../tests/private-table-proof'

const rows = [
  {
    sheet: 'Public A',
    moduleName: 'Public A',
    sessionName: 'Online',
    link: 'https://log.weizaima.com/?key=public-test',
    kps: [],
    pairs: []
  },
  {
    sheet: 'Public B',
    moduleName: 'Public B',
    sessionName: 'Manual',
    link: '',
    manualContent: '完整😀\r\n\u0000尾',
    kps: [],
    pairs: []
  }
]
const bytes = new TextEncoder().encode(
  rows
    .map((value, rowOrder) => 'T' + JSON.stringify({ sheetOrder: rowOrder, rowOrder: 1, value }))
    .join('\n') + '\n'
)
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const source = { bytes: 345, sha256: '1'.repeat(64) }
const expected = () => ({
  version: 1,
  source,
  candidate: { bytes: bytes.length, sha256: sha(bytes) },
  valuesSha256: sha(privateTableRowsText(rows)),
  ...privateTableSummary(rows)
})

it('runtime-only private table expectations require complete proofs and consistent counts', () => {
  expect(requirePrivateTableExpectation(expected()).rows).toBe(2)
  for (const value of [
    undefined,
    {},
    { ...expected(), source: {} },
    { ...expected(), candidate: { bytes: 0, sha256: '0'.repeat(64) } },
    { ...expected(), valuesSha256: 'invalid' },
    { ...expected(), moduleRows: [1] },
    { ...expected(), rows: 3 },
    { ...expected(), manualBytes: -1 }
  ])
    expect(() => requirePrivateTableExpectation(value)).toThrow('Private table')
})

it('complete candidate proof preserves all rows, Unicode, NUL and CRLF', async () => {
  await expect(verifyPrivateTableCandidate(expected(), source, expected().candidate, bytes)).resolves.toEqual(
    rows
  )
})

it('missing configuration or mismatched source, staged proof and private oracle reject the candidate', async () => {
  await expect(verifyPrivateTableCandidate(undefined, source, expected().candidate, bytes)).rejects.toThrow(
    'Private table'
  )
  await expect(
    verifyPrivateTableCandidate(
      expected(),
      { ...source, bytes: source.bytes + 1 },
      expected().candidate,
      bytes
    )
  ).rejects.toThrow('Private table')
  await expect(
    verifyPrivateTableCandidate(
      expected(),
      source,
      { ...expected().candidate, sha256: '0'.repeat(64) },
      bytes
    )
  ).rejects.toThrow('Private table')
  await expect(
    verifyPrivateTableCandidate(
      { ...expected(), valuesSha256: '0'.repeat(64) },
      source,
      expected().candidate,
      bytes
    )
  ).rejects.toThrow('Private table')
  await expect(
    verifyPrivateTableCandidate(
      { ...expected(), manualBytes: expected().manualBytes + 1 },
      source,
      expected().candidate,
      bytes
    )
  ).rejects.toThrow('Private table')
})

it('correctly rehashed truncation, extra rows and changed final manual bytes still fail the independent oracle', async () => {
  for (const changed of [
    bytes.slice(0, -1),
    new Uint8Array([...bytes, ...bytes]),
    new TextEncoder().encode(new TextDecoder().decode(bytes).replace('尾', '改'))
  ]) {
    const candidate = { bytes: changed.length, sha256: sha(changed) }
    await expect(
      verifyPrivateTableCandidate({ ...expected(), candidate }, source, candidate, changed)
    ).rejects.toThrow('Private table')
  }
})
