import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MODULE_PLAY_STATUS_LABELS } from '../../../../../src/shared/types'
import type { ModuleRecord, SessionRecord } from '../../../../../src/shared/types'
import type { MobileSnapshot } from '../../../data/types'
import type { DataAction } from '../../../data/actions'
import { GestureRow } from '../GestureRow'
import { ModuleBodySearch } from './ModuleBodySearch'

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
  /** 正文返回后的临时场次 ID；下一次点击清除展开定位及高亮目标。 */
  returnRecordId?: string
  deferredRecords: ReadonlySet<string>
  snapshot: MobileSnapshot
  onRead(record: SessionRecord, query?: string): void
  queries: Record<string, string>
  onQuery(moduleId: string, query: string): void
  onImport(): void
  onNewModule(): void
  onNewRecord(moduleId: string): void
  onEditModule(value: ModuleRecord): void
  onNewOnline(moduleId: string): void
  onAction(action: DataAction): void
  /** 打开全模组批量检测面板。 */
  onBatchCheck(): void
  onFetch(ids: string[]): void
  onExport(ids: string[], combined: boolean): void
  busy: boolean
}) {
  const { snapshot } = props
  // 正文进度提示不改变records引用；同一份场次只分组和排序一次。
  const recordsByModule = useMemo(() => {
    const groups = new Map<string, SessionRecord[]>()
    for (const record of snapshot.records) {
      const rows = groups.get(record.moduleId)
      if (rows) rows.push(record)
      else groups.set(record.moduleId, [record])
    }
    for (const rows of groups.values()) rows.sort((a, b) => a.order - b.order)
    return groups
  }, [snapshot.records])
  const [expanded, setExpanded] = useState<string[]>(() =>
    snapshot.modules
      .filter(
        (m) =>
          snapshot.modules.length === 1 ||
          props.queries[m.id] ||
          snapshot.records.some((r) => r.id === props.returnRecordId && r.moduleId === m.id)
      )
      .map((m) => m.id)
  )
  const returnCard = useRef<HTMLButtonElement>(null)
  // 仅在列表重建或阅读目标改变后定位一次；头尾按原滚动边界停住，不补空白。
  useLayoutEffect(() => {
    returnCard.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [props.returnRecordId])
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
  const modules = snapshot.modules.slice().sort((a, b) => a.order - b.order)
  return (
    <>
      <div className="edit-actions records-create-actions">
        <button disabled={props.busy} onClick={props.onNewModule}>
          新增模组
        </button>
        <button disabled={props.busy} onClick={props.onBatchCheck}>
          批量检测
        </button>
      </div>
      {!!snapshot.modules.length && (
        <>
          <p className="muted gesture-hint">
            点击模组展开 · 双击名称编辑 · 左滑删除、右滑收回 · 拖动右侧手柄排序；场次长按后松开进入多选
          </p>
        </>
      )}
      {modules.map((m) => {
        const allRecords = recordsByModule.get(m.id) ?? []
        const records = allRecords
        const open = expanded.includes(m.id)
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
                <ModuleBodySearch
                  ready={!allRecords.some((r) => props.deferredRecords.has(r.id))}
                  busy={props.busy}
                  moduleId={m.id}
                  moduleName={m.name}
                  records={snapshot.records}
                  preset={snapshot.settings.filterPreset}
                  query={props.queries[m.id] ?? ''}
                  onQuery={(query) => props.onQuery(m.id, query)}
                  onRead={props.onRead}
                />
                <div
                  className={'entity-actions module-actions' + (selecting ? ' selecting-actions' : '')}
                  role="group"
                  aria-label={m.name + '操作'}
                >
                  <button
                    disabled={props.busy || !records.length}
                    onClick={() => {
                      setSelecting(true)
                      setSelected(Array.from(new Set([...selected, ...records.map((r) => r.id)])))
                    }}
                  >
                    全选此模组
                  </button>
                  {!selecting && (
                    <>
                      <button
                        className="primary"
                        disabled={props.busy}
                        onClick={() => props.onNewRecord(m.id)}
                      >
                        新增手动场次
                      </button>
                      <button disabled={props.busy} onClick={() => props.onNewOnline(m.id)}>
                        新增在线场次
                      </button>
                    </>
                  )}
                  {selecting && (
                    <>
                      <button
                        disabled={props.busy}
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
                      <button
                        className="danger bulk-delete"
                        disabled={props.busy || !ids.length}
                        onClick={() => props.onAction({ type: 'delete-records', ids })}
                      >
                        批量删除
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
                      highlighted={r.id === props.returnRecordId}
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
                          ref={r.id === props.returnRecordId ? returnCard : undefined}
                          className="record-card"
                          aria-current={r.id === props.returnRecordId ? 'true' : undefined}
                          data-record-id={r.id}
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
                                props.deferredRecords.has(r.id) ||
                                r.rawContent ||
                                r.manualContent !== undefined
                                  ? 'tag available'
                                  : 'tag'
                              }
                            >
                              {props.deferredRecords.has(r.id) ||
                              r.rawContent ||
                              r.manualContent !== undefined
                                ? '正文已保存'
                                : '缺少正文'}
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
                {!records.length && <p className="muted">此模组暂无场次。</p>}
              </div>
            )}
          </section>
        )
      })}
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
