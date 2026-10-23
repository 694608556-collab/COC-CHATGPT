import './snapshot-worker-compat'
import { performBackupStreamJob } from './backup-stream-job'
import { encodeBase64 } from './bytes'
import type { BackupStreamJob } from './backup-stream-job'
import { createSearchPipelineChannel } from './search-pipeline-channel'

let started = false,
  request = 0
const pending = new Map<number, { resolve(): void; reject(error: Error): void }>()
let controller = new AbortController()
let sending: Promise<void> = Promise.resolve()
let pipeline: ReturnType<typeof createSearchPipelineChannel> | undefined
self.onmessage = (event) => {
  const message = event.data
  if (['search-part', 'search-seal', 'search-abort'].includes(message.type)) {
    pipeline?.push(message)
    return
  }
  if (message.type === 'ack') {
    const current = pending.get(message.request)
    if (current) {
      pending.delete(message.request)
      message.error ? current.reject(new Error(message.error)) : current.resolve()
    }
    return
  }
  if (message.type !== 'start' || started) return
  started = true
  controller = new AbortController()
  pipeline =
    message.job.type === 'search-pipeline'
      ? createSearchPipelineChannel(message.job.nonce, message.job.maximumReadBytes, controller.signal)
      : undefined
  const indexes = new Map<string, number>()
  const write = (key: string, bytes: Uint8Array) => {
    const result = sending.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const id = ++request,
            index = indexes.get(key) ?? 0
          pending.set(id, { resolve, reject })
          indexes.set(key, index + 1)
          self.postMessage({ type: 'chunk', request: id, key, index, base64: encodeBase64(bytes) })
        })
    )
    sending = result
    return result
  }
  void performBackupStreamJob(message.job as BackupStreamJob, write, controller.signal, pipeline?.input).then(
    (result) => {
      pipeline?.close()
      pipeline = undefined
      started = false
      self.postMessage({ type: 'done', result })
    },
    (reason) => {
      pipeline?.close()
      pipeline = undefined
      controller.abort()
      started = false
      self.postMessage({
        type: 'failed',
        error: reason instanceof Error ? reason.message : '大文件处理失败，未发布数据。'
      })
    }
  )
}
