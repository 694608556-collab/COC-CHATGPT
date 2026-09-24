import { useEffect, useMemo, useRef, useState } from 'react'
import type { MindmapPreviewApi } from '../../../shared/api'
import type { ModuleRecord, ModuleResource } from '../../../shared/types'
import { extractSvgTextRuns, findSvgMatches, scrollToCenter } from '../../../shared/mindmap-search'
import { CloseIcon } from './Icons'

/** 高亮矩形的 class，用于每次重绘前清理旧标记 */
const HIT_MARK = 'mindmap-hit-mark'

/**
 * 把命中项画成画布上的高亮底色。
 *
 * 高亮矩形直接插进 SVG，用的是 SVG 自己的用户坐标（由 getStartPositionOfChar
 * 得到），因此缩放时与文字一起等比缩放，不需要在缩放后重算——这也是「就算
 * 找到了也没有高亮」的修法：此前只在结果列表里标了当前项，画布上没有任何标记。
 *
 * 矩形插在 <text> 之前，保证画在文字底下，不遮字。
 */
function paintHighlights(
  canvas: HTMLElement,
  matches: Array<{ textIndex: number; spanIndex: number; start: number; end: number }>,
  currentIndex: number
): void {
  const svg = canvas.querySelector('svg')
  if (!svg) return
  // 先清掉上一次的高亮
  for (const old of [...svg.querySelectorAll(`.${HIT_MARK}`)]) old.remove()

  const textElements = [...svg.querySelectorAll('text')]
  matches.forEach((match, index) => {
    const textElement = textElements[match.textIndex]
    if (!textElement) return
    // 与 extractSvgTextRuns 的口径一致：有 tspan 就取 tspan，否则用 text 本身
    const spans = [...textElement.querySelectorAll('tspan')]
    const element = spans.length ? spans[match.spanIndex] : textElement
    if (!element) return

    let geometry: { x: number; width: number; y: number; height: number }
    try {
      // getStartPositionOfChar / getEndPositionOfChar 返回该元素用户坐标下的位置，
      // 与文字实际渲染位置一致（含 tspan 自身的 x/y 偏移）
      const start = element.getStartPositionOfChar(match.start)
      const end = element.getEndPositionOfChar(Math.max(match.start, match.end - 1))
      const box = element.getBBox()
      // 底色高度取「字号 × 1.15」并围绕文字视觉中心摆放。
      // 不能直接用 getBBox().height：那是字形的紧包围盒，不同字（有无下伸部）
      // 高度不一，多行命中时底色会高低不齐、相邻行还会连成一片。
      const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 12
      const height = fontSize * 1.15
      const centerY = box.height ? box.y + box.height / 2 : start.y - fontSize * 0.35
      geometry = {
        x: start.x,
        width: Math.max(1, end.x - start.x),
        y: centerY - height / 2,
        height
      }
    } catch {
      // 个别浏览器对空文字段会抛错，跳过这一处高亮，不影响其它命中
      return
    }

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(geometry.x))
    rect.setAttribute('y', String(geometry.y))
    rect.setAttribute('width', String(geometry.width))
    rect.setAttribute('height', String(geometry.height))
    rect.setAttribute('rx', '2')
    rect.setAttribute('class', index === currentIndex ? `${HIT_MARK} current` : HIT_MARK)
    // 插在文字所在元素之前：画在字底下
    const host = spans.length ? textElement : element
    host.parentNode?.insertBefore(rect, host)
  })
}

/**
 * 导图查看器。
 *
 * 用矢量 SVG 显示而不是文件自带的缩略图：缩略图只有 210px 左右，
 * 而导图内容区动辄 5000px 以上，放大后完全糊掉。矢量图放多大都清晰。
 *
 * 0.7.0：
 * - 支持滚轮缩放与左键拖拽平移
 * - 顶部提供节点搜索，命中项可逐条跳转
 * - 多个子页面（HTML 导出的每个画布）在底部以按钮切换
 * - 图形区与工具条的层叠关系修正，按钮边框不再残留在画布上
 *
 * 0.7.1：搜索对齐浏览器查找——画布上全部命中黄底高亮、当前命中橙底高亮，
 * 点结果把该处滚到画布正中（按实际像素计算，缩放不影响定位）。
 */
export function MindmapViewer({
  resource,
  data,
  modules,
  onClose,
  onEdit,
  onNotice
}: {
  resource: ModuleResource
  data: MindmapPreviewApi
  modules: ModuleRecord[]
  onClose(): void
  onEdit(): void
  onNotice(text: string): void
}): React.JSX.Element {
  const [tab, setTab] = useState<'map' | 'outline'>('map')
  const [pageIndex, setPageIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  // 拖拽平移：记录按下时的位置与当时的滚动偏移
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
  const [panning, setPanning] = useState(false)

  const page = data.pages[pageIndex]

  // Esc 关闭。用 document 级键盘监听，免得干扰其他输入框
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * 把视口移到内容中心。
   *
   * 导图内容往往不在画布左上角（例如 7257×5928 的画布，内容从 x≈1100 开始），
   * 打开时停在 0,0 会看到大片空白，用户得自己缩放拖拽才能找到内容。
   */
  const centerView = (): void => {
    const body = bodyRef.current
    if (!body) return
    body.scrollLeft = Math.max(0, (body.scrollWidth - body.clientWidth) / 2)
    body.scrollTop = Math.max(0, (body.scrollHeight - body.clientHeight) / 2)
  }

  // 切换子页面时回到 100% 并居中。
  // 各子页面尺寸差异很大（实测 8101×19290 与 8101×1564），
  // 不重置缩放的话上一页的比例会套到尺寸完全不同的另一页上。
  useEffect(() => {
    setZoom(1)
    // 等浏览器按新尺寸布局完再定位，否则 scrollWidth 还是旧值
    const timer = window.setTimeout(centerView, 0)
    return () => window.clearTimeout(timer)
  }, [pageIndex])

  // 首次打开也居中
  useEffect(() => {
    const timer = window.setTimeout(centerView, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const owner = resource.moduleId
    ? (modules.find((module) => module.id === resource.moduleId)?.name ?? '未知模组')
    : '未归属模组'

  /**
   * 节点搜索。
   *
   * 直接在画布的 SVG 上找：把每个 <text>/<tspan> 当成一个可高亮的文字段，
   * 命中的位置精确到「第几段、第几个字」，界面据此画黄底/橙底高亮。
   * 比 0.7.0 只列文字更接近浏览器查找的体验。
   */
  const runs = useMemo(() => (page ? extractSvgTextRuns(page.svg) : []), [page])
  const hits = useMemo(() => findSvgMatches(runs, query), [runs, query])

  // 命中项变化时回到第一条
  useEffect(() => {
    setHitIndex(0)
  }, [query, pageIndex])

  /** 画布内容变化或命中项变化时重绘高亮 */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || tab !== 'map') return
    // 等 React 把新的 SVG 写进 DOM 之后再画标记
    const timer = window.setTimeout(() => paintHighlights(canvas, hits, hitIndex), 0)
    return () => window.clearTimeout(timer)
  }, [hits, hitIndex, tab, pageIndex, page])

  /**
   * 滚轮：默认上下滚动，Ctrl（或 ⌘）+ 滚轮才缩放。
   *
   * 0.7.6 之前是「滚轮一律缩放」，用户反馈「缩放会同时影响滚动条」。
   * 根因有两层：
   *  1. 逻辑上缩放改了画布尺寸、滚动位置却没跟着调，看起来就是两个一起动；
   *  2. **React 17 起把 onWheel 注册成 passive 监听**，在它里面调用
   *     preventDefault() 是无效的（浏览器只会在控制台警告一句），
   *     所以「拦下滚轮、只缩放」这件事根本没生效，原生滚动照常发生。
   *
   * 因此这里不用 React 的 onWheel，改用 addEventListener 显式传
   * `{ passive: false }`，preventDefault 才真的能拦住原生滚动。
   *
   * 缩放以鼠标位置为锚点：先记下光标在内容里的比例位置，缩放后把滚动位置
   * 调到同一比例，光标下那一点就留在原地（否则放大后画面会跑掉）。
   */
  useEffect(() => {
    const body = bodyRef.current
    if (!body || tab !== 'map') return

    const onWheel = (event: WheelEvent): void => {
      // 没按 Ctrl/⌘ 就完全不干预，交给浏览器原生滚动
      if (!event.ctrlKey && !event.metaKey) return
      // 必须能拦住：否则会一边缩放一边滚动
      event.preventDefault()
      const el = bodyRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      // 光标在「整个可滚动内容」里的相对位置（0~1）
      const ratioX = (event.clientX - rect.left + el.scrollLeft) / Math.max(1, el.scrollWidth)
      const ratioY = (event.clientY - rect.top + el.scrollTop) / Math.max(1, el.scrollHeight)
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top

      setZoom((value) => {
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
        const next = Math.min(8, Math.max(0.15, value * factor))
        if (next === value) return value
        // 等 React 按新尺寸重排完再对齐滚动位置，否则 scrollWidth 还是旧值
        window.requestAnimationFrame(() => {
          const node = bodyRef.current
          if (!node) return
          node.scrollLeft = ratioX * node.scrollWidth - offsetX
          node.scrollTop = ratioY * node.scrollHeight - offsetY
        })
        return next
      })
    }

    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  }, [tab, pageIndex, page])

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    // 只响应左键；在滚动容器上按下即开始平移
    if (event.button !== 0) return
    const body = bodyRef.current
    if (!body) return
    panRef.current = { x: event.clientX, y: event.clientY, left: body.scrollLeft, top: body.scrollTop }
    setPanning(true)
  }

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    const body = bodyRef.current
    const start = panRef.current
    if (!body || !start) return
    body.scrollLeft = start.left - (event.clientX - start.x)
    body.scrollTop = start.top - (event.clientY - start.y)
  }

  const endPan = (): void => {
    panRef.current = undefined
    setPanning(false)
  }

  const exportOutline = async (): Promise<void> => {
    if (!resource.path) return
    try {
      const saved = await window.coc.resources.exportOutline(resource.path, resource.title || '导图大纲')
      onNotice(`大纲已导出：${saved}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '导出大纲失败')
    }
  }

  /**
   * 跳到第 index 处命中，并把它摆到画布正中。
   *
   * 定位靠元素的实际像素位置（getBoundingClientRect），所以缩放多少都不影响
   * ——放大会同时放大元素位置与尺寸，直接按像素差滚动即可。
   */
  const gotoHit = (index: number): void => {
    setHitIndex(index)
    const body = bodyRef.current
    const canvas = canvasRef.current
    if (!body || !canvas) return
    const svg = canvas.querySelector('svg')
    const match = hits[index]
    if (!svg || !match) return

    const textElements = [...svg.querySelectorAll('text')]
    const textElement = textElements[match.textIndex]
    if (!textElement) return
    const spans = [...textElement.querySelectorAll('tspan')]
    const element = spans.length ? spans[match.spanIndex] : textElement
    if (!element) return

    let rect: DOMRect
    try {
      const start = element.getStartPositionOfChar(match.start)
      const end = element.getEndPositionOfChar(Math.max(match.start, match.end - 1))
      // 用 SVG 的坐标变换把用户坐标换算成屏幕坐标，缩放已包含在变换里
      const matrix = element.getScreenCTM()
      if (!matrix) return
      const point = svg.createSVGPoint()
      point.x = start.x
      point.y = start.y
      const screenStart = point.matrixTransform(matrix)
      point.x = end.x
      const screenEnd = point.matrixTransform(matrix)
      rect = new DOMRect(
        screenStart.x,
        screenStart.y - 10,
        Math.max(2, screenEnd.x - screenStart.x),
        20
      )
    } catch {
      return
    }

    const bodyRect = body.getBoundingClientRect()
    const next = scrollToCenter(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { left: bodyRect.left, top: bodyRect.top, width: bodyRect.width, height: bodyRect.height },
      { left: body.scrollLeft, top: body.scrollTop }
    )
    body.scrollTo({ left: next.left, top: next.top, behavior: 'smooth' })
  }

  return (
    <div className="mindmap-viewer" role="dialog" aria-modal="true" aria-label={`导图 ${resource.title}`}>
      <header className="mindmap-viewer-head">
        <span className="mindmap-viewer-name" title={resource.title}>
          {resource.title || resource.path}
        </span>
        <span className="mindmap-viewer-meta">
          {owner}
          {page ? ` · ${page.width} × ${page.height} · ${page.textCount} 个节点` : ''}
          {data.format === 'html' ? ' · 网页导出' : ''}
          {data.modifiedAt ? ` · 改于 ${data.modifiedAt}` : ''}
        </span>
        <span className="spacer" />
        <span className="mindmap-tabs">
          <button
            className={tab === 'map' ? 'mindmap-tab active' : 'mindmap-tab'}
            onClick={() => setTab('map')}
          >
            导图
          </button>
          <button
            className={tab === 'outline' ? 'mindmap-tab active' : 'mindmap-tab'}
            onClick={() => setTab('outline')}
          >
            大纲显示
          </button>
        </span>
        <button className="mindmap-action" onClick={exportOutline}>
          导出大纲
        </button>
        <button className="mindmap-action" onClick={onEdit}>
          用 EdrawMind 打开
        </button>
        <button className="icon-button mindmap-close" aria-label="关闭预览" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      {tab === 'map' ? (
        <>
          <div className="mindmap-viewer-tools">
            <span className="mindmap-search">
              <input
                type="search"
                className="mindmap-search-input"
                aria-label="在当前导图内搜索节点文字"
                placeholder="节点内容搜索框"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.trim() && (
                <>
                  <span className="mindmap-search-count">
                    {hits.length ? `${hitIndex + 1} / ${hits.length}` : '无匹配'}
                  </span>
                  <button
                    className="mindmap-action"
                    disabled={!hits.length}
                    onClick={() => gotoHit((hitIndex + 1) % Math.max(1, hits.length))}
                  >
                    下一个
                  </button>
                </>
              )}
            </span>
            <span className="spacer" />
            {/* 百分比放在「缩小」左边，并给固定宽度：数字从 100% 变成 112%
                时宽度不变，搜索框才不会被挤得一跳一跳 */}
            <span className="mindmap-zoom" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <button className="mindmap-action" onClick={() => setZoom((value) => Math.max(0.15, value / 1.25))}>
              缩小
            </button>
            <button className="mindmap-action" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}>
              放大
            </button>
            <button className="mindmap-action" onClick={() => setZoom(1)}>
              适应
            </button>
            {/* 滚轮的行为变了（0.7.6 起默认滚动、Ctrl+滚轮才缩放），
                在界面上写一句，免得用户以为缩放坏了 */}
            <span className="mindmap-hint" title="滚轮上下滚动，按住 Ctrl 滚动可缩放">
              Ctrl + 滚轮缩放
            </span>
          </div>

          {query.trim() && hits.length > 0 && (
            <div className="mindmap-hits">
              {hits.slice(0, 40).map((hit, index) => (
                <button
                  key={`${hit.textIndex}-${hit.spanIndex}-${hit.start}`}
                  className={index === hitIndex ? 'mindmap-hit active' : 'mindmap-hit'}
                  onClick={() => gotoHit(index)}
                >
                  {/* 关键词在结果里也标出来，扫一眼就知道命中在哪 */}
                  {hit.start > 12 && '…'}
                  {hit.runText.slice(Math.max(0, hit.start - 12), hit.start)}
                  <mark className="mindmap-hit-word">{hit.match}</mark>
                  {hit.runText.slice(hit.end, hit.end + 18)}
                  {hit.runText.length > hit.end + 18 && '…'}
                </button>
              ))}
            </div>
          )}

          <div
            className={panning ? 'mindmap-viewer-body panning' : 'mindmap-viewer-body'}
            ref={bodyRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endPan}
            onMouseLeave={endPan}
          >
            {page ? (
              /* SVG 由本地解析器从用户自己的导图文件生成 */
              <div
                className="mindmap-canvas"
                ref={canvasRef}
                style={{
                  width: Math.round(page.width * zoom),
                  height: Math.round(page.height * zoom)
                }}
                dangerouslySetInnerHTML={{ __html: page.svg }}
              />
            ) : (
              <p className="resource-group-empty">这张导图没有可显示的画布。</p>
            )}
          </div>

          {/* 多子页面：按钮放在底部，点击切换 */}
          {data.pages.length > 1 && (
            <div className="mindmap-pages">
              {data.pages.map((item, index) => (
                <button
                  key={item.name}
                  className={index === pageIndex ? 'mindmap-page active' : 'mindmap-page'}
                  onClick={() => setPageIndex(index)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mindmap-viewer-body outline-view">
          {/* 层级直接从文件读取，不需要另外导出 markdown */}
          <ul className="mindmap-outline">
            {data.outline.map((line, index) => (
              <li
                key={`${index}-${line.text}`}
                className="mindmap-outline-line"
                style={{ paddingLeft: `${line.depth * 18 + 8}px` }}
              >
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
