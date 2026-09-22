import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.0 sequence number picker', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const api = read('src/shared/api.ts')
  const ipc = read('src/main/ipc.ts')

  it('routes the add-session button through gap detection', () => {
    expect(app).toContain('function SequencePickerDialog')
    expect(app).toContain('const requestAddRecord =')
    expect(app).toContain('onClick={() => requestAddRecord(module)}')
    // gaps are every missing number between 1 and the current maximum
    expect(app).toContain('for (let number = 1; number <= maximum; number += 1)')
    // without gaps the editor opens directly, without a modal
    expect(app).toContain('if (!gaps.length)')
    expect(app).toContain('openRecordEditor(module)')
  })

  it('offers gap filling, continuation and a custom number', () => {
    expect(app).toContain('<Modal title="选择下一场编号"')
    expect(app).toContain('填补编号空缺')
    expect(app).toContain('接续最后编号')
    expect(app).toContain('自定义编号')
    expect(app).toContain('placeholder="1-9999"')
  })

  it('validates custom numbers with the same rules as the backend', () => {
    expect(app).toContain('场次编号必须是大于 0 的整数')
    expect(app).toContain('场次编号不能超过 9999')
    expect(app).toContain('场已存在，请选择其他编号')
  })

  it('prefills the session name and forwards the chosen number on create only', () => {
    expect(app).toContain('`${module.name}第 ${sequenceNo} 场`')
    expect(app).toContain('recordDraft.sequenceNo !== undefined ? { sequenceNo: recordDraft.sequenceNo }')
    // the update branch must never send a sequence number
    const updateBranch = app.slice(
      app.indexOf('records.update(recordDraft.id'),
      app.indexOf('records.create({')
    )
    expect(updateBranch).not.toContain('sequenceNo')
  })

  it('clears the picked number when a new draft switches module', () => {
    expect(app).toContain('setRecordDraft({ ...draft, sequenceNo: undefined, name: \'\' })')
  })

  it('reuses the existing modal and option-button visual language', () => {
    expect(app).toContain("'backup-option selected'")
    expect(styles).toContain('.backup-option.selected')
    expect(styles).toContain('.sequence-picker')
    expect(styles).toContain('.sequence-error')
  })

  it('accepts an optional sequence number through the API contract and IPC schema', () => {
    expect(api).toContain('sequenceNo?: number')
    expect(ipc).toContain('sequenceNo: z.number().int().min(1).max(9999).optional()')
  })
})
