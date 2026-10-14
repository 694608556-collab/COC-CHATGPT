import { useEffect, useRef, useState } from 'react'
import { EXPORT_LABELS } from '../../../data/export'
import type { ExportFormat } from '../../../data/export'
export function ExportDialog(props: {
  count: number
  combined: boolean
  busy: boolean
  onClose(): void
  onExport(format: ExportFormat): void
}) {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [open, setOpen] = useState(false)
  const picker = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef(new Map<string, HTMLButtonElement>())
  const formats = Object.keys(EXPORT_LABELS) as ExportFormat[]
  useEffect(() => {
    if (!open) return
    options.current.get(format)?.focus()
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, format])
  useEffect(() => {
    if (props.busy) setOpen(false)
  }, [props.busy])
  return (
    <div className="modal-backdrop">
      <section className="restore-dialog panel" role="dialog" aria-modal="true" aria-label="导出日志">
        <h2>{props.combined ? '合成导出' : '批量/单场次导出'}</h2>
        <p>已选择 {props.count} 个场次。合成按模组分别生成，批量逐场次保存。</p>
        <div className="field">
          <span id="export-format-label">文件格式</span>
          <div
            className="format-picker"
            ref={picker}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
            }}
          >
            <button
              type="button"
              className="format-trigger"
              ref={trigger}
              disabled={props.busy}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls="export-format-options"
              aria-labelledby="export-format-label export-format-value"
              onClick={() => setOpen(!open)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
            >
              <span id="export-format-value">{EXPORT_LABELS[format]}</span>
              <span aria-hidden="true">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
              <div
                id="export-format-options"
                className="format-options"
                role="listbox"
                aria-labelledby="export-format-label"
              >
                {formats.map((value, index) => (
                  <button
                    type="button"
                    role="option"
                    key={value}
                    aria-selected={format === value}
                    ref={(node) => {
                      if (node) options.current.set(value, node)
                      else options.current.delete(value)
                    }}
                    onClick={() => {
                      setFormat(value)
                      setOpen(false)
                      trigger.current?.focus()
                    }}
                    onKeyDown={(event) => {
                      let next = index
                      if (event.key === 'ArrowDown') next = (index + 1) % formats.length
                      else if (event.key === 'ArrowUp') next = (index + formats.length - 1) % formats.length
                      else if (event.key === 'Home') next = 0
                      else if (event.key === 'End') next = formats.length - 1
                      else if (event.key === 'Escape') {
                        event.preventDefault()
                        setOpen(false)
                        trigger.current?.focus()
                        return
                      } else return
                      event.preventDefault()
                      options.current.get(formats[next]!)?.focus()
                    }}
                  >
                    {EXPORT_LABELS[value]}
                    {format === value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="muted">
          按当前过滤设置导出。带图 DOC 引用远程图片链接；PDF
          使用应用内置字体生成页面图像，保留中文，但文字无法复制搜索。未保存正文的场次会报告失败。
        </p>
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
