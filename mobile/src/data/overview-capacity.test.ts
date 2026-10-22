import { expect, it, vi } from 'vitest'
import { validateOverviewBytes, validateSnapshotBytes } from './backup'
import { readBackupJsonStream, writeBackupJsonStream } from './backup-stream'
import type { MobileSnapshot } from './types'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

// A smaller independent item/request budget exercises the same boundary without
// allocating hundreds of MiB in every unit-test worker.
vi.mock('./capacity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./capacity')>()
  return { capacity: { ...actual.capacity, snapshotRequestBytes: 2048 } }
})
function overview(): MobileSnapshot {
  return {
    schemaVersion: 2,
    exportedAt: '2026-10-22T00:00:00.000Z',
    modules: Array.from({ length: 12 }, (_, i) => ({
      id: 'public-' + i,
      name: '公开'.repeat(100),
      playStatus: 'running',
      kps: [],
      pairs: [],
      order: i,
      collapsed: false,
      createdAt: '',
      updatedAt: ''
    })),
    records: [],
    characters: [],
    settings: { theme: 'light', filterPreset: { ...DEFAULT_FILTER_PRESET } }
  }
}
async function* chunks(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += 127) yield bytes.subarray(offset, offset + 127)
}
it('累计元数据超过独立请求预算仍能概览及完整备份往返，独立请求限制保留', async () => {
  const original = overview(),
    bytes = new TextEncoder().encode(JSON.stringify(original))
  expect(bytes.length).toBeGreaterThan(2048)
  expect((await validateOverviewBytes(bytes)).snapshot.modules).toHaveLength(12)
  await expect(validateSnapshotBytes(bytes)).rejects.toThrow('大小')
  const parts: Uint8Array[] = []
  async function* noRecords() {}
  await writeBackupJsonStream(
    original,
    noRecords(),
    async (chunk) => {
      parts.push(chunk.slice())
    },
    { maximumBytes: 128 * 1024 }
  )
  const combined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }
  const read = await readBackupJsonStream(chunks(combined), {
    maximumBytes: combined.length,
    stageRecord: async () => {
      throw new Error('Unexpected record')
    }
  })
  expect(read.metadata).toEqual((await validateOverviewBytes(bytes)).snapshot)
})
it('取消累计限制不会绕过失效关联、正文混入概览或独立实体预算', async () => {
  const original = overview()
  original.records = [
    {
      id: 'r',
      moduleId: 'missing',
      name: '',
      sequenceNo: 1,
      sourceType: 'manual',
      status: 'manual',
      dateSource: 'none',
      order: 0,
      createdAt: '',
      updatedAt: ''
    }
  ]
  const encode = () => new TextEncoder().encode(JSON.stringify(original))
  await expect(validateOverviewBytes(encode())).rejects.toThrow('关联')
  original.records[0]!.moduleId = original.modules[0]!.id
  original.records[0]!.manualContent = '完整正文'
  await expect(validateOverviewBytes(encode())).rejects.toThrow('概览包含正文')
  original.records = []
  original.modules[0]!.name = '字'.repeat(1000)
  const bytes = encode()
  await expect(
    readBackupJsonStream(chunks(bytes), { maximumBytes: bytes.length, stageRecord: async () => {} })
  ).rejects.toThrow('独立字段')
})
