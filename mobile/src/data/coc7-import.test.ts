import { describe, expect, it } from 'vitest'
import { publicCoc7Bytes, publicCoc7Workbook } from '../../test-fixtures/coc7'
import { previewCoc7Import } from './coc7-import'
import { skillFinal } from '../../../src/shared/coc-rules'

describe('七版人物卡专用只读导入', () => {
  it('读取指定人物卡，保留15边界/两栏最终值/完整背景经历和红框内末行物品', () => {
    const result = previewCoc7Import(publicCoc7Bytes(), 'public.xlsx')
    const c = result.character
    expect(c.edition).toBe(7)
    expect(c.basic).toMatchObject({ name: '公开七版调查员', residence: '公开居住地', birthplace: '公开故乡' })
    expect(c.attrs).toMatchObject({ STR: 60, EDU: 75 })
    expect(c.derived).toEqual({ hpCurrent: 7, mpCurrent: 8, sanCurrent: 49, luck7: 42, db: '0' })
    expect(c.skills.map((s) => [s.name, skillFinal(s)])).toEqual([
      ['取悦', 15],
      ['技艺：公开专长', 15],
      ['格斗：斗殴', 80],
      ['母语', 75],
      ['图书馆使用', 35],
      ['侦查', 60]
    ])
    expect(c.skills.find((s) => s.name === '侦查')).toMatchObject({
      base: 60,
      growth: 0,
      occupation: 0,
      interest: 0
    })
    expect(c.background.description).toBe('公开外貌\n第二行')
    expect(c.story).toBe('公开经历首段\n' + '公开完整经历。'.repeat(200) + '\n公开经历尾段')
    expect(c.items).toEqual(['公开物品甲\n完整备注', '公开背包甲', '公开末行物品', '公开末行背包'])
    expect(c.weapons).toEqual([
      { name: '公开自定义武器', hit: 60, damage: '1D6', range: '10', times: '1', ammo: '6' }
    ])
    expect(c.occupationFormula).toBe('EDU×4')
    expect(c.occupationPointOverride).toBeUndefined()
    expect(c.moduleIds).toEqual([])
    expect(JSON.stringify(c)).not.toContain('不得')
    expect(result.skippedSkills).toBe(2)
  })
  it('全部低于15时技能为空，不补回应用默认技能，且不导入徒手', () => {
    const book = publicCoc7Workbook(),
      sheet = book.Sheets['人物卡']!
    for (const address of Object.keys(sheet))
      if (/^(R|AN)(1[6-9]|[234][0-9])$/.test(address)) sheet[address] = { t: 'n', v: 14 }
    delete sheet.B54
    delete sheet.G54
    const c = previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').character
    expect(c.skills).toEqual([])
    expect(c.weapons).toEqual([])
  })
  it('成功率直接作为最终值，错误或空白的点数分项不读取也不阻止导入', () => {
    const book = publicCoc7Workbook(),
      sheet = book.Sheets['人物卡']!
    for (const col of ['J', 'L', 'N', 'P', 'AF', 'AH', 'AJ', 'AL']) {
      sheet[col + '15'] = { t: 's', v: '忽略的分项标题' }
      for (let row = 16; row <= 49; row++) sheet[col + row] = { t: 'e', v: 7 }
    }
    const skills = previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').character.skills
    expect(skills.map(skillFinal)).toEqual([15, 15, 80, 75, 35, 60])
    expect(skills.every((s) => s.growth === 0 && s.occupation === 0 && s.interest === 0)).toBe(true)
  })
  it('跨平台换行统一为LF，长文和段落完整保留', () => {
    const book = publicCoc7Workbook()
    book.Sheets['人物卡']!.W79 = { t: 's', v: '公开首行\r\n公开次行\r公开末行' }
    const c = previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').character
    expect(c.story).toBe('公开首行\n公开次行\n公开末行')
  })
  it('没有目标表、布局错误、错误扩展名及未缓存/错误数值及忽略点数分项明确失败，不猜填', () => {
    expect(() => previewCoc7Import(publicCoc7Bytes(), 'public.csv')).toThrow('XLSX')
    const book = publicCoc7Workbook(),
      sheet = book.Sheets['人物卡']!
    sheet.U3 = { t: 'n', f: '1+2' }
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('U3')
    sheet.U3 = { t: 'n', v: 60 }
    sheet.R17 = { t: 'n', v: 16 }
    expect(skillFinal(previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').character.skills[0]!)).toBe(16)
    sheet.R17 = { t: 'e', v: 7 }
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('表格错误')
    sheet.B3 = { t: 's', v: '布局改变' }
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('布局')
    delete book.Sheets['人物卡']
    book.SheetNames = book.SheetNames.filter((n) => n !== '人物卡')
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('没有“人物卡”')
  })
})
