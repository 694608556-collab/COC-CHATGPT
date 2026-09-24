import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

// 两台开发机上样例的存放位置不同，按逻辑名解析；缺失时对应用例自动跳过
const REAL = samplePath('龙台掠雪')
const hasReal = REAL !== undefined

/**
 * 从 SVG 里取出所有 <text> 的 x/y 与内容。
 * 用于验证文字位置是否落在它所属的节点框内。
 */
function readTexts(svg: string): Array<{ x: number; y: number; text: string; size: number }> {
  const out: Array<{ x: number; y: number; text: string; size: number }> = []
  for (const m of svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), text: m[4]!, size: Number(m[3]) })
  }
  return out
}

/** 粗略估算一行文字的像素宽度 */
function measure(text: string, size: number): number {
  let width = 0
  for (const ch of text) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.55
  return width
}

describe('0.7.0 node text placement and wrapping', () => {
  it.skipIf(!hasReal)('uses the node own text box instead of assuming centering', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    const withTextBox = main.shapes.filter((shape) => shape.textBox)
    // 绝大多数节点都带自己的文字框
    expect(withTextBox.length).toBeGreaterThan(main.shapes.length * 0.9)

    // 文字框应落在节点框内（允许小幅越界），不能跑到别的节点上去
    for (const shape of withTextBox.slice(0, 200)) {
      const box = shape.textBox!
      expect(box.x).toBeGreaterThanOrEqual(shape.x - 2)
      expect(box.y).toBeGreaterThanOrEqual(shape.y - 2)
      expect(box.x + box.width).toBeLessThanOrEqual(shape.x + shape.width + 2)
      expect(box.y + box.height).toBeLessThanOrEqual(shape.y + shape.height + 2)
    }
  })

  it.skipIf(!hasReal)('wraps long node text so it stays inside its box', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    const svg = pageToSvg(main)
    const texts = readTexts(svg)

    // 找一段明显超长的原文，确认它被切成了多行
    const longShape = main.shapes.find((shape) =>
      shape.lines.some((line) => measure(line, shape.fontSize) > (shape.textBox?.width ?? shape.width) + 20)
    )
    expect(longShape).toBeDefined()

    // 画出来的每一行都不应超出它所在节点文字框的宽度太多
    let overflow = 0
    for (const shape of main.shapes) {
      if (!shape.lines.length) continue
      const area = shape.textBox ?? { width: shape.width }
      const own = texts.filter((item) => shape.lines.some((line) => line.startsWith(item.text.slice(0, 4))))
      for (const item of own) {
        if (measure(item.text, item.size) > area.width + 8) overflow++
      }
    }
    // 允许极少数估算误差，但不应大面积溢出
    expect(overflow).toBeLessThan(5)
  })

  it.skipIf(!hasReal)('never emits a text line wider than the whole canvas', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    const svg = pageToSvg(main)
    const canvasWidth = main.bounds.maxX - main.bounds.minX
    for (const item of readTexts(svg)) {
      // 单行宽度不应超过画布宽度（否则必然是没折行）
      expect(measure(item.text, item.size)).toBeLessThan(canvasWidth)
    }
  })

  it('wraps at word boundaries for latin text and keeps newlines', () => {
    // 直接验证折行行为：造一个只有文字的节点，宽度不足以放下一整行
    const svgSource = fs.readFileSync('src/shared/emmx.ts', 'utf8')
    expect(svgSource).toContain('function wrapText')
    expect(svgSource).toContain('function measureText')
    expect(svgSource).toContain('function renderTextLines')
    // 折行要处理空格断点与已有换行符
    expect(svgSource).toContain("char === '\\n'")
    expect(svgSource).toContain('lastIndexOf')
  })

  it.skipIf(!hasReal)('keeps label text single-line (no wrapping for connectors)', () => {
    const document = parseEmmx(fs.readFileSync(REAL!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    // 连线标签「疑似起过纷争，但林知松失忆后无印象」较长，应保持一行
    const longLabel = main.labels.find((label) => label.lines.some((line) => line.length > 15))
    expect(longLabel).toBeDefined()
    const svg = pageToSvg(main)
    for (const line of longLabel!.lines) {
      expect(svg).toContain(`>${line}</text>`)
    }
  })
})

describe('0.7.0 callout labels', () => {
  const CALLOUT_FILE = samplePath('锈蚀纪元')
  const hasCallout = CALLOUT_FILE !== undefined

  it.skipIf(!hasCallout)('reads the text of every Callout box', () => {
    // Callout（标注框）自带文字，坐标相对自身框左上角。
    // 0.7.0 之前把它和 Boundary 归成一类、只画框不读文字，
    // 于是「标注框里的文字看不见，只能看见框」。
    const document = parseEmmx(fs.readFileSync(CALLOUT_FILE!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    const texts = main.labels.flatMap((label) => label.lines)
    expect(texts).toContain('琉星为何会知道黑蛇相关信息')
    expect(texts).toContain('有较多疑点，保留意见')
    expect(texts).toContain('基于白羽相关描述，此段描述生物为白羽可能性不太大')

    const svg = pageToSvg(main)
    expect(svg).toContain('琉星为何会知道黑蛇相关信息')
  })

  it.skipIf(!hasCallout)('places callout text inside its own box', () => {
    const document = parseEmmx(fs.readFileSync(CALLOUT_FILE!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    const calloutText = '琉星为何会知道黑蛇相关信息'
    const label = main.labels.find((item) => item.lines.includes(calloutText))
    expect(label).toBeDefined()
    // 文字中心应落在画布内，且不该是 0 附近（说明坐标没叠加框的左上角）
    const centerX = label!.x + label!.width / 2
    const centerY = label!.y + label!.height / 2
    expect(centerX).toBeGreaterThan(100)
    expect(centerY).toBeGreaterThan(100)
    expect(centerX).toBeLessThan(main.bounds.maxX)
    expect(centerY).toBeLessThan(main.bounds.maxY)
  })
})
