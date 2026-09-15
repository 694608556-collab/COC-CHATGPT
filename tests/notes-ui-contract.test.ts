import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('跑团闲记 module contract', () => {
  const app = read('src/renderer/src/App.tsx')
  const board = read('src/renderer/src/components/NoteBoard.tsx')
  const styles = read('src/renderer/src/styles.css')
  const database = read('src/main/database.ts')
  const ipc = read('src/main/ipc.ts')

  it('sits between the character cards and the settings page', () => {
    const nav = app.slice(app.indexOf("(['records'"), app.indexOf('privacy-note'))
    expect(nav).toContain('notes')
    expect(nav.indexOf("'characters'")).toBeLessThan(nav.indexOf("'notes'"))
    expect(nav.indexOf("'notes'")).toBeLessThan(nav.indexOf("'settings'"))
    expect(app).toContain("notes: '跑团闲记'")
  })

  it('lays the cards out five per row at the default window size', () => {
    expect(styles).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))')
    const grid = styles.slice(styles.indexOf('.note-grid {'), styles.indexOf('.note-card {'))
    expect(grid).toContain('repeat(5, minmax(0, 1fr))')
    expect(styles).toContain('@media (max-width: 1660px)')
  })

  it('shows the module name and the date in the card head', () => {
    expect(board).toContain('note-module')
    expect(board).toContain('note-date')
    expect(board).toContain("'未关联模组'")
  })

  it('edits in place with the three bottom buttons', () => {
    expect(board).toContain('note-card note-card-editing')
    expect(board).toContain('删除')
    expect(board).toContain('取消')
    expect(board).toContain('保存')
    const editing = board.slice(board.indexOf('note-card-editing'), board.indexOf('notes.map'))
    expect(editing.indexOf('删除')).toBeLessThan(editing.indexOf('取消'))
    expect(editing.indexOf('取消')).toBeLessThan(editing.indexOf('保存'))
  })

  it('keeps Enter inside the textarea and accepts pasted images', () => {
    expect(board).toContain('textarea')
    expect(board).toContain('onPaste')
    expect(board).toContain('pasteNoteImage')
    expect(board).toContain('chooseNoteImage')
    expect(board).not.toContain('onKeyDown')
  })

  it('stores notes in the database and exposes the ipc channels', () => {
    expect(database).toContain('CREATE TABLE IF NOT EXISTS notes')
    expect(database).toContain('module_name TEXT')
    expect(ipc).toContain("'notes:create'")
    expect(ipc).toContain("'notes:update'")
    expect(ipc).toContain("'notes:delete'")
    expect(ipc).toContain("'files:choose-note-image'")
    expect(ipc).toContain("'files:paste-note-image'")
  })
  it('matches the note editor controls to the rest of the app', () => {
    const editor = styles.slice(styles.indexOf('.note-date-field input,'), styles.indexOf('.note-date-field input {'))
    expect(editor).toContain('min-height: 34px')
    expect(editor).toContain('border-radius: 8px')
    const actions = styles.slice(styles.indexOf('.note-card-actions .text-button,'))
    expect(actions).toContain('min-height: 34px')
    expect(actions).toContain('.note-card-actions .text-button {')
    expect(actions).toContain('border: 1px solid var(--line)')
  })

  it('keeps destructive confirmations narrow', () => {
    const rule = styles.slice(styles.indexOf('.modal:has(.confirm-text)'))
    expect(rule.slice(0, 120)).toContain('width: min(500px, 100%)')
  })

  it('counts notes in the settings overview', () => {
    const stats = app.slice(app.indexOf('className="stats"'), app.indexOf('备份与恢复'))
    expect(stats).toContain('snapshot.notes.length')
    expect(stats).toContain('闲记')
    expect(styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
  })
})
