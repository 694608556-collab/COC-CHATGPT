// 0.7.8：HTML 导图的字体要统一成应用字体
//
// 用户反馈「html 格式文件打开后，字体需要默认为应用字体」。
//
// 根因：EdrawMind 的 HTML 导出把字体写在 <style> 的 CSS 类里，用的是**系统字体名**
// ——实测同一份文件里有 `苹方 粗体`、`.萍方-简`（原文如此，带前导点）、
// `微软雅黑`、`方正黑体简体` 四种。这些名字在 Windows 上要么匹配不到、
// 要么落到字形不同的替代字体上，于是导图文字与界面明显不一致。
//
// 修法：解析时把这些 font-family 统一换成应用内置的字体栈
// （与 .emmx 解析、界面用的是同一套）。
import { describe, expect, it } from 'vitest'
import { parseMindmapHtml } from '../src/shared/mindmap-html'

/** 应用内置字体栈，与 src/shared/emmx.ts、renderer/src/main.tsx 一致 */
const APP_STACK = "'SF Pro Text', 'SF Pro Display', 'PingFang SC', 'Segoe UI', sans-serif"

/** 造一份最小可解析的 EdrawMind 风格 HTML 导出 */
function htmlExport(styleRules: string, extra = ''): string {
  return `<!doctype html><html><head><title>测试导图</title><style>body{margin:0}</style></head><body>
  <svg id="page0" ed:name="主内容" viewBox="0 0 400 200" width="400" height="200">
    <style type="text/css"><![CDATA[
      ${styleRules}
    ]]></style>
    <g id="1"><text class="st1"><tspan style="white-space:pre" x="10" y="20">节点一</tspan></text></g>
    ${extra}
  </svg>
  </body></html>`
}

describe('0.7.8 html export uses the application font', () => {
  it('replaces system font names in the svg style block', () => {
    const doc = parseMindmapHtml(
      htmlExport('.st1 {fill:#000000;font-family:苹方 粗体;font-size:10pt}')
    )
    const svg = doc.pages[0]!.svg
    expect(svg).toContain(APP_STACK)
    expect(svg, '不该残留系统字体名').not.toContain('苹方')
  })

  it('handles every system font name that real exports actually contain', () => {
    // 实测同一份导出里有这四种写法，其中 `.萍方-简` 带前导点（EdrawMind 原文如此）
    const doc = parseMindmapHtml(
      htmlExport(
        [
          '.st1 {fill:#000000;font-family:.萍方-简;font-size:10pt}',
          '.st2 {fill:#000000;font-family:苹方 粗体;font-size:12pt}',
          '.st3 {fill:#303030;font-family:微软雅黑;font-size:12pt}',
          '.st4 {fill:#303030;font-family:方正黑体简体;font-size:10pt}'
        ].join('\n')
      )
    )
    const svg = doc.pages[0]!.svg
    for (const name of ['苹方', '萍方', '微软雅黑', '方正黑体']) {
      expect(svg, `不该残留「${name}」`).not.toContain(name)
    }
    // 四条规则都换成了应用字体
    expect([...svg.matchAll(/font-family\s*:/g)]).toHaveLength(4)
    expect([...svg.matchAll(new RegExp(APP_STACK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]).toHaveLength(4)
  })

  it('keeps colour, size and weight the user set in the map', () => {
    // 字体换成应用的，但颜色/字号/字重是用户在导图里设的，必须原样保留
    const doc = parseMindmapHtml(
      htmlExport('.st7 {fill:#ff0000;font-family:微软雅黑;font-size:14pt;font-weight:bold}')
    )
    const svg = doc.pages[0]!.svg
    expect(svg).toContain('fill:#ff0000')
    expect(svg).toContain('font-size:14pt')
    expect(svg).toContain('font-weight:bold')
  })

  it('also rewrites the font-family attribute form', () => {
    // 导出的 svg 目前只用 CSS 类，但属性写法也兜住，以防格式变化
    const doc = parseMindmapHtml(
      htmlExport('.st1 {fill:#000}', '<text font-family="微软雅黑">属性写法</text>')
    )
    const svg = doc.pages[0]!.svg
    expect(svg).not.toContain('微软雅黑')
    expect(svg).toContain(`font-family="${APP_STACK}"`)
  })

  it('does not touch other font-family declarations outside the svg', () => {
    // 只改 svg 里的：页面外壳的样式我们本来就丢弃，不该影响解析结果
    const doc = parseMindmapHtml(
      htmlExport('.st1 {fill:#000;font-family:微软雅黑}', '<text class="st1">文字</text>')
    )
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0]!.texts).toContain('文字')
  })

  it('keeps text extraction working after the rewrite', () => {
    // 换字体不能把文字弄丢
    const doc = parseMindmapHtml(
      htmlExport('.st1 {fill:#000000;font-family:苹方 粗体;font-size:10pt}')
    )
    expect(doc.pages[0]!.texts).toContain('节点一')
  })

  it('works on every page, not just the first', () => {
    const html = `<!doctype html><html><head><title>多页</title></head><body>
      <svg id="page0" viewBox="0 0 100 100" width="100" height="100">
        <style>.st1{font-family:苹方 粗体;fill:#000}</style><text class="st1">第一页</text></svg>
      <svg id="page1" viewBox="0 0 100 100" width="100" height="100">
        <style>.st1{font-family:微软雅黑;fill:#000}</style><text class="st1">第二页</text></svg>
      </body></html>`
    const doc = parseMindmapHtml(html)
    expect(doc.pages).toHaveLength(2)
    for (const page of doc.pages) {
      expect(page.svg).toContain(APP_STACK)
      expect(page.svg).not.toMatch(/苹方|微软雅黑/)
    }
  })
})
