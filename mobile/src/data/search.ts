import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import { applyLogFilters } from '../../../src/shared/log-filter'

/** Literal, case-insensitive matches with offsets into the original UTF-16 text. */
export function matchRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = query.trim()
  if (!needle) return []
  const pattern = new RegExp(needle.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'), 'gi')
  const result: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) result.push({ start: match.index, end: match.index + match[0].length })
  return result
}

export function searchExcerpt(text: string, query: string): string {
  const at = matchRanges(text, query)[0]?.start ?? 0
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + Math.max(query.trim().length, 1) + 60)
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/** 模组搜索与阅读器使用同一份过滤、手动分行和定位索引。 */
export function recordMessages(record: SessionRecord, preset: FilterPreset) {
  return record.rawContent
    ? applyLogFilters(record.rawContent, preset)
    : record.manualContent !== undefined
      ? record.manualContent
          .split(/\r\n?|\n/)
          .map((text, i) => ({ id: 'manual-' + i, header: '', text, images: [] }))
          .filter((message) => message.text.trim().length > 0)
      : []
}
