import { useMemo, useState } from 'react'
import type { ModuleRecord, SessionRecord } from '../../../../../src/shared/types'

type Mode = 'module' | 'record'
type State = 'pending' | 'running' | 'done' | 'failed' | 'manual'

/** 本轮检测结果，不把场次原有状态当作本轮已完成。 */
interface ResultRow {
  /** 场次ID。 */
  id: string
  /** 所属模组ID，用于分组。 */
  moduleId: string
  /** 场次显示名称。 */
  name: string
  /** 在线场次的原始链接。 */
  link?: string
  /** 本轮处理状态，manual表示无需联网。 */
  state: State
  /** 成功状态或失败原因。 */
  message: string
}

/** 判断正文是否由用户手动保存。@param record 场次。@returns 是否无需联网检测。 */
function isManual(record: SessionRecord): boolean {
  return record.sourceType === 'manual' || Boolean(record.manualContent)
}

/** 显示检测状态。@param status 场次状态。@returns 中文状态。 */
function statusText(status: SessionRecord['status']): string {
  return { pending: '待检测', valid: '有效', invalid: '失效', fetch_failed: '检测失败', manual: '手动内容' }[
    status
  ]
}

/** 生成本轮初始结果，不计入旧的成功或失败。@param record 所选场次。@returns 初始行。 */
function initialResult(record: SessionRecord): ResultRow {
  return {
    id: record.id,
    moduleId: record.moduleId,
    name: record.name,
    link: record.link,
    state: isManual(record) ? 'manual' : 'pending',
    message: isManual(record) ? '手动内容，无需检测' : ''
  }
}

/** 移动端模组检测面板，结果在原CAS事务保存成功后才完成。@param props 模组、场次及原提交入口。@returns 可折叠、实时统计的检测面板。 */
export function BatchCheck({
  modules,
  records,
  onClose,
  onRun
}: {
  modules: ModuleRecord[]
  records: SessionRecord[]
  onClose(): void
  onRun(ids: string[], onResult: (record: SessionRecord) => void): Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('module')
  const [moduleIds, setModuleIds] = useState<Set<string>>(new Set())
  const [recordIds, setRecordIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [results, setResults] = useState<ResultRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [refreshError, setRefreshError] = useState('')

  const selectable = useMemo(() => records.filter((record) => record.link || isManual(record)), [records])
  const selected = useMemo(
    () =>
      selectable.filter((record) =>
        mode === 'record' ? recordIds.has(record.id) : moduleIds.has(record.moduleId)
      ),
    [selectable, mode, moduleIds, recordIds]
  )
  const targets = selected.filter((record) => !isManual(record))
  const displayed = results.length ? results : selected.map(initialResult)
  const manualCount = displayed.filter((item) => item.state === 'manual').length
  const succeeded = results.filter((item) => item.state === 'done').length
  const failed = results.filter((item) => item.state === 'failed').length
  const finished = succeeded + failed

  /** 更改选择时开始一个新批次，不保留旧统计。@returns 无返回值。 */
  const resetResults = (): void => {
    setResults([])
    setCompleted(false)
    setRefreshError('')
  }

  /** 沿用父级限量并发及一次CAS提交，失败保留面板而不宣称保存完成。@returns 无返回值。 */
  const runChecks = async (): Promise<void> => {
    if (running || !selected.length) return
    setRunning(true)
    setCompleted(false)
    setRefreshError('')
    setResults(
      selected.map((record) => ({ ...initialResult(record), state: isManual(record) ? 'manual' : 'running' }))
    )
    try {
      await onRun(
        selected.map((record) => record.id),
        (updated) => {
          setResults((current) =>
            current.map((item) =>
              item.id === updated.id
                ? {
                    ...item,
                    state: updated.status === 'valid' ? 'done' : 'failed',
                    message:
                      updated.status === 'valid' ? '有效' : updated.lastError || statusText(updated.status)
                  }
                : item
            )
          )
        }
      )
      setCompleted(true)
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '保存失败，请重试；未写入部分结果。')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-backdrop batch-backdrop">
      <section className="panel batch-check" role="dialog" aria-modal="true" aria-label="批量检测">
        <h2>批量检测</h2>
        <div className="dialog-body">
          <div className="dialog-tabs">
            <button
              disabled={running}
              className={mode === 'module' ? 'active' : ''}
              onClick={() => {
                resetResults()
                setMode('module')
              }}
            >
              按模组合集检测
            </button>
            <button
              disabled={running}
              className={mode === 'record' ? 'active' : ''}
              onClick={() => {
                resetResults()
                setMode('record')
              }}
            >
              单链接检测
            </button>
          </div>
          <div className="check-selector">
            {mode === 'module'
              ? modules.map((module) => {
                  const group = selectable.filter((record) => record.moduleId === module.id)
                  const manual = group.filter(isManual).length
                  return (
                    <label key={module.id}>
                      <input
                        type="checkbox"
                        checked={moduleIds.has(module.id)}
                        disabled={running || !group.length}
                        onChange={(event) => {
                          resetResults()
                          setModuleIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(module.id)
                            else next.delete(module.id)
                            return next
                          })
                        }}
                      />
                      <span>{module.name}</span>
                      <small>
                        {group.length - manual} 条链接 · {manual} 场手动内容
                      </small>
                    </label>
                  )
                })
              : selectable.map((record) => (
                  <label key={record.id}>
                    <input
                      type="checkbox"
                      checked={recordIds.has(record.id)}
                      disabled={running}
                      onChange={(event) => {
                        resetResults()
                        setRecordIds((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(record.id)
                          else next.delete(record.id)
                          return next
                        })
                      }}
                    />
                    <span>
                      {modules.find((module) => module.id === record.moduleId)?.name} · {record.name}
                    </span>
                    <small>{statusText(record.status)}</small>
                  </label>
                ))}
          </div>
          {displayed.length > 0 && (
            <div className="check-results check-grouped-results">
              {modules.map((module) => {
                const rows = displayed.filter((item) => item.moduleId === module.id)
                if (!rows.length) return null
                const open = expanded.has(module.id)
                return (
                  <section className="check-module" key={module.id}>
                    <button
                      className="check-module-toggle"
                      aria-label={`${open ? '折叠' : '展开'}${module.name}`}
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current)
                          if (open) next.delete(module.id)
                          else next.add(module.id)
                          return next
                        })
                      }
                    >
                      <span aria-hidden="true" className="check-fold-icon">
                        {open ? '▾' : '▸'}
                      </span>
                      <strong>{module.name}</strong>
                      <small>{rows.length} 场</small>
                    </button>
                    {open && (
                      <section className="check-module-records">
                        {rows.map((item) => (
                          <div key={item.id} className="check-result-row" data-state={item.state}>
                            <strong title={item.link}>{item.name}</strong>
                            <span>{item.state === 'running' ? '检测中' : item.message || '等待检测'}</span>
                          </div>
                        ))}
                      </section>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          {refreshError && <p className="warning-text">{refreshError}</p>}
        </div>
        <footer className="modal-actions">
          <span className="dialog-count check-progress" role="status" aria-live="polite">
            共 {selected.length} 场 · 链接 {targets.length} 条 · 成功 {succeeded} · 失败 {failed} ·
            手动保存内容 {manualCount} 场{running ? ` · 已检测 ${finished}/${targets.length}` : ''}
          </span>
          <button className="secondary" disabled={running} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={running || (!completed && !selected.length)}
            onClick={() => (completed ? onClose() : void runChecks())}
          >
            {completed ? '检测完毕' : running ? '检测中' : '开始检测'}
          </button>
        </footer>
      </section>
    </div>
  )
}
