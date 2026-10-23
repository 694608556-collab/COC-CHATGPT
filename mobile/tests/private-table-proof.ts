import type { TableImportRow } from '../../src/shared/table-import'

type Proof = { bytes: number; sha256: string }
export interface PrivateTableExpectation {
  version: 1
  source: Proof
  candidate: Proof
  valuesSha256: string
  rows: number
  linkRows: number
  manualRows: number
  manualBytes: number
  moduleRows: number[]
}
function check(value: unknown): asserts value {
  if (!value) throw Error('Private table complete proof mismatch')
}
function proof(value: any): value is Proof {
  return value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256)
}
export function requirePrivateTableExpectation(value: unknown): PrivateTableExpectation {
  const item = value as PrivateTableExpectation | undefined
  check(
    item?.version === 1 &&
      proof(item.source) &&
      proof(item.candidate) &&
      /^[a-f0-9]{64}$/.test(item.valuesSha256)
  )
  for (const key of ['rows', 'linkRows', 'manualRows', 'manualBytes'] as const)
    check(Number.isSafeInteger(item[key]) && item[key] >= 0)
  check(item.rows > 0 && item.linkRows <= item.rows && item.manualRows <= item.rows)
  check(
    Array.isArray(item.moduleRows) &&
      item.moduleRows.length > 0 &&
      item.moduleRows.every((count) => Number.isSafeInteger(count) && count > 0)
  )
  check(item.moduleRows.reduce((sum, count) => sum + count, 0) === item.rows)
  check((item.manualRows === 0) === (item.manualBytes === 0))
  return item
}
/** Only runtime rows enter this function. No private values are packaged or logged. */
export function privateTableRowsText(rows: readonly TableImportRow[]): string {
  function stable(value: any): any {
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stable(value[key])])
      )
    return value
  }
  return JSON.stringify(stable(rows))
}
export function privateTableSummary(rows: readonly TableImportRow[]) {
  const modules = new Map<string, number>()
  let linkRows = 0,
    manualRows = 0,
    manualBytes = 0
  for (const row of rows) {
    check(
      row &&
        typeof row.moduleName === 'string' &&
        row.moduleName.trim() &&
        typeof row.sessionName === 'string' &&
        typeof row.link === 'string'
    )
    modules.set(row.moduleName, (modules.get(row.moduleName) ?? 0) + 1)
    if (row.link) linkRows++
    if (row.manualContent !== undefined) {
      check(typeof row.manualContent === 'string' && row.manualContent.trim())
      manualRows++
      manualBytes += new TextEncoder().encode(row.manualContent).length
    }
  }
  return {
    rows: rows.length,
    linkRows,
    manualRows,
    manualBytes,
    moduleRows: [...modules.values()].sort((a, b) => a - b)
  }
}
async function sha256(value: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value.slice().buffer)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
export async function verifyPrivateTableCandidate(
  expected: unknown,
  source: Proof | undefined,
  candidate: Proof | undefined,
  bytes: Uint8Array
): Promise<TableImportRow[]> {
  const checked = requirePrivateTableExpectation(expected)
  check(source?.bytes === checked.source.bytes && source.sha256 === checked.source.sha256)
  check(candidate?.bytes === checked.candidate.bytes && candidate.sha256 === checked.candidate.sha256)
  check(bytes.length === checked.candidate.bytes && (await sha256(bytes)) === checked.candidate.sha256)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  check(text.endsWith('\n'))
  let previousSheet = -1,
    previousRow = -1
  const rows = text
    .slice(0, -1)
    .split('\n')
    .map((line) => {
      check(line[0] === 'T')
      const frame = JSON.parse(line.slice(1))
      check(
        Number.isSafeInteger(frame.sheetOrder) &&
          frame.sheetOrder >= 0 &&
          Number.isSafeInteger(frame.rowOrder) &&
          frame.rowOrder >= 0
      )
      check(
        frame.sheetOrder > previousSheet ||
          (frame.sheetOrder === previousSheet && frame.rowOrder > previousRow)
      )
      previousSheet = frame.sheetOrder
      previousRow = frame.rowOrder
      return frame.value as TableImportRow
    })
  check((await sha256(new TextEncoder().encode(privateTableRowsText(rows)))) === checked.valuesSha256)
  const summary = privateTableSummary(rows)
  for (const key of ['rows', 'linkRows', 'manualRows', 'manualBytes'] as const)
    check(summary[key] === checked[key])
  check(JSON.stringify(summary.moduleRows) === JSON.stringify([...checked.moduleRows].sort((a, b) => a - b)))
  return rows
}
