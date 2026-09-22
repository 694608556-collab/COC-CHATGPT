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

describe('explicit session sequence numbers', () => {
  it('fills a number gap left by a deleted session', () => {
    const module = repository.createModule({ name: '无尽食欲' })
    repository.createRecord({ moduleId: module.id })
    const second = repository.createRecord({ moduleId: module.id })
    repository.createRecord({ moduleId: module.id })
    repository.deleteRecord(second.id)

    const filled = repository.createRecord({ moduleId: module.id, sequenceNo: 2 })
    expect(filled.sequenceNo).toBe(2)
    expect(filled.name).toBe('无尽食欲第 2 场')
    const numbers = repository
      .snapshot()
      .records.map((record) => record.sequenceNo)
      .sort((a, b) => a - b)
    expect(numbers).toEqual([1, 2, 3])
  })

  it('keeps the default continuation when no explicit number is given', () => {
    const module = repository.createModule({ name: '模组' })
    const first = repository.createRecord({ moduleId: module.id })
    const jumped = repository.createRecord({ moduleId: module.id, sequenceNo: 5 })
    const next = repository.createRecord({ moduleId: module.id })
    expect([first.sequenceNo, jumped.sequenceNo, next.sequenceNo]).toEqual([1, 5, 6])
  })

  it('rejects a sequence number already in use', () => {
    const module = repository.createModule({ name: '模组' })
    repository.createRecord({ moduleId: module.id })
    expect(() => repository.createRecord({ moduleId: module.id, sequenceNo: 1 })).toThrow(
      '第 1 场已存在'
    )
  })

  it('rejects non-positive, non-integer and over-limit numbers', () => {
    const module = repository.createModule({ name: '模组' })
    expect(() => repository.createRecord({ moduleId: module.id, sequenceNo: 0 })).toThrow('大于 0')
    expect(() => repository.createRecord({ moduleId: module.id, sequenceNo: -2 })).toThrow('大于 0')
    expect(() => repository.createRecord({ moduleId: module.id, sequenceNo: 1.5 })).toThrow('大于 0')
    expect(() => repository.createRecord({ moduleId: module.id, sequenceNo: 10000 })).toThrow('9999')
  })

  it('keeps sequence numbers independent between modules', () => {
    const moduleA = repository.createModule({ name: '模组甲' })
    const moduleB = repository.createModule({ name: '模组乙' })
    const recordA = repository.createRecord({ moduleId: moduleA.id, sequenceNo: 1 })
    const recordB = repository.createRecord({ moduleId: moduleB.id, sequenceNo: 1 })
    expect(recordA.sequenceNo).toBe(1)
    expect(recordB.sequenceNo).toBe(1)
    expect(recordA.name).toBe('模组甲第 1 场')
    expect(recordB.name).toBe('模组乙第 1 场')
  })

  it('raises the stored maximum and keeps auto names on a later default create', () => {
    const module = repository.createModule({ name: '暗影循迹' })
    repository.createRecord({ moduleId: module.id })
    const high = repository.createRecord({ moduleId: module.id, sequenceNo: 9, name: '特殊团' })
    expect(high.name).toBe('特殊团')
    const following = repository.createRecord({ moduleId: module.id })
    expect(following.sequenceNo).toBe(10)
    expect(following.name).toBe('暗影循迹第 10 场')
  })

  // 0.6.2 回归：加到第 16 场后把末尾几场全删掉，只剩第 8 场。
  // 旧实现读取只增不减的历史最大值，新增场次会凭空跳到第 17 场。
  it('continues from the last surviving session after trailing deletions', () => {
    const module = repository.createModule({ name: '暗影循迹' })
    const created = []
    for (let index = 0; index < 16; index += 1) {
      created.push(repository.createRecord({ moduleId: module.id }))
    }
    expect(created[15]!.sequenceNo).toBe(16)
    // 删掉第 9 到第 16 场，只剩 1-8
    for (const record of created.slice(8)) repository.deleteRecord(record.id)
    const remaining = repository
      .snapshot()
      .records.map((record) => record.sequenceNo)
      .sort((a, b) => a - b)
    expect(remaining).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

    const next = repository.createRecord({ moduleId: module.id })
    expect(next.sequenceNo).toBe(9)
    expect(next.name).toBe('暗影循迹第 9 场')
  })

  // 删除末尾场次不会留下中间空缺，界面因此不会弹出编号选择窗口，
  // 这条路径完全依赖后端的默认编号，必须与界面算出的“接续最后编号”一致。
  it('agrees with the gap-free continuation shown by the picker', () => {
    const module = repository.createModule({ name: '模组' })
    const first = repository.createRecord({ moduleId: module.id })
    const second = repository.createRecord({ moduleId: module.id })
    const third = repository.createRecord({ moduleId: module.id })
    repository.deleteRecord(second.id)
    repository.deleteRecord(third.id)
    const used = repository.snapshot().records.map((record) => record.sequenceNo)
    const maximum = Math.max(...used)
    const usedSet = new Set(used)
    const gaps: number[] = []
    for (let number = 1; number <= maximum; number += 1) {
      if (!usedSet.has(number)) gaps.push(number)
    }
    // 只剩第 1 场：没有空缺，界面直接打开编辑器并把编号交给后端
    expect(used).toEqual([first.sequenceNo])
    expect(gaps).toEqual([])
    expect(repository.createRecord({ moduleId: module.id }).sequenceNo).toBe(maximum + 1)
  })
})
