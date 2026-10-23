import { expect, it } from 'vitest'
import { iosPublicIoConfig } from '../../tests/ios-public-io-config'
import { publicIoTableOrder } from '../../tests/public-io-table-order'

it('retains complete I/O unless a valid cold format is explicitly supplied', () => {
  expect(iosPublicIoConfig()).toEqual({ mode: 'complete' })
})

it.each(['csv', 'xlsx', 'xls'])('selects all formats with %s first for the cold probe', (first) => {
  const config = iosPublicIoConfig(first)
  expect(config).toEqual({ mode: 'tables', publicIoTableFirst: first })
  if (config.mode !== 'tables') throw new Error('Missing cold probe')
  const formats = publicIoTableOrder(config.publicIoTableFirst)
  expect(formats[0]).toBe(first)
  expect(new Set(formats)).toEqual(new Set(['csv', 'xlsx', 'xls']))
})

it.each([null, '', 'complete', 'CSV', ' csv', 'ods', false, 0, {}, ['csv']])(
  'rejects an invalid cold format without falling back to a warm sequence: %s',
  (first) => {
    expect(() => iosPublicIoConfig(first)).toThrow()
  }
)
