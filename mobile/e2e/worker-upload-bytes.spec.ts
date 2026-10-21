import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { searchSample } from '../src/dev/sample'
import { previewBackup } from '../src/data/backup'
import type { SnapshotJob } from '../src/data/snapshot-job'

test('真实 Worker 的 UTF-8 与 Base64 分段逐字节保留大段 Unicode 正文', async ({ page }) => {
  const snapshot = searchSample()
  snapshot.records.find((record) => record.sourceType === 'manual')!.manualContent =
    '\ufeff公开中文😀\r\n\0孤立\ud800代理\udc00'.repeat(30000)
  const checked = (await previewBackup(new TextEncoder().encode(JSON.stringify(snapshot)))).snapshot
  const expected = Buffer.from(JSON.stringify(checked), 'utf8')
  await page.goto('/')
  const result = await page.evaluate(async (snapshot) => {
    const worker = new Worker('snapshot-worker.js')
    let sequence = 0
    /** @param job - 独立 Worker 的顺序任务。 @returns 配对的只读结果，错误时拒绝。 */
    function request<T>(job: SnapshotJob): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        worker.onmessage = ({ data }) => {
          if (data.id !== id) return
          if (data.error) reject(new Error(data.error))
          else resolve(data.result)
        }
        worker.onerror = () => reject(new Error('公开测试 Worker 失败'))
        worker.postMessage({ id, job })
      })
    }
    try {
      const prepared = await request<{ id: string; count: number; bytes: number; sha256: string }>({
        type: 'prepare-upload',
        snapshot
      })
      const chunks: string[] = []
      for (let index = 0; index < prepared.count; index++)
        chunks.push(await request<string>({ type: 'upload-chunk', id: prepared.id, index }))
      await request({ type: 'upload-close', id: prepared.id })
      return { chunks, bytes: prepared.bytes, sha256: prepared.sha256 }
    } finally {
      worker.terminate()
    }
  }, snapshot)
  const bytes = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk, 'base64')))
  expect(result.chunks.length).toBeGreaterThan(1)
  expect(bytes.equals(expected)).toBe(true)
  expect(result.bytes).toBe(expected.length)
  expect(result.sha256).toBe(createHash('sha256').update(expected).digest('hex'))
})
