import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createHash } from 'node:crypto'
import { exampleBackup } from './fixtures'
import { previewBackup } from './backup'
import { searchNativeBodies } from './backup-stream-client'
import type { LogbookPort } from './native'
import { beginBodySearchCache, searchBodyCache } from './body-search-cache'

afterEach(() => vi.unstubAllGlobals())

it.each(['disk', 'memory'])('%s：同一只读版本的不同关键词复用已校验正文；修改版本后重新读取，不返回旧命中', async (mode) => {
  const seed = exampleBackup()
  const bytes = new TextEncoder().encode(JSON.stringify(seed))
  const preset = (await previewBackup(bytes)).snapshot.settings.filterPreset
  vi.stubGlobal('indexedDB', mode === 'disk' ? new IDBFactory() : undefined)
  vi.stubGlobal('location', new URL('https://localhost/'))
  const fetcher = vi.fn(async () => new Response(bytes.slice().buffer))
  vi.stubGlobal('fetch', fetcher)
  let revision = 7
  const forbidden = vi.fn(async () => {
    throw Error('Unexpected write')
  })
  const port = {
    createSearchSource: vi.fn(async () => ({
      id: 'source',
      revision,
      cacheMemoryBytes: mode === 'memory' ? 1024 * 1024 : 0,
      source: {
        fileUri: 'https://localhost/_capacitor_file_/public',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }
    })),
    getStatus: vi.fn(async () => ({ revision })),
    cancelBackupStage: vi.fn(async () => {}),
    appendBackupStage: forbidden,
    finishBackupPreview: forbidden,
    commitBackupRestore: forbidden,
    createBackupStream: forbidden,
    finishBackupExport: forbidden
  } as unknown as LogbookPort
  const signal = new AbortController().signal
  const first = await searchNativeBodies(port, ['r1'], revision, '离线', preset, signal)
  expect(first.hits.map((r) => r.id)).toEqual(['r1'])
  const second = await searchNativeBodies(port, ['r1'], revision, '没有此关键词', preset, signal)
  expect(second.hits).toEqual([])
  expect(port.createSearchSource).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  revision++
  await searchNativeBodies(port, ['r1'], revision, '离线', preset, signal)
  expect(port.createSearchSource).toHaveBeenCalledTimes(2)
  expect(forbidden).not.toHaveBeenCalled()
})

it('缓存内存预算不足改走磁盘，保留全部消息；未完成的缓存不能提供命中', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const writer = await beginBodySearchCache('public-cache', 'ids-and-filter', 1)
  await writer.append('first', 0, [{ header: '公开人物', text: 'NEEDLE needle' }])
  await writer.append('last', 1, [{ header: '', text: '最后 needle 😀' }])
  expect(await searchBodyCache('public-cache', ['first', 'last'], 'ids-and-filter', 'needle')).toBeNull()
  expect(await writer.commit()).toBe(true)
  writer.close()
  expect(await searchBodyCache('public-cache', ['first', 'last'], 'ids-and-filter', 'needle')).toEqual([
    { id: 'first', matches: 2, excerpt: '公开人物\nNEEDLE needle' },
    { id: 'last', matches: 1, excerpt: '\n最后 needle 😀' }
  ])
  expect(await searchBodyCache('public-cache', ['first', 'last'], 'changed-filter', 'needle')).toBeNull()
  const controller = new AbortController(); controller.abort()
  await expect(searchBodyCache('public-cache', ['first', 'last'], 'ids-and-filter', 'needle', controller.signal)).rejects.toThrow('取消')
})

it('磁盘缓存内容损坏时拒绝复用，不发布错误结果', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const writer = await beginBodySearchCache('public-corrupt', 'context')
  await writer.append('first', 0, [{ header: '', text: 'needle' }]); await writer.commit(); writer.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('coc-private-body-search-cache-v1', 1)
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('projection', 'readwrite')
      transaction.objectStore('projection').put({ id: 'first', json: '[{"header":"","text":"wrong"}]', sha256: '0'.repeat(64) }, 0)
      transaction.oncomplete = () => { database.close(); resolve() }
      transaction.onerror = () => reject(transaction.error)
    }
  })
  expect(await searchBodyCache('public-corrupt', ['first'], 'context', 'wrong')).toBeNull()
})
