import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import { applyLogFilters } from '../../../src/shared/log-filter'

/** 构造字面、不区分大小写的查询；空白查询不命中。
 * @param query 用户输入，匹配前去除首尾空白。
 * @param global 是否连续扫描所有不重叠命中。
 * @returns 独立正则，空查询返回undefined；不共享lastIndex。
 */
function literalPattern(query: string, global = false): RegExp | undefined {
  const needle = query.trim()
  if (!needle) return undefined
  return new RegExp(needle.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'), global ? 'gi' : 'i')
}

/** 为一次已提交查询复用匹配器；每次调用重置扫描位置，避免跨消息遗漏。
 * @param query 用户提交的字面查询。
 * @returns 可重复用于不同消息的计数及摘要函数。
 */
export function compileBodyQuery(query: string) {
  const pattern = literalPattern(query, true)
  const needle = query.trim()
  // Unified CJK ideographs, CJK punctuation and ASCII digits/space have no
  // ignore-case aliases. Their literal UTF-16 search can use the engine's
  // indexOf loop; all cased text retains the original RegExp semantics.
  const direct = /^[\u3400-\u9fff\u3000-\u303f0-9 ]+$/.test(needle)
  /** @param text 完整待计数字符串。 @returns 与字面不区分大小写正则相同的全部计数。 */
  const countText = (text: string): number => {
    if (!pattern) return 0
    if (direct) {
      let count = 0,
        from = 0,
        at: number
      while ((at = text.indexOf(needle, from)) >= 0) {
        count++
        from = at + needle.length
      }
      return count
    }
    pattern.lastIndex = 0
    let count = 0
    while (pattern.test(text)) count++
    return count
  }
  return {
    /** @param text 待判断消息。 @returns 首次命中即返回，不遍历消息中的其余命中。 */
    has(text: string): boolean {
      if (!pattern) return false
      if (direct) return text.indexOf(needle) >= 0
      pattern.lastIndex = 0
      return pattern.test(text)
    },
    /** @param text 待计数消息。 @returns 不重叠命中总数。 */
    count: countText,
    /** @param header 原发言头。 @param text 原消息正文。 @returns 不含换行的查询不可能跨越两者之间的换行；其余查询完整拼接匹配。 */
    countMessage(header: string, text: string): number {
      return needle.includes('\n') ? countText(header + '\n' + text) : countText(header) + countText(text)
    },
    /** @param text 待摘要消息。 @returns 首次命中附近保留原文的上下文。 */
    excerpt(text: string): string {
      if (pattern) pattern.lastIndex = 0
      const at = direct ? Math.max(0, text.indexOf(needle)) : (pattern?.exec(text)?.index ?? 0)
      const start = Math.max(0, at - 30)
      const end = Math.min(text.length, at + Math.max(query.trim().length, 1) + 60)
      return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
    }
  }
}

/** 仅判断首个命中，不为所有命中构造高亮数组。
 * @param text 原始正文或发言者文本。
 * @param query 字面查询，不区分大小写。
 * @returns 非空查询是否命中。
 */
export function hasMatch(text: string, query: string): boolean {
  return literalPattern(query)?.test(text) ?? false
}

/** 统计不重叠命中，不保留逐项范围对象。
 * @param text 原始正文。
 * @param query 字面查询，不区分大小写。
 * @returns 全部命中数量；空查询为0。
 */
export function countMatches(text: string, query: string): number {
  const pattern = literalPattern(query, true)
  if (!pattern) return 0
  let count = 0
  while (pattern.test(text)) count++
  return count
}

/** 为实际高亮生成全部命中范围。
 * @param text 原始正文。
 * @param query 字面查询，不区分大小写。
 * @returns 原文本UTF-16偏移，保持与正则匹配一致。
 */
export function matchRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const pattern = literalPattern(query, true)
  if (!pattern) return []
  const result: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) result.push({ start: match.index, end: match.index + match[0].length })
  return result
}

/** 只查找首个命中并截取上下文，不扫描后续全部命中。
 * @param text 原始正文。
 * @param query 字面查询，空查询仍显示文本开头。
 * @returns 保持原字符及省略号规则的摘要。
 */
export function searchExcerpt(text: string, query: string): string {
  const at = literalPattern(query)?.exec(text)?.index ?? 0
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
