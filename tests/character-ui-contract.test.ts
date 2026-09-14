import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('character card UI contract', () => {
  const source = fs.readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8')
  const editor = fs.readFileSync(path.join(root, 'src/renderer/src/components/CharacterEditor.tsx'), 'utf8')

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

  it('deletes a character card through the shared confirmation flow', () => {
    expect(source).toContain('requestDeleteCharacter')
    expect(source).toContain('window.coc.characters.delete')
    const head = source.slice(
      source.indexOf('character-card-head'),
      source.indexOf('character-card-main')
    )
    expect(head).toContain('requestDeleteCharacter(character)')
    expect(head).not.toContain('setCharacterId(character.id)')
  })
  it('supports multiple module links and PC-name suggestions', () => {
    expect(editor).toContain('draft.moduleIds.includes(module.id)')
    expect(editor).toContain('list={nameListId}')
    expect(editor).toContain('pcSuggestions')
    expect(source).toContain('character-carousel')
    expect(source).toContain('attribute-summary')
    expect(source).toContain('characterScroller.current?.scrollBy')
  })
})
