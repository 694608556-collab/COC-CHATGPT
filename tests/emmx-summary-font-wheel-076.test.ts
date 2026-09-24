// 0.7.6 三处修复的回归测试
//
// 1) 概括括号（Summary）不再被填成实心
// 2) 导图文字用应用自己的字体（苹方 / SF Pro），不是写死的微软雅黑
// 3) 滚轮默认滚动、Ctrl+滚轮才缩放
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

const WORLD = samplePath('世界回归进行曲')

/** 造一个最小 .emmx */
function emmx(xml: string): Buffer {
  const payload = Buffer.from(xml, 'utf8')
  const name = Buffer.from('page/page.xml', 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(0, 8)
  header.writeUInt32LE(payload.length, 18)
  header.writeUInt32LE(payload.length, 22)
  header.writeUInt16LE(name.length, 26)
  return Buffer.concat([header, name, payload])
}

function pageOf(...shapes: string[]): string {
  return (
    `<?xml version="1.0"?><Page ID="100" Type="Page" Name="画布 1">` +
    `<PageProps><Width V="2000"/><Height V="2000"/></PageProps>` +
    shapes.join('') +
    `</Page>`
  )
}

/** 一个概括括号：几何不闭合（Closed="0"）且标了 NoFill="1" */
function summary(id: string, opts: { noFill?: boolean; color?: string } = {}): string {
  const { noFill = true, color = '#ff00af54' } = opts
  return (
    `<Shape ID="${id}" Type="Summary"><Transform><Width V="12"/><Height V="100"/>` +
    `<CX V="300" B="1" P="0"/><CY V="300" B="2" P="0"/></Transform>` +
    `<ShapeFormat QuickMask="0"><FillFormat Type="Solid"><Color V="${color}"/></FillFormat>` +
    `<LineFormat><LineWeight V="2"/><LineFill Type="Solid"><Color V="${color}"/></LineFill></LineFormat></ShapeFormat>` +
    `<LevelData><SubLevel V="9"/></LevelData>` +
    `<Geometries><Geometry Closed="0"${noFill ? ' NoFill="1"' : ''}>` +
    `<MoveTo><X V="0" B="1" P="0"/><Y V="0" B="2" P="0"/></MoveTo>` +
    `<LineTo><X V="6" B="1" P="0.5"/><Y V="50" B="2" P="0.5"/></LineTo>` +
    `<LineTo><X V="0" B="1" P="0"/><Y V="100" B="2" P="1"/></LineTo>` +
    `</Geometry></Geometries></Shape>`
  )
}

/** 一个分组框：几何闭合（Closed="1"），应当铺底色 */
function boundary(id: string, color = '#33e7f2e9'): string {
  return (
    `<Shape ID="${id}" Type="Boundary"><Transform><Width V="200"/><Height V="100"/>` +
    `<CX V="600" B="1" P="0"/><CY V="300" B="2" P="0"/></Transform>` +
    `<ShapeFormat QuickMask="0"><FillFormat Type="Solid"><Color V="${color}"/></FillFormat>` +
    `<LineFormat><LineWeight V="2"/><LineFill Type="Solid"><Color V="#ff00af54"/></LineFill></LineFormat></ShapeFormat>` +
    `<LevelData/>` +
    `<Geometries><Geometry Closed="1">` +
    `<MoveTo><X V="0" B="1" P="0"/><Y V="0" B="2" P="0"/></MoveTo>` +
    `<LineTo><X V="200" B="1" P="1"/><Y V="0" B="2" P="0"/></LineTo>` +
    `<LineTo><X V="200" B="1" P="1"/><Y V="100" B="2" P="1"/></LineTo>` +
    `<LineTo><X V="0" B="1" P="0"/><Y V="100" B="2" P="1"/></LineTo>` +
    `<LineTo><X V="0" B="1" P="0"/><Y V="0" B="2" P="0"/></LineTo>` +
    `</Geometry></Geometries></Shape>`
  )
}

describe('0.7.6 summary brackets are stroked, not filled', () => {
  it('does not fill a summary bracket even though it carries a FillFormat colour', () => {
    // 用户的描述是「像在 Illustrator 里把描边设成了填充」。根因：
    // 概括括号的 <Geometry> 写了 NoFill="1"（不填充），但 <FillFormat> 里
    // 仍留着与描边同色的绿。此前只看 FillFormat，于是括号被填成实心色块。
    const doc = parseEmmx(emmx(pageOf(summary('1'))))
    const path = doc.pages[0]!.paths.find((p) => p.id === '1')!
    expect(path.type).toBe('Summary')
    expect(path.fill).toBe('none')
    // 描边保留：括号本身还得画出来
    expect(path.stroke).toBe('#00af54')
    expect(path.strokeWidth).toBe(2)
  })

  it('still fills a boundary box, which is closed and has no NoFill', () => {
    // 分组框是 Closed="1" 且没有 NoFill，必须照旧铺底色，
    // 否则「修概括括号」会把分组框的底色一起弄没
    const doc = parseEmmx(emmx(pageOf(boundary('1'))))
    const path = doc.pages[0]!.paths.find((p) => p.id === '1')!
    expect(path.type).toBe('Boundary')
    expect(path.fill).toBe('#e7f2e9')
  })

  it('renders the bracket as fill="none" in the SVG', () => {
    const doc = parseEmmx(emmx(pageOf(summary('1'))))
    const svg = pageToSvg(doc.pages[0]!)
    // 概括括号那一条 <path>：找带 data-shape 之外、fill 为 none 且描边是括号色的
    const tags = [...svg.matchAll(/<path[^>]*\/>/g)].map((m) => m[0])
    const bracket = tags.find((tag) => tag.includes('stroke="#00af54"'))
    expect(bracket, 'SVG 里应有概括括号').toBeDefined()
    expect(bracket!).toContain('fill="none"')
    // 整张图里不该出现被填成括号色的 path
    expect(tags.some((tag) => tag.includes('fill="#00af54"'))).toBe(false)
  })

  it.skipIf(!WORLD)('strokes every summary in the map the user reported', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const summaries = page.paths.filter((path) => path.type === 'Summary')
    expect(summaries.length).toBeGreaterThan(5)
    // 全盘实测：74 个 Summary 全部 NoFill="1"，EdrawMind 的导出一律 fill="none"
    for (const path of summaries) {
      expect(path.fill, `概括括号 ${path.id} 不该填色`).toBe('none')
    }
    // 用户截图里那一个
    expect(page.paths.find((path) => path.id === '1344')!.fill).toBe('none')
  })

  it.skipIf(!WORLD)('keeps boundary boxes filled while summaries are not', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const boundaries = page.paths.filter((path) => path.type === 'Boundary')
    expect(boundaries.length).toBeGreaterThan(0)
    for (const path of boundaries) expect(path.fill).not.toBe('none')
  })
})

describe('0.7.6 map text uses the application font', () => {
  it('writes the app font stack instead of a hardcoded Microsoft YaHei', () => {
    const doc = parseEmmx(
      emmx(
        pageOf(
          `<Shape ID="1" Type="SubTopic"><Transform><Width V="100"/><Height V="28"/>` +
            `<CX V="100" B="1" P="0"/><CY V="100" B="2" P="0"/></Transform>` +
            `<TextBlock><Character IX="0" Size="12" Color="#333333"/>` +
            `<Text><pp PX="0" CX="0"><tp>同步字体</tp></pp></Text></TextBlock>` +
            `<LevelData/></Shape>`
        )
      )
    )
    const svg = pageToSvg(doc.pages[0]!)
    expect(svg).not.toContain('Microsoft YaHei')
    // 与界面同一套：内置的 SF Pro / 苹方
    expect(svg).toContain('PingFang SC')
    expect(svg).toContain('SF Pro Text')
    expect(svg).toContain('font-family="\'SF Pro Text\', \'SF Pro Display\', \'PingFang SC\'')
  })

  it.skipIf(!WORLD)('uses one font family for every text in a real map', () => {
    const svg = pageToSvg(parseEmmx(fs.readFileSync(WORLD!)).pages[0]!)
    const families = new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))
    // 全部文字（含折叠徽标数字）只应有一种字体栈
    expect(families.size).toBe(1)
    const [only] = [...families]
    expect(only).toContain('PingFang SC')
    expect(only).not.toContain('Microsoft YaHei')
  })

  it('keeps the embedded fonts the app ships (do not swap them out)', () => {
    // 用户明确说过「字体不用变动」——这里只是让导图也用同一套内置字体，
    // 不是换成系统字体，所以内置字体文件必须原样保留
    const fontRoot = path.resolve(__dirname, '../src/renderer/src/assets/fonts')
    for (const file of [
      'PingFangSC-Regular.ttf',
      'PingFangSC-Medium.ttf',
      'PingFangSC-Bold.ttf',
      'SF-Pro-Text-Regular.otf'
    ]) {
      expect(fs.statSync(path.join(fontRoot, file)).size).toBeGreaterThan(0)
    }
  })
})

describe('0.7.6 wheel scrolls, Ctrl+wheel zooms', () => {
  const viewer = fs.readFileSync(
    new URL('../src/renderer/src/components/MindmapViewer.tsx', import.meta.url),
    'utf8'
  )

  it('lets a plain wheel scroll natively instead of hijacking it', () => {
    // 没按 Ctrl/⌘ 时必须直接 return，不拦原生滚动
    expect(viewer).toMatch(/if \(!event\.ctrlKey && !event\.metaKey\) return/)
    // 不能再挂在 React 的 onWheel 上（passive，拦不住）
    expect(viewer).not.toMatch(/onWheel=\{onWheel\}/)
  })

  it('registers a non-passive wheel listener so preventDefault actually works', () => {
    // React 17+ 把 onWheel 注册成 passive，在里面 preventDefault 无效——
    // 这正是「缩放会同时影响滚动条」的原因：拦不住，原生滚动照常发生
    expect(viewer).toContain("body.addEventListener('wheel', onWheel, { passive: false })")
    expect(viewer).toContain("body.removeEventListener('wheel', onWheel)")
  })

  it('anchors the zoom on the pointer so the view does not jump', () => {
    // 缩放后要把滚动位置调到同一比例，光标下那一点留在原地
    expect(viewer).toContain('ratioX')
    expect(viewer).toContain('ratioY')
    expect(viewer).toContain('node.scrollLeft = ratioX * node.scrollWidth - offsetX')
    expect(viewer).toContain('node.scrollTop = ratioY * node.scrollHeight - offsetY')
  })

  it('tells the user the new gesture in the toolbar', () => {
    expect(viewer).toContain('Ctrl + 滚轮缩放')
  })
})
