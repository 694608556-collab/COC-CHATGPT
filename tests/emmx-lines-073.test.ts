import fs from 'node:fs'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

/**
 * 0.7.3 回归：节点文字溢出、压到相邻节点上。
 *
 * 用户反馈「文字框重叠」，实际不是行距问题，而是**行数算多了**：
 * EdrawMind 会把同一行按格式差异切成多个 `<tp>`，而 `<pp>` 才是真正的一行。
 * 0.7.2 及更早按 `<tp>` 收集，单 pp 多 tp 的节点被算成 3 行，
 * 需要的高度翻倍，文字就被挤出节点框、压到上面的节点上。
 *
 * 实测「世界回归进行曲」id=2632：
 *   <pp><tp>应同渊娲一样，为</tp><tp>某个计划</tp><tp>的产物</tp></pp>
 *   → 是 1 行，节点框高 20.7，文字框高 15.2，1 行刚好放得下；
 *     按 tp 算成 3 行则需要约 40.5，溢出 25px，正好压到上方节点。
 */

const REAL = samplePath('世界回归进行曲')
const hasReal = REAL !== undefined

/** 独立解压 page XML（不复用 src 的 zip 读取，保证是独立口径） */
function pageXmls(buf: Buffer): string[] {
  const out: string[] = []
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue
    const nl = buf.readUInt16LE(i + 26)
    const el = buf.readUInt16LE(i + 28)
    if (!nl || nl > 512) continue
    const name = buf.subarray(i + 30, i + 30 + nl).toString('utf8')
    if (!name || name.includes(String.fromCharCode(0))) continue
    if (!/^page\/page.*\.xml$/.test(name)) continue
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const start = i + 30 + nl + el
    const raw = buf.subarray(start, start + size)
    out.push((method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8'))
  }
  return out
}

/** 从 SVG 里数出真正画出来的 <text> 行数（排除页面标签，只留该节点自己的） */
function drawnLines(svg: string): string[] {
  return [...svg.matchAll(/<text x="[-\d.]+" y="[-\d.]+"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!)
}

describe('0.7.3 pp/tp line semantics', () => {
  it.skipIf(!hasReal)('treats a single <pp> with several <tp> as ONE line', () => {
    const buf = fs.readFileSync(REAL!)
    // 先在原始 XML 里确认这个节点确实是「单 pp 多 tp」
    let found: { id: string; pp: number; tp: number } | undefined
    for (const xml of pageXmls(buf)) {
      for (const shape of xml.matchAll(/<Shape\s+ID="(\d+)"\s+Type="[^"]+"[^>]*>([\s\S]*?)<\/Shape>/g)) {
        const body = shape[2]!
        const pp = [...body.matchAll(/<pp\b[^>]*>([\s\S]*?)<\/pp>/g)]
        if (pp.length !== 1) continue
        const tp = [...pp[0]![1]!.matchAll(/<tp\b[^>]*>([\s\S]*?)<\/tp>/g)]
        if (tp.length >= 3) {
          found = { id: shape[1]!, pp: pp.length, tp: tp.length }
          break
        }
      }
      if (found) break
    }
    expect(found, '样例里应存在「单 pp 多 tp」的节点').toBeDefined()
    expect(found!.tp).toBeGreaterThanOrEqual(3)

    // 解析器必须把它算成 1 行，而不是 tp 的个数
    const document = parseEmmx(buf)
    const shape = document.pages.flatMap((p) => p.shapes).find((s) => String(s.id) === found!.id)
    expect(shape, `应解析到节点 ${found!.id}`).toBeDefined()
    expect(shape!.lines.length, `节点 ${found!.id} 有 ${found!.tp} 个 tp 但只有 1 个 pp，应为 1 行`).toBe(1)
  })

  it.skipIf(!hasReal)('counts lines by <pp> count, not by <tp> count', () => {
    const buf = fs.readFileSync(REAL!)
    // 全文件口径：每个带文字的 Shape，行数必须等于 pp 数
    const expected = new Map<string, number>()
    for (const xml of pageXmls(buf)) {
      for (const shape of xml.matchAll(/<Shape\s+ID="(\d+)"\s+Type="[^"]+"[^>]*>([\s\S]*?)<\/Shape>/g)) {
        const body = shape[2]!
        const pp = [...body.matchAll(/<pp\b[^>]*>([\s\S]*?)<\/pp>/g)]
        if (!pp.length) continue
        const withText = pp.filter((p) =>
          [...p[1]!.matchAll(/<tp\b[^>]*>([\s\S]*?)<\/tp>/g)].some(
            (t) => t[1]!.replace(/<[^>]+>/g, '').trim().length > 0
          )
        )
        if (withText.length) expected.set(shape[1]!, withText.length)
      }
    }
    expect(expected.size).toBeGreaterThan(500)

    const document = parseEmmx(buf)
    const actual = new Map<string, number>()
    for (const page of document.pages) {
      for (const shape of page.shapes) if (shape.lines.length) actual.set(String(shape.id), shape.lines.length)
    }

    const wrong: string[] = []
    for (const [id, count] of expected) {
      const got = actual.get(id)
      if (got === undefined) continue // 非节点图形（连线标签等）另有口径
      if (got !== count) wrong.push(`id=${id} 期望${count}行 实际${got}行`)
    }
    expect(wrong, `行数与 <pp> 数不一致：${wrong.slice(0, 5).join(' / ')}`).toEqual([])
  })

  it.skipIf(!hasReal)('never renders more lines than the node text box can hold', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const overflow: string[] = []
    for (const page of document.pages) {
      for (const shape of page.shapes) {
        if (!shape.lines.length || !shape.textBox) continue
        // 只渲染这一个节点，避免把页面标签混进来
        const svg = pageToSvg({ ...page, shapes: [shape], labels: [] })
        const drawn = drawnLines(svg).length
        const need = drawn * shape.fontSize * 1.35
        if (need > shape.textBox.height + 2) {
          overflow.push(
            `id=${shape.id} 需高${need.toFixed(1)} > 文字框高${shape.textBox.height.toFixed(1)}（画了${drawn}行）`
          )
        }
      }
    }
    expect(overflow, `有 ${overflow.length} 个节点的文字放不下：${overflow.slice(0, 5).join(' / ')}`).toEqual([])
  })

  it.skipIf(!hasReal)('renders the reported node on a single line inside its box', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const shape = document.pages
      .flatMap((p) => p.shapes)
      .find((s) => s.lines.some((line) => line.includes('应同渊娲一样')))

    // 用户截图里溢出的那个节点
    expect(shape, '应能定位到用户截图里的节点').toBeDefined()
    expect(shape!.lines.length, '「应同渊娲一样，为某种计划的产物」是一行，不是三行').toBe(1)
    expect(shape!.lines[0]).toBe('应同渊娲一样，为某种计划的产物')

    const svg = pageToSvg({ ...document.pages[0]!, shapes: [shape!], labels: [] })
    expect(drawnLines(svg)).toEqual(['应同渊娲一样，为某种计划的产物'])
  })
})
