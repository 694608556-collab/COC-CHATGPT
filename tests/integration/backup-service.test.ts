import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupService } from '../../src/main/backup-service'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'

let directory: string
let database: AppDatabase
let repository: AppRepository
let service: BackupService

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-backup-'))
  database = new AppDatabase(path.join(directory, 'data', 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
  service = new BackupService(repository, path.join(directory, 'data'), path.join(directory, 'data', 'cache'))
})

afterEach(() => database.close())

function seed(): { moduleId: string; recordId: string } {
  const module = repository.createModule({ name: '暗影循迹', playStatus: 'not_started' })
  const record = repository.createRecord({ moduleId: module.id, manualContent: '不可重新抓取的正文' })
  repository.createCharacter({ edition: 7, moduleId: module.id, name: '林恩' })
  return { moduleId: module.id, recordId: record.id }
}

describe('backup, preview, restore and safe cleanup', () => {
  it('backs up business data as JSON without raw cache and restores only after preview', async () => {
    seed()
    fs.mkdirSync(path.join(directory, 'data', 'cache'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'data', 'cache', 'online.json'), 'cache')
    const backup = await service.createBackup(false, path.join(directory, 'backups'))
    const serialized = fs.readFileSync(backup.path, 'utf8')
    expect(serialized).toContain('不可重新抓取的正文')
    expect(serialized).not.toContain('online.json')
    const preview = await service.previewBackup(backup.path)
    expect(preview).toMatchObject({ format: 'json', modules: 1, records: 1, characters: 1, archiveFiles: 0 })

    repository.clearBusinessData({ resetSettings: false, clearMappings: false })
    expect(repository.snapshot().records).toHaveLength(0)
    service.restore(preview.token, { restoreSettings: false })
    expect(repository.snapshot().records[0]?.manualContent).toBe('不可重新抓取的正文')
    expect(repository.snapshot().characters[0]?.basic.name).toBe('林恩')
  })

  it('backs up only registered archive files into ZIP and restores them under a new directory', async () => {
    const { recordId } = seed()
    const archive = path.join(directory, 'archive')
    fs.mkdirSync(path.join(archive, '暗影循迹'), { recursive: true })
    const registered = path.join(archive, '暗影循迹', '记录.txt')
    const unregistered = path.join(archive, '暗影循迹', '用户文件.txt')
    fs.writeFileSync(registered, 'registered')
    fs.writeFileSync(unregistered, 'do not include')
    repository.addArchiveEntry({
      ownerType: 'record',
      ownerId: recordId,
      path: registered,
      format: 'txt',
      size: 10,
      exists: true
    })
    const backup = await service.createBackup(true, path.join(directory, 'backups'))
    const preview = await service.previewBackup(backup.path)
    expect(preview).toMatchObject({ format: 'zip', archiveFiles: 1, archiveBytes: 10 })

    const target = path.join(directory, 'restored')
    repository.clearBusinessData({ resetSettings: false, clearMappings: false })
    service.restore(preview.token, { restoreSettings: true, archiveDirectory: target })
    const entry = repository.archiveEntriesFor('record', recordId)[0]!
    expect(entry.path).toBe(path.join(target, '暗影循迹', '记录.txt'))
    expect(fs.readFileSync(entry.path, 'utf8')).toBe('registered')
    expect(fs.readFileSync(unregistered, 'utf8')).toBe('do not include')
  })

  it('creates automatic backups as lightweight JSON', async () => {
    repository.updateSettings({ autoBackup: { enabled: true } })
    repository.updateSettings({ autoBackup: { interval: 'idle' } })
    repository.updateSettings({ autoBackup: { retention: 1 } })
    seed()
    const first = await service.createAutomaticBackup()
    expect(first).toMatchObject({ format: 'json' })
    expect(first?.path).toContain(path.join('data', 'auto-backups'))

    repository.createModule({ name: 'Auto Module', playStatus: 'not_started' })
    const second = await service.createAutomaticBackup()
    const dir = path.join(directory, 'data', 'auto-backups')
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'))
    expect(files).toHaveLength(1)
    expect(path.join(dir, files[0]!)).toBe(second?.path)
    expect(fs.existsSync(first!.path)).toBe(false)
  })

  it('does not create automatic backups while disabled', async () => {
    repository.updateSettings({ autoBackup: { enabled: false } })
    seed()
    await expect(service.createAutomaticBackup()).resolves.toBeUndefined()
    const dir = path.join(directory, 'data', 'auto-backups')
    expect(fs.existsSync(dir)).toBe(false)
  })
  it('cleans only cache and deletes only registered archive files when explicitly selected', () => {
    const { recordId } = seed()
    const cache = path.join(directory, 'data', 'cache')
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, 'cached.txt'), '1234')
    expect(service.cacheStats()).toEqual({ bytes: 4, files: 1 })
    expect(service.clearCache()).toEqual({ bytes: 4, files: 1 })
    expect(repository.snapshot().records).toHaveLength(1)

    const registered = path.join(directory, 'archive', 'registered.txt')
    const userFile = path.join(directory, 'archive', 'user.txt')
    fs.mkdirSync(path.dirname(registered), { recursive: true })
    fs.writeFileSync(registered, 'app')
    fs.writeFileSync(userFile, 'user')
    repository.addArchiveEntry({
      ownerType: 'record',
      ownerId: recordId,
      path: registered,
      format: 'txt',
      size: 3,
      exists: true
    })
    expect(
      service.clearBusinessData({
        resetSettings: false,
        clearMappings: false,
        deleteRegisteredArchives: true
      })
    ).toBe(1)
    expect(fs.existsSync(registered)).toBe(false)
    expect(fs.existsSync(userFile)).toBe(true)
  })
})
