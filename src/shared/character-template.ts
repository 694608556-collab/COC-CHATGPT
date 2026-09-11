import * as XLSX from 'xlsx'
import { createEmptyCharacter } from './coc-rules'
import type { CharacterData, Edition, Skill } from './types'
import type { GridSheet, WorkbookGrid } from './table-grid'

export type CharacterField =
  | 'basic.name'
  | 'basic.occupation'
  | 'basic.age'
  | 'basic.gender'
  | 'basic.birthplace'
  | 'basic.residence'
  | 'attrs.STR'
  | 'attrs.CON'
  | 'attrs.SIZ'
  | 'attrs.DEX'
  | 'attrs.APP'
  | 'attrs.INT'
  | 'attrs.POW'
  | 'attrs.EDU'
  | 'derived.luck7'
  | 'story'

export interface CharacterSheetPreview {
  sheetName: string
  edition: Edition
  confidence: number
  mapping: Partial<Record<CharacterField, string>>
  values: Partial<Record<CharacterField, string | number>>
  skillHeaderRow?: number
  warnings: string[]
}

const LABELS: Record<CharacterField, string[]> = {
  'basic.name': ['姓名', '调查员', '调查员姓名', '角色名', 'name'],
  'basic.occupation': ['职业', 'occupation'],
  'basic.age': ['年龄', 'age'],
  'basic.gender': ['性别', 'gender', 'sex'],
  'basic.birthplace': ['出生地', '故乡', 'birthplace'],
  'basic.residence': ['居住地', '住址', '住地', 'residence'],
  'attrs.STR': ['str', '力量'],
  'attrs.CON': ['con', '体质'],
  'attrs.SIZ': ['siz', '体型'],
  'attrs.DEX': ['dex', '敏捷'],
  'attrs.APP': ['app', '外貌'],
  'attrs.INT': ['int', '智力', '灵感'],
  'attrs.POW': ['pow', '意志'],
  'attrs.EDU': ['edu', '教育'],
  'derived.luck7': ['幸运', 'luck'],
  story: ['调查员经历', '经历', '背景故事', '故事', 'story']
}

const SKILL_NAME_LABELS = ['技能', '技能名', '技能名称', 'skill']
const SKILL_BASE_LABELS = ['基础', '初始', 'base']
const SKILL_OCCUPATION_LABELS = ['职业', '本职', 'occupation']
const SKILL_INTEREST_LABELS = ['兴趣', 'interest']
const SKILL_GROWTH_LABELS = ['成长', 'growth']
const SKILL_TOTAL_LABELS = ['合计', '总值', '技能值', '成功率', 'value', 'total']
const STORY_VALUE_LABELS = [
  '个人描述',
  '角色外貌',
  '思想与信念',
  '重要之人',
  '意义非凡之地',
  '宝贵之物',
  '特质',
  '难言之隐',
  '伤口和疤痕',
  '恐惧症和狂躁症',
  '关键链接'
]
const CORE_FIELDS = Object.keys(LABELS) as CharacterField[]

function normalized(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
}

function isAsciiWord(value: string): boolean {
  return /^[a-z0-9]+$/i.test(value)
}

function labelMatchesField(field: CharacterField, value: unknown): boolean {
  const label = normalized(value)
  if (!label) return false
  return LABELS[field].some((alias) => {
    const target = normalized(alias)
    if (!target) return false
    if (label === target) return true
    if (field.startsWith('attrs.') || field === 'derived.luck7') {
      if (isAsciiWord(target)) return new RegExp('(^|[^a-z0-9])' + escapeRegExp(target) + '([^a-z0-9]|$)', 'i').test(label)
      if (field === 'attrs.INT' && target === '灵感' && label.includes(target)) return true
      if (!label.startsWith(target)) return false
      const suffix = label.slice(target.length)
      return !suffix || /^[a-z0-9]+$/i.test(suffix)
    }
    if (field === 'story') return label === target || (target.length >= 4 && label.startsWith(target))
    return false
  })
}

function labelMatchesAny(value: unknown, aliases: string[], allowPrefix = true): boolean {
  const label = normalized(value)
  if (!label) return false
  return aliases.some((alias) => {
    const target = normalized(alias)
    if (!target) return false
    if (label === target) return true
    return allowPrefix && label.startsWith(target)
  })
}

function isSkillNameHeader(value: unknown): boolean {
  const label = normalized(value)
  return SKILL_NAME_LABELS.some((alias) => label === normalized(alias))
}

function decodedMergedRanges(sheet: GridSheet): XLSX.Range[] {
  return sheet.mergedRanges.map((range) => XLSX.utils.decode_range(range))
}

function containingRange(ranges: XLSX.Range[], row: number, column: number): XLSX.Range | undefined {
  return ranges.find((range) => row >= range.s.r && row <= range.e.r && column >= range.s.c && column <= range.e.c)
}

function nonBlankValue(sheet: GridSheet, row: number, column: number): { address: string; value: string | number } | undefined {
  const value = sheet.rows[row]?.[column]
  if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
    return { address: XLSX.utils.encode_cell({ r: row, c: column }), value }
  }
  return undefined
}

function scanRight(
  sheet: GridSheet,
  row: number,
  startColumn: number,
  maxSteps = 5
): { address: string; value: string | number } | undefined {
  const limit = Math.min(sheet.rows[row]?.length ?? 0, startColumn + maxSteps)
  for (let column = startColumn; column < limit; column += 1) {
    const found = nonBlankValue(sheet, row, column)
    if (found) return found
  }
  return undefined
}

function scanStoryValue(
  sheet: GridSheet,
  row: number,
  startColumn: number,
  maxSteps: number
): { address: string; value: string | number } | undefined {
  const limit = Math.min(sheet.rows[row]?.length ?? 0, startColumn + maxSteps)
  for (let column = startColumn; column < limit; column += 1) {
    const found = nonBlankValue(sheet, row, column)
    if (!found || labelMatchesAny(found.value, STORY_VALUE_LABELS)) continue
    return found
  }
  return undefined
}

function hasNonBlankRight(sheet: GridSheet, row: number, startColumn: number): boolean {
  return (sheet.rows[row] ?? []).slice(startColumn).some((value) => {
    return value !== null && value !== undefined && String(value).trim()
  })
}

function valueBeside(
  sheet: GridSheet,
  row: number,
  column: number,
  mergedRanges: XLSX.Range[],
  field: CharacterField
): { address: string; value: string | number } | undefined {
  const range = containingRange(mergedRanges, row, column)
  const rightStart = range && range.s.r === row ? range.e.c + 1 : column + 1
  const sameRow = scanRight(sheet, row, rightStart)
  if (sameRow) return sameRow
  const belowRow = range ? range.e.r + 1 : row + 1
  if (field === 'story') {
    const storyStart = range ? range.s.c : rightStart
    const storyWidth = range ? range.e.c - range.s.c + 1 : 5
    return scanStoryValue(sheet, belowRow, storyStart, storyWidth)
  }
  if (hasNonBlankRight(sheet, row, rightStart)) return undefined
  return nonBlankValue(sheet, belowRow, column) ?? scanRight(sheet, belowRow, rightStart)
}

export function detectCharacterSheets(workbook: WorkbookGrid): CharacterSheetPreview[] {
  return workbook.sheets
    .filter((sheet) => sheet.name !== '__COC_META__')
    .map((sheet) => {
      const mapping: Partial<Record<CharacterField, string>> = {}
      const values: Partial<Record<CharacterField, string | number>> = {}
      const mergedRanges = decodedMergedRanges(sheet)
      let skillHeaderRow: number | undefined
      for (let row = 0; row < sheet.rows.length; row += 1) {
        for (let column = 0; column < (sheet.rows[row]?.length ?? 0); column += 1) {
          const label = normalized(sheet.rows[row]?.[column])
          if (!label) continue
          if (skillHeaderRow === undefined && isSkillNameHeader(sheet.rows[row]?.[column])) skillHeaderRow = row
          for (const field of CORE_FIELDS) {
            if (mapping[field] || !labelMatchesField(field, sheet.rows[row]?.[column])) continue
            const found = valueBeside(sheet, row, column, mergedRanges, field)
            if (found) {
              mapping[field] = found.address
              values[field] = found.value
            }
          }
        }
      }
      const attrValues = Object.entries(values)
        .filter(([field]) => field.startsWith('attrs.'))
        .map(([, value]) => Number(value))
        .filter(Number.isFinite)
      const edition: Edition = attrValues.some((value) => value > 20) ? 7 : 6
      const recognized = Object.keys(mapping).length
      const confidence = Math.min(1, recognized / 12 + (skillHeaderRow === undefined ? 0 : 0.1))
      const warnings: string[] = []
      if (!mapping['basic.name']) warnings.push('未识别到调查员姓名')
      if (attrValues.length < 8) warnings.push(`只识别到 ${attrValues.length}/8 项基础属性`)
      if (confidence < 0.6) warnings.push('识别置信度较低，导入前必须人工检查映射')
      return { sheetName: sheet.name, edition, confidence, mapping, values, skillHeaderRow, warnings }
    })
}

function valueAt(sheet: GridSheet, address: string | undefined): string | number | undefined {
  if (!address) return undefined
  const cell = XLSX.utils.decode_cell(address)
  const value = sheet.rows[cell.r]?.[cell.c]
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function numericAt(sheet: GridSheet, row: number, column: number): number | undefined {
  const value = Number(sheet.rows[row]?.[column])
  return Number.isFinite(value) ? value : undefined
}

function findHeaderColumn(header: Array<string | number | boolean | null>, aliases: string[], start: number, end: number): number {
  for (let column = start; column < end; column += 1) {
    if (labelMatchesAny(header[column], aliases)) return column
  }
  return -1
}

function skillNameAt(sheet: GridSheet, row: number, nameColumn: number, baseColumn: number): string {
  const name = String(sheet.rows[row]?.[nameColumn] ?? '').trim()
  if (!name) return ''
  const parts = [name.replace(/\s+/g, ' ')]
  for (let column = nameColumn + 1; column < baseColumn; column += 1) {
    const value = sheet.rows[row]?.[column]
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const text = String(value).trim()
    if (text) parts.push(text)
  }
  const first = parts[0] ?? ''
  if (parts.length === 1) return first
  return first.endsWith('\uff1a') || first.endsWith(':') ? parts.join('') : parts.join('\uff1a')
}

function importSkillsFromSheet(sheet: GridSheet, skillHeaderRow: number): Skill[] {
  const header = sheet.rows[skillHeaderRow] ?? []
  const nameColumns = header.reduce<number[]>((columns, value, index) => {
    if (isSkillNameHeader(value)) columns.push(index)
    return columns
  }, [])
  const imported: Skill[] = []
  const seen = new Set<string>()
  for (const [index, nameColumn] of nameColumns.entries()) {
    const groupEnd = nameColumns[index + 1] ?? header.length
    const baseColumn = findHeaderColumn(header, SKILL_BASE_LABELS, nameColumn + 1, groupEnd)
    const occupationColumn = findHeaderColumn(header, SKILL_OCCUPATION_LABELS, nameColumn + 1, groupEnd)
    const interestColumn = findHeaderColumn(header, SKILL_INTEREST_LABELS, nameColumn + 1, groupEnd)
    const growthColumn = findHeaderColumn(header, SKILL_GROWTH_LABELS, nameColumn + 1, groupEnd)
    const totalColumn = findHeaderColumn(header, SKILL_TOTAL_LABELS, nameColumn + 1, groupEnd)
    const firstNumberColumn = baseColumn >= 0 ? baseColumn : totalColumn
    if (firstNumberColumn < 0) continue
    for (let row = skillHeaderRow + 1; row < sheet.rows.length; row += 1) {
      const name = skillNameAt(sheet, row, nameColumn, firstNumberColumn)
      if (!name || isSkillNameHeader(name)) continue
      const total = totalColumn >= 0 ? numericAt(sheet, row, totalColumn) : undefined
      const base = baseColumn >= 0 ? numericAt(sheet, row, baseColumn) : undefined
      const occupation = occupationColumn >= 0 ? numericAt(sheet, row, occupationColumn) : undefined
      const interest = interestColumn >= 0 ? numericAt(sheet, row, interestColumn) : undefined
      const growth = growthColumn >= 0 ? numericAt(sheet, row, growthColumn) : undefined
      if ([total, base, occupation, interest, growth].every((value) => value === undefined)) continue
      const key = normalized(name)
      if (seen.has(key)) continue
      seen.add(key)
      imported.push({
        id: globalThis.crypto.randomUUID(),
        name,
        base: base ?? total ?? 0,
        occupation: occupation ?? 0,
        interest: interest ?? 0,
        growth: growth ?? 0,
        builtIn: false,
        mappingState: 'review'
      })
    }
  }
  return imported
}

export function importCharacterFromSheet(
  sheet: GridSheet,
  edition: Edition,
  mapping: Partial<Record<CharacterField, string>>,
  moduleId?: string,
  skillHeaderRow?: number
): CharacterData {
  const character = createEmptyCharacter({ edition, moduleId })
  for (const [field, address] of Object.entries(mapping) as Array<[CharacterField, string]>) {
    const value = valueAt(sheet, address)
    if (value === undefined) continue
    if (field.startsWith('basic.')) {
      const key = field.slice(6) as keyof CharacterData['basic']
      character.basic[key] = String(value)
    } else if (field.startsWith('attrs.')) {
      const key = field.slice(6) as keyof CharacterData['attrs']
      const number = Number(value)
      if (Number.isFinite(number)) character.attrs[key] = number
    } else if (field === 'derived.luck7') {
      const number = Number(value)
      if (Number.isFinite(number)) character.derived.luck7 = number
    } else character.story = String(value)
  }
  if (skillHeaderRow !== undefined) {
    const imported = importSkillsFromSheet(sheet, skillHeaderRow)
    if (imported.length) character.skills = imported
  }
  character.editionSnapshots = { [edition]: { ...character.attrs } }
  return character
}

export function createCharacterWorkbook(character?: CharacterData, edition: Edition = 7): Uint8Array {
  const data = character ?? createEmptyCharacter({ edition })
  const rows: Array<Array<string | number>> = [
    [`COC 调查员角色卡（第${data.edition === 7 ? '七' : '六'}版）`, ''],
    ['姓名', data.basic.name, '职业', data.basic.occupation],
    ['年龄', data.basic.age, '性别', data.basic.gender],
    ['出生地', data.basic.birthplace, '居住地', data.basic.residence],
    [],
    ['STR', data.attrs.STR, 'CON', data.attrs.CON, 'SIZ', data.attrs.SIZ, 'DEX', data.attrs.DEX],
    ['APP', data.attrs.APP, 'INT', data.attrs.INT, 'POW', data.attrs.POW, 'EDU', data.attrs.EDU],
    ['幸运', data.edition === 6 ? data.attrs.POW * 5 : (data.derived.luck7 ?? 50)],
    [],
    ['技能', '基础', '职业', '兴趣', '成长', '合计'],
    ...data.skills.map((skill) => [
      skill.name,
      skill.base,
      skill.occupation,
      skill.interest,
      skill.growth,
      skill.base + skill.occupation + skill.interest + skill.growth
    ]),
    [],
    ['物品清单', data.items.join('\n')],
    ['调查员经历', data.story]
  ]
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(workbook, sheet, '角色卡')
  const meta = XLSX.utils.aoa_to_sheet([
    ['format', 'coc-session-journal'],
    ['version', 1],
    ['edition', data.edition]
  ])
  XLSX.utils.book_append_sheet(workbook, meta, '__COC_META__')
  workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] }
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }))
}
