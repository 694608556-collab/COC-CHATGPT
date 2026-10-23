import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Native, type LogbookPort } from './native'
import type { NativeSearchSource } from './body-search-stream'
import type { NativeBackupFile } from './backup-stream-native'
import type { SearchPipelineMessage } from './search-pipeline-channel'
import { checkStreamCancelled } from './stream-json'
import { BodySearchCleanupError } from './body-search-stream'
import { readSource } from './local-source'

export type SearchFeed = { connect(send: (message: SearchPipelineMessage) => void): () => void }
type Chunk = {
  nonce: string
  id: string
  revision: number
  index: number
  kind: 'root' | 'records' | 'tail'
  source: NativeBackupFile
  maximumReadBytes: number
  cacheMemoryBytes: number
  searchProjectionVersion: number
}

/** Start only the real Android adapter's sealed read-only stream.
 * @param port Native identity; arbitrary caller ports always retain the ordinary source path.
 * @param options Exact selection, revision and cancellation for this search.
 * @param start Creates a worker result which stays unpublished until the native seal arrives.
 * @returns The final native lease and optional speculative result; caller owns CAS and cleanup.
 */
export async function requestSearchPipeline<T>(
  port: LogbookPort,
  options: { ids: string[]; revision: number; signal: AbortSignal },
  start: (
    config: { nonce: string; id: string; maximumReadBytes: number; cacheMemoryBytes: number },
    feed: SearchFeed
  ) => Promise<T>
): Promise<{ lease: NativeSearchSource; result?: Promise<T> }> {
  if (!port.createSearchSource) throw new Error('本机缺少逐场正文搜索能力。')
  if (port !== Native || Capacitor.getPlatform() !== 'android' || typeof document === 'undefined')
    return { lease: await port.createSearchSource({ ids: options.ids, expectedRevision: options.revision }) }
  const nonce = crypto.randomUUID(),
    queued: SearchPipelineMessage[] = []
  let sender: ((message: SearchPipelineMessage) => void) | undefined,
    active = true,
    index = 0,
    owner = ''
  let result: Promise<T> | undefined, invalid: Error | undefined
  let acquired: NativeSearchSource | undefined
  let delivery: Promise<void> = Promise.resolve()
  let configuredRead = 0,
    configuredCache = 0,
    queuedBytes = 0
  const send = (message: SearchPipelineMessage) => {
    if (sender) sender(message)
    else queued.push(message)
  }
  const fail = (message: string) => {
    invalid = new Error(message)
    send({ type: 'search-abort', nonce, error: message })
  }
  const native = Native as unknown as {
    addListener(name: string, callback: (event: Chunk) => void): Promise<PluginListenerHandle>
  }
  const listener = await native.addListener('searchSourceChunk', (event) => {
    if (!active || event?.nonce !== nonce || invalid) return
    try {
      if (
        event.revision !== options.revision ||
        event.searchProjectionVersion !== 3 ||
        !Number.isSafeInteger(event.index) ||
        event.index !== index ||
        !event.id ||
        !['root', 'records', 'tail'].includes(event.kind) ||
        !Number.isSafeInteger(event.maximumReadBytes) ||
        event.maximumReadBytes < 1 ||
        !Number.isSafeInteger(event.cacheMemoryBytes) ||
        event.cacheMemoryBytes < 0 ||
        !Number.isSafeInteger(event.source?.bytes) ||
        event.source.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(event.source.sha256) ||
        typeof event.source.fileUri !== 'string'
      )
        throw new Error('搜索分片来源凭证不符。')
      if (!owner) {
        if (event.kind !== 'root') throw new Error('搜索分片缺少起始元数据。')
        owner = event.id
        configuredRead = event.maximumReadBytes
        configuredCache = event.cacheMemoryBytes
        result = start(
          { nonce, id: owner, maximumReadBytes: configuredRead, cacheMemoryBytes: configuredCache },
          {
            connect(next) {
              sender = next
              for (const message of queued.splice(0)) next(message)
              return () => {
                sender = undefined
              }
            }
          }
        )
        void result.catch(() => undefined)
      }
      if (
        owner !== event.id ||
        configuredRead !== event.maximumReadBytes ||
        configuredCache !== event.cacheMemoryBytes
      )
        throw new Error('搜索分片跨越来源租约。')
      if (event.source.bytes > configuredRead - queuedBytes) throw new Error('搜索分片超出本轮快路驻留预算。')
      queuedBytes += event.source.bytes
      index++
      const part = {
        index: event.index,
        kind: event.kind,
        source: {
          url: Capacitor.convertFileSrc(event.source.fileUri),
          bytes: event.source.bytes,
          sha256: event.source.sha256
        }
      }
      // Start independent same-origin reads as credentials arrive. Ordered
      // delivery and a second Worker SHA preserve the complete proof while
      // the network/local-server turn overlaps earlier record processing.
      const loaded = readSource(part.source)
      void loaded.catch(() => undefined)
      delivery = delivery.then(async () => {
        const bytes = await loaded
        if (!invalid)
          send({ type: 'search-part', nonce, part: { ...part, prefetched: bytes.buffer as ArrayBuffer } })
      })
      void delivery.catch(() => undefined)
    } catch (error) {
      fail(error instanceof Error ? error.message : '搜索分片来源无效。')
    }
  })
  try {
    const lease = await port.createSearchSource({
      ids: options.ids,
      expectedRevision: options.revision,
      streamNonce: nonce
    })
    acquired = lease
    active = false
    if (!lease.searchStream) {
      // Native discarded all speculative pieces and returned a newly captured
      // complete fallback. None of those partial results can be admitted.
      send({ type: 'search-abort', nonce, error: '搜索快路已回退完整读取。' })
      await result?.catch(() => undefined)
      return { lease }
    }
    await delivery
    if (
      invalid ||
      !result ||
      lease.id !== owner ||
      lease.revision !== options.revision ||
      lease.searchProjectionVersion !== 3 ||
      lease.searchStream.nonce !== nonce ||
      lease.searchStream.chunks !== index ||
      !Number.isSafeInteger(index) ||
      index < 2 ||
      lease.maximumReadBytes !== configuredRead ||
      lease.cacheMemoryBytes !== configuredCache ||
      !Number.isSafeInteger(lease.originalSource?.bytes) ||
      lease.originalSource!.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(lease.originalSource?.sha256 ?? '')
    ) {
      fail('搜索分片最终封存证明不符。')
      await result?.catch(() => undefined)
      const rejected = Promise.reject<T>(invalid!)
      void rejected.catch(() => undefined)
      return { lease, result: rejected }
    }
    try {
      checkStreamCancelled(options.signal)
    } catch (error) {
      fail('搜索已取消。')
    }
    if (!invalid)
      send({
        type: 'search-seal',
        nonce,
        proof: { bytes: lease.source.bytes, sha256: lease.source.sha256, chunks: index }
      })
    return { lease, result }
  } catch (error) {
    fail('搜索原生来源生成失败。')
    await result?.catch(() => undefined)
    if (acquired) {
      const rejected = Promise.reject<T>(error)
      void rejected.catch(() => undefined)
      return { lease: acquired, result: rejected }
    }
    throw error
  } finally {
    active = false
    try {
      await listener.remove()
    } catch {
      fail('搜索监听清理失败，未发布结果。')
      await result?.catch(() => undefined)
      if (acquired)
        try {
          await port.cancelBackupStage!({ id: acquired.id })
        } catch {
          throw new BodySearchCleanupError('搜索读取暂存清理失败，请重开应用后重试；未发布搜索结果。')
        }
      throw new BodySearchCleanupError('搜索监听清理失败，请重开应用后重试；未发布搜索结果。')
    }
  }
}
