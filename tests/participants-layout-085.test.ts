import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.8.5 participants row layout', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('removes only the obsolete participants edit icon', () => {
    expect(app).not.toContain('participants-edit')
    expect(app).not.toContain('<PencilIcon />')
    expect(app).toContain('<div className="participants">')
  })

  it('keeps the participant labels and module editing entry point', () => {
    expect(app).toContain('KP：{module.kps.join')
    expect(app).toContain('PC / PL')
    expect(app).toContain('className="module-name"')
    expect(app).toContain('setModuleDraft({')
  })

  it('aligns KP with the 30px collapse control in the module row', () => {
    expect(styles).toContain('padding: 8px 12px 8px 30px;')
    expect(styles).toContain('gap: 5px;')
  })
})
