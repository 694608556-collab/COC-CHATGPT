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

describe('character persistence and module linking', () => {
  it('persists edits, recalculates derived limits and synchronizes linked PC names', () => {
    const module = repository.createModule({ name: '长夜' })
    const character = repository.createCharacter({ edition: 7, moduleId: module.id, name: '林恩' })
    expect(repository.findModule(module.id).pairs).toEqual([
      { pc: '林恩', pl: '', characterId: character.id }
    ])

    character.basic.name = '林恩·怀特'
    character.attrs.CON = 80
    character.attrs.SIZ = 70
    character.derived.hpCurrent = 99
    const updated = repository.updateCharacter(character.id, character)

    expect(updated.derived.hpCurrent).toBe(15)
    expect(repository.findModule(module.id).pairs[0]?.pc).toBe('林恩·怀特')
    expect(repository.snapshot().characters[0]?.basic.name).toBe('林恩·怀特')
  })

  it('moves with explicit old-module policies and retains the name when deleting a card', () => {
    const first = repository.createModule({ name: '旧模组' })
    const second = repository.createModule({ name: '新模组' })
    const character = repository.createCharacter({ edition: 6, moduleId: first.id, name: '阿伦' })

    repository.moveCharacter(character.id, second.id, 'retain-name')
    expect(repository.findModule(first.id).pairs).toEqual([{ pc: '阿伦', pl: '' }])
    expect(repository.findModule(second.id).pairs[0]?.characterId).toBe(character.id)

    repository.deleteCharacter(character.id)
    expect(repository.snapshot().characters).toHaveLength(0)
    expect(repository.findModule(second.id).pairs).toEqual([{ pc: '阿伦', pl: '' }])
  })

  it('can remove the old PC row or cancel a move', () => {
    const first = repository.createModule({ name: '甲' })
    const second = repository.createModule({ name: '乙' })
    const character = repository.createCharacter({ edition: 7, moduleId: first.id, name: '调查员' })

    expect(repository.moveCharacter(character.id, second.id, 'cancel').moduleId).toBe(first.id)
    repository.moveCharacter(character.id, second.id, 'remove')
    expect(repository.findModule(first.id).pairs).toHaveLength(0)
    expect(repository.findModule(second.id).pairs[0]?.characterId).toBe(character.id)
  })
})
