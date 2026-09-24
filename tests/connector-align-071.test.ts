/**
 * 0.7.1 修复：连线形状必须与 EdrawMind 的原始几何一致。
 *
 * 用户反馈「线条制作仍然一塌糊涂，原本直线就能解决的问题现在变得曲里拐弯的」，
 * 并给出官方 HTML 导出作为「好看」的参照。
 *
 * 本文件取代了此前 connector-align-071.test.ts 的旧断言。旧断言要求把端点
 * 「钉到框边中点」，那正是把直线拉成斜线与鼓包的原因，现已废弃。
 *
 * 现在的契约（由三个真实 .emmx 量化得出）：
 * - 终点与几何末点 100% 相同（102/102、155/155、804/804），绝不搬动
 * - 起点只差一段【轴对齐】的距离（0 个例外），补一条水平/垂直短线即可
 * - 不引入任何长斜线段
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEmmx } from '../src/shared/emmx'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const SAMPLES = [
  'F:\\1\\dist\\渊娲之海.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-07\\精神病院失踪事件.emmx',
  'E:\\微信文件\\xwechat_files\\wxid_b70gzcimuk4h22_f95c\\msg\\file\\2025-11\\世界回归进行曲.emmx'
]
const available = SAMPLES.filter((file) => fs.existsSync(file))

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

describe('0.7.1 fix: connectors keep the original geometry', () => {
  it('bridges the start gap instead of moving the endpoint', () => {
    const source = read('src/shared/emmx.ts')
    expect(source).toContain('bridgeStartGap')
    // 旧的「钉到框边中点 / 平移干线」实现必须彻底消失
    expect(source).not.toContain('alignEndToBoxCenter')
    expect(source).not.toContain('alignConnectorEnds')
    expect(source).not.toContain('shiftRun')
    expect(source).not.toContain('CONNECTOR_SNAP_RANGE')
  })

  it.runIf(available.length > 0)('never moves the end point away from the stored geometry', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        let mismatched = 0
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          if (!p.anchors) continue
          const segs = segments(p.d)
          if (!segs.length) continue
          const last = segs[segs.length - 1]!
          const endX = last.nums[last.nums.length - 2]!
          const endY = last.nums[last.nums.length - 1]!
          if (Math.abs(endX - p.anchors.endX) > 0.6 || Math.abs(endY - p.anchors.endY) > 0.6) {
            mismatched += 1
          }
        }
        expect(mismatched, `${path.basename(file)} 终点被搬动的连线数`).toBe(0)
      }
    }
  })

  it.runIf(available.length > 0)('keeps connectors an orthogonal polyline with small corner curves', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        let total = 0
        let longDiagonal = 0
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          total += 1
          const segs = segments(p.d)
          for (let i = 1; i < segs.length; i++) {
            const a = segs[i - 1]!
            const b = segs[i]!
            // 曲线段是 EdrawMind 画的小圆角，不算斜线
            if (a.kind === 'C' || b.kind === 'C') continue
            const ax = a.nums[a.nums.length - 2]!
            const ay = a.nums[a.nums.length - 1]!
            const bx = b.nums[b.nums.length - 2]!
            const by = b.nums[b.nums.length - 1]!
            // 长斜线是「端点被搬动」的典型症状；原始几何里没有
            if (Math.abs(bx - ax) > 20 && Math.abs(by - ay) > 20) longDiagonal += 1
          }
        }
        if (!total) continue
        expect(
          longDiagonal,
          `${path.basename(file)} 出现长斜线段（共 ${total} 条连线）`
        ).toBe(0)
      }
    }
  })

  it.runIf(available.length > 0)('keeps the bridging segment axis-aligned and collinear', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          const segs = segments(p.d)
          if (segs.length < 2) continue
          const a = segs[0]!
          const b = segs[1]!
          if (a.kind !== 'M' || b.kind !== 'L') continue
          const ax = a.nums[0]!
          const ay = a.nums[1]!
          const bx = b.nums[0]!
          const by = b.nums[1]!
          // 补出来的接线必须是水平或垂直的，不能是斜的
          expect(
            Math.abs(ax - bx) < 0.6 || Math.abs(ay - by) < 0.6,
            `${path.basename(file)} 连线 ${p.id} 首段接线非轴对齐`
          ).toBe(true)
        }
      }
    }
  })

  it.runIf(available.length > 0)('leaves no anchor-versus-geometry gap unbridged', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        let unbridged = 0
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          if (!p.anchors) continue
          const segs = segments(p.d)
          if (!segs.length) continue
          /**
           * 判据是「锚点与几何端点之间有没有缺口」，而不是「端点离框有多远」。
           *
           * 实测世界回归进行曲里有 19 个端点离最近的框 5~27px，但它们的锚点与
           * 几何起点【完全相同】（差 0.0）——那是 EdrawMind 自己的画法：一条母线
           * 从框外侧一段距离起笔，再由同组的支线接上。把这种当成「悬空」去搬动
           * 端点，正是上一版把线条弄弯的原因。
           */
          const first = segs[0]!
          const last = segs[segs.length - 1]!
          const startX = first.nums[first.nums.length - 2]!
          const startY = first.nums[first.nums.length - 1]!
          const endX = last.nums[last.nums.length - 2]!
          const endY = last.nums[last.nums.length - 1]!
          // 起点：要么与 BeginPt 一致，要么被补过一段轴对齐接线
          const startGap = Math.hypot(startX - p.anchors.beginX, startY - p.anchors.beginY)
          if (startGap > 0.6) {
            // 补过接线的话，首段必须是轴对齐的（水平或垂直）
            const axisAligned =
              Math.abs(startX - p.anchors.beginX) < 0.6 || Math.abs(startY - p.anchors.beginY) < 0.6
            if (!axisAligned) unbridged += 1
          }
          // 终点：必须与 EndPt 一致
          if (Math.hypot(endX - p.anchors.endX, endY - p.anchors.endY) > 0.6) unbridged += 1
        }
        expect(unbridged, `${path.basename(file)} 锚点与几何不一致的端点数`).toBe(0)
      }
    }
  })
})
