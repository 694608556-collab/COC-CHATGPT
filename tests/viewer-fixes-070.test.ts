import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMindmapHtml } from '../src/shared/mindmap-html'
import { samplePath } from './sample-files'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const REAL_HTML = samplePath('铸形骸html')

describe('0.7.0 viewer fixes', () => {
  const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('3. centers the view when opening and when switching sub-pages', () => {
    expect(viewer).toContain('centerView')
    // 居中 = 滚动到内容中点
    expect(viewer).toContain('(body.scrollWidth - body.clientWidth) / 2')
    expect(viewer).toContain('(body.scrollHeight - body.clientHeight) / 2')
    // 首次打开与切换子页面都要调用（都包在 setTimeout 里等布局完成）
    const calls = viewer.match(/setTimeout\(centerView/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // 打开时不再停在 0,0
    expect(viewer).not.toContain('scrollTop = 0')
  })

  it('4. reads the real sub-page names from ed:name', () => {
    const source = read('src/shared/mindmap-html.ts')
    expect(source).toContain('ed:name')
    // 取不到才退回序号
    expect(source).toContain('画布 ${index}')
    // 解析结果里 title 用的是页面名而不是 id
    const html = `<html><head><title>t</title></head><body>
      <svg id="page0" ed:name="主内容" viewBox="0 0 800 600"><text><tspan>甲</tspan></text></svg>
      <svg id="page1" ed:name="卷宗" viewBox="0 0 400 300"><text><tspan>乙</tspan></text></svg>
      <svg id="page2" viewBox="0 0 300 200"><text><tspan>丙</tspan></text></svg>
    </body></html>`
    const document = parseMindmapHtml(html)
    expect(document.pages.map((page) => page.title)).toEqual(['主内容', '卷宗', '画布 2'])
  })

  it.skipIf(REAL_HTML === undefined)('reads real page names from a genuine export', () => {
    const document = parseMindmapHtml(fs.readFileSync(REAL_HTML!, 'utf8'))
    expect(document.pages.map((page) => page.title)).toEqual([
      '主内容',
      '待探索调查',
      '卷宗',
      '冬蛾相关'
    ])
  })

  it('5. pins the zoom readout so the search box cannot shift', () => {
    // 百分比从按钮改成独立元素
    expect(viewer).toContain('mindmap-zoom')
    expect(viewer).not.toContain('{Math.round(zoom * 100)}%</button>')
    // 渲染顺序：百分比在「缩小」之前。
    // 先剥掉注释再比位置，否则注释里提到的「缩小」会干扰匹配。
    const tools = viewer
      .slice(viewer.indexOf('mindmap-viewer-tools'), viewer.indexOf('mindmap-hits'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const zoomAt = tools.indexOf('mindmap-zoom')
    const outAt = tools.indexOf('缩小')
    const inAt = tools.indexOf('放大')
    expect(zoomAt).toBeGreaterThanOrEqual(0)
    expect(outAt).toBeGreaterThan(0)
    expect(zoomAt).toBeLessThan(outAt)
    expect(outAt).toBeLessThan(inAt)
    // 固定宽度，数字变化不再改变布局
    const rule = styles.slice(styles.indexOf('.mindmap-zoom {'), styles.indexOf('.mindmap-zoom {') + 260)
    expect(rule).toContain('min-width')
    expect(rule).toContain('tabular-nums')
  })

  it('7. keeps toolbar buttons on a single line', () => {
    const rule = styles.slice(styles.indexOf('.mindmap-tab,'), styles.indexOf('.mindmap-tab:hover'))
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('flex: none')
  })
})
