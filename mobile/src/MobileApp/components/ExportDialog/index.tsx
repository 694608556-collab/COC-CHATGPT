import { useState } from 'react'
import { EXPORT_LABELS } from '../../../data/export'
import type { ExportFormat } from '../../../data/export'
import { SelectField } from '../SelectField'
import type { PdfProgress } from '../../../data/pdf'
import { SystemMessage } from '../SystemMessage'
/**
 * 导出确认与统一格式下拉；切换格式不创建文件。
 * @param props - 已选场次、合并方式、忙状态、当前导出错误/进度及导出/取消/关闭请求。
 * @returns 应用风格导出弹窗。
 */
export function ExportDialog(props: {
  count: number
  combined: boolean
  busy: boolean
  /** 当前操作错误；首次导出前不重播其他页面的旧错误。 */
  error?: string
  /** PDF 的真实阶段、页数和批量文件序号，其他格式不提供。 */
  progress?: PdfProgress
  /** 已请求取消、正在等待在途编码和清理时为 true。 */
  cancelling?: boolean
  /** 请求取消当前 PDF，无返回值；最终发布时按钮禁用。 */
  onCancel?(): void
  onClose(): void
  onExport(format: ExportFormat): void
}) {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [attempted, setAttempted] = useState(false)
  const formats = Object.keys(EXPORT_LABELS) as ExportFormat[]
  return (
    <div className="modal-backdrop">
      <section className="restore-dialog panel" role="dialog" aria-modal="true" aria-label="导出日志">
        <h2>{props.combined ? '合成导出' : '批量/单场次导出'}</h2>
        <div className="dialog-body">
          {attempted && props.error && <SystemMessage kind="error" message={props.error} autoHide={false} />}
          <p>已选择 {props.count} 个场次。合成按模组分别生成，批量逐场次保存。</p>
          <SelectField
            label="文件格式"
            disabled={props.busy}
            value={format}
            onChange={(value) => setFormat(value as ExportFormat)}
            options={formats.map((value) => ({ value, label: EXPORT_LABELS[value] }))}
          />
          <p className="muted">
            <strong>按当前过滤设置导出。</strong>带图 DOC 引用远程图片链接；PDF
            使用应用内置字体保留中文与完整正文，不代替可编辑文字备份。未保存正文的场次会报告失败。
          </p>
          {props.busy && props.progress && (
            <div
              role="progressbar"
              aria-label="PDF 导出进度"
              aria-valuemin={0}
              aria-valuemax={props.progress.total || undefined}
              aria-valuenow={props.progress.total ? props.progress.completed : undefined}
            >
              {props.progress.fileTotal && props.progress.fileTotal > 1
                ? `文件 ${props.progress.fileIndex}/${props.progress.fileTotal} · `
                : ''}
              {props.cancelling
                ? '正在取消并清理临时文件…'
                : props.progress.stage === 'layout'
                  ? '正在排版完整正文…'
                  : `${props.progress.stage === 'save' ? '正在保存并校验' : props.progress.stage === 'encode' ? '正在编码完整 PDF' : '正在生成 PDF'}：${props.progress.completed}/${props.progress.total} 页`}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button
            disabled={props.busy && (!props.onCancel || props.cancelling || props.progress?.stage === 'save')}
            onClick={props.busy ? props.onCancel : props.onClose}
          >
            {props.busy && props.onCancel ? '取消导出' : '取消'}
          </button>
          <button
            className="primary"
            disabled={props.busy}
            onClick={() => {
              setAttempted(true)
              props.onExport(format)
            }}
          >
            {props.busy ? '正在导出…' : '保存导出文件'}
          </button>
        </div>
      </section>
    </div>
  )
}
