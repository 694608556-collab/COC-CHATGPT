// 0.7.7：.emmx 里插入的图片与节点图标要显示出来
//
// 用户反馈「原 emmx 文件中插入的图片和图标没有显示出来」。
// 根因：这两类图形是**嵌套在节点内部的**（`<Shape Type="Image">` /
// `<Shape Type="Mark">`），而 0.7.5 把嵌套图形一律当成「附属装饰」跳过了。
//
// 存储机制（实测）：
//   page.xml   <Shape ID="535" Type="Image"><Data Res="rId1"/></Shape>
//   rels       <Relationship Id="rId1" Target="../media/image1.png"/>
//   zip 条目    media/image1.png（336 KB）
//   图标        <MarkData Name="star1" GroupName="star"/>（图形数据不在文件里，
//              只有名字；从 EdrawMind 的 HTML 导出里内置了一份位图）
//
// 坐标：嵌套图形的 CX/CY 是**相对父框左上角**的中心点偏移。
// 实测 Mark 恒为 CX=17.5/CY=14.3，换算成左上角是 (9, 5.8)，
// 与 EdrawMind HTML 里父节点内的 `translate(9,5.8)` 完全一致。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MINDMAP_MARKS, mindmapMarkHref } from '../src/shared/mindmap-marks'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

const WORLD = samplePath('世界回归进行曲')
const DRAGON = samplePath('龙台掠雪')

/** 1×1 的透明 PNG，用作测试里的图片数据 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * 造一个带 media 的 .emmx（未压缩 zip）。
 *
 * entries 里每项是 [名字, 内容]；图片走真实的 media/ + rels 引用路径，
 * 与 EdrawMind 存的结构一致。
 */
function emmxWithMedia(entries: Array<[string, Buffer | string]>): Buffer {
  const chunks: Buffer[] = []
  for (const [name, content] of entries) {
    const payload = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    const nameBytes = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(0, 8)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(payload.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    chunks.push(header, nameBytes, payload)
  }
  return Buffer.concat(chunks)
}

/** 一个普通节点（可带嵌套的装饰图形） */
function node(
  id: string,
  text: string,
  opts: { x?: number; y?: number; w?: number; h?: number; inner?: string; hidden?: string } = {}
): string {
  const { x = 100, y = 100, w = 100, h = 28, inner = '', hidden } = opts
  return (
    `<Shape ID="${id}" Type="SubTopic"><Transform><Width V="${w}"/><Height V="${h}"/>` +
    `<CX V="${x + w / 2}" B="1" P="0"/><CY V="${y + h / 2}" B="2" P="0"/></Transform>` +
    inner +
    `<TextBlock><Character IX="0" Size="12" Color="#333333"/>` +
    `<Text><pp PX="0" CX="0"><tp>${text}</tp></pp></Text></TextBlock>` +
    `<LevelData>${hidden === undefined ? '' : `<TogglerID V="${hidden}"/>`}</LevelData></Shape>`
  )
}

/** 嵌套的图片图形（坐标相对父框左上角） */
function innerImage(cx: number, cy: number, size: number, res: string): string {
  return (
    `<Shape ID="900" Type="Image"><Transform><Width V="${size}"/><Height V="${size}"/>` +
    `<CX V="${cx}" B="1" P="0"/><CY V="${cy}" B="2" P="0"/></Transform>` +
    `<Data Res="${res}"/></Shape>`
  )
}

/** 嵌套的图标图形 */
function innerMark(cx: number, cy: number, name: string): string {
  return (
    `<Shape ID="901" Type="Mark"><Transform><Width V="17"/><Height V="17"/>` +
    `<CX V="${cx}" B="1" P="0"/><CY V="${cy}" B="2" P="0"/></Transform>` +
    `<MarkData Name="${name}" GroupName="star"/></Shape>`
  )
}

function pageOf(...shapes: string[]): string {
  return (
    `<?xml version="1.0"?><Page ID="100" Type="Page" Name="画布 1">` +
    `<PageProps><Width V="2000"/><Height V="2000"/></PageProps>` +
    shapes.join('') +
    `</Page>`
  )
}

describe('0.7.7 inserted images are rendered', () => {
  it('reads the image out of media/ and inlines it as a data URI', () => {
    const file = emmxWithMedia([
      [
        'rels/page_rels.xml',
        `<?xml version="1.0"?><Relationships>` +
          `<Relationship Id="rId1" Target="../media/image1.png"/></Relationships>`
      ],
      ['media/image1.png', TINY_PNG],
      ['page/page.xml', pageOf(node('1', '带图的节点', { inner: innerImage(40, 40, 80, 'rId1') }))]
    ])
    const page = parseEmmx(file).pages[0]!
    expect(page.decorations).toHaveLength(1)
    const image = page.decorations[0]!
    expect(image.kind).toBe('image')
    expect(image.ownerId).toBe('1')
    expect(image.href?.startsWith('data:image/png;base64,')).toBe(true)
    // 内嵌的必须是真的图片数据，不是空串
    expect(image.href!.length).toBeGreaterThan(50)
  })

  it('places the image by the parent box, not the canvas origin', () => {
    // CX/CY 是相对父框左上角的中心点偏移：父框左上 (100,100)、
    // 图片 80x80 中心 (40,40) → 左上角 = 100+40-40, 100+40-40 = (100,100)
    const file = emmxWithMedia([
      ['rels/page_rels.xml', `<Relationships><Relationship Id="rId1" Target="../media/a.png"/></Relationships>`],
      ['media/a.png', TINY_PNG],
      ['page/page.xml', pageOf(node('1', '父', { x: 100, y: 100, inner: innerImage(40, 40, 80, 'rId1') }))]
    ])
    const image = parseEmmx(file).pages[0]!.decorations[0]!
    expect(image.x).toBeCloseTo(100, 1)
    expect(image.y).toBeCloseTo(100, 1)
    expect(image.width).toBe(80)
    expect(image.height).toBe(80)
  })

  it('draws the image into the SVG as an <image> element', () => {
    const file = emmxWithMedia([
      ['rels/page_rels.xml', `<Relationships><Relationship Id="rId1" Target="../media/a.png"/></Relationships>`],
      ['media/a.png', TINY_PNG],
      ['page/page.xml', pageOf(node('1', '父', { inner: innerImage(40, 40, 80, 'rId1') }))]
    ])
    const svg = pageToSvg(parseEmmx(file).pages[0]!)
    expect(svg).toContain('<image data-image="1"')
    expect(svg).toContain('data:image/png;base64,')
  })

  it('skips an image whose media entry is missing instead of drawing an empty box', () => {
    // 图片数据读不到就不画：画个空框反而让人以为导图坏了
    const file = emmxWithMedia([
      ['rels/page_rels.xml', `<Relationships><Relationship Id="rId1" Target="../media/gone.png"/></Relationships>`],
      ['page/page.xml', pageOf(node('1', '父', { inner: innerImage(40, 40, 80, 'rId1') }))]
    ])
    const page = parseEmmx(file).pages[0]!
    expect(page.decorations).toEqual([])
    expect(pageToSvg(page)).not.toContain('data-image=')
  })

  it('does not fail the whole map when rels is corrupt', () => {
    const file = emmxWithMedia([
      ['rels/page_rels.xml', '这不是 XML'],
      ['page/page.xml', pageOf(node('1', '节点'))]
    ])
    const page = parseEmmx(file).pages[0]!
    expect(page.shapes.map((shape) => shape.id)).toContain('1')
    expect(page.decorations).toEqual([])
  })
})

describe('0.7.7 node icons are rendered', () => {
  it('ships the four icons that real maps actually use', () => {
    // 全盘统计 44 个真实导图，用到的图标只有这四种
    for (const name of ['star1', 'star2', 'star3', 'finished']) {
      expect(MINDMAP_MARKS[name], `应内置 ${name} 图标`).toBeDefined()
      expect(mindmapMarkHref(name)).toMatch(/^data:image\/png;base64,/)
    }
    expect(mindmapMarkHref('不存在的图标')).toBeUndefined()
    expect(mindmapMarkHref(undefined)).toBeUndefined()
  })

  it('reads the icon name and places it relative to the parent box', () => {
    // 实测 Mark 恒为 CX=17.5/CY=14.3、尺寸 17x17，
    // 换算成相对父框左上角的左上角 = (17.5-8.5, 14.3-8.5) = (9, 5.8)
    const file = emmxWithMedia([
      ['page/page.xml', pageOf(node('1', '重要物品', { x: 200, y: 300, inner: innerMark(17.5, 14.3, 'star1') }))]
    ])
    const mark = parseEmmx(file).pages[0]!.decorations[0]!
    expect(mark.kind).toBe('mark')
    expect(mark.mark).toBe('star1')
    expect(mark.ownerId).toBe('1')
    expect(mark.x - 200).toBeCloseTo(9, 1)
    expect(mark.y - 300).toBeCloseTo(5.8, 1)
  })

  it('draws the icon into the SVG', () => {
    const file = emmxWithMedia([
      ['page/page.xml', pageOf(node('1', '重要物品', { inner: innerMark(17.5, 14.3, 'star2') }))]
    ])
    const svg = pageToSvg(parseEmmx(file).pages[0]!)
    expect(svg).toContain('<image data-mark="1"')
    expect(svg).toContain('data:image/png;base64,')
  })

  it('does not draw an icon whose name is unknown', () => {
    const file = emmxWithMedia([
      ['page/page.xml', pageOf(node('1', '节点', { inner: innerMark(17.5, 14.3, '没见过的图标') }))]
    ])
    const svg = pageToSvg(parseEmmx(file).pages[0]!)
    expect(svg).not.toContain('data-mark=')
  })

  it('hides decorations whose node is folded away', () => {
    // 折叠分支里的节点不画，它身上的图片/图标自然也不该画
    const file = emmxWithMedia([
      ['page/page.xml', pageOf(node('1', '折叠掉的', { hidden: '9', inner: innerMark(17.5, 14.3, 'star1') }))]
    ])
    const page = parseEmmx(file).pages[0]!
    expect(page.decorations[0]!.hidden).toBe(true)
    expect(pageToSvg(page)).not.toContain('data-mark=')
  })

  it('does not treat a decoration as a node in the outline', () => {
    // 装饰没有文字、也没有层级，绝不能出现在大纲里
    const file = emmxWithMedia([
      ['page/page.xml', pageOf(node('1', '真正的节点', { inner: innerMark(17.5, 14.3, 'star1') }))]
    ])
    const doc = parseEmmx(file)
    expect(doc.outline.map((line) => line.text)).toEqual(['真正的节点'])
  })
})

describe('0.7.7 real maps keep their images and icons', () => {
  it.skipIf(!WORLD)('finds the inserted image and every icon in the reported map', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const images = page.decorations.filter((item) => item.kind === 'image')
    const marks = page.decorations.filter((item) => item.kind === 'mark')
    // 实测：1 张插入的图片 + 23 个图标
    expect(images.length).toBeGreaterThan(0)
    expect(marks.length).toBeGreaterThan(15)
    for (const image of images) {
      expect(image.href).toMatch(/^data:image\//)
      // 图片必须落在所属节点框内（这是用户截图里「梅汐」那张）
      const owner = page.shapes.find((shape) => shape.id === image.ownerId)!
      expect(owner, `图片 ${image.ownerId} 应有所属节点`).toBeDefined()
      expect(image.x).toBeGreaterThanOrEqual(owner.x - 1)
      expect(image.y).toBeGreaterThanOrEqual(owner.y - 1)
      expect(image.x + image.width).toBeLessThanOrEqual(owner.x + owner.width + 1)
    }
    // 每种图标都认识
    for (const mark of marks) expect(mindmapMarkHref(mark.mark), `应认识 ${mark.mark}`).toBeDefined()
  })

  it.skipIf(!WORLD)('renders every visible decoration into the SVG', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const svg = pageToSvg(page)
    const visibleMarks = page.decorations.filter((item) => item.kind === 'mark' && !item.hidden)
    const visibleImages = page.decorations.filter((item) => item.kind === 'image' && !item.hidden)
    expect([...svg.matchAll(/data-mark="/g)]).toHaveLength(visibleMarks.length)
    expect([...svg.matchAll(/data-image="/g)]).toHaveLength(visibleImages.length)
  })

  it.skipIf(!DRAGON)('does not invent decorations in a map that has none', () => {
    // 龙台掠雪 没有插入图片、也没有图标；修复不该凭空画出东西
    const page = parseEmmx(fs.readFileSync(DRAGON!)).pages[0]!
    expect(page.decorations).toEqual([])
    expect(pageToSvg(page)).not.toContain('data-mark=')
    expect(pageToSvg(page)).not.toContain('data-image=')
  })
})
