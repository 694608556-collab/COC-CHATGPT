import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  countMatches,
  searchModuleRecords,
  searchRecordMessages,
  splitByMatches
} from '../src/shared/record-search'
import { DEFAULT_FILTER_PRESET, type SessionRecord } from '../src/shared/types'

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

describe('0.6.5 jumping from module search into the right message', () => {
  const styles = read('src/renderer/src/styles.css')
  const app = read('src/renderer/src/App.tsx')

  function logRecord(texts: Array<{ header: string; text: string }>): SessionRecord {
    return {
      id: 'r1',
      moduleId: 'm1',
      name: '第 1 场',
      sequenceNo: 1,
      sourceType: 'online',
      status: 'valid',
      dateSource: 'none',
      order: 0,
      createdAt: '',
      updatedAt: '',
      rawContent: {
        parserVersion: 1,
        messages: texts.map((t, i) => ({
          id: `m${i}`,
          order: i,
          displayName: t.header,
          header: t.header,
          text: t.text,
          type: 'text' as const,
          isDiceCommand: false,
          isOffTopic: false,
          images: []
        }))
      }
    } as SessionRecord
  }

  it('reports which message the first hit falls in', () => {
    const record = logRecord([
      { header: '12:32 浮士德', text: '记录已经开始了。' },
      { header: '12:37 kp', text: '你们吃早餐然后出发。' },
      { header: '12:40 陆桉阳', text: '早餐不错。' }
    ])
    const [hit] = searchModuleRecords([record], '早餐', DEFAULT_FILTER_PRESET)
    // 首次命中在第 2 条消息（下标 1），不是第 0 条
    expect(hit?.messageIndex).toBe(1)
  })

  it('picks the last message when the hit is at the very end', () => {
    const record = logRecord([
      { header: 'a', text: '无关内容' },
      { header: 'b', text: '无关内容' },
      { header: 'c', text: '结尾出现暗号' }
    ])
    const [hit] = searchModuleRecords([record], '暗号', DEFAULT_FILTER_PRESET)
    expect(hit?.messageIndex).toBe(2)
  })

  it('treats manual content as a single message', () => {
    const record = { ...logRecord([]), manualContent: '手写的走廊描述' } as SessionRecord
    const [hit] = searchModuleRecords([record], '走廊', DEFAULT_FILTER_PRESET)
    expect(hit?.messageIndex).toBe(0)
  })

  it('maps every message correctly, not just the first', () => {
    // 逐条验证偏移换算：每条消息都单独搜一次，命中的下标必须与它自己的位置一致
    const texts = [
      { header: '12:00 a', text: '第一条 标记' },
      { header: '12:10 b', text: '第二条 标记' },
      { header: '12:20 c', text: '第三条 标记' },
      { header: '12:30 d', text: '第四条 标记' }
    ]
    for (let index = 0; index < texts.length; index += 1) {
      // 只让第 index 条含关键词，其余用不同词，确保命中的就是这一条
      const record = logRecord(
        texts.map((t, i) => ({ header: t.header, text: i === index ? `第${i}条 目标词` : `第${i}条 别的` }))
      )
      const [hit] = searchModuleRecords([record], '目标词', DEFAULT_FILTER_PRESET)
      expect(hit?.messageIndex).toBe(index)
    }
  })

  it('passes the index through to the detail dialog and marks that message', () => {
    expect(app).toContain('setDetailMessageIndex(hit.messageIndex)')
    expect(app).toContain('initialMessageIndex')
    expect(app).toContain("className={messageIndex === activeMessage ? 'message-active' : undefined}")
  })

  it('draws a marker on the located message', () => {
    const rule = styles.slice(styles.indexOf('.log-preview article.message-active {'))
    expect(rule).toContain('border-left: 3px solid var(--accent)')
    expect(rule).toContain('background: var(--accent-soft)')
  })

  it('does not clear the incoming keyword on first render', () => {
    // 从模组搜索带词进来时不能被“换词就重置”的逻辑立刻清掉
    expect(app).toContain('firstRun')
  })
})
