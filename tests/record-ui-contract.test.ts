import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const app = fs.readFileSync(
  path.join(root, 'src/renderer/src/App.tsx'),
  'utf8'
)
const styles = fs.readFileSync(
  path.join(root, 'src/renderer/src/styles.css'),
  'utf8'
)

describe('record module UI contract', () => {
  it('uses the custom confirmation dialog for destructive actions', () => {
    expect(app).toContain('ConfirmDialog')
    expect(app).toContain('setConfirmOptions')
    expect(app.match(/window\.confirm/g)?.length ?? 0).toBe(1)
  })

  it('removes the sidebar brand block', () => {
    expect(app).not.toContain('className="brand"')
    expect(app).toContain("nav-item")
  })

  it('keeps batch detection results in readable columns', () => {
    expect(styles).toContain('.check-results div')
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) auto')
  })

  it('animates toast exit instead of disappearing abruptly', () => {
    expect(app).toContain('messageClosing')
    expect(styles).toContain('@keyframes notice-out')
  })
})
