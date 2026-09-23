import { useState } from 'react'
import * as XLSX from 'xlsx'
import {
  TABLE_TEMPLATE_HEADERS,
  buildTableImportTemplateCsv,
  buildTableImportTemplateXlsx,
  parseImportWorkbook,
  validateTableImportRow,
  type TableImportRow
} from '../../../shared/table-import'
import { DialogShell } from './DialogShell'

export interface ImportOutcome {
  modules: number
  records: number
  updated: number
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

  const download = (fileName: string, content: string | BlobPart, type: string): void => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadXlsxTemplate = (): void => {
    download(
      'COC跑团记录导入模板.xlsx',
      buildTableImportTemplateXlsx().buffer as ArrayBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  }

  const downloadCsvTemplate = (): void => {
    download(buildTableImportTemplateCsv(), 'COC跑团记录导入模板.csv', 'text/csv;charset=utf-8')
  }

  const readFile = async (file: File): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv')
      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const rows = parseImportWorkbook(workbook)
      if (!rows.length) throw new Error('没有识别到表头，请使用本软件提供的空白模板或导出的表格')
      const invalid = rows.filter((row) => validateTableImportRow(row))
      const valid = rows.filter((row) => !validateTableImportRow(row))
      if (!valid.length) {
        throw new Error(invalid.length ? `没有可导入的数据行（${invalid.length} 行信息不完整）` : '没有读取到可导入的数据行')
      }
      const result = await onImport(valid)
      setDone(true)
      setMessage(
        `已读取 ${workbook.SheetNames.length} 个工作表；新增 ${result.records} 场，覆盖更新 ${result.updated} 场，` +
          `新增 ${result.modules} 个模组，跳过 ${result.skipped + invalid.length} 行。`
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
        <p className="dialog-note">请按照下方模板格式整理数据后导入；本软件导出的表格可直接重新导入。</p>
        <div className="template-preview">
          <table>
            <thead>
              <tr>
                {TABLE_TEMPLATE_HEADERS.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>暗影循迹</td>
                <td>第一场</td>
                <td>https://log.weizaima.com/?key=...</td>
                <td>阿默</td>
                <td>艾伦</td>
                <td>李四</td>
                <td>夏恩</td>
                <td>王五</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dialog-note">
          PC/PL 必须按列成对填写：PC1/PL1、PC2/PL2、PC3/PL3；KP 填在 KP1 列，没有对应人员的格子留空。
        </p>
        <p className="dialog-note">
          状态、跑团日期、最近抓取时间三列由软件导出时自动记录，空白模板无需填写；把导出的表格重新导入时会自动带回这些信息。
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={downloadXlsxTemplate}>
            下载空白模板（xlsx）
          </button>
          <button className="secondary" onClick={downloadCsvTemplate}>
            下载空白模板（CSV）
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
