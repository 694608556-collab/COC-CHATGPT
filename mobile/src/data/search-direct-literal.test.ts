import { expect, it } from 'vitest'
import { compileBodyQuery, countMatches, searchExcerpt } from './search'

it('CJK literal counting preserves every original regex count, excerpt and repeated invocation', () => {
  for (const query of [
    '的',
    '你',
    '。',
    '你好',
    '你你',
    '第123场',
    '【内容】',
    ' 你 ',
    'あ',
    'A',
    'ſ',
    'K',
    'Σ',
    '😀',
    '[.*]'
  ]) {
    const matcher = compileBodyQuery(query)
    for (const text of [
      '你好你你你。的的。\n第123场【内容】',
      '😀\ud800你\udc00你好',
      'aAſsSKkKσςΣあ[.*]',
      'nothing',
      '你'.repeat(30000)
    ]) {
      expect(matcher.count(text)).toBe(countMatches(text, query))
      expect(matcher.has(text)).toBe(countMatches(text, query) > 0)
      expect(matcher.excerpt(text)).toBe(searchExcerpt(text, query))
      expect(matcher.count(text)).toBe(countMatches(text, query))
    }
  }
})
it('every BMP ignore-case canonicalization preserves the direct CJK ranges without foreign aliases', () => {
  const selected = (code: number) =>
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 48 && code <= 57) ||
    code === 32
  for (let code = 0; code <= 0xffff; code++) {
    const char = String.fromCharCode(code),
      upper = char.toUpperCase()
    // ECMAScript non-Unicode RegExp Canonicalize: expansion and mappings
    // from non-ASCII to ASCII retain the original UTF-16 code unit.
    const canonical =
      upper.length !== 1 || (code >= 128 && upper.charCodeAt(0) < 128) ? code : upper.charCodeAt(0)
    if (selected(code) || selected(canonical)) expect(canonical).toBe(code)
  }
})
it('message-part counting exactly preserves literal matches across the original inserted newline', () => {
  for (const query of ['你', '的', 'aa', 'A', '你\n好', '\n', 'a\nB', 'ſ', '😀', ' ']) {
    const matcher = compileBodyQuery(query)
    for (const header of ['你你', 'aA', 'ſ', '第一\n行', '😀', ''])
      for (const body of ['你好', 'aaa', '\n你\n好', 'b\nB', '😀', ''])
        expect(matcher.countMessage(header, body)).toBe(countMatches(header + '\n' + body, query))
  }
})
