import { useEffect, useRef, useState } from 'react'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import type { ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import type { MobileSnapshot } from '../../../data/types'
import type { DataAction } from '../../../data/actions'
import { GestureRow } from '../GestureRow'

const STATUS_LABELS = {
  pending: '未检测',
  valid: '有效',
  invalid: '失效',
  fetch_failed: '检测失败',
  manual: '手动内容'
}

/**
 * 记录列表、同页模组和已选场次操作；不在组件内直接持久化。
 * @param props - 数据、忙状态及受保护的编辑/删除/导出事件。
 * @returns 手机记录汇总页面。
 */
export function Records(props: {
  snapshot: MobileSnapshot
  onRead(record: SessionRecord): void
  onImport(): void
  onNewModule(): void
  onNewRecord(moduleId: string): void
  onEditModule(value: ModuleRecord): void
  onNewOnline(moduleId: string): void
  onAction(action: DataAction): void
  onFetch(ids: string[]): void
  onExport(ids: string[], combined: boolean): void
  busy: boolean
}) {
  const { snapshot } = props
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>(() =>
    snapshot.modules.length === 1 ? [snapshot.modules[0]!.id] : []
  )
  const [selected, setSelected] = useState<string[]>([])
  const [selecting, setSelecting] = useState(false)
  const collapseTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(
    () => () => {
      for (const timer of collapseTimers.current.values()) clearTimeout(timer)
    },
    []
  )
  /**
   * 箭头点击立即折叠；名称收合先等待双击，避免文档缩短导致第二次点击落空。
   * @param id - 模组标识。
   * @param open - 此刻模组是否展开。
   * @param caret - 是否点在专用折叠箭头上。
   * @returns 无返回值。
   */
  function toggleModule(id: string, open: boolean, caret: boolean) {
    clearTimeout(collapseTimers.current.get(id))
    collapseTimers.current.delete(id)
    if (!open || caret)
      setExpanded((current) => (open ? current.filter((item) => item !== id) : [...current, id]))
    else
      collapseTimers.current.set(
        id,
        setTimeout(() => {
          setExpanded((current) => current.filter((item) => item !== id))
          collapseTimers.current.delete(id)
        }, 320)
      )
  }
  /** @param value - 待编辑模组。 @returns 无返回值；取消尚未执行的名称收合。 */
  function editModule(value: ModuleRecord) {
    clearTimeout(collapseTimers.current.get(value.id))
    collapseTimers.current.delete(value.id)
    props.onEditModule(value)
  }
  const needle = query.trim().toLowerCase()
  const modules = snapshot.modules
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter(
      (m) =>
        !needle ||
        m.name.toLowerCase().includes(needle) ||
        snapshot.records.some((r) => r.moduleId === m.id && r.name.toLowerCase().includes(needle))
    )
  return (
    <>
      <div className="edit-actions">
        <button disabled={props.busy} onClick={props.onNewModule}>
          新增模组
        </button>
      </div>
      {!!snapshot.modules.length && (
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
          <p className="muted gesture-hint">
            点击模组展开 · 双击名称编辑 · 左滑删除、右滑收回 · 拖动右侧手柄排序；场次长按后松开进入多选
          </p>
        </>
      )}
      {modules.map((m) => {
        const allRecords = snapshot.records
          .filter((r) => r.moduleId === m.id)
          .sort((a, b) => a.order - b.order)
        const records = allRecords.filter(
          (r) => !needle || m.name.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)
        )
        const open = !!needle || expanded.includes(m.id)
        const ids = records.filter((r) => selected.includes(r.id)).map((r) => r.id)
        return (
          <section key={m.id} className="module-group panel">
            <GestureRow
              id={m.id}
              group="modules"
              label={'模组 ' + m.name}
              disabled={props.busy}
              onDelete={() => props.onAction({ type: 'delete', kind: 'module', id: m.id })}
              onReorder={(targetId) =>
                props.onAction({ type: 'reorder', kind: 'module', id: m.id, targetId })
              }
            >
              <button
                className="module-toggle"
                data-module-toggle
                aria-expanded={open}
                aria-label={'模组 ' + m.name}
                onClick={(event) => {
                  if (event.detail > 1) return
                  toggleModule(m.id, open, !!(event.target as Element).closest('.module-caret'))
                }}
                onDoubleClick={() => editModule(m)}
              >
                <span className="module-caret" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
                <strong>{m.name}</strong>
                <span className="module-meta">
                  {MODULE_PLAY_STATUS_LABELS[m.playStatus]} · {allRecords.length} 场
                </span>
              </button>
            </GestureRow>
            {open && (
              <div className="module-content">
                {!!(m.kps.length || m.pairs.length) && (
                  <p className="muted participant-summary">
                    KP：{m.kps.join('、') || '未填写'} · PC/PL：
                    {m.pairs.map((p) => p.pc + '/' + p.pl).join('、') || '未填写'}
                  </p>
                )}
                <div className="entity-actions module-actions" role="group" aria-label={m.name + '操作'}>
                  <button
                    disabled={props.busy || !records.length}
                    onClick={() => {
                      setSelecting(true)
                      setSelected(Array.from(new Set([...selected, ...records.map((r) => r.id)])))
                    }}
                  >
                    全选此模组
                  </button>
                  <button disabled={props.busy} onClick={() => props.onNewRecord(m.id)}>
                    新增手动场次
                  </button>
                  <button disabled={props.busy} onClick={() => props.onNewOnline(m.id)}>
                    新增在线场次
                  </button>
                  <button
                    className="danger"
                    disabled={props.busy || !ids.length}
                    onClick={() => props.onAction({ type: 'delete-records', ids })}
                  >
                    批量删除
                  </button>
                  {selecting && (
                    <>
                      <button
                        onClick={() => {
                          setSelected([])
                          setSelecting(false)
                        }}
                      >
                        退出多选
                      </button>
                      <button
                        disabled={
                          props.busy || !records.some((r) => ids.includes(r.id) && r.sourceType === 'online')
                        }
                        onClick={() =>
                          props.onFetch(
                            records
                              .filter((r) => ids.includes(r.id) && r.sourceType === 'online')
                              .map((r) => r.id)
                          )
                        }
                      >
                        获取所选在线正文
                      </button>
                      <button disabled={props.busy || !ids.length} onClick={() => props.onExport(ids, false)}>
                        批量导出
                      </button>
                      <button disabled={props.busy || !ids.length} onClick={() => props.onExport(ids, true)}>
                        合成导出
                      </button>
                      <span className="selection-count">已选 {ids.length} 场</span>
                    </>
                  )}
                </div>
                <div className="record-list">
                  {records.map((r) => (
                    <GestureRow
                      key={r.id}
                      id={r.id}
                      group={'records:' + m.id}
                      label={'场次 ' + r.name}
                      disabled={props.busy}
                      selected={selected.includes(r.id)}
                      onDelete={() => props.onAction({ type: 'delete', kind: 'record', id: r.id })}
                      onHold={() => {
                        setSelecting(true)
                        setSelected((current) => (current.includes(r.id) ? current : [...current, r.id]))
                      }}
                      onReorder={(targetId) =>
                        props.onAction({ type: 'reorder', kind: 'record', id: r.id, targetId })
                      }
                    >
                      <div className={'session-row' + (selected.includes(r.id) ? ' selected' : '')}>
                        {selecting && (
                          <label className="check selection-check">
                            <input
                              type="checkbox"
                              aria-label={'选择 ' + r.name}
                              checked={selected.includes(r.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, r.id]
                                    : selected.filter((id) => id !== r.id)
                                )
                              }
                            />
                          </label>
                        )}
                        <button
                          className="record-card"
                          onClick={() =>
                            selecting
                              ? setSelected(
                                  selected.includes(r.id)
                                    ? selected.filter((id) => id !== r.id)
                                    : [...selected, r.id]
                                )
                              : props.onRead(r)
                          }
                        >
                          <span className="muted">{m.name}</span>
                          <span className="record-title">
                            <strong className="record-name">{r.name}</strong>
                            <span
                              className={
                                r.rawContent || r.manualContent !== undefined ? 'tag available' : 'tag'
                              }
                            >
                              {r.rawContent || r.manualContent !== undefined ? '正文已保存' : '缺少正文'}
                            </span>
                          </span>
                          <span className="record-status">
                            <span className="record-status-text">
                              序号 {r.sequenceNo} ·{' '}
                              {r.sourceType === 'manual' ? '手动内容' : STATUS_LABELS[r.status]}
                              {r.lastError ? ' · ' + r.lastError : ''}
                              {' · 跑团时间：' + (r.playDate || '未填写')}
                            </span>
                          </span>
                        </button>
                      </div>
                    </GestureRow>
                  ))}
                </div>
                {!records.length && (
                  <p className="muted">{needle ? '没有匹配的场次。' : '此模组暂无场次。'}</p>
                )}
              </div>
            )}
          </section>
        )
      })}
      {!modules.length && !!snapshot.modules.length && <p className="muted">没有匹配的模组或场次。</p>}
      {!snapshot.records.length && (
        <section className="panel empty">
          <h2>暂无场次</h2>
          <p>可以先新增模组，再添加手动场次，也可以导入电脑备份。</p>
          <button className="primary" onClick={props.onImport}>
            前往数据与设置
          </button>
        </section>
      )}
    </>
  )
}
