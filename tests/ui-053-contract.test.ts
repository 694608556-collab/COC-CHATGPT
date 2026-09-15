import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.5.3 recovered UI contract', () => {
  const app = read('src/renderer/src/App.tsx')
  const editor = read('src/renderer/src/components/CharacterEditor.tsx')
  const icons = read('src/renderer/src/components/Icons.tsx')
  const main = read('src/main/index.ts')
  const ipc = read('src/main/ipc.ts')
  const windowState = read('src/shared/window-state.ts')
  const styles = read('src/renderer/src/styles.css')

  it('keeps the 960x640 minimum window size', () => {
    expect(main).toContain('minWidth: 960')
    expect(main).toContain('minHeight: 640')
    expect(ipc).toContain('.min(960)')
    expect(ipc).toContain('.min(640)')
    expect(windowState).toContain('1920, 960')
    expect(windowState).toContain('1080, 640')
  })

  it('uses the solid triangle and X icons', () => {
    expect(icons).toContain('SolidTriangleIcon')
    expect(icons).toContain('XIcon')
    expect(icons).not.toContain('ChevronIcon')
    expect(icons).not.toContain('TrashIcon')
    expect(app).toContain('SolidTriangleIcon')
    expect(app).toContain('icon-button module-remove')
    expect(editor).toContain('icon-button neutral-delete')
  })

  it('renders the character list as a plain grid without the carousel', () => {
    expect(app).not.toContain('character-carousel')
    expect(app).not.toContain('characterScroller')
    expect(app).toContain('className="character-grid"')
    expect(app).toContain('character-card-actions')
  })

  it('puts the edition badge inside the card head', () => {
    const head = app.slice(app.indexOf('character-card-head'), app.indexOf('character-card-main'))
    expect(head).toContain('edition-badge')
  })

  it('keeps the simplified skill rows and the two column property grid', () => {
    expect(editor).not.toContain('skill-row-head')
    expect(editor).toContain('技能${index + 1}名称')
    expect(editor).toContain('技能${index + 1}点数')
    expect(editor).toContain('section-heading-with-action')
    expect(editor).toContain('add-item')
    expect(editor).toContain('story-textarea')
    expect(editor).toContain('background-field background-')
  })

  it('ships the recovered stylesheet markers', () => {
    expect(styles).toContain('.section-heading-with-action')
    expect(styles).toContain('.neutral-delete')
    expect(styles).toContain('.story-textarea')
    expect(styles).toContain('@media (max-width: 1460px)')
  })
})
