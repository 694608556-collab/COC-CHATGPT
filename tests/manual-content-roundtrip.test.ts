import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { exportRecordTables } from '../src/shared/record-table'
import { parseImportWorkbook, validateTableImportRow } from '../src/shared/table-import'
import type { AppSnapshot } from '../src/shared/types'

describe('手动正文表格往返', () => {
  for (const format of ['csv', 'xlsx'] as const) {
    it(`${format} 在KP前保留多行手动正文并允许无链接导入`, () => {
      const body = '第一行，含逗号与"引号"\n第二行：中文正文' + '长篇正文😀\n'.repeat(9000)
      const snapshot = {
        modules: [{ id: 'm', name: '公开模组', playStatus: 'not_started', kps: ['公开KP'], pairs: [] }],
        records: [{ id: 'r', moduleId: 'm', name: '第一场', manualContent: body, status: 'manual' }]
      } as unknown as AppSnapshot
      const file = exportRecordTables(snapshot, format)[0]!
      const workbook = XLSX.read(file.bytes, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]!]!
      const header = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0]!
      expect(header.indexOf('手动保存内容')).toBe(header.indexOf('KP1') - 1)
      const row = parseImportWorkbook(workbook)[0]!
      expect(row).toHaveProperty('manualContent', body)
      expect(validateTableImportRow(row)).toBeUndefined()
      expect(snapshot.records[0]!.manualContent).toBe(body)
    })
  }
})
