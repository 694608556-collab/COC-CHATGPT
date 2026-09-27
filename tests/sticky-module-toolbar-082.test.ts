import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.8.3 records scrolling layout', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('keeps the records import/export toolbar in normal document flow', () => {
    expect(app).toContain('className="toolbar records-toolbar"')
    const toolbarRule = styles.slice(styles.indexOf('.toolbar {'), styles.indexOf('.toolbar-divider {'))
    expect(toolbarRule).not.toContain('position: sticky')
    expect(styles).not.toContain('.records-toolbar {')
  })

  it('keeps module headings normal and scrolls extra sessions inside each module', () => {
    const rule = styles.slice(styles.indexOf('.module-row {'), styles.indexOf('.collapse-button {'))
    expect(rule).not.toContain('position: sticky')
    expect(rule).not.toContain('top: 64px')
    expect(rule).not.toContain('z-index')

    const cardRule = styles.slice(styles.indexOf('.module-card {'), styles.indexOf('.module-row {'))
    expect(cardRule).toContain('overflow: hidden')
    expect(app).toContain('className="module-records-viewport"')
    expect(app).toContain('className="module-records-scroll"')
    const recordsRule = styles.slice(
      styles.indexOf('.module-records-scroll {'),
      styles.indexOf('.collapse-button {')
    )
    expect(recordsRule).toContain('max-height:')
    expect(recordsRule).toContain('overflow-y: auto')
  })
})
