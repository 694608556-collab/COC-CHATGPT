import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CharacterFileService } from '../../src/main/character-file-service'
import { AppDatabase } from '../../src/main/database'
import { AppRepository } from '../../src/main/repository'
import { createCharacterWorkbook } from '../../src/shared/character-template'

let database: AppDatabase
let repository: AppRepository
let directory: string
let service: CharacterFileService

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-character-files-'))
  database = new AppDatabase(path.join(directory, 'data', 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
  service = new CharacterFileService(repository, async () => Buffer.from('%PDF-character'))
})

afterEach(() => database.close())

describe('character files', () => {
  it('exports XLSX and print-ready PDF into the required character directory', async () => {
    const module = repository.createModule({ name: '暗影/循迹', playStatus: 'not_started' })
    const character = repository.createCharacter({ edition: 7, moduleId: module.id, name: '艾伦' })
    const xlsx = await service.exportCharacter(character.id, 'xlsx')
    const pdf = await service.exportCharacter(character.id, 'pdf')

    expect(path.dirname(xlsx.path)).toBe(path.join(directory, 'archive', '暗影＿循迹', '角色卡'))
    expect(path.basename(xlsx.path)).toMatch(/^艾伦第七版\d{8}\.xlsx$/)
    expect(fs.readFileSync(xlsx.path).subarray(0, 2).toString()).toBe('PK')
    expect(fs.readFileSync(pdf.path).subarray(0, 4).toString()).toBe('%PDF')
    expect(repository.archiveEntriesFor('character', character.id)).toHaveLength(2)
  })

  it('creates both blank templates and imports selected worksheets only after preview', () => {
    expect(fs.existsSync(service.saveBlankTemplate(6).path)).toBe(true)
    expect(fs.existsSync(service.saveBlankTemplate(7).path)).toBe(true)
    const source = repository.createCharacter({ edition: 7, name: '模板人物' })
    const filePath = path.join(directory, 'external.xlsx')
    fs.writeFileSync(filePath, createCharacterWorkbook(source))

    const preview = service.previewImport(filePath)
    expect(preview.sheets).toHaveLength(1)
    expect(repository.snapshot().characters).toHaveLength(1)
    const sheet = preview.sheets[0]!
    const imported = service.commitImport(preview.token, [
      {
        sheetName: sheet.sheetName,
        edition: sheet.edition,
        mapping: sheet.mapping,
        skillHeaderRow: sheet.skillHeaderRow,
        mappingName: '通用第七版'
      }
    ])
    expect(imported[0]?.basic.name).toBe('模板人物')
    expect(repository.snapshot().importMappings).toHaveLength(1)
    expect(() => service.commitImport(preview.token, [])).toThrow('导入预览已过期')
  })
})
