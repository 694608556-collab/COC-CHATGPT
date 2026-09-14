import { useMemo, useState } from 'react'
import type { ModuleRecord, SessionRecord } from '../../../shared/types'
import { DialogShell } from './DialogShell2'

type Mode = 'module' | 'record'
type State = 'pending' | 'running' | 'done' | 'failed'

interface ResultRow {
  id: string
  name: string
  state: State
  message: string
}

function statusText(status: SessionRecord['status']): string {
  return {
    pending: '待检测',
    valid: '有效',
    invalid: '失效',
    fetch_failed: '检测失败',
    manual: '手动内容'
  }[status]
}

export function BatchCheckDialog({
  modules,
  records,
  onClose,
  onRefresh
}: {
  modules: ModuleRecord[]
  records: SessionRecord[]
  onClose(): void
  onRefresh(): Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('module')
  const [moduleIds, setModuleIds] = useState<Set<string>>(new Set())
  const [recordIds, setRecordIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ResultRow[]>([])

  const eligible = useMemo(
    () => records.filter((record) => record.link && record.sourceType !== 'manual'),
    [records]
  )
  const targets = useMemo(() => {
    if (mode === 'record') {
      return eligible.filter((record) => recordIds.has(record.id))
    }
    return eligible.filter((record) => moduleIds.has(record.moduleId))
  }, [eligible, mode, moduleIds, recordIds])

  const runChecks = async (): Promise<void> => {
    if (!targets.length) return
    setRunning(true)
    setResults(
      targets.map((record) => ({
        id: record.id,
        name: record.name,
        state: 'pending',
        message: ''
      }))
    )
    let cursor = 0
    const workers = Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (cursor < targets.length) {
        const record = targets[cursor]
        cursor += 1
        if (!record) return
        setResults((current) =>
          current.map((item) => (item.id === record.id ? { ...item, state: 'running' } : item))
        )
        try {
          const updated = await window.coc.records.probe(record.id)
          setResults((current) =>
            current.map((item) =>
              item.id === record.id
                ? {
                    ...item,
                    state: 'done',
                    message: statusText(updated.status)
                  }
                : item
            )
          )
        } catch (error) {
          setResults((current) =>
            current.map((item) =>
              item.id === record.id
                ? {
                    ...item,
                    state: 'failed',
                    message: error instanceof Error ? error.message : '检测失败'
                  }
                : item
            )
          )
        }
      }
    })
    await Promise.all(workers)
    setRunning(false)
    await onRefresh()
  }

  return (
    <DialogShell title="批量检测" onClose={onClose} wide>
      <div className="dialog-body">
        <div className="dialog-tabs">
          <button className={mode === 'module' ? 'active' : ''} onClick={() => setMode('module')}>
            按模组合集检测
          </button>
          <button className={mode === 'record' ? 'active' : ''} onClick={() => setMode('record')}>
            单链接检测
          </button>
        </div>

        <div className="check-selector">
          {mode === 'module'
            ? modules.map((module) => {
                const count = eligible.filter((record) => record.moduleId === module.id).length
                return (
                  <label key={module.id}>
                    <input
                      type="checkbox"
                      checked={moduleIds.has(module.id)}
                      disabled={!count}
                      onChange={(event) => {
                        setModuleIds((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(module.id)
                          else next.delete(module.id)
                          return next
                        })
                      }}
                    />
                    <span>{module.name}</span>
                    <small>{count} 条链接</small>
                  </label>
                )
              })
            : eligible.map((record) => (
                <label key={record.id}>
                  <input
                    type="checkbox"
                    checked={recordIds.has(record.id)}
                    onChange={(event) => {
                      setRecordIds((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(record.id)
                        else next.delete(record.id)
                        return next
                      })
                    }}
                  />
                  <span>{record.name}</span>
                  <small>{statusText(record.status)}</small>
                </label>
              ))}
        </div>

        {results.length ? (
          <div className="check-results">
            {results.map((item) => (
              <div key={item.id} data-state={item.state}>
                <strong>{item.name}</strong>
                <span>
                  {item.state === 'running'
                    ? '检测中'
                    : item.message || (item.state === 'pending' ? '等待检测' : '')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <footer className="modal-actions">
        <span className="dialog-count">已选 {targets.length} 条</span>
        <button className="secondary" onClick={onClose}>
          取消
        </button>
        <button className="primary" disabled={running || !targets.length} onClick={() => void runChecks()}>
          {running ? '检测中' : '开始检测'}
        </button>
      </footer>
    </DialogShell>
  )
}
