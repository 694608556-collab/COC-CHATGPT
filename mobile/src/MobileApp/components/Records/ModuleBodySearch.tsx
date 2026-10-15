import { useMemo, useRef, useState } from 'react'
import type { FilterPreset, SessionRecord } from '../../../../../src/shared/types'
import { matchRanges, recordMessages, searchExcerpt } from '../../../data/search'

/** 只搜索此模组的已保存正文，不更改列表选择、排序或业务数据。 */
export function ModuleBodySearch(props: {
  moduleId: string
  moduleName: string
  records: SessionRecord[]
  preset: FilterPreset
  query: string
  onQuery(query: string): void
  onRead(record: SessionRecord, query: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(0)
  const needle = props.query.trim()
  const active = !!needle
  const rows = useMemo(
    () =>
      props.records
        .filter((r) => r.moduleId === props.moduleId)
        .slice()
        .sort((a, b) => a.order - b.order),
    [props.records, props.moduleId]
  )
  const bodies = useMemo(
    () => (active ? rows.map((record) => ({ record, messages: recordMessages(record, props.preset) })) : []),
    [rows, props.preset, active]
  )
  const hits = useMemo(
    () =>
      bodies.flatMap(({ record, messages }) => {
        let matches = 0,
          excerpt = ''
        for (const message of messages) {
          const text = message.header + '\n' + message.text
          const count = matchRanges(text, needle).length
          if (count && !matches) excerpt = searchExcerpt(text, needle)
          matches += count
        }
        return matches ? [{ record, matches, excerpt }] : []
      }),
    [bodies, needle]
  )
  const pages = Math.max(1, Math.ceil(hits.length / 20)),
    current = Math.min(page, pages - 1)
  return (
    <div className="module-body-search" role="search" aria-label={props.moduleName + '正文搜索'}>
      <form
        className="reader-search"
        onSubmit={(event) => {
          event.preventDefault()
          if (hits[0]) props.onRead(hits[0].record, needle)
        }}
      >
        <label className="field module-search-field">
          <span className="search-input-wrap">
            <input
              ref={input}
              type="search"
              aria-label="搜索该模组所有场次正文"
              enterKeyHint="search"
              placeholder="搜索该模组所有场次正文"
              value={props.query}
              onChange={(event) => {
                props.onQuery(event.target.value)
                setPage(0)
              }}
            />
            <button
              type="button"
              className="search-clear"
              aria-label="清空模组正文搜索"
              onClick={() => {
                props.onQuery('')
                setPage(0)
                input.current?.focus()
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </span>
        </label>
      </form>
      {active && (
        <section className="search-results" aria-label="模组正文搜索结果">
          <p role="status">
            {hits.length ? `匹配 ${hits.length} 个场次` : '没有找到匹配正文'}
            。按当前阅读过滤条件搜索本机已保存正文。
          </p>
          {hits.slice(current * 20, (current + 1) * 20).map((hit) => (
            <button
              type="button"
              className="search-result"
              key={hit.record.id}
              onClick={() => props.onRead(hit.record, needle)}
            >
              <strong>
                {hit.record.name} · {hit.matches} 处
              </strong>
              <span>{hit.excerpt}</span>
            </button>
          ))}
          {pages > 1 && (
            <div className="pagination">
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                上一组场次
              </button>
              <span>
                {current + 1} / {pages}
              </span>
              <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                下一组场次
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
