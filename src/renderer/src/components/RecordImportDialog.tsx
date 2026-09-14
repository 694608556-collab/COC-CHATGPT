import { useState } from 'react'
import * as XLSX from 'xlsx'
import {
  TABLE_IMPORT_HEADERS,
  buildTableImportTemplate,
  normalizeTableImportRows,
  validateTableImportRow,
  type TableImportRow
} from '../../../shared/table-import'
import { DialogShell } from './DialogShell2'

export interface ImportOutcome {
  modules: number
  records: number
  skipped: number
}

export function RecordImportDialog({
  onClose,
  onImport
}: {
  onClose(): void
  onImport(rows: TableImportRow[]): Promise<ImportOutcome>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  const downloadTemplate = (): void => {
    const blob = new Blob([buildTableImportTemplate()], {
      type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'COC跑团记录导入模板.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const readFile = async (file: File): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv')
      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(new Uint8Array(await file.arrayBuffer()), {
            type: 'array'
          })
      const sheetName = workbook.SheetNames[0]
      const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
      if (!sheet) throw new Error('文件中没有可用工作表')
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: ''
      })
      const rows = normalizeTableImportRows(rawRows)
      const invalid = rows.filter((row) => validateTableImportRow(row))
      const valid = rows.filter((row) => !validateTableImportRow(row))
      if (!valid.length) {
        throw new Error('没有读取到可导入的数据行')
      }
      const result = await onImport(valid)
      setDone(true)
      setMessage(
        `已导入 ${result.records} 场，` +
          `新增 ${result.modules} 个模组，` +
          `跳过 ${result.skipped + invalid.length} 行。`
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title="导入表格" onClose={onClose} wide>
      <div className="dialog-body">
        <p className="dialog-note">请按照下方模板格式 整理数据后导入。</p>
        <div className="template-preview">
          <table>
            <thead>
              <tr>
                {TABLE_IMPORT_HEADERS.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>暗影循迹</td>
                <td>第一场</td>
                <td>https://log.weizaima.com/?key=...</td>
                <td>KP 阿默；PC 艾伦/PL 李四</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dialog-note">参与者格式： KP 张三；PC 艾伦/PL 李四； PC 夏恩/PL 王五</p>
        <div className="dialog-actions">
          <button className="secondary" onClick={downloadTemplate}>
            下载空白模板
          </button>
          <label className="secondary file-button">
            选择 CSV / XLSX / XLS
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </label>
        </div>
        {message ? <p className="dialog-result">{message}</p> : null}
      </div>
      <footer className="modal-actions">
        <button className="primary" onClick={onClose} disabled={busy}>
          {done ? '完成' : '关闭'}
        </button>
      </footer>
    </DialogShell>
  )
}
