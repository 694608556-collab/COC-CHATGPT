import { expect, it } from 'vitest'
import { hasMatch, countMatches, matchRanges, searchExcerpt } from './search'

it('命中判断与计数保持字面、大小写、空白及UTF-16偏移语义', () => {
  const texts = ['灯塔旁还有灯塔', 'İIıiſSKKk', '😀A😀a', 'a+b [线索] .* $ \\ <script>', 'aaa', '  ', '']
  const queries = [
    ' 灯塔 ',
    'i',
    's',
    'k',
    '😀',
    'a',
    'aa',
    'a+B',
    '[线索]',
    '.*',
    '$',
    '\\',
    '<script>',
    ' ',
    ''
  ]
  for (const text of texts)
    for (const query of queries) {
      const ranges = matchRanges(text, query)
      expect(hasMatch(text, query)).toBe(ranges.length > 0)
      expect(countMatches(text, query)).toBe(ranges.length)
      const at = ranges[0]?.start ?? 0
      const start = Math.max(0, at - 30)
      const end = Math.min(text.length, at + Math.max(query.trim().length, 1) + 60)
      expect(searchExcerpt(text, query)).toBe(
        (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
      )
    }
})

it('高频长正文计数完整，摘要仅返回首处上下文', () => {
  const text = 'A'.repeat(200000) + '中文😀'
  expect(hasMatch(text, 'a')).toBe(true)
  expect(countMatches(text, 'a')).toBe(200000)
  expect(searchExcerpt(text, 'a')).toBe('A'.repeat(61) + '…')
  expect(hasMatch(text, '没有')).toBe(false)
})
