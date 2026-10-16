import { zipSync } from 'fflate'
import { exportRecordTables } from '../../../src/shared/record-table'
import { nextExportName, sanitizeExportName, tableExportName } from '../../../src/shared/export-filenames'
import type { AppSnapshot } from '../../../src/shared/types'
import type { MobileSnapshot } from './types'

/** Same root filename and multi-module CSV archive shape as the desktop export. */
export function createRecordTableExport(snapshot: MobileSnapshot, format: 'csv' | 'xlsx') {
  const files = exportRecordTables(snapshot as unknown as AppSnapshot, format)
  const name = tableExportName(format, files.length)
  if (format === 'xlsx')
    return {
      name,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: files[0]!.bytes
    }
  if (files.length === 1) return { name, mime: 'text/csv', bytes: files[0]!.bytes }
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) {
    const entry = nextExportName(
      Object.keys(entries),
      sanitizeExportName(file.name.slice(0, -4), '未命名模组') + '.csv'
    )
    entries[entry] = file.bytes
  }
  return { name, mime: 'application/zip', bytes: zipSync(entries) }
}
