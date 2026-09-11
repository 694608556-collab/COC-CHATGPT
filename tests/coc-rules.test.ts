import { describe, expect, it } from 'vitest'
import {
  calculateDerived,
  convertCharacterEdition,
  createEmptyCharacter,
  interestPoints,
  occupationPoints,
  skillFinal,
  skillPointSummary
} from '../src/shared/coc-rules'

describe('COC 6e and 7e rules', () => {
  it('uses edition-specific derived values and luck', () => {
    const attrs6 = { STR: 12, CON: 11, SIZ: 13, DEX: 10, APP: 10, INT: 14, POW: 12, EDU: 15 }
    expect(calculateDerived(6, attrs6)).toEqual({ hp: 12, mp: 12, san: 60, luck: 60, db: '+1D4' })
    const attrs7 = Object.fromEntries(
      Object.entries(attrs6).map(([key, value]) => [key, value * 5])
    ) as typeof attrs6
    expect(calculateDerived(7, attrs7, 47)).toEqual({ hp: 12, mp: 12, san: 60, luck: 47, db: '+1D4' })
  })

  it('restores a non-multiple-of-five original value after round trips', () => {
    const character = createEmptyCharacter({ edition: 7 })
    character.attrs.STR = 57
    character.derived.luck7 = 43
    const six = convertCharacterEdition(character, 6)
    expect(six.attrs.STR).toBe(11)
    expect(six.derived.luck6).toBe(six.attrs.POW * 5)
    const seven = convertCharacterEdition(six, 7)
    expect(seven.attrs.STR).toBe(57)
    expect(seven.derived.luck7).toBe(43)
  })

  it('calculates occupation and interest limits, overrides and overspend warnings', () => {
    const six = createEmptyCharacter({ edition: 6 })
    six.attrs.EDU = 15
    six.attrs.INT = 14
    expect(occupationPoints(six)).toBe(300)
    expect(interestPoints(6, six.attrs)).toBe(140)
    const seven = createEmptyCharacter({ edition: 7 })
    seven.attrs.EDU = 70
    seven.attrs.DEX = 55
    seven.occupationFormula = 'EDU×2 + DEX×2'
    expect(occupationPoints(seven)).toBe(250)
    seven.occupationPointOverride = 260
    seven.skills[0]!.occupation = 300
    expect(skillPointSummary(seven)).toMatchObject({ occupationUsed: 300, occupationLimit: 260 })
  })

  it('keeps skill investments as explicit components', () => {
    expect(skillFinal({ id: 's', name: '侦查', base: 25, occupation: 30, interest: 10, growth: 5 })).toBe(70)
  })
})
