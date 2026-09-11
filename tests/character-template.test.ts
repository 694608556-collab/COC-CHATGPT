import { describe, expect, it } from 'vitest'
import { createEmptyCharacter } from '../src/shared/coc-rules'
import {
  createCharacterWorkbook,
  detectCharacterSheets,
  importCharacterFromSheet
} from '../src/shared/character-template'
import { readWorkbookGrid } from '../src/shared/table-grid'

describe('character templates and flexible import', () => {
  it('round-trips the built-in seventh-edition workbook through automatic mapping', () => {
    const source = createEmptyCharacter({ edition: 7, name: '艾伦' })
    source.basic.occupation = '记者'
    source.attrs.STR = 57
    source.derived.luck7 = 43
    const grid = readWorkbookGrid(createCharacterWorkbook(source), 'character.xlsx')
    const [preview] = detectCharacterSheets(grid)
    expect(preview?.confidence).toBeGreaterThanOrEqual(0.8)
    const imported = importCharacterFromSheet(
      grid.sheets[0]!,
      preview!.edition,
      preview!.mapping,
      undefined,
      preview!.skillHeaderRow
    )
    expect(imported.basic).toMatchObject({ name: '艾伦', occupation: '记者' })
    expect(imported.attrs.STR).toBe(57)
    expect(imported.derived.luck7).toBe(43)
  })

  it('recognizes alternative labels and requires review for incomplete sheets', () => {
    const bytes = new TextEncoder().encode('角色名,洛克,职业,医生\n力量,60,体质,55\n幸运,40')
    const grid = readWorkbookGrid(bytes, 'other.csv')
    const [preview] = detectCharacterSheets(grid)
    expect(preview).toMatchObject({ edition: 7 })
    expect(preview?.values['basic.name']).toBe('洛克')
    expect(preview?.warnings).toContain('识别置信度较低，导入前必须人工检查映射')
  })

  it('round-trips the built-in sixth-edition workbook through automatic mapping', () => {
    const source = createEmptyCharacter({ edition: 6, name: '\u83ab\u91cc\u65af' })
    source.basic.occupation = '\u6559\u6388'
    source.attrs.STR = 12
    source.attrs.POW = 13
    const grid = readWorkbookGrid(createCharacterWorkbook(source), 'character-6e.xlsx')
    const [preview] = detectCharacterSheets(grid)
    expect(preview?.edition).toBe(6)
    expect(preview?.confidence).toBeGreaterThanOrEqual(0.8)
    const imported = importCharacterFromSheet(
      grid.sheets[0]!,
      preview!.edition,
      preview!.mapping,
      undefined,
      preview!.skillHeaderRow
    )
    expect(imported.basic).toMatchObject({ name: '\u83ab\u91cc\u65af', occupation: '\u6559\u6388' })
    expect(imported.attrs.STR).toBe(12)
    expect(imported.attrs.POW).toBe(13)
  })
})
