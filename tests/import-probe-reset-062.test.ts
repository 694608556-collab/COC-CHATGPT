import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.2 session numbering and import probe reset', () => {
  const repository = read('src/main/repository.ts')
  const app = read('src/renderer/src/App.tsx')
  const ipc = read('src/main/ipc.ts')
  const api = read('src/shared/api.ts')
  const preload = read('src/preload/index.ts')
  const packagedPreload = read('resources/preload.cjs')
  const dialog = read('src/renderer/src/components/RecordImportDialog.tsx')

  it('derives the default session number from surviving sessions only', () => {
    // 历史最大值不得参与默认编号，否则删掉末尾场次后会凭空跳号
    const branch = repository.slice(
      repository.indexOf('默认接续现存场次的最大编号'),
      repository.indexOf('const nextMaximum')
    )
    expect(branch).toContain('sequenceNo = largestUsed + 1')
    expect(branch).not.toContain('Math.max(storedMaximum, largestUsed)')
  })

  it('keeps the gap picker contract untouched', () => {
    // 中间空缺仍由界面提示用户选择，不改变既有交互
    expect(app).toContain('function SequencePickerDialog')
    expect(app).toContain('const requestAddRecord =')
    expect(app).toContain('if (!gaps.length)')
    expect(app).toContain('填补编号空缺')
    expect(app).toContain('接续最后编号')
  })

  it('never sends a status or fetched time when importing rows', () => {
    const importBlock = app.slice(app.indexOf('const importTableRows'), app.indexOf('const createCharacter'))
    expect(importBlock).not.toContain('row.status')
    expect(importBlock).not.toContain('row.fetchedAt')
  })

  it('resets probe state for both new and updated imported sessions', () => {
    const importBlock = app.slice(app.indexOf('const importTableRows'), app.indexOf('const createCharacter'))
    // 覆盖更新分支必须显式重置，否则旧正文会留在记录里
    expect(importBlock).toContain('window.coc.records.resetProbe(duplicate.id)')
    // 新增分支不带状态，由后端默认成 pending
    expect(importBlock).toContain('await window.coc.records.create({')
  })

  it('exposes the reset-probe channel through every layer', () => {
    expect(api).toContain('resetProbe(id: string): Promise<SessionRecord>')
    expect(preload).toContain("resetProbe: (id) => invoke('records:reset-probe', { id })")
    expect(packagedPreload).toContain("resetProbe: (id) => invoke('records:reset-probe', { id })")
    expect(ipc).toContain("register('records:reset-probe'")
    expect(ipc).toContain("'records:reset-probe',")
  })

  it('clears the cached body so the link must be checked again', () => {
    const method = repository.slice(
      repository.indexOf('resetRecordProbeState'),
      repository.indexOf('deleteRecord(id: string)')
    )
    for (const column of ['raw_json=NULL', 'fetched_at=NULL', 'cache_source_url=NULL', 'last_error=NULL']) {
      expect(method).toContain(column)
    }
    expect(method).toContain("status='pending'")
    // 手动正文的场次不受在线内容影响，必须保持原状
    expect(method).toContain("current.sourceType === 'manual' || current.manualContent")
  })

  it('documents the new import behaviour in the dialog', () => {
    expect(dialog).toContain('链接状态一律重置为“待检测”')
    // 导出仍保留状态列供查看，只是导入不再采信
    expect(dialog).toContain('状态、跑团日期、最近抓取时间三列由软件导出时自动记录')
  })
})
