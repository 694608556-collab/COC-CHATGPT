import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as unzipper from 'unzipper'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
