import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FilterPreset, SessionRecord } from '../../../../../src/shared/types'
import { compileBodyQuery, matchRanges, recordMessages, searchExcerpt } from '../../../data/search'
import { SystemMessage } from '../SystemMessage'
import { SearchInput } from '../SearchInput'

function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query)
  let previous = 0
  return (
    <>
      {ranges.map(({ start, end }) => {
        const prefix = text.slice(previous, start)
        previous = end
        return (
          <Fragment key={start}>
            {prefix}
            <mark>{text.slice(start, end)}</mark>
          </Fragment>
        )
      })}
      {text.slice(previous)}
    </>
  )
}

/** Search keeps the full filtered context; jumping selects the page containing the original message. */
export function LogReader(props: {
  record: SessionRecord
  initialQuery?: string
  preset: FilterPreset
  busy: boolean
  onBack(): void
  onEdit(): void
  onFetch(): void
  onReset(): void
  /** 请求删除当前场次；父级负责确认及事务保护，无返回值。 */
  onDelete(): void
  onExport(filters: FilterPreset): void
  onExportMore(filters: FilterPreset): void
}) {
  const filters = props.preset
  const [query, setQuery] = useState(props.initialQuery ?? '')
  const [submittedQuery, setSubmittedQuery] = useState(props.initialQuery ?? '')
  const initialJump = useRef(!!props.initialQuery)
  const [page, setPage] = useState(0)
  const [selectedHit, setSelectedHit] = useState<number | null>(null)
  const [resultPage, setResultPage] = useState(0)
  const [jumpRequest, setJumpRequest] = useState<{ index: number; serial: number }>()
  const messageNodes = useRef(new Map<number, HTMLElement>())
  const needle = submittedQuery.trim()
  const matcher = useMemo(() => compileBodyQuery(needle), [needle])
  const messages = useMemo(() => recordMessages(props.record, filters), [props.record, filters])
  const hits = useMemo(
    () =>
      needle
        ? messages.reduce<number[]>((found, message, index) => {
            if (matcher.has(message.header) || matcher.has(message.text)) found.push(index)
            return found
          }, [])
        : [],
    [messages, needle, matcher]
  )
  const pages = Math.max(1, Math.ceil(messages.length / 100))
  const currentPage = Math.min(page, pages - 1)
  // 正文切页提交后回顶；搜索切页由下方命中定位负责，避免覆盖搜索目标。
  // 不依赖输入词/命中请求变化，普通阅读和清空搜索不会触发回顶。
  useLayoutEffect(() => {
    if (!jumpRequest) window.scrollTo(0, 0)
  }, [props.record.id, currentPage])
  const resultPages = Math.max(1, Math.ceil(hits.length / 20))
  const hasBody = !!props.record.rawContent || props.record.manualContent !== undefined
  function resetSearchPosition() {
    setSelectedHit(null)
    setResultPage(0)
    setJumpRequest(undefined)
  }
  /** @param value 新输入文本。 @returns 无返回值；取消已提交搜索及定位，等待下一次主动提交。 */
  function editSearch(value: string) {
    setQuery(value)
    setSubmittedQuery('')
    initialJump.current = false
    resetSearchPosition()
  }
  /** @returns 无返回值；提交完整词后由命中更新定位首条，重复提交则回到当前首条。 */
  function submitSearch() {
    if (!query.trim()) return
    if (query.trim() === needle) {
      jump(0)
      return
    }
    initialJump.current = true
    resetSearchPosition()
    setSubmittedQuery(query)
  }
  function jump(hit: number) {
    const index = hits[hit]
    if (index === undefined) return
    setSelectedHit(hit)
    setResultPage(Math.floor(hit / 20))
    setPage(Math.floor(index / 100))
    setJumpRequest((previous) => ({ index, serial: (previous?.serial ?? 0) + 1 }))
  }
  useEffect(() => {
    if (initialJump.current) {
      initialJump.current = false
      jump(0)
    }
  }, [hits, needle])
  useEffect(() => {
    if (!jumpRequest) return
    const node = messageNodes.current.get(jumpRequest.index)
    if (node) {
      node.focus({ preventScroll: true })
      node.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [jumpRequest, currentPage])
  return (
    <>
      <div className="reader-actions">
        <button onClick={props.onBack}>返回场次</button>
        <button disabled={props.busy} onClick={props.onEdit}>
          编辑场次
        </button>
        <button className="primary" disabled={props.busy || !hasBody} onClick={() => props.onExport(filters)}>
          导出 TXT
        </button>
        <button disabled={props.busy || !hasBody} onClick={() => props.onExportMore(filters)}>
          更多导出格式
        </button>
      </div>
      <div className="entity-actions">
        {props.record.sourceType === 'online' && (
          <>
            <button disabled={props.busy} onClick={props.onFetch}>
              获取/刷新正文
            </button>
            <button disabled={props.busy} onClick={props.onReset}>
              重置链接状态
            </button>
          </>
        )}
        <button className="danger" disabled={props.busy} onClick={props.onDelete}>
          删除场次
        </button>
      </div>
      <section className="panel">
        <h2>{props.record.name}</h2>
        <p>
          {props.record.playDate || '日期未填写'} · {hasBody ? '本机已保存' : '未带正文'}
        </p>
        {props.record.link && <p className="source-link">来源：{props.record.link}</p>}
        {!hasBody && (
          <SystemMessage
            kind="warning"
            message="此场次尚未保存正文。在线场次可获取正文，手动场次可通过编辑填写正文。"
          />
        )}
      </section>
      {hasBody && (
        <>
          <form
            className="reader-search"
            onSubmit={(e) => {
              e.preventDefault()
              submitSearch()
            }}
          >
            <label className="field">
              搜索整场正文
              <SearchInput
                value={query}
                submitted={!!needle}
                label="搜索整场正文"
                searchLabel="搜索整场正文"
                clearLabel="清空正文搜索"
                placeholder="发言者或正文文字"
                onChange={editSearch}
              />
            </label>
          </form>
          {needle && (
            <section className="panel search-results" aria-label="搜索结果">
              <p role="status">
                匹配 {hits.length} 条{selectedHit !== null ? ' · 当前第 ' + (selectedHit + 1) + ' 条' : ''}
                。按当前过滤条件搜索。
              </p>
              {!hits.length ? (
                <p>没有找到匹配内容，可修改关键词，或到数据与设置调整隐藏规则。</p>
              ) : (
                <>
                  <div className="edit-actions">
                    <button
                      disabled={selectedHit === null || selectedHit === 0}
                      onClick={() => jump((selectedHit ?? 0) - 1)}
                    >
                      上一处
                    </button>
                    <button
                      disabled={selectedHit !== null && selectedHit >= hits.length - 1}
                      onClick={() => jump(selectedHit === null ? 0 : selectedHit + 1)}
                    >
                      下一处
                    </button>
                  </div>
                  {hits.slice(resultPage * 20, (resultPage + 1) * 20).map((index, offset) => {
                    const hit = resultPage * 20 + offset
                    const message = messages[index]!
                    return (
                      <button
                        className="search-result"
                        key={index}
                        aria-current={selectedHit === hit ? 'location' : undefined}
                        onClick={() => jump(hit)}
                      >
                        <span>
                          结果 {hit + 1} · 正文第 {Math.floor(index / 100) + 1} 页
                        </span>
                        <span>
                          <Highlight
                            text={searchExcerpt(message.header + '\n' + message.text, needle)}
                            query={needle}
                          />
                        </span>
                      </button>
                    )
                  })}
                  {resultPages > 1 && (
                    <div className="pagination">
                      <button disabled={!resultPage} onClick={() => setResultPage(resultPage - 1)}>
                        上一组结果
                      </button>
                      <span>
                        {resultPage + 1} / {resultPages}
                      </span>
                      <button
                        disabled={resultPage + 1 >= resultPages}
                        onClick={() => setResultPage(resultPage + 1)}
                      >
                        下一组结果
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          <p className="muted">
            正文共 {messages.length} {props.record.rawContent ? '条' : '行'} · 每页最多 100
            条。搜索跳转保留上下文，图片链接未离线下载。
          </p>
          <div className="messages">
            {messages.slice(currentPage * 100, (currentPage + 1) * 100).map((message, offset) => {
              const index = currentPage * 100 + offset
              return (
                <article
                  tabIndex={-1}
                  data-message-index={index}
                  className={
                    'message' + (selectedHit !== null && hits[selectedHit] === index ? ' search-target' : '')
                  }
                  key={index}
                  ref={(node) => {
                    if (node) messageNodes.current.set(index, node)
                    else messageNodes.current.delete(index)
                  }}
                >
                  {message.header && (
                    <header>
                      <Highlight text={message.header} query={needle} />
                    </header>
                  )}
                  <p>
                    <Highlight text={message.text || '\u00a0'} query={needle} />
                  </p>
                  {message.images.map((image, i) => (
                    <p className="source-link" key={i}>
                      [图片链接] {image.url}
                    </p>
                  ))}
                </article>
              )
            })}
          </div>
          <div className="pagination" aria-label="正文分页">
            <button
              disabled={currentPage === 0}
              onClick={() => {
                setPage(currentPage - 1)
                setJumpRequest(undefined)
              }}
            >
              上一页
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button
              disabled={currentPage + 1 >= pages}
              onClick={() => {
                setPage(currentPage + 1)
                setJumpRequest(undefined)
              }}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </>
  )
}
