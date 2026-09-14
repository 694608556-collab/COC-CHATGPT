import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('character card UI contract', () => {
  const source = read('src/renderer/src/App.tsx')
  const editor = read('src/renderer/src/components/CharacterEditor.tsx')
  const combo = read('src/renderer/src/components/NameSuggestField.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('removes character template and blank-template entries', () => {
    expect(source).not.toContain('\u5bfc\u5165\u6a21\u7248')
    expect(source).not.toContain('\u7b2c\u516d\u7248\u7a7a\u767d\u6a21\u7248')
    expect(source).not.toContain('\u7b2c\u4e03\u7248\u7a7a\u767d\u6a21\u7248')
    expect(source).not.toContain('chooseCharacterImport')
  })

  it('removes character XLSX and PDF export controls', () => {
    expect(source).not.toContain('\u5bfc\u51fa XLSX')
    expect(source).not.toContain('\u5bfc\u51fa PDF')
    expect(source).not.toContain('exportCharacter')
  })

  it('keeps multiple module links and swaps the native datalist for a styled dropdown', () => {
    expect(editor).toContain('draft.moduleIds.includes(module.id)')
    expect(editor).toContain('pcSuggestions')
    expect(editor).toContain('<NameSuggestField')
    expect(editor).not.toContain('<datalist')
    expect(combo).toContain('role="combobox"')
    expect(combo).toContain('combo-list')
    expect(styles).toContain('.combo-list')
  })

  it('deletes a character card through the shared confirmation flow', () => {
    expect(source).toContain('requestDeleteCharacter')
    expect(source).toContain('window.coc.characters.delete')
    const head = source.slice(
      source.indexOf('character-card-head'),
      source.indexOf('character-card-main')
    )
    expect(head).not.toContain('requestDeleteCharacter')
  })

  it('moves the card delete button to the bottom-right action row', () => {
    expect(source).toContain('character-card-actions')
    const start = source.indexOf('character-card-actions')
    const actions = source.slice(start, source.indexOf('</article>', start))
    expect(actions).toContain('requestDeleteCharacter(character)')
    expect(styles).toContain('justify-content: flex-end')
  })

  it('shows Chinese attribute labels and drops the skill point summary line', () => {
    expect(source).toContain('\u529b\u91cf {character.attrs.STR}')
    expect(source).toContain('\u4f53\u8d28 {character.attrs.CON}')
    expect(source).toContain('\u654f\u6377')
    expect(source).toContain('\u667a\u529b {character.attrs.INT}')
    expect(source).not.toContain('\u804c\u4e1a\u6280\u80fd\u70b9')
    expect(source).not.toContain('\u5174\u8da3\u6280\u80fd\u70b9')
  })

  it('removes the skill point limit section from the editor', () => {
    expect(editor).not.toContain('\u6280\u80fd\u70b9\u6570\u4e0a\u9650')
    expect(editor).not.toContain('skillPointSummary')
    expect(editor).not.toContain('occupationLimit')
  })

  it('reduces skills to name and points with add and delete controls', () => {
    expect(editor).toContain('skill-editor')
    expect(editor).toContain('\u6dfb\u52a0\u6280\u80fd')
    expect(editor).toContain('createSkill()')
    expect(editor).toContain('\u5220\u9664\u6280\u80fd')
    expect(editor).not.toContain("'base', 'occupation', 'interest', 'growth'")
  })

  it('lays property rows out in two columns with a trailing delete icon', () => {
    expect(editor).toContain('item-grid')
    expect(editor).toContain('\u5220\u9664\u7269\u54c1')
    expect(styles).toContain('.item-grid')
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })
})
