import { expect, it, vi } from 'vitest'
import { tablePreviewBaseline, restoreTableBodies, mergeTableImport } from './table-preview'
import { importTable } from './tables'
import { searchSample } from '../dev/sample'

it('预览不携带旧正文且不修改原记录，确认恢复所有未更新正文', () => {
  const current = searchSample(),
    before = JSON.stringify(current)
  const baseline = tablePreviewBaseline(current)
  for (const record of baseline.records) {
    expect(record.rawContent).toBeUndefined()
    expect(record.manualContent).toBeUndefined()
  }
  expect(baseline.records[0]).not.toBe(current.records[0])
  expect(restoreTableBodies(baseline, current)).toEqual(current)
  expect(JSON.stringify(current)).toBe(before)
})

it('元数据预览加正文恢复与完整表格导入一致，同名手动更新不丢其他正文', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'))
  try {
    const current = searchSample(),
      record = current.records[1]!,
      module = current.modules.find((m) => m.id === record.moduleId)!
    const csv = new TextEncoder().encode(
      `模组名,场次名,手动保存内容\n${module.name},${record.name},公开更新正文`
    )
    const expected = await importTable(current, csv, 'public-update.csv', 'records')
    const lightweight = await importTable(tablePreviewBaseline(current), csv, 'public-update.csv', 'records')
    expect(lightweight.updated).toBe(1)
    expect(restoreTableBodies(lightweight.next, current)).toEqual(expected.next)
    expect(current.records[1]!.manualContent).toBe(record.manualContent)
  } finally {
    vi.useRealTimers()
  }
})

it('增量确认与完整正文恢复等价，不允许删除、重排、来源变化或在线正文覆盖', () => {
  const current = searchSample()
  const proposed = tablePreviewBaseline(current)
  expect(mergeTableImport(proposed, current)).toEqual(current)
  const manual = proposed.records.find((r) => r.sourceType === 'manual')!
  manual.manualContent = '新正文\n\n中文😀'
  manual.updatedAt = '2026-10-20T12:00:00Z'
  expect(mergeTableImport(proposed, current)).toEqual(restoreTableBodies(proposed, current))
  const rejects = [
    (p: typeof proposed) => {
      p.records.pop()
    },
    (p: typeof proposed) => {
      p.records.reverse()
    },
    (p: typeof proposed) => {
      p.records[0]!.link = 'https://log.weizaima.com/?key=changed'
    },
    (p: typeof proposed) => {
      p.records[0]!.manualContent = '不能覆盖在线场次'
    },
    (p: typeof proposed) => {
      p.records[0]!.rawContent = current.records[0]!.rawContent
    },
    (p: typeof proposed) => {
      p.settings.theme = p.settings.theme === 'dark' ? 'light' : 'dark'
    },
    (p: typeof proposed) => {
      p.records[0]!.updatedAt = 'changed'
    },
    (p: typeof proposed) => {
      p.modules.pop()
    }
  ]
  for (const mutate of rejects) {
    const changed = structuredClone(proposed)
    mutate(changed)
    expect(() => mergeTableImport(changed, current)).toThrow()
  }
  expect(mergeTableImport(proposed)).toEqual(proposed)
})
