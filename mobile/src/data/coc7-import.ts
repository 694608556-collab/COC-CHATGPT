import * as XLSX from 'xlsx'
import { calculateDerived, createEmptyCharacter, createSkill } from '../../../src/shared/coc-rules'
import type { CharacterData } from '../../../src/shared/types'

/** 单个可补填问题；只随导入草稿传递，不写入角色业务数据。 */
export interface Coc7ImportIssue {
  /** 稳定的编辑字段键；技能使用其实体ID。 */
  key: string
  /** 用户可理解的字段名。 */
  label: string
  /** 人物卡中的源单元格地址。 */
  address: string
  /** 缺失或无效的具体原因及补填提示。 */
  message: string
}
export interface Coc7ImportSummary {
  skippedSkills: number
  warnings: string[]
  /** 等待用户补填的字段；不可用占位数值直接保存。 */
  issues: Coc7ImportIssue[]
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
  const issues: Coc7ImportIssue[] = []
  const fieldNames: Record<string, string> = {
    E3: '姓名',
    E5: '职业',
    E6: '年龄',
    M6: '性别',
    E7: '居住地',
    M7: '故乡',
    R12: '剩余理智',
    AP52: '伤害加值',
    AA61: '外貌描述',
    AA63: '思想与信念',
    AA65: '重要之人',
    AA67: '意义非凡之地',
    AA69: '宝贵之物',
    AA71: '特质',
    AA73: '秘密',
    AA75: '伤口与疤痕',
    AA77: '恐惧与躁狂',
    W79: '调查员经历'
  }
  function raw(address: string): string | number | undefined {
    const cell = sheet![address] as XLSX.CellObject | undefined
    const label = fieldNames[address] ?? '字段'
    if (cell?.t === 'e')
      throw new Error(`${label}（人物卡 ${address}）包含表格错误，请在Excel或WPS中修正该单元格后重新导入。`)
    if (cell?.v === undefined || cell.v === null || cell.v === '') {
      if (cell?.f && cell.t !== 's')
        throw new Error(
          `${label}（人物卡 ${address}）缺少公式结果，请在 Excel 或 WPS 中计算并保存后重新导入。`
        )
      return undefined
    }
    if (typeof cell.v !== 'string' && typeof cell.v !== 'number')
      throw new Error(
        `${label}（人物卡 ${address}）内容类型不正确，应为文字或数字，请核对该单元格后重新导入。`
      )
    return cell.v
  }
  function text(address: string): string {
    return String(raw(address) ?? '').replace(/\r\n?/g, '\n')
  }
  /** @param address - 源单元格。 @param label - 字段中文名。 @param key - 编辑字段键。 @returns 有效数值；问题字段返回undefined并登记补填提示，不中断整卡预览。 */
  function numeric(address: string, label: string, key: string): number | undefined {
    const cell = sheet![address] as XLSX.CellObject | undefined
    let reason = '未填写'
    if (cell?.t === 'e') reason = '含有表格错误'
    else if (cell?.f && (cell.v === undefined || cell.v === null || cell.v === ''))
      reason = '缺少已保存的公式结果'
    else if (cell?.v !== undefined && cell.v !== null && String(cell.v).trim()) {
      if ((typeof cell.v === 'number' || typeof cell.v === 'string') && Number.isFinite(Number(cell.v)))
        return Number(cell.v)
      reason = '不是有效数字'
    }
    issues.push({ key, label, address, message: `${label}（人物卡 ${address}）${reason}，请在此补填。` })
    return undefined
  }
  const normalize = (value: string) => value.replace(/\s|[：:]/g, '').toLowerCase()
  const anchors: Array<[string, string]> = [
    ['B3', '姓名'],
    ['B5', '职业'],
    ['S3', '力量STR'],
    ['Y3', '敏捷DEX'],
    ['AE3', '意志POW'],
    ['F15', '技能名称'],
    ['AB15', '技能名称']
  ]
  if (
    anchors.some(([address, label]) => normalize(text(address)) !== normalize(label)) ||
    !text('R15').includes('成功率') ||
    !text('AN15').includes('成功率')
  ) {
    const mismatch = anchors
      .filter(([address, label]) => normalize(text(address)) !== normalize(label))
      .map(([address, label]) => `${label}标题（${address}）`)
    if (!text('R15').includes('成功率')) mismatch.push('左栏成功率标题（R15）')
    if (!text('AN15').includes('成功率')) mismatch.push('右栏成功率标题（AN15）')
    throw new Error(
      `“人物卡”布局与支持的七版模板不一致：${mismatch.join('、')}不匹配。请使用原七版模板，未导入任何数据。`
    )
  }
  const character = createEmptyCharacter({ edition: 7 })
  const warnings: string[] = []
  const basics = { name: 'E3', occupation: 'E5', age: 'E6', gender: 'M6', residence: 'E7', birthplace: 'M7' }
  for (const [key, address] of Object.entries(basics))
    character.basic[key as keyof CharacterData['basic']] = text(address)
  if (!character.basic.name.trim())
    issues.push({
      key: '姓名',
      label: '姓名',
      address: 'E3',
      message: '姓名（人物卡 E3）未填写，请在此补填。'
    })
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
  const attributeLabels: Record<string, string> = {
    STR: '力量 STR',
    CON: '体质 CON',
    SIZ: '体型 SIZ',
    DEX: '敏捷 DEX',
    APP: '外貌 APP',
    INT: '智力 INT',
    POW: '意志 POW',
    EDU: '教育 EDU'
  }
  for (const [key, address] of Object.entries(attributes))
    character.attrs[key as keyof CharacterData['attrs']] = numeric(address, attributeLabels[key]!, key) ?? 0
  character.editionSnapshots = { 7: { ...character.attrs } }
  character.derived = {
    hpCurrent: numeric('E10', '当前生命值 HP', '当前 HP') ?? 0,
    mpCurrent: numeric('W10', '当前魔法值 MP', '当前 MP') ?? 0,
    sanCurrent: numeric('N10', '当前理智值 SAN', '当前 SAN') ?? 0,
    luck7: numeric('AG7', '幸运', '幸运') ?? 0,
    db: text('AP52') || calculateDerived(7, character.attrs).db
  }
  if (raw('R12') !== undefined && Number(raw('R12')) !== character.derived.sanCurrent)
    warnings.push('表内“理智”与“剩余理智”不同，当前读取“理智”，请核对当前SAN。')
  // 职业点数及上限不映射，沿用应用的新角色默认设置。
  character.skills = []
  let skippedSkills = 0
  for (const [nameCol, subCol, totalCol] of [
    ['F', 'H', 'R'],
    ['AB', 'AD', 'AN']
  ]) {
    for (let row = 16; row <= 49; row++) {
      const original = text(nameCol! + row).trim()
      if (!original) continue
      let name = original.replace(/\s*Ω\s*$/, '')
      const sub = text(subCol! + row).trim()
      if (sub) name = name.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '').replace(/[：:]$/, '') + '：' + sub
      if (name === '导航') name = '领航'
      // 表内普通成功率就是最终技能值；不读取或拆分点数分项。
      const skill = createSkill(name, 0)
      const total = numeric(totalCol! + row, `技能“${name}”普通成功率`, 'skill:' + skill.id)
      if (total !== undefined && total < 15) {
        skippedSkills++
        continue
      }
      skill.base = total ?? 0
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
  return { character, warnings, skippedSkills, issues }
}
