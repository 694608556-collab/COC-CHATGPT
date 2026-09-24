import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AppError } from '../src/shared/errors'
import { emmxOutline, pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

/** 造一个未压缩的 zip 条目（本地文件头 + 内容） */
function zipEntry(name: string, content: Buffer): Buffer {
  const nameBuffer = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(0, 8) // 不压缩
  header.writeUInt32LE(content.length, 18)
  header.writeUInt32LE(content.length, 22)
  header.writeUInt16LE(nameBuffer.length, 26)
  return Buffer.concat([header, nameBuffer, content])
}

// 真实样本来自本机的跑团资料目录；文件不在时跳过，保证别处也能跑测试。
const SAMPLES = [
  { path: samplePath('月廻上时间线') ?? '', minShapes: 5 },
  { path: samplePath('龙台掠雪') ?? '', minShapes: 400, pages: 2 },
  { path: samplePath('渊娲之海') ?? '', minShapes: 150 }
]

describe('emmx parser', () => {
  it('rejects files that are not EdrawMind documents', () => {
    expect(() => parseEmmx(Buffer.from('not a zip at all'))).toThrow(/EdrawMind/)
    expect(() => parseEmmx(Buffer.alloc(0))).toThrow(/为空/)
  })

  it('keeps the synthetic case working without any real file', () => {
    // 构造一个最小 .emmx：zip 本地头 + 未压缩的 page.xml
    const xml =
      '<?xml version="1.0"?><Page ID="100" Type="Page" Name="画布 1">' +
      '<PageProps><Width V="1000"/><Height V="800"/></PageProps>' +
      '<Shape ID="1" Type="MMShape"><Transform><Width V="100"/><Height V="40"/>' +
      '<CX V="200" B="1" P="0"/><CY V="100" B="2" P="0"/></Transform>' +
      '<TextBlock TextFormatMask="0"><Character IX="0" Family="微软雅黑" Size="14" Color="#ff112233"/>' +
      '<Text><pp PX="1" CX="0"><tp CX="0">中心主题</tp></pp></Text></TextBlock>' +
      '<LevelData/><Geometries/></Shape></Page>'
    const payload = Buffer.from(xml, 'utf8')
    const name = Buffer.from('page/page.xml', 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(0, 8) // 不压缩
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(payload.length, 22)
    header.writeUInt16LE(name.length, 26)
    const emmx = Buffer.concat([header, name, payload])

    const doc = parseEmmx(emmx)
    expect(doc.pages).toHaveLength(1)
    const page = doc.pages[0]!
    expect(page.title).toBe('画布 1')
    expect(page.shapes).toHaveLength(1)
    expect(page.shapes[0]!.lines).toEqual(['中心主题'])
    expect(page.shapes[0]!.fontSize).toBe(14)
    // #aarrggbb → #rrggbb
    expect(page.shapes[0]!.color).toBe('#112233')
    // 中心点 (200,100) 减去半宽半高 → 左上角 (150,80)
    expect(page.shapes[0]!.x).toBe(150)
    expect(page.shapes[0]!.y).toBe(80)
    expect(emmxOutline(doc)).toEqual(['中心主题'])

    const svg = pageToSvg(page)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('中心主题')
    expect(svg).toContain('viewBox=')
  })

  it('explains what to do when the file uses the new 12.x binary format', () => {
    // EdrawMind 12.x 把画布存成 mmpage/*.bin，没有公开规范、无法还原图形。
    // 报错必须告诉用户「导出 HTML」，而不是笼统的「读不到画布」。
    const documentXml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><Document Version="12.2.2">' +
        '<Properties><Pages V="page;page-1"/></Properties></Document>',
      'utf8'
    )
    const emmx = Buffer.concat([
      zipEntry('document.xml', documentXml),
      zipEntry('mmpage/page.bin', Buffer.from('binary canvas data', 'utf8'))
    ])

    let caught: unknown
    try {
      parseEmmx(emmx)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    const appError = caught as AppError
    expect(appError.code).toBe('EMMX_NEW_FORMAT')
    // 带上版本号，用户就知道是软件升级导致的格式变化
    expect(appError.message).toContain('12.2.2')
    // 给出可操作的做法
    expect(appError.message).toContain('HTML')
  })

  it('still reports a plain empty map without mentioning HTML', () => {
    // 既没有文本画布也没有二进制页时，走原来那条通用错误
    const emmx = zipEntry(
      'document.xml',
      Buffer.from('<?xml version="1.0"?><Document Version="8.5.1"></Document>', 'utf8')
    )
    let caught: unknown
    try {
      parseEmmx(emmx)
    } catch (error) {
      caught = error
    }
    expect((caught as AppError).code).toBe('EMMX_NO_PAGE')
    expect((caught as AppError).message).not.toContain('HTML')
  })

  for (const sample of SAMPLES) {
    const exists = fs.existsSync(sample.path)
    it.skipIf(!exists)(`parses the real file ${sample.path.split('\\').pop()}`, () => {
      const doc = parseEmmx(fs.readFileSync(sample.path))
      if (sample.pages) expect(doc.pages.length).toBe(sample.pages)
      const shapes = doc.pages.reduce((sum, page) => sum + page.shapes.length, 0)
      expect(shapes).toBeGreaterThanOrEqual(sample.minShapes)
      // 每个画布都要能出 SVG，且带内容包围盒
      for (const page of doc.pages) {
        const svg = pageToSvg(page)
        expect(svg).toContain('<svg')
        expect(page.bounds.maxX).toBeGreaterThan(page.bounds.minX)
      }
      // 大纲必须能取到文字
      expect(emmxOutline(doc).length).toBeGreaterThan(0)
    })
  }

  it.skipIf(!fs.existsSync(SAMPLES[1]!.path))('extracts every canvas of a multi-page map', () => {
    const doc = parseEmmx(fs.readFileSync(SAMPLES[1]!.path))
    expect(doc.pages.length).toBe(2)
    expect(doc.pages.map((page) => page.name)).toEqual(['page/page.xml', 'page/page-1.xml'])
  })

  it.skipIf(!fs.existsSync(SAMPLES[1]!.path))('rebuilds a vector map instead of the tiny thumbnail', () => {
    const doc = parseEmmx(fs.readFileSync(SAMPLES[1]!.path))
    const main = doc.pages.find((page) => page.name === 'page/page.xml')!
    // 内容区远大于内置缩略图的 210px，这正是不能用缩略图的原因
    const contentWidth = main.bounds.maxX - main.bounds.minX
    expect(contentWidth).toBeGreaterThan(4000)
    const svg = pageToSvg(main)
    // 矢量图：viewBox 覆盖内容，文字是 <text> 而不是位图
    expect(svg).toContain('<text')
    expect(svg).not.toContain('<image')
  })
})
