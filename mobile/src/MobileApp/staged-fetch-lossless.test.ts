import { expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { stagedFetch } from './staged-fetch'
import { exampleBackup } from '../data/fixtures'
import { previewBackup } from '../data/backup'
import type { LogbookPort } from '../data/native'

it('Android 无损传输仍逐场核对完整字节摘要，并只在所有暂存结束后保存一次', async () => {
  const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const snapshot = {
    ...base,
    records: Array.from({ length: 3 }, (_, i) => ({
      ...base.records[0]!,
      id: 'public-packed-' + i,
      rawContent: undefined,
      link: 'https://log.weizaima.com/?key=public-packed-' + i
    }))
  }
  let expectedBytes = 0,
    expectedHash = '',
    active = false,
    staged = 0,
    finished = 0
  let chunks: Buffer[] = []
  const port = {
    beginFetchBatch: async () => ({ id: 'public-batch' }),
    fetchLog: async ({ url }: { url: string }) => ({
      url,
      status: 200,
      text: JSON.stringify({
        messages: [{ text: '公开保留完整正文中文😀'.repeat(50000) + new URL(url).searchParams.get('key') }]
      })
    }),
    beginSnapshotEdit: async ({ bytes, sha256 }: { bytes: number; sha256: string }) => {
      expect(active).toBe(false)
      active = true
      expectedBytes = bytes
      expectedHash = sha256
      chunks = []
      return { id: 'public-upload' }
    },
    appendSnapshotEdit: async () => {
      throw Error('New native capability must receive the lossless transport')
    },
    appendSnapshotEditEncoded: async ({
      index,
      encoding,
      rawBytes,
      base64
    }: {
      index: number
      encoding: string
      rawBytes: number
      base64: string
    }) => {
      expect(index).toBe(chunks.length)
      const wire = Buffer.from(base64, 'base64'),
        bytes = encoding === 'zlib' ? inflateSync(wire) : wire
      expect(wire.length).toBeLessThanOrEqual(256 * 1024)
      expect(bytes.length).toBe(rawBytes)
      chunks.push(bytes)
    },
    stageFetchResult: async () => {
      const complete = Buffer.concat(chunks)
      expect(complete.length).toBe(expectedBytes)
      expect(createHash('sha256').update(complete).digest('hex')).toBe(expectedHash)
      const row = JSON.parse(complete.toString()).records[0]
      expect(row.rawContent.messages[0].text).toBe('公开保留完整正文中文😀'.repeat(50000) + row.id)
      staged++
    },
    cancelSnapshotEdit: async () => {
      active = false
    },
    finishFetchBatch: async () => {
      expect(staged).toBe(3)
      finished++
      return { revision: 2, exportedAt: 'public' }
    },
    cancelFetchBatch: async () => {
      throw Error('Successful batch must not cancel')
    }
  } as unknown as LogbookPort
  const result = await stagedFetch(
    port,
    snapshot,
    snapshot.records.map((r) => r.id),
    1,
    () => {},
    () => {}
  )
  expect(finished).toBe(1)
  expect(active).toBe(false)
  expect(result.fetched.map((r) => r.id)).toEqual(snapshot.records.map((r) => r.id))
  expect(result.fetched.every((r) => r.rawContent === undefined)).toBe(true)
})
