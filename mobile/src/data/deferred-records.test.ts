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

it('整批正文合并不为每个场次重新遍历列表，仍全部核对归属和来源', () => {
  const current = searchSample(),
    template = current.records[0]!
  let reads = 0
  current.records = Array.from({ length: 1000 }, (_, index) => ({
    ...template,
    get id() {
      reads++
      return `body-${index}`
    },
    rawContent: undefined
  }))
  const ids = Array.from({ length: 1000 }, (_, index) => `body-${index}`)
  const content = { ...current, records: ids.map((id) => ({ ...template, id })) }
  const merged = mergeRecordContent(current, content, ids)
  expect(reads).toBeLessThanOrEqual(current.records.length * 4)
  expect(merged.records).toEqual(content.records)
  content.records[999] = { ...content.records[999]!, moduleId: 'wrong-module' }
  expect(() => mergeRecordContent(current, content, ids)).toThrow('不一致')
  expect(current.records.every((record) => record.rawContent === undefined)).toBe(true)
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
