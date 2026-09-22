import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root = path.resolve(__dirname, '..')
const styles = fs.readFileSync(path.join(root, 'src/renderer/src/styles.css'), 'utf8')

describe('0.6.0 content scroll chain', () => {
  it('constrains the grid row so the main panel cannot outgrow the window', () => {
    expect(styles).toContain('grid-template-rows: minmax(0, 1fr)')
  })

  it('lets the main panel shrink instead of pushing the content out of view', () => {
    const block = styles.slice(styles.indexOf('.main-panel {'), styles.indexOf('.main-panel {') + 180)
    expect(block).toContain('min-height: 0')
    expect(block).toContain('overflow: hidden')
  })

  it('makes .content the single vertical scroll container', () => {
    const block = styles.slice(styles.indexOf('.content {'), styles.indexOf('.content {') + 320)
    expect(block).toContain('flex: 1 1 auto')
    expect(block).toContain('min-height: 0')
    expect(block).toContain('overflow-y: auto')
    expect(block).toContain('overflow-x: hidden')
    expect(block).toContain('overscroll-behavior: contain')
  })

  it('draws a visible, draggable vertical scrollbar on the content area', () => {
    expect(styles).toContain('.content::-webkit-scrollbar {')
    expect(styles).toContain('width: 12px')
    expect(styles).toContain('.content::-webkit-scrollbar-thumb')
    expect(styles).toContain('border-radius: 8px')
    expect(styles).toContain('.content::-webkit-scrollbar-thumb:hover')
  })
})
