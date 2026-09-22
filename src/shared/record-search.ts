import type { SessionRecord } from './types'
import { applyLogFilters } from './log-filter'
import type { FilterPreset } from './types'

export interface ModuleSearchHit {
  recordId: string
  recordName: string
  /** 该场次内命中关键词的次数 */
  matches: number
  /** 关键词前后各截一段的摘要，供结果列表展示 */
  excerpt: string
  /** 摘要中关键词的起始偏移，供界面高亮 */
  excerptStart: number
  excerptLength: number
}

export const SEARCH_EXCERPT_PADDING = 28

/** 取一条记录的纯文本正文：手动内容优先，否则把已抓取的消息拼起来。 */
export function recordPlainText(record: SessionRecord, preset: FilterPreset): string {
  if (record.manualContent) return record.manualContent
  if (!record.rawContent) return ''
  return applyLogFilters(record.rawContent, preset)
    .map((message) => `${message.header}\n${message.text}`)
    .join('\n\n')
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * 在一个模组的所有场次正文里搜索关键词。
 * 没有正文的场次（链接未检测）自然不会命中。
 */
export function searchModuleRecords(
  records: SessionRecord[],
  query: string,
  preset: FilterPreset
): ModuleSearchHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const hits: ModuleSearchHit[] = []
  for (const record of records) {
    const source = recordPlainText(record, preset)
    if (!source) continue
    const matches = countOccurrences(source.toLocaleLowerCase(), needle)
    if (!matches) continue
    const at = source.toLocaleLowerCase().indexOf(needle)
    const from = Math.max(0, at - SEARCH_EXCERPT_PADDING)
    const to = Math.min(source.length, at + needle.length + SEARCH_EXCERPT_PADDING)
    // 先压缩空白再定位关键词：压缩会改变偏移，所以这里对片段本身重新查找
    const raw = source.slice(from, to)
    const excerpt = collapseWhitespace(raw)
    const hitAt = excerpt.toLocaleLowerCase().indexOf(needle)
    hits.push({
      recordId: record.id,
      recordName: record.name,
      matches,
      excerpt,
      // 关键词被压缩后的位置；找不到时退回片段开头，界面按无高亮处理
      excerptStart: hitAt < 0 ? 0 : hitAt,
      excerptLength: hitAt < 0 ? 0 : needle.length
    })
  }
  return hits.sort((a, b) => b.matches - a.matches)
}
