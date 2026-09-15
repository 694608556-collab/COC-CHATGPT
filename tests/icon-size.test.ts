import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const styles = fs.readFileSync(path.join(root, 'src/renderer/src/styles.css'), 'utf8')

describe('delete icon sizing', () => {
  it('shrinks the X glyph without touching the button box', () => {
    expect(styles).toContain('.module-remove svg { width: 12px; height: 12px; stroke-width: 1.5; }')
    expect(styles).toContain('.character-editor .neutral-delete svg { width: 12px; height: 12px; stroke-width: 1.5; }')
  })

  it('keeps both delete buttons at their previous outer size', () => {
    expect(styles).toContain('.character-editor .neutral-delete { width: 22px; min-width: 22px; min-height: 22px; height: 22px;')
    const moduleButton = styles.slice(styles.indexOf('.kp-edit-row .icon-button,'))
    expect(moduleButton.slice(0, 120)).toContain('width: 34px')
  })
})
