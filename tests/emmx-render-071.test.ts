/**
 * 0.7.1 阶段 1：导图渲染修复。
 *
 * 三条实测结论（用真实 .emmx 量化得出，见注释里的数字）：
 *
 * 1. 连线起点有 13.5px 空隙。EdrawMind 的起点从「节点框的视觉边缘」出发，
 *    而节点框本身带一圈固定留白：实测 57/210 个端点间隙恰为 13.5px，
 *    其余 151 个为 0。终点没有这个问题（Geometry 尾点 100% 等于 EndPt）。
 *
 * 2. 行距过大导致文字溢出。当前用 1.25×，实测「感受到一种病态的美学崇拜」
 *    5 行 × 12.5 = 62.5px，而框高只有 55.3px，溢出 7.2px 压到下方节点。
 *    按 1.0/1.05/1.10 倍行距均零溢出，1.15 倍起开始溢出——故取 1.1。
 *
 * 3. 文字并未偏离节点框：实测文字框中心与节点框中心相差 0.0px。
 *    截图里「偏右」是长行按 text-anchor=middle 居中后两侧同时溢出造成的错觉，
 *    根治办法是折行时留出安全边距，保证任何一行都不超出可用宽度。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

/** 真实样例（家里电脑齐全，公司电脑只有一部分，缺失即跳过） */
const SAMPLES = [
  'F:\\1\\dist\\渊娲之海.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-07\\精神病院失踪事件.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-11\\世界回归进行曲.emmx'
]
const available = SAMPLES.filter((file) => fs.existsSync(file))

function measure(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.55
  }
  return width
}

/** 把 SVG 里的 XML 实体还原成真实字符，否则 `&quot;` 会被当成 6 个字符来量宽 */
function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 从渲染出的 SVG 里取出全部 text 行（内容已还原实体） */
function svgTextLines(svg: string): Array<{
  x: number
  y: number
  fontSize: number
  content: string
  anchor: string
  shapeId?: string
}> {
  return [
    ...svg.matchAll(
      /<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="([\d.]+)"[^>]*text-anchor="([^"]*)"(?:[^>]*data-shape="([^"]*)")?[^>]*>([^<]*)<\/text>/g
    )
  ].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    fontSize: Number(m[3]),
    anchor: m[4]!,
    ...(m[5] === undefined ? {} : { shapeId: m[5] }),
    content: unescapeXml(m[6]!)
  }))
}

/** 取某个节点渲染出的全部文字行（靠 data-shape 归属，不靠坐标猜） */
function linesOfShape(
  lines: ReturnType<typeof svgTextLines>,
  shapeId: string
): ReturnType<typeof svgTextLines> {
  return lines.filter((line) => line.shapeId === shapeId)
}

describe('0.7.1 stage 1: emmx rendering', () => {
  describe('connector gap', () => {
    it('uses BeginPt/EndPt as the authoritative connector endpoints', () => {
      const source = read('src/shared/emmx.ts')
      // BeginPt/EndPt 是 EdrawMind 存的连线锚点，比 Geometry 首尾点更接近真实
      // 连接位置；两者都可能偏离框边，最终统一校正到框边
      expect(source).toContain('alignConnectorEnds')
      expect(source).toContain("'BeginPt'")
      expect(source).toContain("'EndPt'")
      expect(source).toContain('extendEndToBoxBoundary')
    })

    it.runIf(available.length > 0)('leaves no connector endpoint floating a small gap from a node', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          const boxes = page.shapes.map((s) => ({ x: s.x, y: s.y, w: s.width, h: s.height }))
          const gapTo = (x: number, y: number): number => {
            let best = Infinity
            for (const b of boxes) {
              const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - (b.x + b.w) : 0
              const dy = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0
              best = Math.min(best, Math.hypot(dx, dy))
            }
            return best
          }
          /**
           * 只统计「差一小段就接上」的端点——那才是观感问题（线头浮在框外）。
           *
           * 实测 EdrawMind 的折线有时故意从空白处起笔（例如一条主干线带多个分支，
           * 起点离任何框 34~358px），那是正常画法，不是缺陷。所以判据是「间隙在
           * 可校正范围内却仍未被校正」，而不是「必须贴边」。
           */
          const snapRange = Number(
            /CONNECTOR_SNAP_RANGE = ([\d.]+)/.exec(read('src/shared/emmx.ts'))?.[1] ?? '32'
          )
          let floating = 0
          for (const p of page.paths) {
            if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
            const tokens = p.d.split(/(?=[MLC])/).filter(Boolean)
            for (const token of [tokens[0], tokens[tokens.length - 1]]) {
              if (!token) continue
              const nums = token.slice(1).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
              if (nums.length < 2) continue
              const x = nums[nums.length - 2]!
              const y = nums[nums.length - 1]!
              const gap = gapTo(x, y)
              // 落在可校正范围内却没贴上 → 说明校正漏了
              if (gap > 1.5 && gap <= snapRange) floating += 1
            }
          }
          expect(floating, `${path.basename(file)} ${page.name} 未校正的小间隙端点数`).toBe(0)
        }
      }
    })
  })

  describe('line height', () => {
    it('uses a line height that keeps wrapped text inside its box', () => {
      const source = read('src/shared/emmx.ts')
      // 1.25 会溢出（实测 7.2px），必须收紧
      expect(source).toContain('LINE_HEIGHT_RATIO = 1.1')
      // 行距必须真的用常量计算，而不是散落的字面量
      expect(source).toContain('fontSize * LINE_HEIGHT_RATIO')
    })

    it.runIf(available.length > 0)('never renders text taller than the node box', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        const ratio = Number(/LINE_HEIGHT_RATIO = ([\d.]+)/.exec(read('src/shared/emmx.ts'))?.[1] ?? '1.1')
        for (const page of document.pages) {
          const lines = svgTextLines(pageToSvg(page, 40))
          for (const shape of page.shapes) {
            if (!shape.lines.length) continue
            const own = linesOfShape(lines, shape.id)
            if (!own.length) continue
            // 以【节点框】为界，而不是文字框：实测 EdrawMind 常按单行给文字框高度
            // （「阅读相关档案会梦到」2 段需 22px，文字框只有 18.4px，节点框 23.9px
            // 才装得下）。节点框是画面上真正的边界，超出它才会压到别的节点。
            const height = own.length * shape.fontSize * ratio
            expect(
              height,
              `${path.basename(file)} 「${shape.lines[0]!.slice(0, 14)}」 ${own.length}行 高${height.toFixed(1)} > 节点框高${shape.height.toFixed(1)}`
            ).toBeLessThanOrEqual(shape.height + 1)
          }
        }
      }
    })
  })

  describe('text stays inside its box', () => {
    it('attributes each rendered line to its node so search can highlight it', () => {
      const source = read('src/shared/emmx.ts')
      expect(source).toContain('data-shape=')
    })

    it.runIf(available.length > 0)('renders no line wider than its available width', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          const lines = svgTextLines(pageToSvg(page, 40))
          for (const shape of page.shapes) {
            if (!shape.textBox || !shape.lines.length) continue
            const area = shape.textBox
            for (const line of linesOfShape(lines, shape.id)) {
              const width = measure(line.content, line.fontSize)
              expect(
                width,
                `${path.basename(file)} 行宽${width.toFixed(1)} > 可用${area.width.toFixed(1)} 「${line.content.slice(0, 18)}」`
              ).toBeLessThanOrEqual(area.width + 0.5)
            }
          }
        }
      }
    })
  })

  describe('regression guard', () => {
    it('keeps the existing parser contract', () => {
      const source = read('src/shared/emmx.ts')
      // 这些是 0.7.0 已修好的点，不能被本次改动破坏
      expect(source).toContain('export function parseEmmx')
      expect(source).toContain('export function pageToSvg')
      expect(source).toContain('export function emmxOutline')
      expect(source).toContain('export function outlineToMarkdown')
      // 关系连线标签仍要叠加锚点
      expect(source).toContain('readLabel(body, cx, cy, false, id)')
      // 分组框/概括/标注仍要画
      expect(source).toContain("type === 'Boundary' || type === 'Summary' || type === 'Callout'")
    })
  })
})
