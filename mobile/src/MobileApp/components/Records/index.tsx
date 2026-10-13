import { useState } from 'react'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import type { ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import type { MobileSnapshot } from '../../../data/types'
import type { DataAction } from '../../../data/actions'

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
  onNewOnline(): void
  onAction(action: DataAction): void
  onFetch(ids: string[]): void
  onExport(ids: string[], combined: boolean): void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
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
        <button disabled={props.busy || !snapshot.modules.length} onClick={props.onNewOnline}>
          新增在线场次
        </button>
      </div>
      {!!snapshot.modules.length && (
        <details className="panel">
          <summary>管理模组</summary>
          {snapshot.modules
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((m) => (
              <section key={m.id} className="entity-actions">
                <button disabled={props.busy} onClick={() => props.onEditModule(m)}>
                  {m.name} · 编辑
                </button>
                <button
                  disabled={props.busy}
                  aria-label={'上移模组 ' + m.name}
                  onClick={() => props.onAction({ type: 'move', kind: 'module', id: m.id, direction: -1 })}
                >
                  上移
                </button>
                <button
                  disabled={props.busy}
                  aria-label={'下移模组 ' + m.name}
                  onClick={() => props.onAction({ type: 'move', kind: 'module', id: m.id, direction: 1 })}
                >
                  下移
                </button>
                <button
                  disabled={props.busy}
                  onClick={() => props.onAction({ type: 'realign', moduleId: m.id })}
                >
                  重排场次序号
                </button>
                <button
                  disabled={props.busy}
                  className="danger"
                  onClick={() => props.onAction({ type: 'delete', kind: 'module', id: m.id })}
                >
                  删除模组 {m.name}
                </button>
              </section>
            ))}
        </details>
      )}
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
            <div className="entity-actions">
              <button disabled={props.busy} onClick={() => setSelected(records.map((r) => r.id))}>
                全选当前列表
              </button>
              <button onClick={() => setSelected([])}>取消选择</button>
              <button
                disabled={props.busy || !selected.length}
                onClick={() =>
                  props.onFetch(
                    snapshot.records
                      .filter((r) => selected.includes(r.id) && r.sourceType === 'online')
                      .map((r) => r.id)
                  )
                }
              >
                获取所选在线正文
              </button>
              <button
                disabled={props.busy || !selected.length}
                onClick={() => props.onExport(selected, false)}
              >
                批量导出
              </button>
              <button
                disabled={props.busy || !selected.length}
                onClick={() => props.onExport(selected, true)}
              >
                合成导出
              </button>
            </div>
            {records.map((r) => (
              <section key={r.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id)
                      )
                    }
                  />
                  选择 {r.name}
                </label>
                <div className="entity-actions">
                  <button
                    disabled={props.busy}
                    aria-label={'上移场次 ' + r.name}
                    onClick={() => props.onAction({ type: 'move', kind: 'record', id: r.id, direction: -1 })}
                  >
                    上移
                  </button>
                  <button
                    disabled={props.busy}
                    aria-label={'下移场次 ' + r.name}
                    onClick={() => props.onAction({ type: 'move', kind: 'record', id: r.id, direction: 1 })}
                  >
                    下移
                  </button>
                </div>
                <button className="record-card" key={r.id} onClick={() => props.onRead(r)}>
                  <span className="muted">{snapshot.modules.find((m) => m.id === r.moduleId)?.name}</span>
                  <strong>{r.name}</strong>
                  <span>
                    {r.playDate || '日期未填写'}
                    <span className={r.rawContent || r.manualContent ? 'tag available' : 'tag'}>
                      {r.rawContent || r.manualContent ? '正文已保存' : '缺少正文'}
                    </span>
                  </span>
                  <span>
                    序号 {r.sequenceNo} · {r.status}
                    {r.lastError ? ' · ' + r.lastError : ''}
                  </span>
                </button>
              </section>
            ))}
          </div>
          {!records.length && <p className="muted">没有匹配的场次。</p>}
        </>
      )}
    </>
  )
}
