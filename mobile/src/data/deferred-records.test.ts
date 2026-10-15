import { expect, it } from 'vitest'
import { searchSample } from '../dev/sample'
import { deferredIds, mergeRecordContent } from './deferred-records'

it('正文索引拒绝重复、未知 ID 和无效结构，失败不更改数据', () => {
  const sample = searchSample(),
    id = sample.records[0]!.id
  expect([...deferredIds(sample, [id])]).toEqual([id])
  for (const invalid of [[id, id], ['missing'], [null], null])
    expect(() => deferredIds(sample, invalid)).toThrow()
})

it('按需正文只能完整合并所选批次，其他正文和当前元数据保持原对象', () => {
  const current = searchSample(),
    first = current.records[0]!,
    id = first.id
  const overview = {
    ...current,
    records: current.records.map((r) =>
      r.id === id ? { ...r, rawContent: undefined, manualContent: undefined } : r
    )
  }
  const selected = { ...current, records: [first], settings: { ...current.settings, theme: 'dark' as const } }
  const merged = mergeRecordContent(overview, selected, [id])
  expect(merged.records[0]!.rawContent).toEqual(first.rawContent)
  expect(merged.records[1]).toBe(overview.records[1])
  expect(merged.settings).toBe(overview.settings)
  for (const bad of [
    { ...selected, records: [] },
    { ...selected, records: [first, current.records[1]!] },
    { ...selected, records: [{ ...first, moduleId: 'other' }] },
    { ...selected, records: [{ ...first, rawContent: undefined, manualContent: undefined }] }
  ])
    expect(() => mergeRecordContent(overview, bad, [id])).toThrow()
  expect(overview.records[0]!.rawContent).toBeUndefined()
})
