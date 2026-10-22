import type { MobileSnapshot } from './types'
/** Drop only committed native body copies; durable bodies remain in SQLite.
 * Keep the current bounded read/export selection, never an accumulating library.
 */
export function retainBodySelection(
  snapshot: MobileSnapshot,
  deferred: ReadonlySet<string>,
  ids: ReadonlySet<string>
): { snapshot: MobileSnapshot; deferred: Set<string>; changed: boolean } {
  const nextDeferred = new Set(deferred)
  let changed = false
  const records = snapshot.records.map((record) => {
    if (ids.has(record.id) || (record.rawContent === undefined && record.manualContent === undefined))
      return record
    const { rawContent, manualContent, ...metadata } = record
    nextDeferred.add(record.id)
    changed = true
    return metadata
  })
  return { snapshot: changed ? { ...snapshot, records } : snapshot, deferred: nextDeferred, changed }
}
