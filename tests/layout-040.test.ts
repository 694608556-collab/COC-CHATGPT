import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.4.0 layout contract', () => {
  const styles = read('src/renderer/src/styles.css')
  const app = read('src/renderer/src/App.tsx')
  const main = read('src/main/index.ts')

  it('renders the square shell edge to edge with native resizing and no shadow residue', () => {
    expect(main).toContain('hasShadow: false')
    // 0.6.1：thickFrame + resizable 交给系统原生隐形边框完成八方向缩放
    expect(main).toContain('thickFrame: true')
    expect(main).toContain('resizable: true')
    expect(styles).toContain('.window-frame {')
    expect(styles).toContain('--window-gutter: 0px')
    expect(styles).toContain('.window-frame.maximized {')
    expect(app).toContain('window-frame maximized')
    expect(app).toContain("'app-shell maximized' : 'app-shell'")
  })

  it('locks one base font size instead of inheriting the 16px browser default', () => {
    const rootBlock = styles.slice(styles.indexOf(':root {'), styles.indexOf(":root[data-theme"))
    expect(rootBlock).toContain('font-size: 13px')
  })

  it('keeps the accent-soft token defined for both themes', () => {
    expect(styles.match(/--accent-soft:/g)?.length ?? 0).toBe(2)
  })

  it('sizes the module editor inputs and their delete icons identically', () => {
    expect(styles).toContain('.kp-edit-row .icon-button')
    expect(styles).toContain('min-height: 34px')
    expect(styles).toContain('width: 34px')
  })

  it('shrinks the toolbar buttons to the shared control size', () => {
    const rule = styles.slice(styles.indexOf('.toolbar .secondary'), styles.indexOf('.toolbar .secondary') + 120)
    expect(rule).toContain('font-size: 13px')
  })

  it('puts the participants edit button before the KP label', () => {
    const editIndex = app.indexOf('participants-edit')
    const kpIndex = app.indexOf('KP：{module.kps')
    expect(editIndex).toBeGreaterThan(-1)
    expect(kpIndex).toBeGreaterThan(-1)
    expect(editIndex).toBeLessThan(kpIndex)
  })

  it('softens the active preset option and keeps its label readable', () => {
    const rule = styles.slice(styles.indexOf('.filter-option.active {'), styles.indexOf('.filter-option.active small'))
    expect(rule).toContain('background: var(--accent-soft)')
    expect(rule).toContain('color: var(--text)')
    expect(rule).toContain('border-color: var(--accent)')
  })

  it('stops native radios and checkboxes from stretching across the row', () => {
    const reset = styles.slice(styles.indexOf("input[type='checkbox'],"), styles.indexOf('/* export dialog'))
    expect(reset).toContain('width: 15px')
    expect(reset).toContain('flex: none')
  })

  it('gives the export dialog readable radio rows', () => {
    expect(styles).toContain('.export-dialog fieldset')
    expect(styles).toContain('.radio-row + .radio-row')
  })

  it('aligns confirmation dialog buttons to one size', () => {
    expect(styles).toContain('.modal-actions .danger-button')
    expect(styles).toContain('.modal-actions .danger-link')
    const rule = styles.slice(styles.indexOf('.modal-actions .secondary'), styles.indexOf('.modal-actions .secondary') + 200)
    expect(rule).toContain('font-size: 13px')
    expect(rule).toContain('border-radius: 8px')
  })

  it('floats the toast at the bottom-right and dismisses it automatically', () => {
    const notice = styles.slice(styles.indexOf('.notice {'), styles.indexOf('.notice button'))
    expect(notice).toContain('position: fixed')
    expect(notice).toContain('bottom: calc(var(--window-gutter, 0px) + 20px)')
    expect(notice).toContain('right: calc(var(--window-gutter, 0px) + 20px)')
    expect(app).toContain('setMessageClosing(true), 5000')
    expect(app).toContain('setMessage(undefined), 5550')
  })
})
