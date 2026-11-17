import { afterEach, expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createSnapshotJobSession } from './snapshot-job'
import { previewBackup } from './backup'
import { exampleBackup } from './fixtures'
import { packUploadBytes } from './upload-transfer'

afterEach(() => vi.useRealTimers())

it('混合可压缩和不可压缩窗口都完整传完，随机尾段不截断且不扩大桥接窗口', () => {
  const block = 2 * 1024 * 1024
  const original = Buffer.alloc(block * 2 + 37, 120)
  let state = 0x13579bdf
  for (let index = block; index < original.length; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    original[index] = state & 255
  }
  const parts = packUploadBytes(original)
  expect(parts.some((part) => part.encoding === 'zlib')).toBe(true)
  expect(parts.some((part) => part.encoding === 'identity')).toBe(true)
  const restored = Buffer.concat(
    parts.map((part) => {
      expect(part.bytes.length).toBeLessThanOrEqual(256 * 1024)
      if (part.encoding === 'zlib') {
        expect(part.bytes.buffer).not.toBe(original.buffer)
        expect(part.bytes.buffer.byteLength).toBeLessThanOrEqual(256 * 1024)
      }
      const bytes = part.encoding === 'zlib' ? inflateSync(part.bytes) : Buffer.from(part.bytes)
      expect(bytes.length).toBe(part.rawBytes)
      return bytes
    })
  )
  expect(restored.equals(original)).toBe(true)
})

it('无损传输减少大正文跨层分段，独立解压后逐字节及完整摘要与原上传一致', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T00:00:00Z'))
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const { rawContent, manualContent, ...record } = snapshot.records[0]!
  const text = JSON.stringify({
    messages: [{ content: '公开全文中文😀\\"\n'.repeat(120000), rawNumber: '900719925474099312345' }]
  })
  const run = createSnapshotJobSession()
  const plain = (await run({ type: 'prepare-fetch-upload', snapshot, record, text })) as any
  const original = Buffer.concat(
    await Promise.all(
      Array.from({ length: plain.count }, async (_, index) =>
        Buffer.from((await run({ type: 'upload-chunk', id: plain.id, index })) as string, 'base64')
      )
    )
  )
  await run({ type: 'upload-close', id: plain.id })
  const next = (await run({
    type: 'prepare-fetch-upload',
    snapshot,
    record,
    text,
    losslessTransfer: true
  } as any)) as any
  expect(next.count).toBeLessThan(plain.count)
  expect(next.keepsOriginalBytes).toBe(false)
  expect(next).not.toHaveProperty('snapshot')
  expect(next.record).not.toHaveProperty('rawContent')
  const chunks: Buffer[] = []
  let wireBytes = 0
  for (let index = 0; index < next.count; index++) {
    const part = (await run({ type: 'upload-transfer', id: next.id, index } as any)) as any
    const wire = Buffer.from(part.base64, 'base64')
    expect(wire.length).toBeLessThanOrEqual(256 * 1024)
    const decoded = part.encoding === 'zlib' ? inflateSync(wire) : wire
    expect(decoded.length).toBe(part.rawBytes)
    expect(decoded.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    wireBytes += wire.length
    chunks.push(decoded)
  }
  const restored = Buffer.concat(chunks)
  expect(restored.equals(original)).toBe(true)
  expect(restored.length).toBe(next.bytes)
  expect(createHash('sha256').update(restored).digest('hex')).toBe(next.sha256)
  expect(next.sha256).toBe(plain.sha256)
  expect(wireBytes).toBeLessThan(original.length / 4)
  await run({ type: 'upload-close', id: next.id })
  await expect(run({ type: 'upload-transfer', id: next.id, index: 0 } as any)).rejects.toThrow('失效')
})
