import { createLogTextProjector } from '../../../src/shared/log-filter'
import type { FilterPreset } from '../../../src/shared/types'
/** Complete visible message fields; image presence only participates in filtering. */
export type SearchMessageText = { header: string; text: string }

/** Validate and render all native schema-attested search tuples.
 * @param rows Complete original-validated tuple list. @param preset Exact current reading filters.
 * @returns All visible header/text pairs, preserving ordering and complete text.
 */
export function projectSearchTuples(rows: unknown, preset: FilterPreset): SearchMessageText[] {
  if (!Array.isArray(rows)) throw new Error('正文搜索投影消息数组无效。')
  const project = createLogTextProjector(preset),
    result: SearchMessageText[] = []
  for (const row of rows) {
    // Validate hidden tuples too; filtering cannot conceal a malformed tail.
    if (
      !Array.isArray(row) ||
      row.length !== 7 ||
      (row[0] !== null && typeof row[0] !== 'string') ||
      typeof row[1] !== 'string' ||
      (row[2] !== null && typeof row[2] !== 'string') ||
      typeof row[3] !== 'string' ||
      typeof row[4] !== 'boolean' ||
      typeof row[5] !== 'boolean' ||
      typeof row[6] !== 'boolean'
    )
      throw new Error('正文搜索投影消息字段无效。')
    const message = project(row[0] ?? undefined, row[1], row[2] ?? undefined, row[3], row[4], row[5], row[6])
    if (message) result.push(message)
  }
  return result
}
