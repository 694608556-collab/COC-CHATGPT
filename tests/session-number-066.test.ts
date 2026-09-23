import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, CURRENT_SCHEMA_VERSION, realignRecordSequences } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { sessionNameFor, sessionNumberFromName } from '../src/shared/session-number'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.6 session number follows the session name', () => {
  describe('sessionNumberFromName', () => {
    it('reads the number out of the default name shape', () => {
      expect(sessionNumberFromName('铸形骸，灯心性，启天命第 10 场')).toBe(10)
      expect(sessionNumberFromName('模组第1场')).toBe(1)
      expect(sessionNumberFromName('模组 第  16  场')).toBe(16)
      expect(sessionNumberFromName('模组第 007 场')).toBe(7)
    })

    it('takes the last number when the module name carries one too', () => {
      // 默认名是“<模组名>第 N 场”，模组名自己带“第 N 场”时不能取错
      expect(sessionNumberFromName('暗影循迹第 3 场第 12 场')).toBe(12)
    })

    it('reads full-width digits', () => {
      expect(sessionNumberFromName('模组第 １２ 场')).toBe(12)
    })

    it('returns undefined when the name carries no number', () => {
      expect(sessionNumberFromName('决战夜')).toBeUndefined()
      expect(sessionNumberFromName('')).toBeUndefined()
      expect(sessionNumberFromName(undefined)).toBeUndefined()
      // 超出后端 1-9999 的范围时视为没写编号，交给默认接续
      expect(sessionNumberFromName('模组第 10000 场')).toBeUndefined()
      expect(sessionNumberFromName('模组第 0 场')).toBeUndefined()
    })

    it('round-trips through sessionNameFor', () => {
      for (const value of [1, 9, 10, 16, 9999]) {
        expect(sessionNumberFromName(sessionNameFor('铸形骸', value))).toBe(value)
      }
    })
  })

  describe('createRecord', () => {
    let database: AppDatabase
    let repository: AppRepository
    let directory: string

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-name-seq-'))
      database = new AppDatabase(path.join(directory, 'coc.sqlite'))
      database.initialize()
      repository = new AppRepository(database, path.join(directory, 'archive'))
    })

    afterEach(() => database.close())

    it('takes the number from an imported session name instead of appending', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      // 表格带进来的场次名写着第 17 场，编号就必须是 17，而不是“下一个空位”
      const record = repository.createRecord({ moduleId: module.id, name: '铸形骸第 17 场' })
      expect(record.sequenceNo).toBe(17)
    })

    it('still appends when the name carries no number', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, name: '开场' })
      const second = repository.createRecord({ moduleId: module.id, name: '决战夜' })
      expect(second.sequenceNo).toBe(2)
      // 名称里没有编号时不能凭空改名，用户起的名原样保留
      expect(second.name).toBe('决战夜')
    })

    it('falls back to appending when the named number is already taken', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 5 场' })
      const clash = repository.createRecord({ moduleId: module.id, name: '铸形骸第 5 场' })
      // 撞号时退回接续，绝不写出重复编号
      expect(clash.sequenceNo).toBe(6)
    })

    it('lets an explicit sequence number win over the name', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const record = repository.createRecord({
        moduleId: module.id,
        name: '铸形骸第 9 场',
        sequenceNo: 3
      })
      expect(record.sequenceNo).toBe(3)
    })
  })

  describe('renaming a session', () => {
    let database: AppDatabase
    let repository: AppRepository
    let directory: string

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-seq-'))
      database = new AppDatabase(path.join(directory, 'coc.sqlite'))
      database.initialize()
      repository = new AppRepository(database, path.join(directory, 'archive'))
    })

    afterEach(() => database.close())

    it('moves the number with the name so the two never split', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const record = repository.createRecord({ moduleId: module.id, name: '铸形骸第 17 场' })
      const renamed = repository.updateRecord(record.id, { name: '铸形骸第 10 场' })
      expect(renamed.sequenceNo).toBe(10)
      expect(renamed.name).toBe('铸形骸第 10 场')
    })

    it('keeps the number when the new name carries none', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const record = repository.createRecord({ moduleId: module.id, name: '铸形骸第 4 场' })
      const renamed = repository.updateRecord(record.id, { name: '决战夜' })
      expect(renamed.sequenceNo).toBe(4)
    })

    it('keeps the number rather than colliding with another session', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 1 场' })
      const second = repository.createRecord({ moduleId: module.id, name: '铸形骸第 2 场' })
      const renamed = repository.updateRecord(second.id, { name: '铸形骸第 1 场' })
      expect(renamed.sequenceNo).toBe(2)
    })

    it('leaves other fields untouched when only the number moves', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const record = repository.createRecord({
        moduleId: module.id,
        name: '铸形骸第 2 场',
        manualContent: '正文'
      })
      const renamed = repository.updateRecord(record.id, { name: '铸形骸第 7 场' })
      expect(renamed.sequenceNo).toBe(7)
      expect(renamed.manualContent).toBe('正文')
      expect(renamed.status).toBe('manual')
    })
  })

  describe('realignRecordSequences', () => {
    let database: AppDatabase
    let repository: AppRepository
    let directory: string

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-realign-'))
      database = new AppDatabase(path.join(directory, 'coc.sqlite'))
      database.initialize()
      repository = new AppRepository(database, path.join(directory, 'archive'))
    })

    afterEach(() => database.close())

    it('repairs the imported names that no longer match their numbers', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      // 复现用户的真实数据：名称是 1-4，编号却是 1-3 与 17
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 1 场' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 2 场' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 3 场' })
      const stray = repository.createRecord({ moduleId: module.id, sequenceNo: 17 })
      database.connection.prepare('UPDATE records SET name=? WHERE id=?').run('铸形骸第 4 场', stray.id)

      const fixed = repository.realignModuleSequences(module.id)
      expect(fixed).toBe(1)
      const numbers = repository
        .snapshot()
        .records.map((record) => record.sequenceNo)
        .sort((a, b) => a - b)
      expect(numbers).toEqual([1, 2, 3, 4])
    })

    it('swaps two numbers that were exchanged by a rename', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const first = repository.createRecord({ moduleId: module.id, name: '铸形骸第 1 场' })
      const second = repository.createRecord({ moduleId: module.id, name: '铸形骸第 2 场' })
      // 直接改库模拟“两场编号互换”，逐条改时谁都动不了
      database.connection.prepare('UPDATE records SET name=? WHERE id=?').run('铸形骸第 2 场', first.id)
      database.connection.prepare('UPDATE records SET name=? WHERE id=?').run('铸形骸第 1 场', second.id)

      expect(realignRecordSequences(database.connection)).toBe(2)
      expect(repository.findRecord(first.id).sequenceNo).toBe(2)
      expect(repository.findRecord(second.id).sequenceNo).toBe(1)
    })

    it('never writes a duplicate number', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 1 场' })
      // 两场都叫第 5 场：目标有歧义，一律不动
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 5 场' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 5 场' })

      realignRecordSequences(database.connection)
      const numbers = repository.snapshot().records.map((record) => record.sequenceNo)
      expect(new Set(numbers).size).toBe(numbers.length)
    })

    it('leaves hand-named sessions and their numbers alone', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      const custom = repository.createRecord({ moduleId: module.id, name: '决战夜' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 2 场' })

      realignRecordSequences(database.connection)
      expect(repository.findRecord(custom.id).sequenceNo).toBe(1)
      expect(repository.findRecord(custom.id).name).toBe('决战夜')
    })

    it('is idempotent and never renames anything', () => {
      const module = repository.createModule({ name: '铸形骸', playStatus: 'not_started' })
      repository.createRecord({ moduleId: module.id, name: '铸形骸第 1 场' })
      const stray = repository.createRecord({ moduleId: module.id, sequenceNo: 9 })
      database.connection.prepare('UPDATE records SET name=? WHERE id=?').run('铸形骸第 2 场', stray.id)

      const namesBefore = repository.snapshot().records.map((record) => record.name)
      expect(realignRecordSequences(database.connection)).toBe(1)
      expect(realignRecordSequences(database.connection)).toBe(0)
      expect(repository.snapshot().records.map((record) => record.name)).toEqual(namesBefore)
    })

    it('keeps modules independent', () => {
      const moduleA = repository.createModule({ name: '甲', playStatus: 'not_started' })
      const moduleB = repository.createModule({ name: '乙', playStatus: 'not_started' })
      repository.createRecord({ moduleId: moduleA.id, name: '甲第 1 场' })
      const strayB = repository.createRecord({ moduleId: moduleB.id, sequenceNo: 3 })
      database.connection.prepare('UPDATE records SET name=? WHERE id=?').run('乙第 1 场', strayB.id)

      // 只重排甲时，乙保持原样
      expect(repository.realignModuleSequences(moduleA.id)).toBe(0)
      expect(repository.findRecord(strayB.id).sequenceNo).toBe(3)
      expect(repository.realignModuleSequences(moduleB.id)).toBe(1)
      expect(repository.findRecord(strayB.id).sequenceNo).toBe(1)
    })
  })

  describe('schema v5 migration', () => {
    it('is wired into the upgrade path', () => {
      const databaseSource = read('src/main/database.ts')
      // 版本号会随迁移递增，不写死；只确认 v5 这一步还在
      expect(databaseSource).toMatch(/const SCHEMA_VERSION = \d+/)
      expect(databaseSource).toContain('if (currentVersion < 5)')
      expect(databaseSource).toContain('realignRecordSequences(this.connection)')
    })

    it('repairs a database written by 0.6.5 on upgrade', () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-migrate-v5-'))
      const file = path.join(directory, 'coc.sqlite')
      const initial = new AppDatabase(file)
      initial.initialize()
      initial.close()

      // 拼出 0.6.5 会留下的状态：名称连续、编号有空洞
      const raw = new DatabaseSync(file)
      const stamp = '2026-01-01T00:00:00.000Z'
      raw
        .prepare(
          'INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status) VALUES (?,?,?,?,?,?,?,?,?)'
        )
        .run('m1', '铸形骸', '[]', '[]', 0, 0, stamp, stamp, 'not_started')
      const insert = raw.prepare(
        'INSERT INTO records (id,module_id,name,sequence_no,link,source_type,status,date_source,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      )
      for (let index = 1; index <= 3; index += 1) {
        insert.run(`r${index}`, 'm1', `铸形骸第 ${index} 场`, index, null, 'online', 'pending', 'none', index - 1, stamp, stamp)
      }
      insert.run('r4', 'm1', '铸形骸第 4 场', 17, null, 'online', 'pending', 'none', 3, stamp, stamp)
      raw.prepare('UPDATE schema_meta SET version = 4').run()
      raw.close()

      const upgraded = new AppDatabase(file)
      upgraded.initialize()
      const rows = upgraded.connection
        .prepare('SELECT name, sequence_no FROM records ORDER BY sequence_no')
        .all() as Array<Record<string, unknown>>
      const version = (
        upgraded.connection.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as {
          version: number
        }
      ).version
      upgraded.close()

      expect(rows.map((row) => row.sequence_no)).toEqual([1, 2, 3, 4])
      expect(rows.map((row) => row.name)).toEqual([
        '铸形骸第 1 场',
        '铸形骸第 2 场',
        '铸形骸第 3 场',
        '铸形骸第 4 场'
      ])
      expect(version).toBe(CURRENT_SCHEMA_VERSION)
    })
  })

  describe('renderer wiring', () => {
    const app = read('src/renderer/src/App.tsx')
    const api = read('src/shared/api.ts')
    const ipc = read('src/main/ipc.ts')
    const preload = read('src/preload/index.ts')
    const packagedPreload = read('resources/preload.cjs')

    it('judges gaps by the number in the name, not the stored column', () => {
      const picker = app.slice(app.indexOf('const requestAddRecord'), app.indexOf('const confirmSequence'))
      expect(picker).toContain('sessionNumberFromName(record.name) ?? record.sequenceNo')
    })

    it('prefills the name through the shared helper', () => {
      expect(app).toContain('sessionNameFor(module.name, sequenceNo)')
      expect(app).not.toContain('`${module.name}第 ${sequenceNo} 场`')
    })

    it('realigns every touched module after an import', () => {
      const importBlock = app.slice(
        app.indexOf('const importTableRows'),
        app.indexOf('const createCharacter')
      )
      expect(importBlock).toContain('touchedModuleIds.add(module.id)')
      expect(importBlock).toContain('await window.coc.records.realignSequences(moduleId)')
    })

    it('exposes the realign channel through every layer', () => {
      expect(api).toContain('realignSequences(moduleId: string): Promise<number>')
      expect(preload).toContain("realignSequences: (moduleId) => invoke('records:realign-sequences', { moduleId })")
      expect(packagedPreload).toContain(
        "realignSequences: (moduleId) => invoke('records:realign-sequences', { moduleId })"
      )
      expect(ipc).toContain("register('records:realign-sequences'")
    })
  })
})
