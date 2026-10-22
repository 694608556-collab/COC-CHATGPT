/** Filesystem-independent desktop naming rules, also used by the Android exporter. */
export function sanitizeExportName(value: string, fallback = '未命名'): string {
  let result = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '＿' : character
  )
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!result) result = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`
  return result.slice(0, 120).replace(/[. ]+$/g, '') || fallback
}

export type NamedExportFormat = 'raw' | 'txt' | 'doc' | 'dialogue-doc' | 'docx' | 'pdf'
export function exportDate(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}
export function recordExportName(
  module: string,
  record: string,
  date: string | undefined,
  format: NamedExportFormat
): string {
  const suffix =
    format === 'doc' ? '带图' : format === 'dialogue-doc' ? '对话' : format === 'raw' ? '原始' : ''
  const extension = format === 'raw' ? 'json' : format === 'dialogue-doc' ? 'doc' : format
  return `${sanitizeExportName((date?.replace(/-/g, '') || '日期未知') + module + record + suffix)}.${extension}`
}
export function combinedExportName(module: string, format: NamedExportFormat, now = new Date()): string {
  const extension = format === 'raw' ? 'json' : format === 'dialogue-doc' ? 'doc' : format
  return `${sanitizeExportName(exportDate(now) + module + '合集')}.${extension}`
}
export function tableExportName(format: 'csv' | 'xlsx', count: number, now = new Date()): string {
  return `COC跑团记录${exportDate(now)}.${format === 'csv' && count > 1 ? 'zip' : format}`
}
/** @param format 整库备份格式。 @param now 设备本地日期。 @returns 当天首份备份名；保存端统一为同日后续 JSON/ZIP 递增编号。 */
export function backupExportName(format: 'json' | 'zip', now = new Date()): string {
  const date =
    String(now.getFullYear()).padStart(4, '0') +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  return `${date}COC跑团记录簿.${format}`
}
/** Export requests always include a normal extension; keep the desktop (2), (3) collision convention. */
export function nextExportName(existing: Iterable<string>, requested: string): string {
  const used = new Set(Array.from(existing, (name) => name.toLocaleLowerCase()))
  const backup = /^(\d{8}COC跑团记录簿)\.(json|zip)$/i.exec(requested)
  if (backup) {
    let maximum = -1
    for (const name of used) {
      const match = /^(\d{8}COC跑团记录簿)(\d*)\.(?:json|zip)$/i.exec(name)
      if (match?.[1]?.toLocaleLowerCase() !== backup[1]!.toLocaleLowerCase()) continue
      const number = Number(match[2] || 0)
      if (!Number.isSafeInteger(number) || number >= Number.MAX_SAFE_INTEGER)
        throw new Error('备份文件序号无效，请更换保存目录。')
      maximum = Math.max(maximum, number)
    }
    return backup[1]! + (maximum < 0 ? '' : maximum + 1) + '.' + backup[2]!
  }
  if (!used.has(requested.toLocaleLowerCase())) return requested
  const dot = requested.lastIndexOf('.')
  const stem = dot > 0 ? requested.slice(0, dot) : requested
  const extension = dot > 0 ? requested.slice(dot) : ''
  let index = 2
  while (used.has(`${stem} (${index})${extension}`.toLocaleLowerCase())) index++
  return `${stem} (${index})${extension}`
}
