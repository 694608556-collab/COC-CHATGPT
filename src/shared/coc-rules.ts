import type { CharacterData, Edition, Skill } from './types'

export type AttributeName = keyof CharacterData['attrs']

export interface DerivedLimits {
  hp: number
  mp: number
  san: number
  luck: number
  db: string
}

export const COC7_FORMULAS = [
  'EDU×4',
  'EDU×2 + DEX×2',
  'EDU×2 + STR×2',
  'EDU×2 + POW×2',
  'EDU×2 + APP×2'
] as const

function createId(): string {
  return globalThis.crypto.randomUUID()
}

const COMMON_SKILLS: Array<[string, number, number]> = [
  ['会计', 10, 5],
  ['人类学', 1, 1],
  ['估价', 5, 5],
  ['考古学', 1, 1],
  ['攀爬', 40, 20],
  ['计算机使用', 1, 5],
  ['克苏鲁神话', 0, 0],
  ['乔装', 1, 5],
  ['急救', 30, 30],
  ['历史', 20, 5],
  ['跳跃', 25, 20],
  ['法律', 5, 5],
  ['图书馆使用', 25, 20],
  ['聆听', 25, 20],
  ['锁匠', 1, 1],
  ['机械维修', 20, 10],
  ['医学', 5, 1],
  ['博物学', 10, 10],
  ['领航', 10, 10],
  ['神秘学', 5, 5],
  ['说服', 15, 10],
  ['精神分析', 1, 1],
  ['心理学', 5, 10],
  ['骑术', 5, 5],
  ['侦查', 25, 25],
  ['潜行', 10, 20],
  ['游泳', 25, 20],
  ['投掷', 25, 20],
  ['追踪', 10, 10]
]

export function builtInSkills(edition: Edition): Skill[] {
  return COMMON_SKILLS.map(([name, base6, base7]) => ({
    id: createId(),
    name,
    base: edition === 6 ? base6 : base7,
    occupation: 0,
    interest: 0,
    growth: 0,
    builtIn: true,
    mappingState: 'ok'
  }))
}

export function calculateDb(edition: Edition, strength: number, size: number): string {
  const sum = strength + size
  if (edition === 6) {
    if (sum <= 12) return '-1D6'
    if (sum <= 16) return '-1D4'
    if (sum <= 24) return '0'
    if (sum <= 32) return '+1D4'
    if (sum <= 40) return '+1D6'
    return `+${Math.ceil((sum - 40) / 16) + 1}D6`
  }
  if (sum <= 64) return '-2'
  if (sum <= 84) return '-1'
  if (sum <= 124) return '0'
  if (sum <= 164) return '+1D4'
  if (sum <= 204) return '+1D6'
  return `+${Math.ceil((sum - 204) / 80) + 1}D6`
}

export function calculateDerived(edition: Edition, attrs: CharacterData['attrs'], luck7 = 0): DerivedLimits {
  if (edition === 6) {
    return {
      hp: Math.ceil((attrs.CON + attrs.SIZ) / 2),
      mp: attrs.POW,
      san: attrs.POW * 5,
      luck: attrs.POW * 5,
      db: calculateDb(edition, attrs.STR, attrs.SIZ)
    }
  }
  return {
    hp: Math.floor((attrs.CON + attrs.SIZ) / 10),
    mp: Math.floor(attrs.POW / 5),
    san: attrs.POW,
    luck: luck7,
    db: calculateDb(edition, attrs.STR, attrs.SIZ)
  }
}

export function occupationPoints(
  character: Pick<CharacterData, 'edition' | 'attrs' | 'occupationFormula' | 'occupationPointOverride'>
): number {
  if (character.occupationPointOverride !== undefined)
    return Math.max(0, Math.round(character.occupationPointOverride))
  if (character.edition === 6) return character.attrs.EDU * 20
  const formula = character.occupationFormula.replace(/\s/g, '')
  const terms = formula.split('+')
  let result = 0
  for (const term of terms) {
    const match = term.match(/^(EDU|DEX|STR|POW|APP)[×*x](\d+)$/i)
    if (!match) throw new Error('职业技能点公式不受支持')
    result += character.attrs[match[1] as AttributeName] * Number(match[2])
  }
  return result
}

export function interestPoints(edition: Edition, attrs: CharacterData['attrs']): number {
  return attrs.INT * (edition === 6 ? 10 : 2)
}

export function skillFinal(skill: Skill): number {
  return skill.base + skill.occupation + skill.interest + skill.growth
}

export function skillPointSummary(character: CharacterData): {
  occupationUsed: number
  occupationLimit: number
  interestUsed: number
  interestLimit: number
} {
  return {
    occupationUsed: character.skills.reduce((sum, skill) => sum + skill.occupation, 0),
    occupationLimit: occupationPoints(character),
    interestUsed: character.skills.reduce((sum, skill) => sum + skill.interest, 0),
    interestLimit: interestPoints(character.edition, character.attrs)
  }
}

export function createEmptyCharacter(input: {
  edition: Edition
  moduleId?: string
  moduleIds?: string[]
  name?: string
  occupation?: string
}): CharacterData {
  const timestamp = new Date().toISOString()
  const value = input.edition === 6 ? 10 : 50
  const attrs: CharacterData['attrs'] = {
    STR: value,
    CON: value,
    SIZ: value,
    DEX: value,
    APP: value,
    INT: value,
    POW: value,
    EDU: value
  }
  const limits = calculateDerived(input.edition, attrs, 50)
  const moduleIds = [...new Set(input.moduleIds ?? (input.moduleId ? [input.moduleId] : []))].filter(Boolean)
  return {
    id: createId(),
    moduleIds,
    moduleId: moduleIds[0],
    edition: input.edition,
    basic: {
      name: input.name ?? '',
      occupation: input.occupation ?? '',
      age: '',
      gender: '',
      birthplace: '',
      residence: ''
    },
    attrs,
    editionSnapshots: { [input.edition]: { ...attrs } },
    derived: {
      hpCurrent: limits.hp,
      mpCurrent: limits.mp,
      sanCurrent: limits.san,
      luck6: attrs.POW * 5,
      luck7: 50,
      db: limits.db
    },
    occupationFormula: input.edition === 6 ? 'EDU×20' : 'EDU×4',
    skills: builtInSkills(input.edition),
    weapons: [],
    items: [],
    background: {},
    story: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function convertCharacterEdition(character: CharacterData, target: Edition): CharacterData {
  if (character.edition === target) return structuredClone(character)
  const source = character.edition
  const snapshots = { ...character.editionSnapshots, [source]: { ...character.attrs } }
  const saved = snapshots[target]
  const attrs = saved
    ? ({ ...saved } as CharacterData['attrs'])
    : (Object.fromEntries(
        Object.entries(character.attrs).map(([key, value]) => [
          key,
          target === 7 ? value * 5 : Math.round(value / 5)
        ])
      ) as CharacterData['attrs'])
  snapshots[target] = { ...attrs }
  const limits = calculateDerived(target, attrs, character.derived.luck7 ?? 0)
  const mappedSkills = character.skills.map((skill) => ({
    ...skill,
    mappingState: skill.builtIn ? ('ok' as const) : ('review' as const)
  }))
  return {
    ...structuredClone(character),
    edition: target,
    attrs,
    editionSnapshots: snapshots,
    occupationFormula:
      target === 6
        ? 'EDU×20'
        : character.occupationFormula === 'EDU×20'
          ? 'EDU×4'
          : character.occupationFormula,
    skills: mappedSkills,
    derived: {
      ...character.derived,
      hpCurrent: Math.min(character.derived.hpCurrent, limits.hp),
      mpCurrent: Math.min(character.derived.mpCurrent, limits.mp),
      sanCurrent: Math.min(character.derived.sanCurrent, limits.san),
      luck6: attrs.POW * 5,
      luck7: character.derived.luck7 ?? 50,
      db: limits.db
    },
    updatedAt: new Date().toISOString()
  }
}
