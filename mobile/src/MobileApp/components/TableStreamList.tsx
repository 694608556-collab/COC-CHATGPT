import type { NativeTablePreview } from '../../data/table-stream-native'
import { SystemMessage } from './SystemMessage'

/** A bounded preview page; changing pages never retains previous pages. */
export function TableStreamList({
  preview,
  offsets,
  busy,
  onPage
}: {
  preview: NativeTablePreview
  offsets: { names: number; warnings: number }
  busy: boolean
  onPage(kind: 'names' | 'warnings', offset: number): void
}) {
  return (
    <>
      <p>
        新增 {preview.added} 项，更新 {preview.updated} 项，跳过 {preview.skipped} 项。
      </p>
      {(['names', 'warnings'] as const).map((kind) => {
        const total = kind === 'names' ? preview.namesCount : preview.warningsCount
        const values = preview[kind],
          offset = offsets[kind]
        if (!total) return null
        return (
          <div key={kind}>
            <p>
              {kind === 'names' ? '导入项目' : '导入提醒'}：第 {offset + 1}–{offset + values.length} 项，共{' '}
              {total} 项
            </p>
            {values.map((value, i) =>
              kind === 'names' ? (
                <p key={offset + i}>{value}</p>
              ) : (
                <SystemMessage kind="warning" message={value} key={offset + i} />
              )
            )}
            {offset > 0 && (
              <button disabled={busy} onClick={() => onPage(kind, Math.max(0, offset - 100))}>
                {kind === 'names' ? '上一页项目' : '上一页提醒'}
              </button>
            )}
            {offset + values.length < total && (
              <button disabled={busy} onClick={() => onPage(kind, offset + values.length)}>
                {kind === 'names' ? '下一页项目' : '下一页提醒'}
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
