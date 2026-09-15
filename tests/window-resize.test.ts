import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('rounded window with custom resizing', () => {
  const main = read('src/main/index.ts')
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const handles = read('src/renderer/src/components/ResizeHandles.tsx')

  it('keeps the window transparent so the shell can draw rounded corners', () => {
    expect(main).toContain('transparent: true')
    expect(main).toContain('resizable: false')
    expect(main).toContain("backgroundColor: '#00000000'")
    expect(main).not.toContain('thickFrame: true')
    expect(styles).toContain('border-radius: 14px')
  })

  it('renders the eight resize handles again', () => {
    expect(app).toContain("import { ResizeHandles } from './components/ResizeHandles'")
    expect(app).toContain('<ResizeHandles disabled={windowMaximized} />')
    expect(handles).toContain("['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']")
  })

  it('enforces the shared minimum size while dragging', () => {
    expect(handles).toContain('const MIN_WIDTH = 960')
    expect(handles).toContain('const MIN_HEIGHT = 640')
    expect(handles).toContain('window.coc.window.setBounds')
  })

  it('places every handle across the visible shell edge, not the window edge', () => {
    expect(styles).toContain('left: calc(var(--window-gutter) - 5px)')
    expect(styles).toContain('right: calc(var(--window-gutter) - 5px)')
    expect(styles).toContain('top: calc(var(--window-gutter) - 5px)')
    expect(styles).toContain('bottom: calc(var(--window-gutter) - 5px)')
    const block = styles.slice(styles.indexOf('/* handles sit on the visible shell edge'), styles.indexOf('.filter-option {'))
    expect(block).not.toMatch(/top: 0;/)
    expect(block).not.toMatch(/left: 0;/)
  })
})
