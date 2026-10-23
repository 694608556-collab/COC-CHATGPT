import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  Native: { createSearchSource: vi.fn(), addListener: vi.fn(), cancelBackupStage: vi.fn() }
}))
vi.mock('./native', () => mock)
vi.mock('./local-source', () => ({ readSource: vi.fn(async () => new Uint8Array(4)) }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', convertFileSrc: (uri: string) => uri }
}))
import { requestSearchPipeline } from './search-source-pipeline'
import type { LogbookPort } from './native'
import type { SearchPipelineMessage } from './search-pipeline-channel'

const source = { fileUri: 'https://localhost/_capacitor_file_/public', bytes: 4, sha256: 'a'.repeat(64) }
let listener: (value: any) => void, remove: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('document', {})
  remove = vi.fn(async () => {})
  mock.Native.addListener.mockImplementation(async (_name, callback) => {
    listener = callback
    return { remove }
  })
  mock.Native.cancelBackupStage.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())
const options = () => ({ ids: ['r1'], revision: 4, signal: new AbortController().signal })
const lease = (nonce: string) => ({
  id: 'lease',
  revision: 4,
  source,
  searchProjectionVersion: 3,
  originalSource: { bytes: 100, sha256: 'b'.repeat(64) },
  maximumReadBytes: 100,
  cacheMemoryBytes: 100,
  searchStream: { nonce, chunks: 2 }
})
function pieces(nonce: string, change: (value: any) => void = () => {}) {
  for (const [index, kind] of ['root', 'tail'].entries()) {
    const value = {
      nonce,
      id: 'lease',
      revision: 4,
      index,
      kind,
      source,
      searchProjectionVersion: 3,
      maximumReadBytes: 100,
      cacheMemoryBytes: 100
    }
    change(value)
    listener(value)
  }
}
function worker(
  config: { nonce: string },
  feed: { connect(send: (message: SearchPipelineMessage) => void): () => void }
) {
  return new Promise<string>((resolve, reject) =>
    feed.connect((message) => {
      if (message.type === 'search-seal') resolve('complete')
      if (message.type === 'search-abort') reject(new Error(message.error))
    })
  )
}
it('starts speculative processing before native completion but seals only its same-lease full proof', async () => {
  let started = false
  mock.Native.createSearchSource.mockImplementation(async ({ streamNonce }) => {
    pieces(streamNonce)
    expect(started).toBe(true)
    return lease(streamNonce)
  })
  const value = await requestSearchPipeline(
    mock.Native as unknown as LogbookPort,
    options(),
    (config, feed) => {
      started = true
      return worker(config, feed)
    }
  )
  expect(await value.result).toBe('complete')
  expect(remove).toHaveBeenCalledOnce()
})
it('native fallback discards tentative pieces and a forged adapter cannot activate the event path', async () => {
  mock.Native.createSearchSource.mockImplementation(async ({ streamNonce }) => {
    pieces(streamNonce)
    const full = lease(streamNonce)
    return { ...full, id: 'fallback', searchStream: undefined, searchProjectionVersion: undefined }
  })
  const value = await requestSearchPipeline(mock.Native as unknown as LogbookPort, options(), worker)
  expect(value.result).toBeUndefined()
  expect(value.lease.id).toBe('fallback')
  mock.Native.addListener.mockClear()
  const forged = { createSearchSource: async () => lease('forged') } as unknown as LogbookPort
  const start = vi.fn(worker)
  await requestSearchPipeline(forged, options(), start)
  expect(mock.Native.addListener).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})
it('rejects mismatched owner, revision, sequence and final counts, and removes the listener on native failure', async () => {
  for (const field of ['id', 'revision', 'index', 'chunks']) {
    mock.Native.createSearchSource.mockImplementation(async ({ streamNonce }) => {
      pieces(streamNonce, (value) => {
        if (value.index === 1 && field !== 'chunks') value[field] = field === 'id' ? 'wrong' : 99
      })
      return {
        ...lease(streamNonce),
        ...(field === 'chunks' ? { searchStream: { nonce: streamNonce, chunks: 99 } } : {})
      }
    })
    const value = await requestSearchPipeline(mock.Native as unknown as LogbookPort, options(), worker)
    await expect(value.result).rejects.toThrow('封存')
  }
  mock.Native.createSearchSource.mockRejectedValueOnce(new Error('native failed'))
  await expect(
    requestSearchPipeline(mock.Native as unknown as LogbookPort, options(), worker)
  ).rejects.toThrow('native failed')
  expect(remove).toHaveBeenCalledTimes(5)
})
it('listener cleanup failure closes its acquired source and cannot expose a speculative success', async () => {
  mock.Native.createSearchSource.mockImplementation(async ({ streamNonce }) => {
    pieces(streamNonce)
    return lease(streamNonce)
  })
  remove.mockRejectedValueOnce(new Error('remove failed'))
  await expect(
    requestSearchPipeline(mock.Native as unknown as LogbookPort, options(), worker)
  ).rejects.toThrow('监听清理')
  expect(mock.Native.cancelBackupStage).toHaveBeenCalledWith({ id: 'lease' })
})
