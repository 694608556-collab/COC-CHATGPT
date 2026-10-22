import { expect, it } from 'vitest'
import { validateOverviewBytes, validateSnapshotBytes } from './backup'
import { readBackupJsonStream, writeBackupJsonStream } from './backup-stream'
import type { MobileSnapshot } from './types'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

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
it('概览和完整候选共用格式校验，不再使用固定请求容量门槛', async () => {
  const original = overview(),
    bytes = new TextEncoder().encode(JSON.stringify(original))
  expect(bytes.length).toBeGreaterThan(2048)
  expect((await validateOverviewBytes(bytes)).snapshot.modules).toHaveLength(12)
  expect((await validateSnapshotBytes(bytes)).snapshot.modules).toHaveLength(12)
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
it('取消容量门槛不会绕过失效关联、正文混入概览或本次实际来源预算', async () => {
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
  const read = await readBackupJsonStream(chunks(bytes), {
    maximumBytes: bytes.length,
    stageRecord: async () => {}
  })
  expect(read.metadata.modules[0]!.name).toBe(original.modules[0]!.name)
  await expect(
    readBackupJsonStream(chunks(bytes), { maximumBytes: bytes.length - 1, stageRecord: async () => {} })
  ).rejects.toThrow('本次')
})
