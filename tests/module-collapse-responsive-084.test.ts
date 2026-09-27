import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const app = fs.readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8')

describe('0.8.4 module collapse responsiveness', () => {
  it('updates the visible snapshot before persisting the collapsed flag', () => {
    const block = app.slice(app.indexOf('const toggleModuleCollapsed'), app.indexOf('const header ='))
    expect(block).toContain('setSnapshot((current) => ({')
    expect(block).toContain('item.id === module.id ? { ...item, collapsed } : item')
    expect(block).toContain('window.coc.modules.update(module.id, { collapsed })')
  })

  it('does not route the triangle click through the full refresh operation', () => {
    const button = app.slice(app.indexOf('className="collapse-button"'), app.indexOf('className="module-name"'))
    expect(button).toContain('onClick={() => toggleModuleCollapsed(module)}')
    expect(button).not.toContain('void run(')
  })
})
