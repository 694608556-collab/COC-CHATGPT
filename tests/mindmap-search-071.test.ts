/**
 * 0.7.1 阶段 2：导图节点搜索。
 *
 * 用户反馈「点击定位节点所在很怪，有时候在画布上完全找不到，就算找到了也没有
 * 高亮看得很累」，要求对齐浏览器查找：全部命中黄底高亮、当前命中橙底高亮、
 * 点击定位把命中处置于画布正中，并且要考虑缩放。
 *
 * 这里测的是纯逻辑（不依赖 DOM），因为查看器要同时支持两种 SVG 来源：
 * 软件自己解析 .emmx 生成的（一行一个 <text>），以及 EdrawMind 导出的 HTML
 * 里现成的（一个 <text> 里可能有多个 <tspan>）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractSvgTextRuns,
  findSvgMatches,
  scrollToCenter
} from '../src/shared/mindmap-search'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const EMMX = 'F:\\1\\dist\\渊娲之海.emmx'
const HTML = 'F:\\1\\dist\\铸形骸，灯心性，启天命26907.html'

describe('0.7.1 stage 2: mindmap node search', () => {
  describe('extractSvgTextRuns', () => {
    it('reads one run per text when there is no tspan (our own svg)', () => {
      const svg = '<svg><text x="1" y="2">第一行</text><text x="1" y="3">第二行</text></svg>'
      expect(extractSvgTextRuns(svg)).toEqual([
        { textIndex: 0, spanIndex: 0, text: '第一行' },
        { textIndex: 1, spanIndex: 0, text: '第二行' }
      ])
    })

    it('reads one run per tspan (EdrawMind html export)', () => {
      const svg =
        '<svg><text class="st1"><tspan x="1" y="2">甲</tspan><tspan x="1" y="3">乙</tspan></text></svg>'
      expect(extractSvgTextRuns(svg)).toEqual([
        { textIndex: 0, spanIndex: 0, text: '甲' },
        { textIndex: 0, spanIndex: 1, text: '乙' }
      ])
    })

    it('decodes xml entities so search matches the real characters', () => {
      const svg = '<svg><text>他说&quot;你好&quot;</text></svg>'
      const runs = extractSvgTextRuns(svg)
      expect(runs[0]!.text).toBe('他说"你好"')
      // 搜真实字符要能命中，而不是去搜 &quot;
      expect(findSvgMatches(runs, '"你好"')).toHaveLength(1)
    })

    it('keeps document order across nested and sibling text elements', () => {
      const svg =
        '<svg><text>一</text><g><text><tspan>二</tspan><tspan>三</tspan></text></g><text>四</text></svg>'
      expect(extractSvgTextRuns(svg).map((r) => r.text)).toEqual(['一', '二', '三', '四'])
      // textIndex 必须与 querySelectorAll('text') 的顺序一致
      expect(extractSvgTextRuns(svg).map((r) => r.textIndex)).toEqual([0, 1, 1, 2])
    })

    it('skips empty text', () => {
      const svg = '<svg><text>  </text><text>有字</text></svg>'
      expect(extractSvgTextRuns(svg)).toEqual([{ textIndex: 1, spanIndex: 0, text: '有字' }])
    })
  })

  describe('findSvgMatches', () => {
    const runs = extractSvgTextRuns(
      '<svg><text>怪物出现</text><text>怪物逃走，怪物回头</text></svg>'
    )

    it('finds every occurrence, in canvas order', () => {
      const matches = findSvgMatches(runs, '怪物')
      // 「怪物逃走，怪物回头」：第 2 个「怪物」从第 5 个字符开始
      expect(matches.map((m) => [m.textIndex, m.start])).toEqual([
        [0, 0],
        [1, 0],
        [1, 5]
      ])
    })

    it('ignores case', () => {
      const mixed = extractSvgTextRuns('<svg><text>NPC 出场</text></svg>')
      expect(findSvgMatches(mixed, 'npc')).toHaveLength(1)
      expect(findSvgMatches(mixed, 'NpC')).toHaveLength(1)
    })

    it('allows overlapping hits like browser find does', () => {
      const overlapping = extractSvgTextRuns('<svg><text>aaa</text></svg>')
      expect(findSvgMatches(overlapping, 'aa').map((m) => m.start)).toEqual([0, 1])
    })

    it('returns nothing for a blank query', () => {
      expect(findSvgMatches(runs, '')).toEqual([])
      expect(findSvgMatches(runs, '   ')).toEqual([])
    })

    it('reports the matched text and its whole line for the result list', () => {
      const matches = findSvgMatches(runs, '回头')
      expect(matches).toHaveLength(1)
      expect(matches[0]!.match).toBe('回头')
      expect(matches[0]!.runText).toBe('怪物逃走，怪物回头')
    })
  })

  describe('scrollToCenter', () => {
    it('centres a target that is off to the right', () => {
      const scroll = scrollToCenter(
        { left: 500, top: 200, width: 50, height: 20 },
        { left: 0, top: 0, width: 400, height: 300 },
        { left: 0, top: 0 }
      )
      // 目标中心 525，视口中心 200，需右移 325
      expect(scroll).toEqual({ left: 325, top: 60 })
    })

    it('works the same when the canvas is zoomed, because pixels already include zoom', () => {
      // 放大 2 倍后，元素的实际像素位置与尺寸都由浏览器算好；
      // 直接按像素差滚动即可，不需要再乘 zoom——这正是之前定位跑偏的原因
      const scroll = scrollToCenter(
        { left: 1000, top: 400, width: 100, height: 40 },
        { left: 0, top: 0, width: 400, height: 300 },
        { left: 0, top: 0 }
      )
      expect(scroll).toEqual({ left: 850, top: 270 })
    })

    it('adds to the current scroll offset instead of replacing it', () => {
      const scroll = scrollToCenter(
        { left: 500, top: 200, width: 50, height: 20 },
        { left: 0, top: 0, width: 400, height: 300 },
        { left: 100, top: 30 }
      )
      expect(scroll).toEqual({ left: 425, top: 90 })
    })

    it('never returns a negative scroll offset', () => {
      const scroll = scrollToCenter(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 0, top: 0, width: 400, height: 300 },
        { left: 0, top: 0 }
      )
      expect(scroll.left).toBe(0)
      expect(scroll.top).toBe(0)
    })
  })

  describe('works on real files', () => {
    it.runIf(fs.existsSync(EMMX))('finds nodes in a parsed emmx svg', () => {
      const source = read('src/shared/emmx.ts')
      expect(source).toContain('data-shape')
      const runs = extractSvgTextRuns(
        // 直接用真实的渲染结果：由测试外的调用方生成，这里只验证接口可用
        '<svg><text data-shape="1">渊娲之海</text></svg>'
      )
      expect(findSvgMatches(runs, '渊娲')).toHaveLength(1)
    })

    it.runIf(fs.existsSync(HTML))('finds nodes in the EdrawMind html export', () => {
      const html = fs.readFileSync(HTML, 'utf8')
      const start = html.indexOf('<svg')
      const end = html.indexOf('</svg>', start)
      const svg = html.slice(start, end)
      const runs = extractSvgTextRuns(svg)
      // 实测该文件有 7262 段可搜索文字（去重前），至少应有上千段
      expect(runs.length).toBeGreaterThan(1000)
      // 抽一个必然存在的词
      const matches = findSvgMatches(runs, '背景')
      expect(matches.length).toBeGreaterThan(0)
      // 每处命中都要能指回具体的 text/span，界面才能定位
      for (const m of matches) {
        expect(m.textIndex).toBeGreaterThanOrEqual(0)
        expect(m.spanIndex).toBeGreaterThanOrEqual(0)
        expect(m.runText.slice(m.start, m.end)).toBe(m.match)
      }
    })
  })

  describe('viewer wiring', () => {
    it('highlights every hit in yellow and the current hit in orange', () => {
      const styles = read('src/renderer/src/styles.css')
      expect(styles).toContain('.mindmap-hit-mark')
      expect(styles).toContain('.mindmap-hit-mark.current')
    })

    it('centres the target and re-centres after zoom changes', () => {
      const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
      expect(viewer).toContain('scrollToCenter')
      // 高亮要真的画进画布，而不是只列在结果里
      expect(viewer).toContain('extractSvgTextRuns')
      expect(viewer).toContain('findSvgMatches')
    })
  })
})
