import { it, expect } from 'vitest'
import { performSnapshotJob } from './snapshot-job'
import { searchSample } from '../dev/sample'
import { decodeBase64 } from './bytes'
it('完整校验后分段保存保留正文、UTF-8 字节及摘要，并拒绝坏快照', async () => {
  const sample = searchSample()
  sample.records[0]!.manualContent = '中文😀'.repeat(100000)
  const result = (await performSnapshotJob({ type: 'prepare-upload', snapshot: sample })) as {
    snapshot: typeof sample
    bytes: number
    sha256: string
    id: string
    count: number
  }
  expect(result.count).toBeGreaterThan(1)
  const chunks: Uint8Array[] = []
  for (let index = 0; index < result.count; index++)
    chunks.push(
      decodeBase64((await performSnapshotJob({ type: 'upload-chunk', id: result.id, index })) as string)
    )
  expect(chunks.every((c) => c.length <= 256 * 1024)).toBe(true)
  const all = new Uint8Array(result.bytes)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.length
  }
  expect(offset).toBe(result.bytes)
  expect(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all))).toEqual(result.snapshot)
  expect(result.snapshot.records[0]!.manualContent).toBe(sample.records[0]!.manualContent)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', all)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  expect(hash).toBe(result.sha256)
  await performSnapshotJob({ type: 'upload-close', id: result.id })
  await expect(performSnapshotJob({ type: 'upload-chunk', id: result.id, index: 0 })).rejects.toThrow('失效')
  await expect(
    performSnapshotJob({ type: 'prepare-upload', snapshot: { ...sample, schemaVersion: 999 } as never })
  ).rejects.toThrow()
})

it('后准备的上传使迟到结果失效，旧租约清理不能释放新字节', async () => {
  const sample = searchSample()
  const first = performSnapshotJob({ type: 'prepare-upload', snapshot: sample })
  const next = performSnapshotJob({ type: 'prepare-upload', snapshot: sample })
  const results = await Promise.allSettled([first, next])
  expect(results[0]!.status).toBe('rejected')
  expect(results[1]!.status).toBe('fulfilled')
  if (results[1]!.status !== 'fulfilled') throw new Error('新上传未准备成功')
  const active = results[1]!.value as { id: string }
  await performSnapshotJob({ type: 'upload-close', id: 'old-owner' })
  expect(typeof (await performSnapshotJob({ type: 'upload-chunk', id: active.id, index: 0 }))).toBe('string')
  await expect(performSnapshotJob({ type: 'upload-chunk', id: active.id, index: -1 })).rejects.toThrow()
  await performSnapshotJob({ type: 'upload-close', id: active.id })
})
