import { useEffect, useMemo, useRef, useState } from 'react'
import type { MindmapPreviewApi } from '../../../shared/api'
import type { ModuleRecord, ModuleResource } from '../../../shared/types'
import { CloseIcon } from './Icons'

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

  /** 节点搜索：在当前子页面的文字里找命中项 */
  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || !page) return []
    return page.texts.filter((text) => text.toLowerCase().includes(needle))
  }, [query, page])

  // 命中项变化时回到第一条
  useEffect(() => {
    setHitIndex(0)
  }, [query, pageIndex])

  /** 滚轮缩放：按住 Ctrl 或直接滚都缩放，滚轮向下缩小 */
  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    setZoom((value) => Math.min(8, Math.max(0.15, value * factor)))
  }

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

  /** 把当前命中项滚动到可见位置 */
  const gotoHit = (index: number): void => {
    setHitIndex(index)
    const body = bodyRef.current
    if (!body || !page) return
    // 命中项在 SVG 里的位置未知，这里按命中序号在画布上做纵向定位，
    // 用户可用滚轮/拖拽继续找；比完全不跳转好用。
    const ratio = hits.length > 1 ? index / (hits.length - 1) : 0
    body.scrollTop = (body.scrollHeight - body.clientHeight) * ratio
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
          </div>

          {query.trim() && hits.length > 0 && (
            <div className="mindmap-hits">
              {hits.slice(0, 40).map((text, index) => (
                <button
                  key={`${index}-${text}`}
                  className={index === hitIndex ? 'mindmap-hit active' : 'mindmap-hit'}
                  onClick={() => gotoHit(index)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}

          <div
            className={panning ? 'mindmap-viewer-body panning' : 'mindmap-viewer-body'}
            ref={bodyRef}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endPan}
            onMouseLeave={endPan}
          >
            {page ? (
              /* SVG 由本地解析器从用户自己的导图文件生成 */
              <div
                className="mindmap-canvas"
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
