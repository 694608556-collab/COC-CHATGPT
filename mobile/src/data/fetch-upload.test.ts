import { afterEach, expect, it, vi } from 'vitest'
import { performSnapshotJob, createSnapshotJobSession } from './snapshot-job'
import { fetchRecord } from './network'
import { previewBackup } from './backup'
import { exampleBackup } from './fixtures'
import { decodeBase64 } from './bytes'

afterEach(() => vi.useRealTimers())

it('两个后台会话并行保留完整字节，同名租约的释放不会影响另一槽位', async () => {
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const { rawContent, manualContent, ...record } = snapshot.records[0]!
  const sessions = [createSnapshotJobSession(), createSnapshotJobSession()]
  const leases = (await Promise.all(
    sessions.map((run, index) =>
      run({
        type: 'prepare-fetch-upload',
        snapshot,
        record,
        text: JSON.stringify({ messages: [{ content: ('公开槽位' + index + '中文😀').repeat(20000) }] })
      })
    )
  )) as Array<{ id: string; count: number; sha256: string; bytes: number }>
  expect(leases[0]!.id).toBe(leases[1]!.id)
  expect(leases[0]!.sha256).not.toBe(leases[1]!.sha256)
  await sessions[0]!({ type: 'upload-close', id: leases[0]!.id })
  await expect(sessions[0]!({ type: 'upload-chunk', id: leases[0]!.id, index: 0 })).rejects.toThrow('失效')
  const bytes = Buffer.concat(
    await Promise.all(
      Array.from({ length: leases[1]!.count }, async (_, index) =>
        Buffer.from(
          decodeBase64((await sessions[1]!({ type: 'upload-chunk', id: leases[1]!.id, index })) as string)
        )
      )
    )
  )
  expect(bytes.length).toBe(leases[1]!.bytes)
  expect(JSON.parse(bytes.toString()).records[0].rawContent.messages[0].text).toBe(
    '公开槽位1中文😀'.repeat(20000)
  )
  await sessions[1]!({ type: 'upload-close', id: leases[1]!.id })
})

it('后台解析到上传的完整字节等同旧路径，正文不返回主线程', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-22T00:00:00Z'))
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const { rawContent, manualContent, ...record } = snapshot.records[0]!
  const text = JSON.stringify({
    messages: [
      {
        nickname: '公开',
        content: '中文😀\\"\n'.repeat(40000),
        extra: { flag: true, precise: '900719925474099312345' }
      }
    ]
  })
  const oldRecord = await fetchRecord({ fetchLog: async ({ url }) => ({ status: 200, url, text }) }, record)
  const old = (await performSnapshotJob({
    type: 'prepare-upload',
    snapshot: { ...snapshot, records: [oldRecord] }
  })) as { snapshot: typeof snapshot; sha256: string; bytes: number; id: string }
  await performSnapshotJob({ type: 'upload-close', id: old.id })
  const next = (await performSnapshotJob({
    type: 'prepare-fetch-upload',
    snapshot,
    record,
    text
  })) as { record: typeof record; id: string; bytes: number; sha256: string; count: number }
  expect(next).not.toHaveProperty('snapshot')
  expect(next.record).not.toHaveProperty('rawContent')
  expect(next.record).not.toHaveProperty('manualContent')
  expect(next.sha256).toBe(old.sha256)
  expect(next.bytes).toBe(old.bytes)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < next.count; i++)
    chunks.push(
      decodeBase64((await performSnapshotJob({ type: 'upload-chunk', id: next.id, index: i })) as string)
    )
  const complete = Buffer.concat(chunks)
  expect(JSON.parse(complete.toString('utf8'))).toEqual(JSON.parse(JSON.stringify(old.snapshot)))
  await performSnapshotJob({ type: 'upload-close', id: next.id })
})

it('解析失败仅上传失败元数据，失效关联仍拒绝且不会免除校验', async () => {
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const { rawContent, manualContent, ...record } = snapshot.records[0]!
  const failed = (await performSnapshotJob({
    type: 'prepare-fetch-upload',
    snapshot,
    record,
    text: 'not json'
  })) as { id: string; record: typeof record }
  expect(failed.record.status).toBe('fetch_failed')
  expect(failed.record).not.toHaveProperty('rawContent')
  await performSnapshotJob({ type: 'upload-close', id: failed.id })
  await expect(
    performSnapshotJob({
      type: 'prepare-fetch-upload',
      snapshot,
      record: { ...record, moduleId: 'missing' },
      text: '{"messages":[{"content":"公开"}]}'
    })
  ).rejects.toThrow('关联')
})

it('解析期间被新准备替换时拒绝迟到结果，旧租约关闭不释放新正文', async () => {
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const { rawContent, manualContent, ...record } = snapshot.records[0]!
  const first = performSnapshotJob({
    type: 'prepare-fetch-upload',
    snapshot,
    record,
    text: '{"messages":[{"content":"迟到公开正文"}]}'
  })
  const second = performSnapshotJob({
    type: 'prepare-fetch-upload',
    snapshot,
    record,
    text: '{"messages":[{"content":"新的公开正文"}]}'
  })
  const results = await Promise.allSettled([first, second])
  expect(results[0]!.status).toBe('rejected')
  if (results[0]!.status === 'rejected') expect(String(results[0]!.reason)).toContain('失效')
  expect(results[1]!.status).toBe('fulfilled')
  if (results[1]!.status !== 'fulfilled') throw new Error('新准备失败')
  const active = results[1]!.value as { id: string }
  await performSnapshotJob({ type: 'upload-close', id: 'previous-owner' })
  const chunk = await performSnapshotJob({ type: 'upload-chunk', id: active.id, index: 0 })
  expect(new TextDecoder().decode(decodeBase64(chunk as string))).toContain('新的公开正文')
  await performSnapshotJob({ type: 'upload-close', id: active.id })
})
