import { useState } from 'react'
import { EXPORT_LABELS } from '../../../data/export'
import type { ExportFormat } from '../../../data/export'
import { SelectField } from '../SelectField'
/**
 * 导出确认与统一格式下拉；切换格式不创建文件。
 * @param props - 已选场次、合并方式、忙状态及导出/关闭请求。
 * @returns 应用风格导出弹窗。
 */
export function ExportDialog(props: {
  count: number
  combined: boolean
  busy: boolean
  onClose(): void
  onExport(format: ExportFormat): void
}) {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const formats = Object.keys(EXPORT_LABELS) as ExportFormat[]
  return (
    <div className="modal-backdrop">
      <section className="restore-dialog panel" role="dialog" aria-modal="true" aria-label="导出日志">
        <h2>{props.combined ? '合成导出' : '批量/单场次导出'}</h2>
        <div className="dialog-body">
          <p>已选择 {props.count} 个场次。合成按模组分别生成，批量逐场次保存。</p>
          <SelectField
            label="文件格式"
            disabled={props.busy}
            value={format}
            onChange={(value) => setFormat(value as ExportFormat)}
            options={formats.map((value) => ({ value, label: EXPORT_LABELS[value] }))}
          />
          <p className="muted">
            按当前过滤设置导出。带图 DOC 引用远程图片链接；PDF
            使用应用内置字体生成页面图像，保留中文，但文字无法复制搜索。未保存正文的场次会报告失败。
          </p>
        </div>
        <div className="dialog-actions">
          <button disabled={props.busy} onClick={props.onClose}>
            取消
          </button>
          <button className="primary" disabled={props.busy} onClick={() => props.onExport(format)}>
            {props.busy ? '正在导出…' : '保存导出文件'}
          </button>
        </div>
      </section>
    </div>
  )
}
