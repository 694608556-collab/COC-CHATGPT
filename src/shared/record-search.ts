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
  /** 首次命中落在第几条消息（手动内容的场次恒为 0），供点进详情后定位 */
  messageIndex: number
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

/**
 * 把「整段正文里的字符偏移」换算成「第几条消息」。
 * 拼接方式必须与 recordPlainText 完全一致（每条 `${header}\n${text}`，中间隔两个换行），
 * 否则点进详情后会定位到错误的那条。
 */
function messageIndexForOffset(
  record: SessionRecord,
  preset: FilterPreset,
  offset: number
): number {
  // 手动内容在 recordPlainText 里就是整段文本，只对应一条消息
  if (record.manualContent) return 0
  if (!record.rawContent) return 0
  const messages = applyLogFilters(record.rawContent, preset)
  let cursor = 0
  for (let index = 0; index < messages.length; index += 1) {
    const part = `${messages[index]!.header}\n${messages[index]!.text}`
    if (offset < cursor + part.length) return index
    cursor += part.length + 2
  }
  return Math.max(0, messages.length - 1)
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

export interface RecordMatch {
  /** 命中所在的第几条消息（用于点击定位） */
  messageIndex: number
  /** 该消息的标题（时间 + 说话人），列表里当小标题 */
  header: string
  /** 关键词前后的原文摘要 */
  excerpt: string
  /** 摘要中关键词的起始偏移与长度，供界面高亮 */
  excerptStart: number
  excerptLength: number
}

/**
 * 在当前场次的正文里逐条查找关键词，返回可直接渲染成结果列表的条目。
 * 与模组搜索的摘要算法保持一致：前后各截 SEARCH_EXCERPT_PADDING 个字符，
 * 压缩空白后再定位关键词。
 *
 * 命中按“第几条消息”组织，所以每条消息只会出现一次，
 * 不会出现同一个关键词在一条消息里被拆成多行结果的情况。
 */
export function searchRecordMessages(
  messages: Array<{ header: string; text: string }>,
  query: string
): RecordMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const results: RecordMatch[] = []
  messages.forEach((message, messageIndex) => {
    const source = [message.header, message.text].filter(Boolean).join('\n')
    if (!source) return
    const at = source.toLocaleLowerCase().indexOf(needle)
    if (at < 0) return
    const from = Math.max(0, at - SEARCH_EXCERPT_PADDING)
    const to = Math.min(source.length, at + needle.length + SEARCH_EXCERPT_PADDING)
    const excerpt = collapseWhitespace(source.slice(from, to))
    const hitAt = excerpt.toLocaleLowerCase().indexOf(needle)
    results.push({
      messageIndex,
      header: message.header,
      excerpt,
      // 关键词被压缩后的位置；找不到时退回片段开头，界面按无高亮处理
      excerptStart: hitAt < 0 ? 0 : hitAt,
      excerptLength: hitAt < 0 ? 0 : needle.length
    })
  })
  return results
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
      excerptLength: hitAt < 0 ? 0 : needle.length,
      // 首次命中在第几条消息：点进详情后据此滚动并标出那一条
      messageIndex: messageIndexForOffset(record, preset, at)
    })
  }
  return hits.sort((a, b) => b.matches - a.matches)
}
