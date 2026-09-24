/**
 * 导图节点搜索：把「命中哪些文字」算成纯数据，界面只负责画高亮与滚动。
 *
 * 为什么单独成模块：查看器里的 SVG 是整块注入的（两种来源：软件自己解析 .emmx
 * 生成的，以及 EdrawMind 导出的 HTML 里现成的），要在这两种结构上做同一套
 * 搜索高亮，就必须先把「第几个 text 元素的第几个 tspan、从第几个字到第几个字」
 * 算清楚。这部分不依赖 DOM，可以单独测。
 *
 * 实测两种格式的差异：
 * - 软件自己生成的：一行一个 <text>，没有 tspan
 * - EdrawMind 导出的：一个 <text> 里可能有多个 <tspan>（每个是一行）
 * 所以统一按「run = 一个可独立高亮的文字段」建模，两种格式都能覆盖。
 */

/** SVG 里一个可独立高亮的文字段 */
export interface SvgTextRun {
  /** 所属 <text> 元素在文档里的序号（从 0 开始） */
  textIndex: number
  /** 该 <text> 内的 <tspan> 序号；没有 tspan 时为 0 */
  spanIndex: number
  /** 该段的完整文字 */
  text: string
}

/** 一处命中 */
export interface SvgTextMatch {
  textIndex: number
  spanIndex: number
  /** 命中在该段文字里的起始字符序号 */
  start: number
  /** 命中在该段文字里的结束序号（不含） */
  end: number
  /** 命中的文字原文 */
  match: string
  /** 该段的完整文字，供结果列表显示上下文 */
  runText: string
}

/** 去掉标签、还原实体后的纯文字 */
function plainText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // &amp; 最后处理，避免 "&amp;quot;" 被解成引号
    .replace(/&amp;/g, '&')
}

/**
 * 按文档顺序取出 SVG 里所有可高亮的文字段。
 *
 * 顺序必须与浏览器 `svg.querySelectorAll('text')` 一致，界面才能用同样的序号
 * 找到对应的 DOM 元素。所以这里只做「按出现顺序扫描」，不做任何重排。
 */
export function extractSvgTextRuns(svg: string): SvgTextRun[] {
  const runs: SvgTextRun[] = []
  let textIndex = 0
  for (const textMatch of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const inner = textMatch[1]!
    const spans = [...inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)]
    if (spans.length) {
      spans.forEach((span, spanIndex) => {
        const text = plainText(span[1]!)
        if (text.trim()) runs.push({ textIndex, spanIndex, text })
      })
    } else {
      const text = plainText(inner)
      if (text.trim()) runs.push({ textIndex, spanIndex: 0, text })
    }
    textIndex += 1
  }
  return runs
}

/**
 * 在一段文字里找出全部命中位置。
 *
 * 大小写不敏感（用户搜「npc」应当命中「NPC」）；允许重叠命中，与浏览器
 * 查找行为一致（搜「aa」在「aaa」里命中两处）。
 */
function findInRun(text: string, needle: string): Array<{ start: number; end: number }> {
  const haystack = text.toLowerCase()
  const found: Array<{ start: number; end: number }> = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    found.push({ start: at, end: at + needle.length })
    // 从下一个字符继续，允许重叠命中
    from = at + 1
  }
  return found
}

/**
 * 在全部文字段里找出命中项，按画布上的出现顺序返回。
 *
 * 顺序就是结果列表的顺序，也是「下一个」按钮的跳转顺序——与浏览器查找一致，
 * 从上到下、从左到右（即 SVG 文档顺序）。
 */
export function findSvgMatches(runs: SvgTextRun[], query: string): SvgTextMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: SvgTextMatch[] = []
  for (const run of runs) {
    for (const hit of findInRun(run.text, needle)) {
      matches.push({
        textIndex: run.textIndex,
        spanIndex: run.spanIndex,
        start: hit.start,
        end: hit.end,
        match: run.text.slice(hit.start, hit.end),
        runText: run.text
      })
    }
  }
  return matches
}

/**
 * 计算「把某个矩形摆到视口正中」所需的滚动位置。
 *
 * 全部用屏幕像素（getBoundingClientRect 的口径）计算，因此缩放天然被考虑进去：
 * 缩放后元素的实际像素位置和尺寸都变了，直接用它们做差即可，不需要另外乘 zoom。
 * 这正是「有时候在画布上完全找不到」的根因——此前按命中序号估算纵向比例，
 * 既没考虑元素真实位置，也没考虑缩放。
 */
export function scrollToCenter(
  target: { left: number; top: number; width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number },
  current: { left: number; top: number }
): { left: number; top: number } {
  // 目标中心相对视口中心的偏移量
  const dx = target.left + target.width / 2 - (viewport.left + viewport.width / 2)
  const dy = target.top + target.height / 2 - (viewport.top + viewport.height / 2)
  return {
    left: Math.max(0, current.left + dx),
    top: Math.max(0, current.top + dy)
  }
}
