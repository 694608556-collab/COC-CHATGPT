import { expect, it } from 'vitest'
import { compileBodyQuery, countMatches, hasMatch, searchExcerpt } from './search'

it.each(['a+b😀', 'Aa', 'aa', ' ', '[x]', '中文'])(
  '复用查询 %s 保持字面匹配、大小写、非重叠及摘要语义',
  (query) => {
    const matcher = compileBodyQuery(query)
    for (const text of ['a+b😀 a+b😀', 'AAaaaAa', 'none', '[x] 中文中文', 'a+b😀']) {
      expect(matcher.count(text)).toBe(countMatches(text, query))
      expect(matcher.has(text)).toBe(hasMatch(text, query))
      expect(matcher.excerpt(text)).toBe(searchExcerpt(text, query))
      expect(matcher.count(text)).toBe(countMatches(text, query))
    }
  }
)
