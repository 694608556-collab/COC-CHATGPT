import { useState } from 'react'
import type { ImportPreview } from '../../../data/types'
import { SystemMessage } from '../SystemMessage'

/**
 * 显式覆盖确认；不勾选时保留本机显示设置，取消不调用原生恢复。
 * @param props - 校验预览、原数据数量、忙状态及确认/取消事件。
 * @returns 可滚动的恢复确认对话框。
 */
export function RestoreDialog(props: {
  preview: ImportPreview
  currentRecords: number
  busy: boolean
  /** 当前真实导入阶段，类型为 string。 */
  stage: string
  /** 导入失败说明，类型为 string；弹窗不隐藏错误。 */
  error: string
  onCancel(): void
  onConfirm(restoreSettings: boolean): void
}) {
  const [settings, setSettings] = useState(false)
  const snapshot = props.preview.snapshot
  return (
    <div className="modal-backdrop">
      <section
        className="restore-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-title"
      >
        <h2 id="restore-title">确认导入范围</h2>
        {props.busy && (
          <SystemMessage
            kind="progress"
            ariaLabel="安全导入进度"
            message={props.stage || '正在准备安全导入…'}
          />
        )}
        {props.error && <SystemMessage kind="error" message={props.error} />}
        <p>
          {snapshot.modules.length} 个模组 · {snapshot.records.length} 个场次 · {snapshot.characters.length}{' '}
          张角色卡
        </p>
        <p>其中 {props.preview.offlineRecords} 个场次带有已保存正文。</p>
        {props.preview.warnings.map((w) => (
          <SystemMessage kind="warning" message={w} key={w} />
        ))}
        <p>
          将覆盖本机的模组、场次与角色卡（当前 {props.currentRecords}{' '}
          个场次），不会自动合并。确认后先在归档目录生成并回读安全备份；失败则不继续覆盖。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings}
            disabled={props.busy}
            onChange={(e) => setSettings(e.target.checked)}
          />
          恢复主题与阅读过滤设置（不更改保存位置）
        </label>
        <div className="dialog-actions">
          <button disabled={props.busy} onClick={props.onCancel}>
            取消
          </button>
          <button className="primary" disabled={props.busy} onClick={() => props.onConfirm(settings)}>
            {props.busy ? '正在安全导入…' : '确认覆盖并导入'}
          </button>
        </div>
      </section>
    </div>
  )
}
