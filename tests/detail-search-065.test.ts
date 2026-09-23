import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { countMatches, splitByMatches } from '../src/shared/record-search'

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

  it('renders highlights and a current-hit marker instead of only a count', () => {
    expect(app).toContain('splitByMatches')
    expect(app).toContain('countMatches')
    expect(app).toContain('match-active')
    expect(app).toContain('<mark')
  })

  it('offers previous and next buttons plus keyboard stepping', () => {
    expect(app).toContain('aria-label="上一处"')
    expect(app).toContain('aria-label="下一处"')
    expect(app).toContain("event.key === 'Enter'")
    // Shift+回车往回跳
    expect(app).toContain('event.shiftKey ? -1 : 1')
  })

  it('scrolls the current hit into view', () => {
    expect(app).toContain('scrollIntoView')
    expect(app).toContain('previewRef')
  })

  it('keeps every hit highlighted and makes the current one stand out', () => {
    const rule = styles.slice(styles.indexOf('.log-preview mark {'))
    expect(rule).toContain('background')
    expect(styles).toContain('.log-preview mark.match-active')
  })

  it('gives the search box the full dialog width', () => {
    // 输入框独占一行铺满；命中数与上/下一处按钮挪到下面一行，不再挤占输入框
    const inputRule = styles.slice(
      styles.indexOf('.detail-search input {'),
      styles.indexOf('.detail-search span {')
    )
    expect(inputRule).toContain('width: 100%')
    expect(inputRule).not.toContain('flex: 1')
    const searchRule = styles.slice(
      styles.indexOf('.detail-search {'),
      styles.indexOf('.detail-search input {')
    )
    expect(searchRule).toContain('flex-direction: column')
    expect(app).toContain('className="detail-search-tools"')
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
