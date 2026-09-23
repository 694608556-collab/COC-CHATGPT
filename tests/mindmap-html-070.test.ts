import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { htmlMindmapOutline, parseMindmapHtml } from '../src/shared/mindmap-html'

// 真实样本；文件不在时跳过，保证别处也能跑测试
const REAL = 'C:\\Users\\Admin\\AppData\\Roaming\\dsh-launcher\\dsh-packs\\pack-test\\attachments\\v1\\files\\55\\559a075b75a21021c3daf0a938d806e02ca878d9a397377f7ba94ebdd6a77c01\\铸形骸，灯心性，启天命26907.html'

describe('0.7.0 mindmap html parser', () => {
  it('parses a minimal handcrafted export', () => {
    const html = `<!doctype html><html><head><title>测试导图</title></head><body>
      <div id="author-name"><div class="text">张三</div></div>
      <svg id="page0" width="800" height="600" viewBox="0 0 800 600">
        <rect x="0" y="0" width="100" height="40"/>
        <text><tspan>中心主题</tspan></text>
        <text><tspan>子节点甲</tspan></text>
      </svg>
      <svg id="page1" width="400" height="300" viewBox="0 0 400 300">
        <text><tspan>第二页文字</tspan></text>
      </svg>
    </body></html>`
    const document = parseMindmapHtml(html)
    expect(document.title).toBe('测试导图')
    expect(document.author).toBe('张三')
    expect(document.pages).toHaveLength(2)
    expect(document.pages[0]!.id).toBe('page0')
    expect(document.pages[0]!.width).toBe(800)
    expect(document.pages[0]!.height).toBe(600)
    expect(document.pages[0]!.texts).toContain('中心主题')
    expect(document.pages[0]!.texts).toContain('子节点甲')
    expect(document.pages[1]!.texts).toContain('第二页文字')
    // 大纲去重后合并所有页面
    const outline = htmlMindmapOutline(document)
    expect(outline).toContain('中心主题')
    expect(outline).toContain('第二页文字')
    expect(new Set(outline).size).toBe(outline.length)
  })

  it('skips svg elements without a real size', () => {
    // 图标之类的小 svg 不该被当成画布
    const html = `<html><head><title>t</title></head><body>
      <svg id="icon"><path d="M0 0h10v10z"/></svg>
      <svg id="page0" viewBox="0 0 500 400"><text><tspan>真画布</tspan></text></svg>
    </body></html>`
    const document = parseMindmapHtml(html)
    expect(document.pages).toHaveLength(1)
    expect(document.pages[0]!.id).toBe('page0')
  })

  it('returns an empty document rather than throwing on junk input', () => {
    const document = parseMindmapHtml('<html><body>没有画布</body></html>')
    expect(document.pages).toEqual([])
    expect(htmlMindmapOutline(document)).toEqual([])
  })

  it.skipIf(!fs.existsSync(REAL))('parses the real multi-page export', () => {
    const document = parseMindmapHtml(fs.readFileSync(REAL, 'utf8'))
    // 4 个子页面
    expect(document.pages).toHaveLength(4)
    expect(document.pages.map((page) => page.id)).toEqual(['page0', 'page1', 'page2', 'page3'])
    // 每页都要有尺寸与文字
    for (const page of document.pages) {
      expect(page.width).toBeGreaterThan(1000)
      expect(page.height).toBeGreaterThan(100)
      expect(page.texts.length).toBeGreaterThan(50)
    }
    // 首页是「主内容」，文字最多
    expect(document.pages[0]!.texts.length).toBeGreaterThan(1000)
    const outline = htmlMindmapOutline(document)
    expect(outline.length).toBeGreaterThan(3000)
    // 图形必须是矢量 path，不是位图
    expect(document.pages[0]!.svg).toContain('<path')
    expect(document.pages[0]!.svg).not.toContain('<img')
  })
})
