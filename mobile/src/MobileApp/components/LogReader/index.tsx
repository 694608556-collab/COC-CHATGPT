import { useMemo, useState } from 'react'
import type { FilterPreset, SessionRecord } from '../../../../../src/shared/types'
import { applyLogFilters } from '../../../../../src/shared/log-filter'

/**
 * 本地正文阅读器；全正文搜索，分页渲染，图片只保留链接不下载。
 * @param props - 场次、已有过滤设置、忙状态及返回/文本导出事件。
 * @returns 可离线阅读的正文或明确的缺失提示。
 */
export function LogReader(props: {
  record: SessionRecord
  preset: FilterPreset
  busy: boolean
  onBack(): void
  onEdit(): void
  onExport(filters: FilterPreset): void
}) {
  const [filters, setFilters] = useState(props.preset)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const messages = useMemo(
    () =>
      props.record.rawContent
        ? applyLogFilters(props.record.rawContent, filters).filter(
            (m) => !query || `${m.header}\n${m.text}`.toLowerCase().includes(query.toLowerCase())
          )
        : [],
    [props.record, filters, query]
  )
  const pages = Math.max(1, Math.ceil(messages.length / 100))
  const currentPage = Math.min(page, pages - 1)
  const hasBody = !!props.record.rawContent || props.record.manualContent !== undefined
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
      </div>
      <section className="panel">
        <h2>{props.record.name}</h2>
        <p>
          {props.record.playDate || '日期未填写'} · {hasBody ? '本机已保存' : '未带正文'}
        </p>
        {props.record.link && <p className="source-link">来源：{props.record.link}</p>}
        {!hasBody && (
          <p className="warning">
            此备份只有场次登记，没有日志正文。联网获取尚未接入，不能显示未保存的内容。
          </p>
        )}
      </section>
      {props.record.rawContent && (
        <>
          <label className="field">
            搜索整场正文
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder="发言者或正文文字"
            />
          </label>
          <div className="filters">
            {(['hideDiceCommands', 'hideOffTopic', 'hideTime'] as const).map((key) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) => {
                    setFilters({ ...filters, [key]: e.target.checked })
                    setPage(0)
                  }}
                />
                {
                  {
                    hideDiceCommands: '隐藏骰指令',
                    hideOffTopic: '隐藏题外话',
                    hideTime: '隐藏时间'
                  }[key]
                }
              </label>
            ))}
          </div>
          <p className="muted">显示 {messages.length} 条 · 每页最多 100 条。图片链接未离线下载。</p>
          <div className="messages">
            {messages.slice(currentPage * 100, (currentPage + 1) * 100).map((m, i) => (
              <article className="message" key={`${m.id}-${i}`}>
                <header>{m.header}</header>
                <p>{m.text}</p>
                {m.images.map((image, index) => (
                  <p className="source-link" key={index}>
                    [图片链接] {image.url}
                  </p>
                ))}
              </article>
            ))}
          </div>
          <div className="pagination">
            <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </div>
        </>
      )}
      {!props.record.rawContent && props.record.manualContent !== undefined && (
        <section className="panel preserve-text">{props.record.manualContent}</section>
      )}
    </>
  )
}
