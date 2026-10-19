import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as unzipper from 'unzipper'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseImportWorkbook } from '../../src/shared/table-import'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'
import { TableExportService } from '../../src/main/table-export-service'

let database: AppDatabase
let repository: AppRepository
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-table-export-'))
  database = new AppDatabase(path.join(directory, 'data', 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('table export service', () => {
  for (const format of ['xlsx', 'csv'] as const) {
    it(`${format} 多模组旧归档被移走后再次导出，文件和登记均成功`, async () => {
      for (const name of ['公开重复导出甲', '公开重复导出乙']) {
        const module = repository.createModule({ name, playStatus: 'not_started' })
        repository.createRecord({ moduleId: module.id, manualContent: '公开正文' })
      }
      const service = new TableExportService(repository)
      const first = await service.export(format)
      fs.unlinkSync(first.path)
      const second = await service.export(format)
      expect(fs.existsSync(second.path)).toBe(true)
      expect(second.path).not.toBe(first.path)
      expect(repository.archiveEntriesFor('backup', 'record-table')).toHaveLength(2)
      if (format === 'csv')
        expect((await unzipper.Open.buffer(fs.readFileSync(second.path))).files).toHaveLength(2)
      else expect(XLSX.read(fs.readFileSync(second.path)).SheetNames).toHaveLength(2)
    })
  }

  it('并发多模组CSV导出生成不同且完整的ZIP，前一失败不会阻塞后续', async () => {
    for (const name of ['公开并发甲', '公开并发乙']) {
      const module = repository.createModule({ name, playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, manualContent: '公开正文' })
    }
    const service = new TableExportService(repository)
    await expect(service.export('csv', [])).rejects.toThrow('没有可导出的场次记录')
    const entries = await Promise.all([service.export('csv'), service.export('csv')])
    expect(new Set(entries.map((entry) => entry.path)).size).toBe(2)
    for (const entry of entries)
      expect((await unzipper.Open.buffer(fs.readFileSync(entry.path))).files).toHaveLength(2)
    expect(repository.archiveEntriesFor('backup', 'record-table')).toHaveLength(2)
  })

  it('保留数据库手动正文并可从归档表格完整恢复', async () => {
    const module = repository.createModule({
      name: '公开往返模组',
      playStatus: 'not_started',
      kps: ['公开KP']
    })
    const body = '第一段，含"引号"\n\n第二段正文😀' + '公开长正文\n'.repeat(9000) + '末段'
    const record = repository.createRecord({ moduleId: module.id, manualContent: body })
    for (const format of ['csv', 'xlsx'] as const) {
      const entry = await new TableExportService(repository).export(format, [record.id])
      const rows = parseImportWorkbook(XLSX.read(fs.readFileSync(entry.path)))
      expect(rows[0]!.manualContent).toBe(body)
      const restoredModule = repository.createModule({ name: `恢复${format}`, playStatus: 'not_started' })
      const restored = repository.createRecord({
        moduleId: restoredModule.id,
        name: rows[0]!.sessionName,
        manualContent: rows[0]!.manualContent,
        link: rows[0]!.link
      })
      expect(restored.manualContent).toBe(body)
      expect(restored.status).toBe('manual')
      expect(repository.findRecord(record.id).manualContent).toBe(body)
    }
  })

  it('writes multiple modules to separate XLSX worksheets', async () => {
    const first = repository.createModule({ name: '模组甲', playStatus: 'not_started' })
    const second = repository.createModule({ name: '模组乙', playStatus: 'not_started' })
    repository.createRecord({ moduleId: first.id, manualContent: '甲' })
    repository.createRecord({ moduleId: second.id, manualContent: '乙' })

    const entry = await new TableExportService(repository).export('xlsx')
    const workbook = XLSX.read(fs.readFileSync(entry.path))

    expect(workbook.SheetNames).toEqual(['模组甲', '模组乙'])
    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(repository.archiveEntriesFor('backup', 'record-table')).toHaveLength(1)
  })

  it('packages multi-module CSV output as a ZIP and respects selection', async () => {
    const first = repository.createModule({ name: '甲/组', playStatus: 'not_started' })
    const second = repository.createModule({ name: '乙组', playStatus: 'not_started' })
    const firstRecord = repository.createRecord({ moduleId: first.id, manualContent: '甲' })
    repository.createRecord({ moduleId: second.id, manualContent: '乙' })
    const service = new TableExportService(repository)

    const zipEntry = await service.export('csv')
    const archive = await unzipper.Open.buffer(fs.readFileSync(zipEntry.path))
    expect(archive.files.map((file) => file.path).sort()).toEqual(['乙组.csv', '甲＿组.csv'])

    const selectedEntry = await service.export('csv', [firstRecord.id])
    expect(path.extname(selectedEntry.path)).toBe('.csv')
    expect(fs.readFileSync(selectedEntry.path).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  })
})
