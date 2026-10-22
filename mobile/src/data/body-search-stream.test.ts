import { expect, it, vi, afterEach } from 'vitest'
import { searchNativeBodies } from './backup-stream-client'
import { BodySearchCleanupError } from './body-search-stream'
import type { LogbookPort } from './native'
import { createHash } from 'node:crypto'
import { exampleBackup } from './fixtures'
import { searchBodyStream } from './body-search-stream'
import { retainBodySelection } from './body-cache'
import { previewBackup } from './backup'
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const proof = (bytes: Uint8Array) => ({
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex')
})
async function* source(bytes: Uint8Array) {
  for (let start = 0; start < bytes.length; start += 16384) yield bytes.subarray(start, start + 16384)
}
afterEach(() => vi.unstubAllGlobals())
it('只读搜索租约核对版本后释放；取消、过期和清理失败不转成写入或覆盖', async () => {
  const bytes = encode(exampleBackup()),
    preset = (await previewBackup(bytes)).snapshot.settings.filterPreset
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes.slice().buffer))
  )
  const cancelled = vi.fn(async () => {}),
    forbidden = vi.fn(async () => {
      throw Error('Unexpected write')
    })
  const controller = new AbortController()
  const port = {
    createSearchSource: vi.fn(async () => ({
      id: 'read-only',
      revision: 7,
      source: { fileUri: 'https://localhost/_capacitor_file_/public', ...proof(bytes) }
    })),
    getStatus: vi.fn(async () => ({ revision: 7 })),
    cancelBackupStage: cancelled,
    appendBackupStage: forbidden,
    finishBackupPreview: forbidden,
    commitBackupRestore: forbidden,
    createBackupStream: forbidden,
    finishBackupExport: forbidden
  } as unknown as LogbookPort
  const result = await searchNativeBodies(port, ['r1'], 7, '离线', preset, controller.signal)
  expect(result.hits.map((row) => row.id)).toEqual(['r1'])
  expect(cancelled).toHaveBeenLastCalledWith({ id: 'read-only' })
  expect(forbidden).not.toHaveBeenCalled()
  vi.mocked(port.getStatus).mockResolvedValue({ revision: 8 } as Awaited<
    ReturnType<LogbookPort['getStatus']>
  >)
  await expect(searchNativeBodies(port, ['r1'], 7, '离线', preset, controller.signal)).rejects.toThrow('变化')
  vi.mocked(port.createSearchSource!).mockImplementation(async () => {
    controller.abort()
    return {
      id: 'read-only',
      revision: 7,
      source: { fileUri: 'https://localhost/_capacitor_file_/public', ...proof(bytes) }
    }
  })
  await expect(searchNativeBodies(port, ['r1'], 7, '离线', preset, controller.signal)).rejects.toThrow('取消')
  const next = new AbortController()
  vi.mocked(port.createSearchSource!).mockImplementation(async () => {
    next.abort()
    return {
      id: 'read-only',
      revision: 7,
      source: { fileUri: 'https://localhost/_capacitor_file_/public', ...proof(bytes) }
    }
  })
  cancelled.mockRejectedValueOnce(new Error('public cleanup failure'))
  await expect(searchNativeBodies(port, ['r1'], 7, '离线', preset, next.signal)).rejects.toBeInstanceOf(
    BodySearchCleanupError
  )
  expect(forbidden).not.toHaveBeenCalled()
})
it('逐场搜索与阅读过滤一致，完整计数与摘要返回，不返回任何正文或写入回调', async () => {
  const seed = exampleBackup(),
    first = seed.records[0]!
  const preset = (await previewBackup(encode(seed))).snapshot.settings.filterPreset
  first.rawContent!.messages = [
    { ...first.rawContent!.messages[0]!, text: 'PUBLIC NEEDLE needle 😀' },
    { ...first.rawContent!.messages[0]!, id: 'hidden', text: 'NEEDLE', isOffTopic: true }
  ]
  const backup = {
    ...seed,
    records: [
      first,
      {
        ...first,
        id: 'last',
        rawContent: undefined,
        sourceType: 'manual',
        status: 'manual',
        manualContent: '首行\r\n最后 NEEDLE\0😀'
      }
    ]
  }
  const bytes = encode(backup)
  const result = await searchBodyStream(source(bytes), {
    expectedSource: proof(bytes),
    ids: ['r1', 'last'],
    query: 'needle',
    preset: { ...preset, hideOffTopic: true }
  })
  expect(result.records).toBe(2)
  expect(result.hits.map((hit) => [hit.id, hit.matches])).toEqual([
    ['r1', 2],
    ['last', 1]
  ])
  expect(result.hits[1]!.excerpt).toContain('最后 NEEDLE\0😀')
  expect(JSON.stringify(result)).not.toContain('rawContent')
  expect(JSON.stringify(result)).not.toContain('manualContent')
  await expect(
    searchBodyStream(source(bytes), {
      expectedSource: { ...proof(bytes), sha256: '0'.repeat(64) },
      ids: ['r1', 'last'],
      query: 'needle',
      preset
    })
  ).rejects.toThrow()
  await expect(
    searchBodyStream(source(bytes), { expectedSource: proof(bytes), ids: ['r1'], query: 'needle', preset })
  ).rejects.toThrow('场次')
  const controller = new AbortController()
  controller.abort()
  await expect(
    searchBodyStream(source(bytes), {
      expectedSource: proof(bytes),
      ids: ['r1', 'last'],
      query: 'needle',
      preset,
      signal: controller.signal
    })
  ).rejects.toThrow('取消')
})
it('连续阅读只保留所选正文，淘汰正文重新标为原生延迟读取，不改变任何元数据或原对象', async () => {
  const initial = (await previewBackup(encode(exampleBackup()))).snapshot
  initial.records = [
    ...initial.records,
    { ...initial.records[0]!, id: 'second', manualContent: '完整手动\0😀' }
  ]
  const original = JSON.stringify(initial)
  const retained = retainBodySelection(initial, new Set(['unloaded']), new Set(['second']))
  expect(retained.snapshot.records[0]!.rawContent).toBeUndefined()
  expect(retained.snapshot.records[1]!.rawContent).toEqual(initial.records[1]!.rawContent)
  expect(retained.snapshot.records[1]!.manualContent).toBe('完整手动\0😀')
  expect([...retained.deferred]).toEqual(['unloaded', 'r1'])
  expect(JSON.stringify(initial)).toBe(original)
  const closed = retainBodySelection(retained.snapshot, retained.deferred, new Set())
  expect(closed.snapshot.records.every((row) => !row.rawContent && row.manualContent === undefined)).toBe(
    true
  )
  expect(closed.deferred.has('second')).toBe(true)
  expect(retainBodySelection(closed.snapshot, closed.deferred, new Set()).snapshot).toBe(closed.snapshot)
})
