import { useMemo, useState } from 'react'
import type { FilterPreset, SessionRecord } from '../../../../../src/shared/types'
import { countMatches, recordMessages, searchExcerpt } from '../../../data/search'
import { SearchInput } from '../SearchInput'

/** 只搜索此模组的已保存正文，不更改列表选择、排序或业务数据。 */
export function ModuleBodySearch(props: {
  streaming?: boolean
  result?: import('../../../data/body-search-stream').BodySearchResult
  searching?: boolean
  ready: boolean
  busy: boolean
  moduleId: string
  moduleName: string
  records: SessionRecord[]
  preset: FilterPreset
  query: string
  submittedQuery: string
  onQuery(query: string): void
  onSearch(query: string): void
  onRead(record: SessionRecord, query: string): void
}) {
  const [page, setPage] = useState(0)
  const needle = props.submittedQuery.trim()
  const streamed = props.result?.query === needle ? props.result : undefined
  const ready = props.streaming ? !!streamed : props.ready
  const busy = props.streaming ? !!props.searching : props.busy
  const active = !!needle && ready
  const rows = useMemo(
    () =>
      props.records
        .filter((r) => r.moduleId === props.moduleId)
        .slice()
        .sort((a, b) => a.order - b.order),
    [props.records, props.moduleId]
  )
  const byID = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const bodies = useMemo(
    () =>
      active && !props.streaming
        ? rows.map((record) => ({ record, messages: recordMessages(record, props.preset) }))
        : [],
    [rows, props.preset, active, props.streaming]
  )
  const hits = useMemo(
    () =>
      props.streaming
        ? (streamed?.hits ?? [])
            .flatMap((hit) => {
              const record = byID.get(hit.id)
              return record ? [{ record, matches: hit.matches, excerpt: hit.excerpt }] : []
            })
            .sort((a, b) => a.record.order - b.record.order)
        : bodies.flatMap(({ record, messages }) => {
            let matches = 0,
              excerpt = ''
            for (const message of messages) {
              const text = message.header + '\n' + message.text
              const count = countMatches(text, needle)
              if (count && !matches) excerpt = searchExcerpt(text, needle)
              matches += count
            }
            return matches ? [{ record, matches, excerpt }] : []
          }),
    [bodies, needle, streamed, rows, byID, props.streaming]
  )
  const pages = Math.max(1, Math.ceil(hits.length / 20)),
    current = Math.min(page, pages - 1)
  return (
    <div className="module-body-search" role="search" aria-label={props.moduleName + '正文搜索'}>
      <form
        className="reader-search"
        onSubmit={(event) => {
          event.preventDefault()
          if (props.query.trim()) props.onSearch(props.query)
        }}
      >
        <label className="field module-search-field">
          <SearchInput
            label="搜索该模组所有场次正文"
            searchLabel="搜索模组正文"
            clearLabel="清空模组正文搜索"
            submitted={!!needle}
            placeholder="搜索该模组所有场次正文"
            value={props.query}
            onChange={(value) => {
              props.onQuery(value)
              setPage(0)
            }}
          />
        </label>
      </form>
      {!!needle && !ready && (
        <section className="search-results" aria-label="模组正文搜索结果">
          <p role="status">{busy ? '正在逐场搜索已保存正文…' : '正文尚未读取，重试后显示完整搜索结果。'}</p>
          {!busy && (
            <button type="button" onClick={() => props.onSearch(props.query)}>
              重试正文搜索
            </button>
          )}
        </section>
      )}
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
