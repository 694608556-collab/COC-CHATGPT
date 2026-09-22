import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'

let database: AppDatabase
let repository: AppRepository

beforeEach(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-character-'))
  database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('character persistence', () => {
  it('persists edits and recalculates derived limits without inventing module rows', () => {
    const module = repository.createModule({ name: '长夜', playStatus: 'not_started' })
    const character = repository.createCharacter({ edition: 7, moduleId: module.id, name: '林恩' })
    // creating a card must not add a PC/PL row to the module roster
    expect(repository.findModule(module.id).pairs).toEqual([])

    character.basic.name = '林恩·怀特'
    character.attrs.CON = 80
    character.attrs.SIZ = 70
    character.derived.hpCurrent = 99
    const updated = repository.updateCharacter(character.id, character)

    expect(updated.derived.hpCurrent).toBe(15)
    // renaming the card must not add rows either
    expect(repository.findModule(module.id).pairs).toEqual([])
    expect(repository.snapshot().characters[0]?.basic.name).toBe('林恩·怀特')
  })

  it('leaves both rosters untouched when a card changes module', () => {
    const first = repository.createModule({ name: '旧模组', playStatus: 'not_started', pairs: [{ pc: '阿伦', pl: '小夏' }] })
    const second = repository.createModule({ name: '新模组', playStatus: 'not_started', pairs: [{ pc: '林恩', pl: '长风' }] })
    const character = repository.createCharacter({ edition: 6, moduleId: first.id, name: '阿伦' })

    repository.moveCharacter(character.id, second.id, 'retain-name')
    expect(repository.findModule(first.id).pairs).toEqual([{ pc: '阿伦', pl: '小夏' }])
    expect(repository.findModule(second.id).pairs).toEqual([{ pc: '林恩', pl: '长风' }])

    expect(repository.moveCharacter(character.id, first.id, 'cancel').moduleId).toBe(second.id)
  })

  it('leaves the roster alone when a card is deleted', () => {
    const module = repository.createModule({ name: '长夜', playStatus: 'not_started', pairs: [{ pc: '林恩', pl: '小夏' }] })
    const character = repository.createCharacter({ edition: 7, moduleId: module.id, name: '林恩' })

    repository.deleteCharacter(character.id)
    expect(repository.snapshot().characters).toHaveLength(0)
    expect(repository.findModule(module.id).pairs).toEqual([{ pc: '林恩', pl: '小夏' }])
  })

  it('links one card to several modules without touching their rosters', () => {
    const first = repository.createModule({ name: '甲模组', playStatus: 'not_started' })
    const second = repository.createModule({ name: '乙模组', playStatus: 'not_started' })
    const character = repository.createCharacter({
      edition: 7,
      moduleId: first.id,
      name: '林恩'
    })
    character.moduleIds = [first.id, second.id]
    const updated = repository.updateCharacter(character.id, character)
    expect(updated.moduleIds).toEqual([first.id, second.id])
    expect(repository.findModule(first.id).pairs).toEqual([])
    expect(repository.findModule(second.id).pairs).toEqual([])

    updated.basic.name = '林恩·怀特'
    repository.updateCharacter(updated.id, updated)
    expect(repository.findModule(first.id).pairs).toEqual([])
    expect(repository.findModule(second.id).pairs).toEqual([])
  })
})
