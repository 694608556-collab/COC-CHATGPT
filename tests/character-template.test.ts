import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
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
  it('imports a protected-style merged Chinese seventh-edition character sheet', () => {
    const workbook = XLSX.utils.book_new()
    const rows: Array<Array<string | number | null>> = []
    rows[2] = []
    rows[2][1] = '\u59d3\u540d'
    rows[2][4] = '\u6e29\u7166'
    rows[2][18] = '\u529b\u91cf\nSTR'
    rows[2][20] = 75
    rows[2][24] = '\u654f\u6377\nDEX'
    rows[2][26] = 70
    rows[2][30] = '\u610f\u5fd7\nPOW'
    rows[2][32] = 60
    rows[4] = []
    rows[4][1] = '\u804c\u4e1a'
    rows[4][4] = '\u56fd\u4f01\u804c\u5458'
    rows[4][18] = '\u4f53\u8d28\nCON'
    rows[4][20] = 65
    rows[4][24] = '\u5916\u8c8c\nAPP'
    rows[4][26] = 70
    rows[4][30] = '\u6559\u80b2\nEDU'
    rows[4][32] = 65
    rows[5] = []
    rows[5][1] = '\u5e74\u9f84'
    rows[5][4] = 31
    rows[5][9] = '\u6027\u522b'
    rows[5][12] = '\u7537'
    rows[6] = []
    rows[6][1] = '\u4f4f\u5730'
    rows[6][4] = '\u9e3f\u4eac'
    rows[6][9] = '\u6545\u4e61'
    rows[6][18] = '\u4f53\u578b\nSIZ'
    rows[6][20] = 60
    rows[6][24] = '\u667a\u529b\n\u7075\u611f'
    rows[6][26] = 65
    rows[6][30] = '\u5e78\u8fd0\nLuck'
    rows[6][32] = 45
    rows[14] = []
    rows[14][5] = '\u6280\u80fd\u540d\u79f0'
    rows[14][9] = '\u521d\u59cb'
    rows[14][11] = '\u6210\u957f'
    rows[14][13] = '\u804c\u4e1a'
    rows[14][15] = '\u5174\u8da3'
    rows[14][17] = '\u6210\u529f\u7387 \u666e\u901a/\u56f0\u96be/\u6781\u9650'
    rows[14][27] = '\u6280\u80fd\u540d\u79f0'
    rows[14][31] = '\u521d\u59cb'
    rows[14][35] = '\u804c\u4e1a'
    rows[14][37] = '\u5174\u8da3'
    rows[14][39] = '\u6210\u529f\u7387 \u666e\u901a/\u56f0\u96be/\u6781\u9650'
    rows[28] = []
    rows[28][5] = '\u95ea\u907f'
    rows[28][9] = 35
    rows[28][15] = 35
    rows[28][17] = 70
    rows[28][27] = '\u5fc3\u7406\u5b66'
    rows[28][31] = 10
    rows[28][35] = 60
    rows[28][37] = 10
    rows[28][39] = 80
    rows[32] = []
    rows[32][5] = '\u8bdd\u672f'
    rows[32][9] = 5
    rows[32][13] = 60
    rows[32][15] = 10
    rows[32][17] = 75
    rows[59] = []
    rows[59][22] = '\u80cc\u666f\u6545\u4e8b'
    rows[60] = []
    rows[60][22] = '\u4e2a\u4eba\u63cf\u8ff0'
    rows[60][26] = '\u603b\u662f\u772f\u773c\u7b11'
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!merges'] = [
      XLSX.utils.decode_range('B3:D3'),
      XLSX.utils.decode_range('B5:D5'),
      XLSX.utils.decode_range('B6:D6'),
      XLSX.utils.decode_range('B7:D7'),
      XLSX.utils.decode_range('J6:L6'),
      XLSX.utils.decode_range('J7:L7'),
      XLSX.utils.decode_range('S3:T3'),
      XLSX.utils.decode_range('Y3:Z3'),
      XLSX.utils.decode_range('AE3:AF3'),
      XLSX.utils.decode_range('S5:T5'),
      XLSX.utils.decode_range('Y5:Z5'),
      XLSX.utils.decode_range('AE5:AF5'),
      XLSX.utils.decode_range('S7:T7'),
      XLSX.utils.decode_range('Y7:Z7'),
      XLSX.utils.decode_range('AE7:AF7'),
      XLSX.utils.decode_range('W60:AR60')
    ]
    sheet['!protect'] = { password: 'D857' }
    XLSX.utils.book_append_sheet(workbook, sheet, '\u4eba\u7269\u5361')
    const grid = readWorkbookGrid(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'wenxu-like.xlsx')
    const [preview] = detectCharacterSheets(grid)
    expect(preview?.confidence).toBe(1)
    expect(preview?.warnings).toEqual([])
    expect(preview?.values).toMatchObject({
      'basic.name': '\u6e29\u7166',
      'basic.occupation': '\u56fd\u4f01\u804c\u5458',
      'basic.residence': '\u9e3f\u4eac',
      'attrs.STR': 75,
      'attrs.CON': 65,
      'attrs.SIZ': 60,
      'attrs.DEX': 70,
      'attrs.APP': 70,
      'attrs.INT': 65,
      'attrs.POW': 60,
      'attrs.EDU': 65,
      'derived.luck7': 45,
      story: '\u603b\u662f\u772f\u773c\u7b11'
    })
    expect(preview?.mapping['basic.birthplace']).toBeUndefined()
    const imported = importCharacterFromSheet(
      grid.sheets[0]!,
      preview!.edition,
      preview!.mapping,
      undefined,
      preview!.skillHeaderRow
    )
    expect(imported.basic).toMatchObject({
      name: '\u6e29\u7166',
      occupation: '\u56fd\u4f01\u804c\u5458',
      age: '31',
      gender: '\u7537',
      residence: '\u9e3f\u4eac'
    })
    expect(imported.attrs).toMatchObject({
      STR: 75, CON: 65, SIZ: 60, DEX: 70, APP: 70, INT: 65, POW: 60, EDU: 65
    })
    expect(imported.derived.luck7).toBe(45)
    expect(imported.story).toBe('\u603b\u662f\u772f\u773c\u7b11')
    expect(imported.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '\u95ea\u907f', base: 35, interest: 35 }),
        expect.objectContaining({ name: '\u5fc3\u7406\u5b66', base: 10, occupation: 60, interest: 10 }),
        expect.objectContaining({ name: '\u8bdd\u672f', base: 5, occupation: 60, interest: 10 })
      ])
    )
  })

})
