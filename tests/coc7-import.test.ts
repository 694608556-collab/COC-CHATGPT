import { describe, expect, it } from 'vitest'
import { publicCoc7Bytes, publicCoc7Workbook } from './fixtures/coc7'
import { previewCoc7Import } from '../src/shared/coc7-import'
import { skillFinal } from '../src/shared/coc-rules'

describe('七版人物卡专用只读导入', () => {
  it('缺少HP、无效属性或公式未缓存时仍预览，其余字段保留并明确标记待补填项', () => {
    const book = publicCoc7Workbook(),
      sheet = book.Sheets['人物卡']!
    delete sheet.E10
    sheet.U3 = { t: 'n', f: '1+2' }
    sheet.W10 = { t: 's', v: '未填写' }
    const result = previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')
    expect(result.character.basic.name).toBe('公开七版调查员')
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: '当前 HP', address: 'E10', label: '当前生命值 HP' }),
        expect.objectContaining({ key: 'STR', address: 'U3', label: '力量 STR' }),
        expect.objectContaining({ key: '当前 MP', address: 'W10', label: '当前魔法值 MP' })
      ])
    )
    expect(result.character.derived.sanCurrent).toBe(49)
    expect(result.character.items).toHaveLength(4)
  })
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
  it('错误文件和布局明确失败，未缓存或错误数值改为待补填，不读取点数分项', () => {
    expect(() => previewCoc7Import(publicCoc7Bytes(), 'public.csv')).toThrow('XLSX')
    const book = publicCoc7Workbook(),
      sheet = book.Sheets['人物卡']!
    sheet.U3 = { t: 'n', f: '1+2' }
    expect(previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: 'U3' })])
    )
    sheet.U3 = { t: 'n', v: 60 }
    sheet.R17 = { t: 'n', v: 16 }
    expect(skillFinal(previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').character.skills[0]!)).toBe(16)
    sheet.R17 = { t: 'e', v: 7 }
    expect(previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx').issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: 'R17' })])
    )
    sheet.B3 = { t: 's', v: '布局改变' }
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('布局')
    delete book.Sheets['人物卡']
    book.SheetNames = book.SheetNames.filter((n) => n !== '人物卡')
    expect(() => previewCoc7Import(publicCoc7Bytes(book), 'public.xlsx')).toThrow('没有“人物卡”')
  })
})
