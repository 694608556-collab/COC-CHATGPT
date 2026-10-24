import { expect, it, vi } from 'vitest'
import { exampleBackup } from '../data/fixtures'
import { previewBackup } from '../data/backup'
import type { LogbookPort } from '../data/native'

const work = vi.hoisted(() => ({ prepared: [] as string[], released: [] as string[], packed: false }))
vi.mock('../data/background', async (original) => ({
  ...(await original<typeof import('../data/background')>()),
  prepareFetchUploadInBackground: async (_snapshot: unknown, record: { id: string }) => {
    work.prepared.push(record.id)
    return {
      id: record.id,
      bytes: 1,
      sha256: 'a'.repeat(64),
      count: 1,
      keepsOriginalBytes: !work.packed,
      record: { ...record, status: 'valid' }
    }
  },
  uploadChunkInBackground: async () => 'eA==',
  uploadTransferInBackground: async () => ({ encoding: 'zlib', rawBytes: 1, base64: 'eA==' }),
  closeUploadInBackground: async (id: string) => {
    work.released.push(id)
  }
}))
import { stagedFetch } from './staged-fetch'

it.each(['legacy', 'packed', 'identity-fallback'] as const)(
  '正文处理与上传重叠，%s 候选保持展开名额有界，原生上传仍串行且最后才提交',
  async (mode) => {
    const packed = mode === 'packed'
    work.packed = packed
    work.prepared.length = 0
    work.released.length = 0
    const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
    const snapshot = {
      ...base,
      records: Array.from({ length: 8 }, (_, i) => ({
        ...base.records[0]!,
        id: 'public-' + i,
        rawContent: undefined
      }))
    }
    let unblock!: () => void
    const held = new Promise<void>((resolve) => {
      unblock = resolve
    })
    let staging = 0,
      active = 0,
      maximum = 0,
      finished = false
    const port = {
      beginFetchBatch: async () => ({ id: 'public-batch' }),
      fetchLog: async ({ url }: { url: string }) => ({ url, status: 200, text: '{}' }),
      beginSnapshotEdit: async () => {
        active++
        maximum = Math.max(maximum, active)
        return { id: 'public-upload' }
      },
      appendSnapshotEdit: async () => {},
      appendSnapshotEditEncoded: mode !== 'legacy' ? async () => {} : undefined,
      stageFetchResult: async () => {
        if (++staging === 1) await held
      },
      cancelSnapshotEdit: async () => {
        active--
      },
      finishFetchBatch: async () => {
        expect(work.released).toHaveLength(8)
        finished = true
        return { revision: 2, exportedAt: 'public' }
      },
      cancelFetchBatch: async () => {
        throw Error('Unexpected cancellation')
      }
    } as unknown as LogbookPort
    const pending = stagedFetch(
      port,
      snapshot,
      snapshot.records.map((r) => r.id),
      1,
      () => {},
      () => {}
    )
    for (let i = 0; i < 60; i++) await Promise.resolve()
    try {
      expect(staging).toBe(1)
      expect(
        work.prepared,
        'The second full preparation must start before first staging completes'
      ).toHaveLength(packed ? 3 : 2)
      expect(finished).toBe(false)
    } finally {
      unblock()
    }
    const result = await pending
    expect(maximum).toBe(1)
    expect(result.fetched.map((r) => r.id)).toEqual(snapshot.records.map((r) => r.id))
    expect(finished).toBe(true)
    expect(active).toBe(0)
  }
)
