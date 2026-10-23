import { expect, it } from 'vitest'
import { publicIoTableOrder } from '../../tests/public-io-table-order'

it('keeps the existing CSV-first matrix when instrumentation omits the option', () => {
  expect(publicIoTableOrder()).toEqual(['csv', 'xlsx', 'xls'])
  expect(publicIoTableOrder(undefined)).toEqual(['csv', 'xlsx', 'xls'])
})

it.each([
  ['csv', ['csv', 'xlsx', 'xls']],
  ['xlsx', ['xlsx', 'xls', 'csv']],
  ['xls', ['xls', 'csv', 'xlsx']]
])('starts with %s and retains every other public format exactly once', (first, expected) => {
  const order = publicIoTableOrder(first)
  expect(order).toEqual(expected)
  expect(order).toHaveLength(3)
  expect([...order].sort()).toEqual(['csv', 'xls', 'xlsx'])
  // Only the final format's third preview may remain open for the single commit.
  expect(order[2]).toBe(expected[2])
})

it.each(['', 'CSV', ' xlsx', 'xls ', 'ods', 'csv,xlsx,xls', null, 0, false, [], {}])(
  'rejects an invalid instrumentation value without narrowing the matrix: %j',
  (first) => {
    expect(() => publicIoTableOrder(first)).toThrow('publicIoTableFirst must be exactly csv, xlsx or xls')
  }
)

it('returns a fresh order so one run cannot remove a later run format', () => {
  publicIoTableOrder('xlsx').pop()
  expect(publicIoTableOrder('xlsx')).toEqual(['xlsx', 'xls', 'csv'])
  expect(publicIoTableOrder()).toEqual(['csv', 'xlsx', 'xls'])
})
