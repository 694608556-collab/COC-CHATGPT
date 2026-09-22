import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'

let database: AppDatabase
let repository: AppRepository
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-db-'))
  database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('SQLite repository', () => {
  it('creates the v1 schema and survives reopening', () => {
    expect(database.integrityCheck()).toBe('ok')
    repository.createModule({
      name: '暗影循迹',
      playStatus: 'not_started',
      kps: [' 阿默 ', ''],
      pairs: [
        { pc: '林恩', pl: '小夏' },
        { pc: '', pl: '' }
      ]
    })
    database.close()
    database = new AppDatabase(path.join(directory, 'coc.sqlite'))
    database.initialize()
    repository = new AppRepository(database, path.join(directory, 'archive'))
    expect(repository.snapshot().modules[0]).toMatchObject({
      name: '暗影循迹',
      kps: ['阿默'],
      pairs: [{ pc: '林恩', pl: '小夏' }]
    })
  })

  it('keeps existing session names and numbers after deletion and sorting', () => {
    const module = repository.createModule({ name: '无尽食欲', playStatus: 'not_started' })
    const first = repository.createRecord({ moduleId: module.id })
    const second = repository.createRecord({ moduleId: module.id })
    repository.deleteRecord(second.id)
    const third = repository.createRecord({ moduleId: module.id })
    repository.moveRecord(third.id, -1)
    const records = repository.snapshot().records
    // 删除不会重命名或重排已有场次：第 1 场仍然叫第 1 场
    expect(first.name).toBe('无尽食欲第 1 场')
    // 0.6.2 起新增场次接续现存场次的最大编号，末尾被删掉的编号会被重新使用
    expect(third.name).toBe('无尽食欲第 2 场')
    expect(records.map((record) => record.sequenceNo)).toEqual([2, 1])
  })

  it('resets probe state so an imported link must be checked again', () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const record = repository.createRecord({
      moduleId: module.id,
      link: 'https://log.weizaima.com/?key=one'
    })
    repository.updateRecord(record.id, {
      status: 'valid',
      rawContent: { messages: [], parserVersion: 1 },
      fetchedAt: '2026-09-22T04:07:50.839Z',
      cacheSourceUrl: record.link
    })
    repository.updateRecord(record.id, { status: 'fetch_failed', lastError: '连接超时' })

    const reset = repository.resetRecordProbeState(record.id)
    expect(reset.status).toBe('pending')
    expect(reset.previousStatus).toBeUndefined()
    expect(reset.rawContent).toBeUndefined()
    expect(reset.fetchedAt).toBeUndefined()
    expect(reset.cacheSourceUrl).toBeUndefined()
    expect(reset.lastError).toBeUndefined()
    // 链接本身保留，用户不需要重新填写
    expect(reset.link).toBe(record.link)
  })

  it('never resets a manual-content session when importing', () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const record = repository.createRecord({ moduleId: module.id, manualContent: '本地正文' })
    const reset = repository.resetRecordProbeState(record.id)
    expect(reset.status).toBe('manual')
    expect(reset.manualContent).toBe('本地正文')
  })

  it('persists collapse, ordering, theme and manual content', () => {
    const first = repository.createModule({ name: '模组甲', playStatus: 'not_started' })
    const second = repository.createModule({ name: '模组乙', playStatus: 'not_started' })
    repository.moveModule(second.id, -1)
    repository.updateModule(first.id, { collapsed: true })
    repository.createRecord({ moduleId: first.id, manualContent: '本地正文', playDate: '2025-03-08' })
    repository.updateSettings({ theme: 'dark' })
    const snapshot = repository.snapshot()
    expect(snapshot.modules.map((module) => module.name)).toEqual(['模组乙', '模组甲'])
    expect(snapshot.modules[1]?.collapsed).toBe(true)
    expect(snapshot.records[0]).toMatchObject({
      status: 'manual',
      dateSource: 'manual',
      manualContent: '本地正文'
    })
    expect(snapshot.settings.theme).toBe('dark')
  })

  it('resets online status when a link changes and keeps old cache isolated', () => {
    const module = repository.createModule({ name: '模组', playStatus: 'not_started' })
    const record = repository.createRecord({ moduleId: module.id, link: 'https://log.weizaima.com/?key=one' })
    repository.updateRecord(record.id, {
      status: 'valid',
      cacheSourceUrl: record.link,
      fetchedAt: new Date().toISOString()
    })
    const changed = repository.updateRecord(record.id, { link: 'https://log.weizaima.com/?key=two' })
    expect(changed.status).toBe('pending')
    expect(changed.previousStatus).toBe('valid')
    expect(changed.cacheSourceUrl).toContain('key=one')
  })

  it('finds duplicate sea links inside one module and ignores the edited record itself', () => {
    const firstModule = repository.createModule({ name: '\u6a21\u7ec4\u4e00', playStatus: 'not_started' })
    const secondModule = repository.createModule({ name: '\u6a21\u7ec4\u4e8c', playStatus: 'not_started' })
    const first = repository.createRecord({
      moduleId: firstModule.id,
      link: 'https://log.weizaima.com/?key=dup#111111'
    })
    const second = repository.createRecord({
      moduleId: firstModule.id,
      link: 'https://log.weizaima.com/?key=other#222222'
    })
    repository.createRecord({
      moduleId: secondModule.id,
      link: 'https://log.weizaima.com/?key=dup#111111'
    })

    expect(repository.findDuplicateLink(firstModule.id, first.link!)).toMatchObject({ id: first.id })
    expect(repository.findDuplicateLink(firstModule.id, first.link!, first.id)).toBeUndefined()
    expect(repository.findDuplicateLink(firstModule.id, second.link!, first.id)).toMatchObject({
      id: second.id
    })
    expect(repository.findDuplicateLink(secondModule.id, second.link!)).toBeUndefined()
  })
})
