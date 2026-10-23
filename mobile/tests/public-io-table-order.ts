/** Public record-table formats covered by every complete timing matrix. */
export type PublicIoTableFormat = 'csv' | 'xlsx' | 'xls'

/** Rotate the complete public table matrix so a fresh process can measure each format first.
 * @param first Instrumentation-only format choice; omitted means the existing CSV-first order.
 * @returns A new array containing all three formats once, in cyclic order from `first`.
 * @throws If the supplied value is not exactly `csv`, `xlsx` or `xls`; never silently drops a format.
 */
export function publicIoTableOrder(first: unknown = 'csv'): PublicIoTableFormat[] {
  const formats: PublicIoTableFormat[] = ['csv', 'xlsx', 'xls']
  const start = first === 'csv' ? 0 : first === 'xlsx' ? 1 : first === 'xls' ? 2 : -1
  if (start < 0) throw new Error('publicIoTableFirst must be exactly csv, xlsx or xls')
  return [...formats.slice(start), ...formats.slice(0, start)]
}
