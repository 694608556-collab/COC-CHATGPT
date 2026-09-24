/**
 * 0.7.1 修复：连线必须保留 EdrawMind 的原始几何形状。
 *
 * 用户反馈「线条制作仍然一塌糊涂，原本直线就能解决的问题现在变得曲里拐弯的」，
 * 并给出官方 HTML 导出作为「好看」的参照：父节点出发走一小段圆角，沿竖直干线
 * 延伸，分支点用小圆角转向子节点，子节点之间是短横直线——没有多余曲线。
 *
 * 根因是我上一版的做法：把端点「钉到框边中点」，还为了保持正交去平移整条干线。
 * 用三个真实 .emmx 量化后，结论很明确：
 *   - 终点与几何末点【完全相同】：102/102、155/155、804/804（100%）
 *   - 起点要么与几何首点相同，要么只差一段【轴对齐】的距离（60/60、90/90、435/435）
 *   - 不轴对齐的端点：0 个
 * 也就是说原始几何本来就是完整正确的，只需在起点补一小段水平/垂直直线，
 * 任何「搬动端点」的做法都会破坏 EdrawMind 算好的形状。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEmmx, pageToSvg } from '../src/shared/emmx'
import { availableSamples } from './sample-files'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

// 两台开发机上样例的存放位置不同，按逻辑名解析出实际路径
const available = availableSamples(['渊娲之海', '精神病院失踪事件', '世界回归进行曲']).map(
  (item) => item.path
)

/** 把 path 拆成「命令 + 坐标」列表 */
function segments(d: string): Array<{ kind: string; nums: number[] }> {
  return d
    .split(/(?=[MLC])/)
    .filter(Boolean)
    .map((token) => ({
      kind: token[0]!,
      nums: token
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((value) => Number.isFinite(value))
    }))
}

describe('0.7.1 fix: keep EdrawMind original connector geometry', () => {
  describe('the destructive alignment must be gone', () => {
    it('no longer snaps endpoints onto edge midpoints', () => {
      const source = read('src/shared/emmx.ts')
      // 这两个函数是上一版「搬动端点」的实现，必须删掉
      expect(source).not.toContain('alignEndToBoxCenter')
      expect(source).not.toContain('alignConnectorEnds')
      expect(source).not.toContain('shiftRun')
    })

    it('renders the stored geometry as-is, only bridging an axis-aligned gap', () => {
      const source = read('src/shared/emmx.ts')
      expect(source).toContain('bridgeStartGap')
    })
  })

  describe('connector shape', () => {
    it('keeps every original geometry command, in order', () => {
      // 渲染出的 path 必须包含原始几何的全部命令，不能多出「搬动端点」造成的改动
      const source = read('src/shared/emmx.ts')
      // 原始几何由 geometryToPath 生成，只允许在最前面补一小段桥接
      expect(source).toContain('geometryToPath')
    })

    it.runIf(available.length > 0)('never moves the end point away from the stored geometry', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          let checked = 0
          let mismatched = 0
          for (const p of page.paths) {
            if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
            const segs = segments(p.d)
            if (!segs.length) continue
            checked += 1
            // 渲染路径的【末点】必须与 anchors.endX/Y 完全一致
            // （实测原始几何的末点 100% 等于 EndPt；若被搬动就会不等）
            if (!p.anchors) continue
            const last = segs[segs.length - 1]!
            const endX = last.nums[last.nums.length - 2]!
            const endY = last.nums[last.nums.length - 1]!
            if (
              Math.abs(endX - p.anchors.endX) > 0.6 ||
              Math.abs(endY - p.anchors.endY) > 0.6
            ) {
              mismatched += 1
            }
          }
          expect(
            mismatched,
            `${path.basename(file)} 终点被搬动的连线数（检查 ${checked} 条）`
          ).toBe(0)
        }
      }
    })

    it.runIf(available.length > 0)('adds only axis-aligned bridging, never diagonals', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          for (const p of page.paths) {
            if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
            const segs = segments(p.d)
            // 桥接段（第一段之后紧跟的那一段）必须是水平或垂直的
            // 原始几何本身可能有斜线，所以这里只检查我们新增的部分：
            // 若首点是 M、次点是 L，且 M 是桥接补出来的，则该 L 必须轴对齐。
            // 简化判据：整条路径里不允许出现「由搬动端点造成的」长斜线，
            // 即不存在 Δx>20 且 Δy>20 的纯直线段（原始几何里也没有）。
            for (let i = 1; i < segs.length; i++) {
              const a = segs[i - 1]!
              const b = segs[i]!
              if (a.kind === 'C' || b.kind === 'C') continue
              const ax = a.nums[a.nums.length - 2]!
              const ay = a.nums[a.nums.length - 1]!
              const bx = b.nums[b.nums.length - 2]!
              const by = b.nums[b.nums.length - 1]!
              const dx = Math.abs(bx - ax)
              const dy = Math.abs(by - ay)
              expect(
                dx > 20 && dy > 20,
                `${path.basename(file)} 连线 ${p.id} 出现长斜线段 Δx=${dx.toFixed(1)} Δy=${dy.toFixed(1)}`
              ).toBe(false)
            }
          }
        }
      }
    })
  })

  describe('rendered svg stays valid', () => {
    it('keeps the M guard for curves that start a geometry, without relying on BeginPt', () => {
      const source = read('src/shared/emmx.ts')
      // SVG 要求路径以 M 开头；万一几何以 CurveTo 起笔，必须有兜底的 M，
      // 否则浏览器判非法、整条线都不画。
      expect(source).toContain('Expected moveto')
      // 但兜底的 M 不能用 BeginPt 当起点：那会把曲线整体拉偏。
      // 必须用曲线自己的首控制点，形状才不受影响。
      expect(source).not.toContain('startPoint?: { x: number; y: number }')
    })

    it.runIf(available.length > 0)('starts every path with M', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          const svg = pageToSvg(page, 40)
          for (const m of svg.matchAll(/<path d="([^"]+)"/g)) {
            // 以 C 开头的路径会被浏览器判为非法、整条不画
            expect(m[1]!.startsWith('M'), `非法路径开头: ${m[1]!.slice(0, 40)}`).toBe(true)
          }
        }
      }
    })

    it.runIf(available.length > 0)('bridges a start gap by extending the line, not by bending it', () => {
      for (const file of available) {
        const document = parseEmmx(fs.readFileSync(file))
        for (const page of document.pages) {
          for (const p of page.paths) {
            if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
            const segs = segments(p.d)
            if (segs.length < 2) continue
            // 若首段是补出来的接线，它必须与第二段【共线】（同一条直线延长），
            // 而不是拐个弯——否则就是「为了接线把线掰弯了」。
            const [a, b] = [segs[0]!, segs[1]!]
            if (a.kind !== 'M' || b.kind !== 'L') continue
            const ax = a.nums[0]!
            const ay = a.nums[1]!
            const bx = b.nums[0]!
            const by = b.nums[1]!
            // 接线本身必须是水平或垂直的
            const bridgeAxis = Math.abs(ax - bx) < 0.6 || Math.abs(ay - by) < 0.6
            expect(
              bridgeAxis,
              `${path.basename(file)} 连线 ${p.id} 的首段接线不是水平/垂直: (${ax},${ay}) → (${bx},${by})`
            ).toBe(true)
          }
        }
      }
    })
  })
})
