import { describe, expect, it } from 'vitest'
import { exportRecordTables, previewRecordImport } from '../src/shared/record-table'
import { readWorkbookGrid } from '../src/shared/table-grid'
import type { AppSnapshot } from '../src/shared/types'
import { DEFAULT_FILTER_PRESET } from '../src/shared/types'

const snapshot: AppSnapshot = {
  schemaVersion: 1,
  exportedAt: '',
  characters: [],
  importMappings: [],
  archiveEntries: [],
  settings: {
    theme: 'light',
    archiveDirectory: 'C:\\archive',
    filterPreset: DEFAULT_FILTER_PRESET,
    autoBackup: { enabled: true, interval: 'idle', retention: 10 }
  },
  modules: [
    {
      id: 'm1',
      name: '暗影循迹',
      kps: ['阿默'],
      pairs: [{ pc: '林恩', pl: '小夏' }],
      order: 0,
      collapsed: false,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'm2',
      name: '雾中来客',
      kps: ['北川'],
      pairs: [],
      order: 1,
      collapsed: false,
      createdAt: '',
      updatedAt: ''
    }
  ],
  records: [
    {
      id: 'r1',
      moduleId: 'm1',
      name: '第一场',
      sequenceNo: 1,
      link: 'https://log.weizaima.com/?key=one',
      sourceType: 'online',
      status: 'valid',
      playDate: '2025-03-08',
      dateSource: 'parsed',
      order: 0,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'r2',
      moduleId: 'm2',
      name: '序章',
      sequenceNo: 1,
      sourceType: 'manual',
      status: 'manual',
      dateSource: 'none',
      order: 0,
      createdAt: '',
      updatedAt: ''
    }
  ]
}

describe('record table export and import', () => {
  it('exports one XLSX worksheet per module and round-trips metadata', () => {
    const [file] = exportRecordTables(snapshot, 'xlsx')
    const grid = readWorkbookGrid(file!.bytes, file!.name)
    expect(grid.sheets.map((sheet) => sheet.name)).toEqual(['暗影循迹', '雾中来客'])
    const preview = previewRecordImport(grid)
    expect(preview).toHaveLength(2)
    expect(preview[0]).toMatchObject({
      moduleName: '暗影循迹',
      sessionName: '第一场',
      playDate: '2025-03-08'
    })
  })

  it('returns one UTF-8 CSV per module and supports selected records', () => {
    const files = exportRecordTables(snapshot, 'csv')
    expect(files.map((file) => file.name)).toEqual(['暗影循迹.csv', '雾中来客.csv'])
    expect(new TextDecoder().decode(files[0]!.bytes)).toContain('林恩')
    expect(exportRecordTables(snapshot, 'csv', ['r2'])).toHaveLength(1)
  })

  it('flags unknown links and missing module names during preview', () => {
    const bytes = new TextEncoder().encode('场次名,链接\n测试,https://example.com/log')
    const preview = previewRecordImport(readWorkbookGrid(bytes, 'bad.csv'))
    expect(preview[0]?.warnings).toEqual(['缺少模组名', '链接不是完整海豹网址'])
  })
})
