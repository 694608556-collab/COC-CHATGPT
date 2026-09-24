/**
 * 0.7.1 修复：连线端点必须接在节点框的【边中点】上。
 *
 * 用户反馈「线条未和文字框居中对齐」，并要求参照 EdrawMind 导出 HTML 的效果。
 * 用官方导出的连线做权威判定，结论明确：可判定的端点全部是
 * 「贴左边/贴右边 + 垂直居中」——即接在边的【中点】上。
 *
 * 而 .emmx 源文件里的端点常落在框角附近：实测矮节点（高 23.9）的端点 y
 * 比垂直中心低 12.0px，正好半个框高，也就是接在右下角。
 * 0.7.1 第一版只把端点「推到框边」，保留了角落坐标，所以矮节点的连线全部
 * 接在右下角——这正是用户看到的问题。
 *
 * 现在的规则：
 * - 端点在框外且离得不远 → 钉在最近那条边的中点
 * - 端点已在框内 → 不动（实测这类是多分支主干线的起点，硬拉会破坏走向）
 * - 端点离框很远 → 不动（指向分组框等）
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

describe('0.7.1 fix: connectors attach to edge midpoints', () => {
  it('uses the nearest edge midpoint rather than the box corner', () => {
    const source = read('src/shared/emmx.ts')
    expect(source).toContain('alignEndToBoxCenter')
    // 必须把该边的另一个坐标摆到中心，而不是只把端点推到边上
    expect(source).toContain('centerX')
    expect(source).toContain('centerY')
    // 旧的「只推到框边」写法必须消失——那正是接在角上的原因
    expect(source).not.toContain('extendEndToBoxBoundary')
  })

  it('keeps connectors orthogonal while moving the endpoint', () => {
    const source = read('src/shared/emmx.ts')
    // 挪端点时必须把相连的整条干线一起平移，否则正交折线会被拉成斜线
    // （实测只挪端点会出现 73 条斜线；只挪相邻一个折点仍有 17 条）
    expect(source).toContain('shiftRun')
    // 判断「哪些点属于同一条干线」必须用原始坐标逐段比较：
    // 拿平移后的坐标去比，链条会在第一个折点处断开
    expect(source).toContain('let prev = from')
  })

  it.runIf(available.length > 0)('keeps almost every connector an orthogonal polyline', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        let total = 0
        let diagonal = 0
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          total += 1
          const tokens = p.d.split(/(?=[MLC])/).filter(Boolean)
          const points = tokens.map((t) => {
            const kind = t[0]!
            const nums = t.slice(1).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
            if (kind === 'C' && nums.length === 6) return { kind, x: nums[4]!, y: nums[5]! }
            return { kind, x: nums[nums.length - 2]!, y: nums[nums.length - 1]! }
          })
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1]!
            const b = points[i]!
            // 曲线段本身是弧线，不算斜线
            if (a.kind === 'C' || b.kind === 'C') continue
            if (Math.abs(b.x - a.x) > 1 && Math.abs(b.y - a.y) > 1) {
              diagonal += 1
              break
            }
          }
        }
        if (!total) continue
        // 原始 .emmx 里 0 条斜线（全是正交折线），所以改动后也不该引入斜线。
        // 允许极少数端点落在曲线上的特例。
        const ratio = 1 - diagonal / total
        expect(
          ratio,
          `${path.basename(file)} 正交比例 ${(ratio * 100).toFixed(1)}%（斜线 ${diagonal}/${total}）`
        ).toBeGreaterThan(0.9)
      }
    }
  })

  it('leaves endpoints that already sit inside a box alone', () => {
    const source = read('src/shared/emmx.ts')
    // 多分支主干线故意从框内部起笔，硬拉到边中点会破坏走向
    expect(source).toContain('const inside =')
    expect(source).toContain('if (inside) return { x, y }')
  })

  it.runIf(available.length > 0)('attaches every box-touching endpoint to an edge midpoint', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      for (const page of document.pages) {
        const boxes = page.shapes.map((s) => ({ x: s.x, y: s.y, w: s.width, h: s.height }))
        let attached = 0
        let onMidpoint = 0
        const offenders: string[] = []
        for (const p of page.paths) {
          if (p.type !== 'MMConnector' && p.type !== 'RelatConnector') continue
          const tokens = p.d.split(/(?=[MLC])/).filter(Boolean)
          for (const token of [tokens[0], tokens[tokens.length - 1]]) {
            if (!token) continue
            const nums = token.slice(1).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
            if (nums.length < 2) continue
            const x = nums[nums.length - 2]!
            const y = nums[nums.length - 1]!
            let best: { b: (typeof boxes)[number]; d: number } | undefined
            for (const b of boxes) {
              const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - (b.x + b.w) : 0
              const dy = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0
              const d = Math.hypot(dx, dy)
              if (!best || d < best.d) best = { b, d }
            }
            // 只看「从框外贴到框上」的端点：
            // - 离得远的（主干线起点、指向分组框等）不在本规则范围内
            // - 已在框内部的（多分支主干线故意从框内起笔）也不该被拉到边上
            if (!best || best.d > 1.5) continue
            const insideBox =
              x > best.b.x + 1 &&
              x < best.b.x + best.b.w - 1 &&
              y > best.b.y + 1 &&
              y < best.b.y + best.b.h - 1
            if (insideBox) continue
            attached += 1
            const midX = best.b.x + best.b.w / 2
            const midY = best.b.y + best.b.h / 2
            const onVerticalEdge =
              Math.abs(x - best.b.x) < 1 || Math.abs(x - (best.b.x + best.b.w)) < 1
            const deviation = onVerticalEdge ? Math.abs(y - midY) : Math.abs(x - midX)
            if (deviation < 1.5) onMidpoint += 1
            else if (offenders.length < 5) {
              offenders.push(`(${x.toFixed(1)},${y.toFixed(1)}) 偏离 ${deviation.toFixed(1)}px`)
            }
          }
        }
        if (!attached) continue
        // 贴到框上的端点必须落在中点（允许极少数几何特例）
        const ratio = onMidpoint / attached
        expect(
          ratio,
          `${path.basename(file)} 居中比例 ${(ratio * 100).toFixed(1)}%  例外: ${offenders.join(' ')}`
        ).toBeGreaterThan(0.98)
      }
    }
  })

  it.runIf(available.length > 0)('does not leave endpoints floating a small gap from a box', () => {
    for (const file of available) {
      const document = parseEmmx(fs.readFileSync(file))
      const snapRange = Number(
        /CONNECTOR_SNAP_RANGE = ([\d.]+)/.exec(read('src/shared/emmx.ts'))?.[1] ?? '32'
      )
      for (const page of document.pages) {
        const boxes = page.shapes.map((s) => ({ x: s.x, y: s.y, w: s.width, h: s.height }))
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
            let gap = Infinity
            for (const b of boxes) {
              const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - (b.x + b.w) : 0
              const dy = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0
              gap = Math.min(gap, Math.hypot(dx, dy))
            }
            if (gap > 1.5 && gap <= snapRange) floating += 1
          }
        }
        expect(floating, `${path.basename(file)} 未校正的小间隙端点数`).toBe(0)
      }
    }
  })
})
