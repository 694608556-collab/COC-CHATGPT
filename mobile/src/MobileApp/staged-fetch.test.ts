import { expect, it } from 'vitest'
import { stagedFetch } from './staged-fetch'
import { exampleBackup } from '../data/fixtures'
import { previewBackup } from '../data/backup'
import type { LogbookPort } from '../data/native'

it('已有50模组1000场时检测20场：不读取旧正文，只逐场上传，最终提交一次', async () => {
  const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const snapshot = {
    ...base,
    modules: Array.from({ length: 50 }, (_, i) => ({
      ...base.modules[0]!,
      id: 'm' + i,
      name: '公开模组' + i
    })),
    records: Array.from({ length: 1000 }, (_, i) => ({
      ...base.records[0]!,
      id: 'r' + i,
      moduleId: 'm' + Math.floor(i / 20),
      link: 'https://log.weizaima.com/?key=public-' + i,
      rawContent: undefined
    }))
  }
  let begun = 0,
    staged = 0,
    finished = 0,
    uploads = 0,
    received = 0,
    expected = 0
  const port = {
    async beginFetchBatch({ ids, expectedRevision }: { ids: string[]; expectedRevision: number }) {
      expect(ids).toEqual(snapshot.records.slice(980).map((r) => r.id))
      expect(expectedRevision).toBe(7)
      begun++
      return { id: 'batch' }
    },
    async beginSnapshotEdit({ bytes }: { bytes: number }) {
      expect(received).toBe(0)
      expected = bytes
      uploads++
      return { id: 'upload' + uploads }
    },
    async appendSnapshotEdit({ base64 }: { base64: string }) {
      received += Buffer.from(base64, 'base64').length
    },
    async stageFetchResult() {
      expect(received).toBe(expected)
      received = 0
      staged++
    },
    async cancelSnapshotEdit() {},
    async finishFetchBatch() {
      expect(staged).toBe(20)
      finished++
      return { revision: 8, exportedAt: 'saved' }
    },
    async cancelFetchBatch() {
      throw new Error('已提交批次不应再次取消')
    },
    async fetchLog({ url }: { url: string }) {
      return {
        url,
        status: 200,
        text: JSON.stringify({ messages: [{ nickname: 'public', content: '公开大库结果😀'.repeat(100) }] })
      }
    },
    async getRecordContent() {
      throw new Error('Must not load old bodies')
    },
    async createExportSource() {
      throw new Error('Must not load whole library')
    },
    async commitEdit() {
      throw new Error('Must not send a whole-library snapshot')
    }
  } as unknown as LogbookPort
  const result = await stagedFetch(
    port,
    snapshot,
    snapshot.records.slice(980).map((r) => r.id),
    7,
    () => {},
    () => {}
  )
  expect([begun, staged, finished, uploads]).toEqual([1, 20, 1, 20])
  expect(result.saved?.revision).toBe(8)
  expect(result.fetched.every((r) => r.rawContent === undefined)).toBe(true)
})
