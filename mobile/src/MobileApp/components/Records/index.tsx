import { useState } from 'react'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import type { ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import type { MobileSnapshot } from '../../../data/types'

/**
 * 手机模组/场次浏览，搜索名称，不联网补取缺失正文。
 * @param props - 安卓业务快照、阅读事件和导入入口。
 * @returns 单列模组与场次卡片。
 */
export function Records(props: {
  snapshot: MobileSnapshot
  onRead(record: SessionRecord): void
  onImport(): void
  onNewModule(): void
  onNewRecord(): void
  onEditModule(value: ModuleRecord): void
}) {
  const [query, setQuery] = useState('')
  const [moduleId, setModuleId] = useState('')
  const { snapshot } = props
  const records = snapshot.records
    .filter(
      (r) =>
        (!moduleId || r.moduleId === moduleId) &&
        (!query ||
          `${r.name} ${snapshot.modules.find((m) => m.id === r.moduleId)?.name}`
            .toLowerCase()
            .includes(query.toLowerCase()))
    )
    .sort((a, b) => a.order - b.order)
  return (
    <>
      <div className="edit-actions">
        <button onClick={props.onNewModule}>新增模组</button>
        <button disabled={!snapshot.modules.length} onClick={props.onNewRecord}>
          新增手动场次
        </button>
      </div>
      {!!snapshot.modules.length && (
        <details className="panel">
          <summary>管理模组</summary>
          {snapshot.modules.map((m) => (
            <button key={m.id} onClick={() => props.onEditModule(m)}>
              {m.name} · 编辑
            </button>
          ))}
        </details>
      )}
      <div className="summary">
        <strong>
          {snapshot.modules.length}
          <small>模组</small>
        </strong>
        <strong>
          {snapshot.records.length}
          <small>场次</small>
        </strong>
        <strong>
          {snapshot.records.filter((r) => r.rawContent || r.manualContent).length}
          <small>已保存正文</small>
        </strong>
      </div>
      {!snapshot.records.length ? (
        <section className="panel empty">
          <h2>暂无场次</h2>
          <p>可以先新增模组，再添加手动场次，也可以导入电脑备份。</p>
          <p>导入前先校验、预览，确认后再覆盖。旧备份若没有正文，不能凭来源链接离线阅读。</p>
          <button className="primary" onClick={props.onImport}>
            前往数据与设置
          </button>
        </section>
      ) : (
        <>
          <label className="field">
            搜索模组或场次
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入名称"
            />
          </label>
          <label className="field">
            模组
            <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">全部模组</option>
              {snapshot.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {MODULE_PLAY_STATUS_LABELS[m.playStatus]}
                </option>
              ))}
            </select>
          </label>
          <div className="record-list">
            {records.map((r) => (
              <button className="record-card" key={r.id} onClick={() => props.onRead(r)}>
                <span className="muted">{snapshot.modules.find((m) => m.id === r.moduleId)?.name}</span>
                <strong>{r.name}</strong>
                <span>
                  {r.playDate || '日期未填写'}
                  <span className={r.rawContent || r.manualContent ? 'tag available' : 'tag'}>
                    {r.rawContent || r.manualContent ? '正文已保存' : '缺少正文'}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!records.length && <p className="muted">没有匹配的场次。</p>}
        </>
      )}
    </>
  )
}
