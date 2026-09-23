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

/** 关键词命中次数。界面上的「N 处」和正文高亮都用它，保证两处数字一致。 */
export function countMatches(text: string, query: string): number {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return 0
  // 只关心个数，不关心偏移，所以可以放心用小写副本
  return countOccurrences(text.toLocaleLowerCase(), needle)
}

export interface TextSegment {
  text: string
  /** 是否命中关键词 */
  match: boolean
  /** 命中片段是第几处（从 0 开始）；非命中片段为 -1 */
  index: number
}

/**
 * 按关键词把一段文本切成「命中 / 非命中」片段，供界面高亮。
 * 每个命中片段带全局序号，界面据此实现“跳到第 N 处”。
 *
 * 切分依赖偏移量，所以必须保证小写副本与原文逐字符等长：
 * 个别语言（例如土耳其语的 İ）转小写会改变长度，一旦错位就会切坏正文。
 * 遇到这种文本就不高亮，宁可少个效果也不能显示错内容。
 */
export function splitByMatches(text: string, query: string): TextSegment[] {
  const plain: TextSegment[] = [{ text, match: false, index: -1 }]
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return plain
  const lower = text.toLocaleLowerCase()
  if (lower.length !== text.length) return plain
  const segments: TextSegment[] = []
  let cursor = 0
  let index = 0
  let at = lower.indexOf(needle)
  while (at !== -1) {
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false, index: -1 })
    segments.push({ text: text.slice(at, at + needle.length), match: true, index })
    index += 1
    cursor = at + needle.length
    at = lower.indexOf(needle, cursor)
  }
  if (!segments.length) return plain
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false, index: -1 })
  return segments
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
