/**
 * EdrawMind 导出的 HTML 解析。
 *
 * 为什么需要这条路：新版 .emmx 把画布存成 mmpage/*.bin 私有二进制，没有公开
 * 规范，实测无法可靠还原图形（坐标不是标准 float32/int32，页面尺寸等已知值
 * 也定位不到）。而 EdrawMind 导出的 HTML 里，每个子页面就是一个现成的 <svg>，
 * 图形由 EdrawMind 自己渲染，100% 准确，且没有任何外部依赖、可完全离线显示。
 *
 * 实测（「铸形骸，灯心性，启天命26907」）：
 * - 4 个子页面 = 4 个 <svg id="page0..3">
 * - 5689 个 <path>，7262 段可搜索文字
 * - 0 个外部 <script src> / <link>，离线可用
 */

/** HTML 里的一个子页面 */
export interface HtmlMindmapPage {
  /** svg 的 id，如 page0 */
  id: string
  /** 页面标题：HTML 里没有显式页名，用序号兜底，界面可再命名 */
  title: string
  width: number
  height: number
  /** 该页面的 svg 原文（已剥离外部引用） */
  svg: string
  /** 该页面的全部文字，供搜索与大纲 */
  texts: string[]
}

export interface HtmlMindmapDocument {
  title: string
  author?: string
  pages: HtmlMindmapPage[]
  modifiedAt?: string
}

/**
 * 应用内置的字体栈，与界面、以及 .emmx 解析出的导图保持一致。
 *
 * 见 renderer/src/main.tsx 的 @font-face：这几个字体随程序打包，不依赖系统。
 */
const APP_FONT_STACK = "'SF Pro Text', 'SF Pro Display', 'PingFang SC', 'Segoe UI', sans-serif"

/**
 * 把 svg 内嵌 `<style>` 里的 font-family 统一换成应用字体。
 *
 * 0.7.8：EdrawMind 的 HTML 导出把字体写在 CSS 类里，用的却是**系统字体名**
 * ——实测同一份文件里就有 `苹方 粗体`、`.萍方-简`（原文如此，带前导点）、
 * `微软雅黑`、`方正黑体简体` 四种。这些名字在 Windows 上要么匹配不到、
 * 要么落到字形不同的替代字体上，于是导图文字与界面明显不一致
 * （用户反馈「html 格式文件打开后，字体需要默认为应用字体」）。
 *
 * 只替换 font-family 的值，其余声明（fill / font-size / font-weight）原样保留：
 * 颜色和字号是用户自己在导图里设的，必须尊重。
 */
function applyAppFont(svg: string): string {
  return (
    svg
      // CSS 形式：font-family:苹方 粗体  /  font-family: 微软雅黑;
      .replace(/(\bfont-family\s*:\s*)([^;}]+)/gi, (_all, head: string) => `${head}${APP_FONT_STACK}`)
      // 属性形式：font-family="苹方 粗体"（导出的 svg 目前没用，兜住以防格式变化）
      .replace(/(\bfont-family\s*=\s*")([^"]*)(")/gi, (_all, head: string, _v: string, tail: string) =>
        `${head}${APP_FONT_STACK}${tail}`
      )
  )
}

/** 从 svg 的 viewBox / width / height 里取出尺寸 */
function readSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="([-\d.\s]+)"/)
  if (viewBox) {
    const parts = viewBox[1]!.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { width: Math.abs(parts[2]!), height: Math.abs(parts[3]!) }
    }
  }
  const width = svg.match(/\bwidth="([\d.]+)(?:px)?"/)
  const height = svg.match(/\bheight="([\d.]+)(?:px)?"/)
  return {
    width: width ? Number(width[1]) : 0,
    height: height ? Number(height[1]) : 0
  }
}

/**
 * 取出一个 svg 里的全部可见文字。
 *
 * EdrawMind 把文字放在 <tspan> 或 <text> 里，同一个节点常被拆成多个 tspan
 * （逐字排版），所以按元素收集后去重，避免同一句话出现几十遍。
 */
function readSvgTexts(svg: string): string[] {
  const seen = new Set<string>()
  const texts: string[] = []
  const push = (raw: string): void => {
    const text = raw
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || text.length > 300) return
    if (seen.has(text)) return
    seen.add(text)
    texts.push(text)
  }
  for (const match of svg.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) push(match[1]!)
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) push(match[1]!)
  return texts
}

/** 取 HTML 里某个容器元素内的纯文字 */
function readMeta(html: string, id: string): string | undefined {
  // 元素内容里通常还嵌着 <div class="text"> 之类，所以要多读一段再剥标签
  const match = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]{0,400}?)</div>\\s*</div>`))
  const raw = match?.[1] ?? html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]{0,200}?)<`))?.[1]
  if (!raw) return undefined
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || undefined
}

/**
 * 解析 EdrawMind 导出的 HTML。
 *
 * 只取每个子页面的 <svg>，其余（页头、版权、内嵌脚本）都丢掉——
 * 界面上由软件自己的外壳提供标题栏与工具条，样式才统一。
 */
export function parseMindmapHtml(html: string): HtmlMindmapDocument {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '未命名导图'
  const author = readMeta(html, 'author-name')
  const modifiedAt = readMeta(html, 'share-time')

  const pages: HtmlMindmapPage[] = []
  // 逐个抓 <svg id="pageN"> ... </svg>；用非贪婪匹配到最近的 </svg>
  const svgPattern = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/g
  let match: RegExpExecArray | null
  let index = 0
  while ((match = svgPattern.exec(html))) {
    const attrs = match[1]!
    const body = match[2]!
    const id = attrs.match(/id="([^"]*)"/)?.[1] ?? `page${index}`
    // 字体统一成应用字体：导出的 svg 用的是「苹方 粗体」「微软雅黑」这类
    // 系统字体名，Windows 上匹配不到就会退回默认字体，与界面不一致
    const full = applyAppFont(`<svg${attrs}>${body}</svg>`)
    const size = readSvgSize(full)
    // 尺寸为 0 的 svg 通常是图标之类，跳过
    if (!size.width || !size.height) continue
    // EdrawMind 把画布名写在自定义命名空间属性 ed:name 里
    // （如 ed:name="主内容"、"待探索调查"）；取不到才退回序号
    const pageName = attrs.match(/\bed:name="([^"]*)"/)?.[1]?.trim()
    pages.push({
      id,
      title: pageName || `画布 ${index}`,
      width: Math.round(size.width),
      height: Math.round(size.height),
      svg: full,
      texts: readSvgTexts(full)
    })
    index += 1
  }

  return { title, author, modifiedAt, pages }
}

/** 全部子页面的文字，供搜索使用 */
export function htmlMindmapOutline(document: HtmlMindmapDocument): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const page of document.pages) {
    for (const text of page.texts) {
      if (seen.has(text)) continue
      seen.add(text)
      lines.push(text)
    }
  }
  return lines
}
