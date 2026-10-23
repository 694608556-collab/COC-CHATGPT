import './snapshot-worker-compat'
import { performTableStreamJob } from './table-stream-job'
import type { TableStreamJob } from './table-stream-job'
import { decodeBase64, encodeBase64 } from './bytes'
import { capacity } from './capacity'

let started = false,
  sequence = 0
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>()
const indexes = { candidate: 0, strings: 0 }
let controller = new AbortController()
function request(type: string, value: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    self.postMessage({ type, request: id, ...value })
  })
}
const cache = new Map<number, { value: string; bytes: number }>()
let cacheBytes = 0
async function readString(index: number): Promise<string> {
  const old = cache.get(index)
  if (old) {
    cache.delete(index)
    cache.set(index, old)
    return old.value
  }
  let offset = 0,
    expected: number | undefined
  const decoder = new TextDecoder('utf-8', { fatal: true }),
    parts: string[] = []
  while (true) {
    const result = await request('read-string', { stringIndex: index, offset })
    if (
      !Number.isSafeInteger(result.bytes) ||
      result.bytes < 0 ||
      (expected !== undefined && expected !== result.bytes)
    )
      throw new Error('表格字符串证明无效。')
    expected = result.bytes
    const bytes = decodeBase64(result.base64)
    if (
      bytes.length > capacity.transferChunkBytes ||
      offset + bytes.length > result.bytes ||
      (!bytes.length && !result.done)
    )
      throw new Error('表格字符串分段无效。')
    offset += bytes.length
    if (result.done !== (offset === expected)) throw new Error('表格字符串未完整读取。')
    parts.push(decoder.decode(bytes, { stream: !result.done }))
    if (result.done) break
  }
  const value = parts.join('')
  if (offset <= 2 * 1024 * 1024) {
    while (cache.size && (cacheBytes + offset > 2 * 1024 * 1024 || cache.size >= 512)) {
      const key = cache.keys().next().value!
      cacheBytes -= cache.get(key)!.bytes
      cache.delete(key)
    }
    cache.set(index, { value, bytes: offset })
    cacheBytes += offset
  }
  return value
}
self.onmessage = ({ data }) => {
  if (data.type === 'reply') {
    const current = pending.get(data.request)
    if (current) {
      pending.delete(data.request)
      data.error ? current.reject(new Error(data.error)) : current.resolve(data.result)
    }
    return
  }
  if (data.type !== 'start' || started) return
  started = true
  controller = new AbortController()
  const job = data.job as TableStreamJob
  const measureRecords = job?.kind === 'records' && job.measure === true
  let candidateBase64Ms = 0
  void performTableStreamJob(
    job,
    async (key, chunk) => {
      const start = measureRecords && key === 'candidate' ? performance.now() : 0
      const base64 = encodeBase64(chunk)
      if (measureRecords && key === 'candidate') candidateBase64Ms += performance.now() - start
      await request('chunk', { key, index: indexes[key]++, base64 })
    },
    readString,
    controller.signal
  ).then(
    (result) => {
      if (measureRecords && result.timing) result.timing.jsCandidateBase64Ms = candidateBase64Ms
      // Keep compiled code only. Each job has fresh indexes, buffers, cache,
      // cancellation state and native owner; no file capability survives.
      cache.clear()
      cacheBytes = 0
      pending.clear()
      indexes.candidate = indexes.strings = 0
      started = false
      self.postMessage({ type: 'done', result })
    },
    (error) => {
      controller.abort()
      self.postMessage({
        type: 'failed',
        error: error instanceof Error ? error.message : '表格解析失败，未确认导入。'
      })
    }
  )
}
