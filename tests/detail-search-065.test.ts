import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { countMatches, searchRecordMessages, splitByMatches } from '../src/shared/record-search'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.5 text splitting for search highlighting', () => {
  it('splits a sentence into matched and unmatched runs', () => {
    const segments = splitByMatches('早餐吃了早餐', '早餐')
    expect(segments).toEqual([
      { text: '早餐', match: true, index: 0 },
      { text: '吃了', match: false, index: -1 },
      { text: '早餐', match: true, index: 1 }
    ])
  })

  it('numbers every hit so the UI can jump to the Nth one', () => {
    const segments = splitByMatches('a a a', 'a')
    const hits = segments.filter((segment) => segment.match)
    expect(hits.map((hit) => hit.index)).toEqual([0, 1, 2])
  })

  it('agrees with the match count shown next to the search box', () => {
    const text = '陆桉阳说他早餐吃了早餐，然后早餐就凉了。'
    const segments = splitByMatches(text, '早餐')
    expect(countMatches(text, '早餐')).toBe(3)
    expect(segments.filter((segment) => segment.match)).toHaveLength(3)
  })

  it('matches case-insensitively without altering the original characters', () => {
    const segments = splitByMatches('KP said Keep it', 'kp')
    expect(segments.filter((segment) => segment.match).map((s) => s.text)).toEqual(['KP'])
    // 拼回去必须与原文完全一致，高亮不能改动内容
    expect(segments.map((segment) => segment.text).join('')).toBe('KP said Keep it')
  })

  it('returns the text untouched when there is no query or no hit', () => {
    expect(splitByMatches('正文', '')).toEqual([{ text: '正文', match: false, index: -1 }])
    expect(splitByMatches('正文', '   ')).toEqual([{ text: '正文', match: false, index: -1 }])
    expect(splitByMatches('正文', '找不到')).toEqual([{ text: '正文', match: false, index: -1 }])
    expect(countMatches('正文', '')).toBe(0)
  })

  it('keeps every character when matches sit at both ends', () => {
    const segments = splitByMatches('早餐中间早餐', '早餐')
    expect(segments.map((segment) => segment.text).join('')).toBe('早餐中间早餐')
    expect(segments[0]).toEqual({ text: '早餐', match: true, index: 0 })
    expect(segments.at(-1)).toEqual({ text: '早餐', match: true, index: 1 })
  })
})

describe('0.6.5 record detail search is wired to the highlighter', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('renders highlights and a result list instead of only a count', () => {
    expect(app).toContain('splitByMatches')
    expect(app).toContain('countMatches')
    expect(app).toContain('searchRecordMessages')
    expect(app).toContain('<mark')
    expect(app).toContain('detail-search-hit')
  })

  it('lists one entry per matching message with an excerpt and a header', () => {
    // 与模组正文搜索一致：每条结果给出小标题 + 关键词前后摘要
    expect(app).toContain('detail-search-hit-head')
    expect(app).toContain('detail-search-hit-excerpt')
    expect(app).toContain('excerptStart')
    expect(app).toContain('excerptLength')
  })

  it('jumps to the matching message when a result is clicked', () => {
    expect(app).toContain('setActiveMessage(hit.messageIndex)')
    expect(app).toContain('data-message-index')
    expect(app).toContain('scrollIntoView')
    expect(app).toContain('previewRef')
  })

  it('carries the module-search keyword into the detail dialog', () => {
    expect(app).toContain('setDetailQuery')
    expect(app).toContain('initialQuery')
  })

  it('has no previous/next buttons any more', () => {
    // 0.6.5 初版加了上下按钮，实际很丑也不好用，改为结果列表
    expect(app).not.toContain('aria-label="上一处"')
    expect(app).not.toContain('aria-label="下一处"')
    expect(app).not.toContain('detail-search-tools')
    expect(app).not.toContain('match-active')
  })

  it('keeps the search box on one line again', () => {
    const inputRule = styles.slice(
      styles.indexOf('.detail-search input {'),
      styles.indexOf('.detail-search span {')
    )
    expect(inputRule).toContain('flex: 1')
    expect(inputRule).not.toContain('width: 100%')
    // 命中数回到输入框右侧
    const countRule = styles.slice(
      styles.indexOf('.detail-search span {'),
      styles.indexOf('.detail-search-results {')
    )
    expect(countRule).toContain('flex: none')
    expect(countRule).toContain('width: 45px')
    expect(styles).not.toContain('.detail-search-tools')
  })

  it('uses the same highlight style as the module search results', () => {
    // 两处 mark 共用同一条规则，保证观感一致
    expect(styles).toContain('.log-preview mark,')
    expect(styles).toContain('.detail-search-hit-excerpt mark {')
    expect(styles).not.toContain('.match-active')
    const moduleMark = styles.slice(styles.indexOf('.module-search-excerpt mark {'))
    expect(moduleMark).toContain('color-mix(in srgb, var(--warning) 35%, transparent)')
  })

  it('lets the result list scroll with the mouse wheel', () => {
    const rule = styles.slice(
      styles.indexOf('.detail-search-results {'),
      styles.indexOf('.detail-search-results-head {')
    )
    expect(rule).toContain('max-height')
    expect(rule).toContain('overflow-y: auto')
  })

  it('drops the horizontal scrollbar from the log preview', () => {
    // 此前 overflow:auto + pre-wrap，超长不换行的内容会撑出横向滚动条，
    // 把左侧文字顶出可视区（截图里那些被切掉一半的字符）。
    const rule = styles.slice(styles.indexOf('.log-preview {'), styles.indexOf('.log-preview article {'))
    expect(rule).toContain('overflow-x: hidden')
    expect(rule).toContain('overflow-y: auto')
    expect(rule).not.toContain('overflow: auto')
    // 长串必须能断行，否则内容仍会被裁掉看不全
    expect(rule).toContain('overflow-wrap: anywhere')
    expect(rule).toContain('word-break: break-word')
  })
})

describe('0.6.5 per-message search results', () => {
  const messages = [
    { header: '12:32 浮士德', text: '记录已经开始了。' },
    { header: '12:37 kp', text: '你们在食堂吃早餐，然后出发。' },
    { header: '12:40 陆桉阳', text: '早餐不错。' },
    { header: '12:45 kp', text: '早餐后继续调查。' }
  ]

  it('returns one entry per matching message', () => {
    const results = searchRecordMessages(messages, '早餐')
    expect(results.map((r) => r.messageIndex)).toEqual([1, 2, 3])
    expect(results[0]?.header).toBe('12:37 kp')
  })

  it('keeps the excerpt around the keyword with its position', () => {
    const [first] = searchRecordMessages(messages, '早餐')
    expect(first?.excerpt).toContain('早餐')
    expect(first?.excerptLength).toBe(2)
    expect(first?.excerpt.slice(first.excerptStart, first.excerptStart + first.excerptLength)).toBe('早餐')
  })

  it('returns nothing for an empty or missing keyword', () => {
    expect(searchRecordMessages(messages, '')).toEqual([])
    expect(searchRecordMessages(messages, '   ')).toEqual([])
    expect(searchRecordMessages(messages, '找不到的词')).toEqual([])
  })

  it('does not split a message that contains the keyword several times', () => {
    // 一条消息里出现多次也只给一条结果，避免列表里刷出一堆重复项
    const results = searchRecordMessages([{ header: 'x', text: '早餐早餐早餐' }], '早餐')
    expect(results).toHaveLength(1)
  })

  it('matches case-insensitively', () => {
    const results = searchRecordMessages([{ header: 'KP', text: 'Keep going' }], 'kp')
    expect(results).toHaveLength(1)
    expect(results[0]?.excerpt).toContain('KP')
  })
})
