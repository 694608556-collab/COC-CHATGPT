import * as XLSX from 'xlsx'
import { MODULE_PLAY_STATUS_LABELS, type AppSnapshot, type ModuleRecord, type SessionRecord } from './types'
import type { WorkbookGrid } from './table-grid'

export interface ExportedTableFile {
  name: string
  bytes: Uint8Array
}

export interface ImportPreviewRow {
  sheet: string
  row: number
  moduleName: string
  sessionName: string
  link: string
  status: string
  playDate: string
  warnings: string[]
}

function uniqueSheetName(value: string, used: Set<string>): string {
  const base =
    value
      .replace(/[\\/?*[\]:]/g, '＿')
      .trim()
      .slice(0, 31) || '未命名模组'
  let result = base
  let index = 2
  while (used.has(result.toLocaleLowerCase())) {
    const suffix = ` (${index})`
    result = `${base.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }
  used.add(result.toLocaleLowerCase())
  return result
}

/**
 * 生成模组的表格行，手动正文位于参与者列之前。
 * @param module 模组及其参与者。
 * @param records 已筛选的场次。
 * @param splitLongContent XLSX启用单格长度分块；CSV保留单列全文。
 * @returns 不修改原场次的导出行。
 */
function rowsForModule(
  module: ModuleRecord,
  records: SessionRecord[],
  splitLongContent = false
): Array<Record<string, string>> {
  return records.map((record) => {
    const row: Record<string, string> = {
      模组名: module.name,
      跑团状态: MODULE_PLAY_STATUS_LABELS[module.playStatus],
      场次名: record.name,
      海豹链接: record.link ?? '',
      // 0.6.3 起改叫“链接状态”，避免和“跑团状态”混淆；导入时两个名字都认
      链接状态: record.status,
      跑团日期: record.playDate ?? '',
      最近抓取时间: record.fetchedAt ?? '',
      手动保存内容: record.manualContent ?? ''
    }
    module.kps.forEach((kp, index) => {
      row[`KP${index + 1}`] = kp
    })
    module.pairs.forEach((pair, index) => {
      row[`PC${index + 1}`] = pair.pc
      row[`PL${index + 1}`] = pair.pl
    })
    // Excel 每格最多32767个UTF-16字符；续列放在参与者之后，回导按序合并，避免截断正文。
    if (splitLongContent && row['手动保存内容']!.length > 32767) {
      let remaining = row['手动保存内容']!
      let index = 0
      while (remaining.length) {
        let end = Math.min(32767, remaining.length)
        if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--
        row[index === 0 ? '手动保存内容' : `手动保存内容（续${index}）`] = remaining.slice(0, end)
        remaining = remaining.slice(end)
        index++
      }
    }
    return row
  })
}

export function exportRecordTables(
  snapshot: AppSnapshot,
  format: 'csv' | 'xlsx',
  selectedRecordIds?: string[]
): ExportedTableFile[] {
  const selected = selectedRecordIds ? new Set(selectedRecordIds) : undefined
  const modules = snapshot.modules.filter((module) =>
    snapshot.records.some((record) => record.moduleId === module.id && (!selected || selected.has(record.id)))
  )
  if (!modules.length) throw new Error('没有可导出的场次记录')
  if (format === 'csv') {
    return modules.map((module) => {
      const records = snapshot.records.filter(
        (record) => record.moduleId === module.id && (!selected || selected.has(record.id))
      )
      const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rowsForModule(module, records)))
      return { name: `${module.name}.csv`, bytes: new TextEncoder().encode(`\uFEFF${csv}`) }
    })
  }
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const module of modules) {
    const records = snapshot.records.filter(
      (record) => record.moduleId === module.id && (!selected || selected.has(record.id))
    )
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rowsForModule(module, records, true)),
      uniqueSheetName(module.name, used)
    )
  }
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  return [{ name: 'COC跑团记录.xlsx', bytes: new Uint8Array(output) }]
}

const aliases: Record<string, keyof Omit<ImportPreviewRow, 'sheet' | 'row' | 'warnings'>> = {
  模组名: 'moduleName',
  模组: 'moduleName',
  团名: 'moduleName',
  场次名: 'sessionName',
  场次: 'sessionName',
  名称: 'sessionName',
  海豹链接: 'link',
  日志链接: 'link',
  链接: 'link',
  url: 'link',
  状态: 'status',
  跑团日期: 'playDate',
  日期: 'playDate'
}

export function previewRecordImport(workbook: WorkbookGrid): ImportPreviewRow[] {
  return workbook.sheets.flatMap((sheet) => {
    const header = sheet.rows[0] ?? []
    const mapping = new Map<number, keyof Omit<ImportPreviewRow, 'sheet' | 'row' | 'warnings'>>()
    header.forEach((value, index) => {
      const target =
        aliases[
          String(value ?? '')
            .trim()
            .toLocaleLowerCase()
        ]
      if (target) mapping.set(index, target)
    })
    return sheet.rows.slice(1).flatMap((values, index) => {
      const row: ImportPreviewRow = {
        sheet: sheet.name,
        row: index + 2,
        moduleName: '',
        sessionName: '',
        link: '',
        status: '',
        playDate: '',
        warnings: []
      }
      for (const [column, target] of mapping) row[target] = String(values[column] ?? '').trim()
      if (!row.sessionName && !row.link) return []
      if (!row.moduleName) row.warnings.push('缺少模组名')
      if (row.link && !/^https?:\/\/log\.weizaima\.com\//i.test(row.link))
        row.warnings.push('链接不是完整海豹网址')
      if (!row.sessionName) row.warnings.push('缺少场次名，将在导入时自动生成')
      return [row]
    })
  })
}
