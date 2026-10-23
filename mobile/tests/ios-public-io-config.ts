import { publicIoTableOrder, type PublicIoTableFormat } from './public-io-table-order'

/** Select the optional cold table probe; the unchanged default runs complete I/O. */
export function iosPublicIoConfig(
  first: unknown = undefined
): { mode: 'complete' } | { mode: 'tables'; publicIoTableFirst: PublicIoTableFormat } {
  if (first === undefined) return { mode: 'complete' }
  return { mode: 'tables', publicIoTableFirst: publicIoTableOrder(first)[0]! }
}
