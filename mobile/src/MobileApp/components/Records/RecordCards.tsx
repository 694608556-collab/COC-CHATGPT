import { memo, type RefObject, type Dispatch, type SetStateAction } from 'react'
import type { SessionRecord } from '../../../../../src/shared/types'
import type { DataAction } from '../../../data/actions'
import { GestureRow } from '../GestureRow'

const STATUS_LABELS = {
  pending: '未检测',
  valid: '有效',
  invalid: '失效',
  fetch_failed: '检测失败',
  manual: '手动内容'
}

/** Stable record cards avoid repeating the complete gesture tree for search progress.
 * @param props Current immutable records, selection, availability and committed handlers.
 * @returns Every original card and gesture; all business changes invalidate the memo.
 */
export const RecordCards = memo(function RecordCards(props: {
  records: SessionRecord[]
  moduleId: string
  moduleName: string
  selected: string[]
  selecting: boolean
  busy: boolean
  returnRecordId?: string
  deferredRecords: ReadonlySet<string>
  returnCard: RefObject<HTMLButtonElement | null>
  setSelected: Dispatch<SetStateAction<string[]>>
  setSelecting: Dispatch<SetStateAction<boolean>>
  onRead(record: SessionRecord, query?: string): void
  onAction(action: DataAction): void
}) {
  return (
    <div className="record-list">
      {props.records.map((r) => (
        <GestureRow
          key={r.id}
          id={r.id}
          highlighted={r.id === props.returnRecordId}
          group={'records:' + props.moduleId}
          label={'场次 ' + r.name}
          disabled={props.busy}
          selected={props.selected.includes(r.id)}
          onDelete={() => props.onAction({ type: 'delete', kind: 'record', id: r.id })}
          onHold={() => {
            props.setSelecting(true)
            props.setSelected((current) => (current.includes(r.id) ? current : [...current, r.id]))
          }}
          onReorder={(targetId) => props.onAction({ type: 'reorder', kind: 'record', id: r.id, targetId })}
        >
          <div className={'session-row' + (props.selected.includes(r.id) ? ' selected' : '')}>
            {props.selecting && (
              <label className="check selection-check">
                <input
                  type="checkbox"
                  aria-label={'选择 ' + r.name}
                  checked={props.selected.includes(r.id)}
                  onChange={(e) =>
                    props.setSelected(
                      e.target.checked
                        ? [...props.selected, r.id]
                        : props.selected.filter((id) => id !== r.id)
                    )
                  }
                />
              </label>
            )}
            <button
              ref={r.id === props.returnRecordId ? props.returnCard : undefined}
              className="record-card"
              aria-current={r.id === props.returnRecordId ? 'true' : undefined}
              data-record-id={r.id}
              onClick={() =>
                props.selecting
                  ? props.setSelected(
                      props.selected.includes(r.id)
                        ? props.selected.filter((id) => id !== r.id)
                        : [...props.selected, r.id]
                    )
                  : props.onRead(r)
              }
            >
              <span className="muted">{props.moduleName}</span>
              <span className="record-title">
                <strong className="record-name">{r.name}</strong>
                <span
                  className={
                    props.deferredRecords.has(r.id) || r.rawContent || r.manualContent !== undefined
                      ? 'tag available'
                      : 'tag'
                  }
                >
                  {props.deferredRecords.has(r.id) || r.rawContent || r.manualContent !== undefined
                    ? '正文已保存'
                    : '缺少正文'}
                </span>
              </span>
              <span className="record-status">
                <span className="record-status-text">
                  序号 {r.sequenceNo} · {r.sourceType === 'manual' ? '手动内容' : STATUS_LABELS[r.status]}
                  {r.lastError ? ' · ' + r.lastError : ''}
                  {' · 跑团时间：' + (r.playDate || '未填写')}
                </span>
              </span>
            </button>
          </div>
        </GestureRow>
      ))}
    </div>
  )
})
