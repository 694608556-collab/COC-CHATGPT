import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  TABLE_TEMPLATE_HEADERS,
  buildTableImportTemplateCsv,
  buildTableImportTemplateXlsx,
  mergeImportedParticipants,
  parseImportedParticipants,
  parseImportSheet,
  parseImportWorkbook,
  validateTableImportRow,
  type TableImportRow
} from '../src/shared/table-import'
import { exportRecordTables } from '../src/shared/record-table'
import { DEFAULT_FILTER_PRESET, type AppSnapshot } from '../src/shared/types'

function sheetRows(rows: Array<Array<unknown>>): TableImportRow[] {
  return parseImportSheet('导入模板', rows)
}

describe('table import templates', () => {
  it('ships an xlsx blank template with one KP and three PC/PL pairs plus notes', () => {
    const bytes = buildTableImportTemplateXlsx()
    const workbook = XLSX.read(bytes, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    expect(rows[0]).toEqual([...TABLE_TEMPLATE_HEADERS])
    expect(TABLE_TEMPLATE_HEADERS).toEqual([
      '模组名',
      '场次名',
      '海豹链接',
      'KP1',
      'PC1',
      'PL1',
      'PC2',
      'PL2',
      'PC3',
      'PL3'
    ])
    const notes = rows.slice(2).map((row) => String(row[0] ?? '')).join('\n')
    expect(notes).toContain('填写说明')
    expect(notes).toContain('PC1/PL1')
    // the template itself must parse without importing the note rows
    const parsed = parseImportWorkbook(workbook)
    expect(parsed).toHaveLength(1)
    expect(validateTableImportRow(parsed[0]!)).toBeUndefined()
  })

  it('ships a CSV blank template with the same headers and note lines', () => {
    const csv = buildTableImportTemplateCsv()
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n')
    expect(lines[0]).toBe(TABLE_TEMPLATE_HEADERS.join(','))
    expect(csv).toContain('# 填写说明')
    const workbook = XLSX.read(csv.replace(/^\uFEFF/, ''), { type: 'string' })
    const parsed = parseImportWorkbook(workbook)
    expect(parsed).toHaveLength(1)
  })
})

describe('table import parsing', () => {
  it('reads KP/PC/PL columns by their numbered positions', () => {
    const rows = sheetRows([
      [...TABLE_TEMPLATE_HEADERS],
      ['暗影循迹', '第一场', 'https://log.weizaima.com/?key=one', '阿默', '艾伦', '李四', '夏恩', '王五', '', ''],
      ['暗影循迹', '第二场', 'https://log.weizaima.com/?key=two', '阿默', '艾伦', '李四', '', '', '孤星', '']
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.kps).toEqual(['阿默'])
    expect(rows[0]!.pairs).toEqual([
      { pc: '艾伦', pl: '李四' },
      { pc: '夏恩', pl: '王五' }
    ])
    expect(rows[1]!.pairs).toEqual([
      { pc: '艾伦', pl: '李四' },
      { pc: '孤星', pl: '' }
    ])
  })

  it('still supports the legacy free-text participants column', () => {
    const rows = sheetRows([
      ['模组名', '场次名', '海豹链接', '参与者'],
      ['暗影循迹', '第一场', 'https://log.weizaima.com/?key=one', 'KP 阿默；PC 艾伦/PL 李四']
    ])
    expect(rows[0]!.kps).toEqual(['阿默'])
    expect(rows[0]!.pairs).toEqual([{ pc: '艾伦', pl: '李四' }])
  })

  it('captures status, play date and fetched time from exported files', () => {
    const rows = sheetRows([
      ['模组名', '场次名', '海豹链接', '状态', '跑团日期', '最近抓取时间', 'KP1'],
      [
        '暗影循迹',
        '暗影循迹第 1 场',
        'https://log.weizaima.com/?key=one',
        'valid',
        '2026-03-15',
        '2026-09-22T04:07:50.839Z',
        '阿默'
      ]
    ])
    expect(rows[0]).toMatchObject({
      moduleName: '暗影循迹',
      sessionName: '暗影循迹第 1 场',
      link: 'https://log.weizaima.com/?key=one',
      status: 'valid',
      playDate: '2026-03-15',
      fetchedAt: '2026-09-22T04:07:50.839Z'
    })
  })

  it('reports invalid rows without throwing', () => {
    const [row] = sheetRows([
      [...TABLE_TEMPLATE_HEADERS],
      ['', '', 'not-a-url', '', '', '', '', '', '', '']
    ])
    expect(validateTableImportRow(row!)).toContain('模组')
  })

  it('parses free text KP and paired PC/PL values', () => {
    const value = ['KP 阿默', 'PC 艾伦/PL 李四', '夏恩/王五', 'PC 孤星'].join('；')
    expect(parseImportedParticipants(value)).toEqual({
      kps: ['阿默'],
      pairs: [
        { pc: '艾伦', pl: '李四' },
        { pc: '夏恩', pl: '王五' },
        { pc: '孤星', pl: '' }
      ]
    })
  })

  it('merges participant names without duplicates', () => {
    const merged = mergeImportedParticipants(
      { kps: ['阿默'], pairs: [{ pc: '艾伦', pl: '李四' }] },
      { kps: ['阿默', '张三'], pairs: [{ pc: '艾伦', pl: '李四' }] }
    )
    expect(merged.kps).toEqual(['阿默', '张三'])
    expect(merged.pairs).toHaveLength(1)
  })
})

describe('exported workbook round-trip', () => {
  const snapshot: AppSnapshot = {
    schemaVersion: 2,
    exportedAt: '',
    characters: [],
    notes: [],
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
        name: '铸形骸',
        kps: ['空竹轻靡'],
        pairs: [
          { pc: '温煦', pl: '长风' },
          { pc: '陆桉阳', pl: '烟簔雨涨' }
        ],
        order: 0,
        collapsed: false,
        createdAt: '',
        updatedAt: ''
      }
    ],
    records: [
      {
        id: 'r1',
        moduleId: 'm1',
        name: '铸形骸第 1 场',
        sequenceNo: 1,
        link: 'https://log.weizaima.com/?key=gqb2%23720262',
        sourceType: 'online',
        status: 'valid',
        playDate: '2026-03-15',
        dateSource: 'manual',
        fetchedAt: '2026-09-22T04:07:50.839Z',
        order: 0,
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 'r2',
        moduleId: 'm1',
        name: '铸形骸第 2 场',
        sequenceNo: 2,
        link: 'https://log.weizaima.com/?key=gclc%23652184',
        sourceType: 'online',
        status: 'pending',
        dateSource: 'none',
        order: 1,
        createdAt: '',
        updatedAt: ''
      }
    ]
  }

  it('re-imports every sheet and carries back metadata columns', () => {
    const [file] = exportRecordTables(snapshot, 'xlsx')
    const workbook = XLSX.read(file!.bytes, { type: 'array' })
    const rows = parseImportWorkbook(workbook)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      sheet: '铸形骸',
      moduleName: '铸形骸',
      sessionName: '铸形骸第 1 场',
      status: 'valid',
      playDate: '2026-03-15',
      fetchedAt: '2026-09-22T04:07:50.839Z'
    })
    expect(rows[0]!.kps).toEqual(['空竹轻靡'])
    expect(rows[0]!.pairs).toEqual([
      { pc: '温煦', pl: '长风' },
      { pc: '陆桉阳', pl: '烟簔雨涨' }
    ])
    expect(rows[1]!.status).toBe('pending')
    expect(rows[1]!.playDate).toBeUndefined()
  })
})
