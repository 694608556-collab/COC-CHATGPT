import { expect, it } from 'vitest'
import { createTableDelta, applyTableDelta } from './table-delta'
import { tablePreviewBaseline } from './table-preview'
import { searchSample } from '../dev/sample'
import { performSnapshotJob } from './snapshot-job'
import { encodeBase64 } from './bytes'
import type { TablePreview } from './tables'

it('delta reconstructs complete metadata, preserves all old bodies, and only carries explicit changes', () => {
  const full = searchSample(),
    before = tablePreviewBaseline(full),
    after = structuredClone(before)
  after.modules[0]!.kps.push('Public KP')
  after.records.push({ ...after.records[0]!, id: 'delta-new', rawContent: undefined })
  const delta = createTableDelta(before, after)
  expect(delta.recordsAdded).toHaveLength(1)
  expect(delta.moduleParticipants).toHaveLength(1)
  expect(delta.manualUpdates).toHaveLength(0)
  expect(applyTableDelta(delta, before, after.exportedAt)).toEqual(after)
  expect(applyTableDelta(delta, full, after.exportedAt).records[0]!.rawContent).toEqual(
    full.records[0]!.rawContent
  )
  expect(JSON.stringify(delta)).not.toContain('rawContent')
})

it('rejects duplicate/conflicting/missing IDs, arbitrary operations and non-import changes', () => {
  const before = tablePreviewBaseline(searchSample()),
    after = structuredClone(before)
  after.records.push({ ...after.records[0]!, id: 'delta-new' })
  const valid = createTableDelta(before, after)
  const bad = [
    { ...valid, recordsAdded: [valid.recordsAdded[0]!, valid.recordsAdded[0]!] },
    { ...valid, recordsAdded: [before.records[0]!] },
    { ...valid, delete: [] },
    { ...valid, protocolVersion: 2 },
    { ...valid, moduleParticipants: [{ ...before.modules[0]!, name: 'forbidden' }] },
    { ...valid, manualUpdates: [{ ...before.records[0]!, manualContent: 'forbidden' }] },
    { ...valid, moduleParticipants: [{ ...before.modules[0]!, id: 'missing' }] }
  ]
  for (const delta of bad) expect(() => applyTableDelta(delta as never, before, before.exportedAt)).toThrow()
})

it('Worker leases bind revision and candidate, reject replacement/release and retain full validation', async () => {
  const snapshot = tablePreviewBaseline(searchSample())
  const base64 = encodeBase64(
    new TextEncoder().encode(
      '模组名称,场次名称,日志链接\nPublic Delta,Public New,https://log.weizaima.com/?key=public-delta'
    )
  )
  const preview = (await performSnapshotJob({
    type: 'table-import',
    snapshot,
    base64,
    name: 'public.csv',
    kind: 'records',
    revision: 7
  })) as TablePreview
  expect(preview.lease).toBeTruthy()
  const expected = structuredClone(preview.next)
  preview.next.records.length = 0
  const prepared = (await performSnapshotJob({ type: 'table-confirm', id: preview.lease!, revision: 7 })) as {
    snapshot: typeof snapshot
    json: string
  }
  expect(prepared.snapshot).toEqual(expected)
  expect(applyTableDelta(JSON.parse(prepared.json), snapshot, expected.exportedAt)).toEqual(expected)
  await expect(
    performSnapshotJob({ type: 'table-confirm', id: preview.lease!, revision: 8 })
  ).rejects.toThrow()
  await performSnapshotJob({ type: 'table-release', id: preview.lease! })
  await expect(
    performSnapshotJob({ type: 'table-confirm', id: preview.lease!, revision: 7 })
  ).rejects.toThrow()
  const next = (await performSnapshotJob({
    type: 'table-import',
    snapshot,
    base64,
    name: 'public.csv',
    kind: 'records',
    revision: 7
  })) as TablePreview
  await performSnapshotJob({
    type: 'table-import',
    snapshot,
    base64,
    name: 'public.csv',
    kind: 'records',
    revision: 7
  })
  await expect(performSnapshotJob({ type: 'table-confirm', id: next.lease!, revision: 7 })).rejects.toThrow()
})
