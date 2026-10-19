import * as XLSX from 'xlsx'
import { calculateDerived, createEmptyCharacter, createSkill } from '../../../src/shared/coc-rules'
import type { CharacterData } from '../../../src/shared/types'

export interface Coc7ImportSummary {
  skippedSkills: number
  warnings: string[]
}
export interface Coc7ImportPreview extends Coc7ImportSummary {
  character: CharacterData
}

/** 只读专用模板“人物卡”的已保存结果，不执行公式或读取其他工作表。 */
export function previewCoc7Import(bytes: Uint8Array, fileName: string): Coc7ImportPreview {
  if (!/\.xlsx$/i.test(fileName)) throw new Error('请选择七版角色卡的 XLSX 文件。')
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('角色卡文件为空或超过 20 MB。')
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      sheets: '人物卡',
      sheetRows: 95,
      cellFormula: true,
      cellHTML: false,
      cellText: false,
      cellStyles: false,
      bookVBA: false,
      dense: false
    })
  } catch {
    throw new Error('无法读取角色卡，请选择可正常打开的 XLSX 文件；不支持需要打开密码的文件。')
  }
  const sheet = workbook.Sheets['人物卡']
  if (!sheet) throw new Error('文件中没有“人物卡”工作表。')
  function raw(address: string): string | number | undefined {
    const cell = sheet![address] as XLSX.CellObject | undefined
    if (cell?.t === 'e') throw new Error(`人物卡 ${address} 包含表格错误，请修正后重试。`)
    if (cell?.v === undefined || cell.v === null || cell.v === '') {
      if (cell?.f && cell.t !== 's')
        throw new Error(`人物卡 ${address} 缺少公式结果，请在 Excel 中计算并保存后重试。`)
      return undefined
    }
    if (typeof cell.v !== 'string' && typeof cell.v !== 'number')
      throw new Error(`人物卡 ${address} 内容类型不正确，请核对后重试。`)
    return cell.v
  }
  function text(address: string): string {
    return String(raw(address) ?? '').replace(/\r\n?/g, '\n')
  }
  function numeric(address: string, optional = false): number {
    const value = raw(address)
    if (optional && (value === undefined || ['—', '——', '-', '--'].includes(String(value).trim()))) return 0
    if (value === undefined || !String(value).trim() || !Number.isFinite(Number(value)))
      throw new Error(`人物卡 ${address} 需要有效数值，请核对后重试。`)
    return Number(value)
  }
  const normalize = (value: string) => value.replace(/\s|[：:]/g, '').toLowerCase()
  const anchors: Array<[string, string]> = [
    ['B3', '姓名'],
    ['B5', '职业'],
    ['S3', '力量STR'],
    ['Y3', '敏捷DEX'],
    ['AE3', '意志POW'],
    ['F15', '技能名称'],
    ['J15', '初始'],
    ['L15', '成长'],
    ['N15', '职业'],
    ['P15', '兴趣'],
    ['AB15', '技能名称'],
    ['AF15', '初始'],
    ['AH15', '成长'],
    ['AJ15', '职业'],
    ['AL15', '兴趣']
  ]
  if (
    anchors.some(([address, label]) => normalize(text(address)) !== normalize(label)) ||
    !text('R15').includes('成功率') ||
    !text('AN15').includes('成功率')
  )
    throw new Error('“人物卡”布局与当前支持的七版模板不一致，未导入任何数据。')
  const character = createEmptyCharacter({ edition: 7 })
  const warnings: string[] = []
  const basics = { name: 'E3', occupation: 'E5', age: 'E6', gender: 'M6', residence: 'E7', birthplace: 'M7' }
  for (const [key, address] of Object.entries(basics))
    character.basic[key as keyof CharacterData['basic']] = text(address)
  const attributes = {
    STR: 'U3',
    CON: 'U5',
    SIZ: 'U7',
    DEX: 'AA3',
    APP: 'AA5',
    INT: 'AA7',
    POW: 'AG3',
    EDU: 'AG5'
  }
  for (const [key, address] of Object.entries(attributes))
    character.attrs[key as keyof CharacterData['attrs']] = numeric(address)
  character.editionSnapshots = { 7: { ...character.attrs } }
  character.derived = {
    hpCurrent: numeric('E10'),
    mpCurrent: numeric('W10'),
    sanCurrent: numeric('N10'),
    luck7: numeric('AG7'),
    db: text('AP52') || calculateDerived(7, character.attrs).db
  }
  if (raw('R12') !== undefined && numeric('R12') !== character.derived.sanCurrent)
    warnings.push('表内“理智”与“剩余理智”不同，当前读取“理智”，请核对当前SAN。')
  // 职业点数及上限不映射，沿用应用的新角色默认设置。
  character.skills = []
  let skippedSkills = 0
  for (const [nameCol, subCol, baseCol, growthCol, occupationCol, interestCol, totalCol] of [
    ['F', 'H', 'J', 'L', 'N', 'P', 'R'],
    ['AB', 'AD', 'AF', 'AH', 'AJ', 'AL', 'AN']
  ]) {
    for (let row = 16; row <= 49; row++) {
      const original = text(nameCol! + row).trim()
      if (!original) continue
      const total = numeric(totalCol! + row)
      if (total < 15) {
        skippedSkills++
        continue
      }
      let name = original.replace(/\s*Ω\s*$/, '')
      const sub = text(subCol! + row).trim()
      if (sub) name = name.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '').replace(/[：:]$/, '') + '：' + sub
      if (name === '导航') name = '领航'
      const skill = createSkill(name, numeric(baseCol! + row, true))
      skill.growth = numeric(growthCol! + row, true)
      skill.occupation = numeric(occupationCol! + row, true)
      skill.interest = numeric(interestCol! + row, true)
      if (Math.abs(skill.base + skill.growth + skill.occupation + skill.interest - total) > 1e-8)
        throw new Error(`人物卡 ${totalCol! + row} 的成功率与技能分项不一致，请计算并保存后重试。`)
      character.skills.push(skill)
    }
  }
  const background = {
    description: 'AA61',
    belief: 'AA63',
    importantPerson: 'AA65',
    significantPlace: 'AA67',
    treasure: 'AA69',
    trait: 'AA71',
    secret: 'AA73',
    wound: 'AA75',
    phobia: 'AA77'
  }
  for (const [key, address] of Object.entries(background)) character.background[key] = text(address)
  character.story = text('W79')
  for (let row = 79; row <= 94; row++) {
    for (const column of ['F', 'N']) {
      const item = text(column + row)
      if (item.trim()) character.items.push(item)
    }
  }
  // 第53行为模板内置徒手；资产、法术、状态、部位和其他辅助内容不导入。
  for (let row = 54; row <= 56; row++) {
    if (!text('B' + row).trim() && !text('G' + row).trim()) continue
    const weapon: Record<string, string | number> = {}
    for (const [key, column] of Object.entries({
      name: 'B',
      hit: 'Q',
      damage: 'W',
      range: 'AA',
      times: 'AE',
      ammo: 'AG'
    }))
      weapon[key] = raw(column + row) ?? ''
    if (!String(weapon.name).trim()) warnings.push(`武器表第${row}行缺少名称，请在保存前补充。`)
    character.weapons.push(weapon)
  }
  return { character, warnings, skippedSkills }
}
