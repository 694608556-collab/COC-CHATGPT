import { performSnapshotJob } from './snapshot-job'
import type { SnapshotJob } from './snapshot-job'
import type { ImportPreview, MobileSnapshot } from './types'

/** 任务成功/失败回调，按 number 序号配对，不存放文件权限。 */
interface PendingJob {
  /** 接收只读计算结果的回调。 */
  resolve(value: unknown): void
  /** 接收校验/工作线程错误的回调。 */
  reject(reason: Error): void
}
let worker: Worker | undefined
let sequence = 0
const pending = new Map<number, PendingJob>()

/**
 * 投递到本地打包的工作线程，避免界面处理整份正文。
 * @param job - 不包含写入/确认操作的任务。
 * @returns 只读结果；工作线程失败拒绝，不降级为阻塞界面的计算。
 */
async function runJob<T>(job: SnapshotJob): Promise<T> {
  // Node-only storage tests reuse the same algorithm; browser/Android must use a real worker.
  if (typeof document === 'undefined') return (await performSnapshotJob(job)) as T
  if (typeof Worker === 'undefined') throw new Error('此 WebView 不支持后台校验，未写入数据。')
  if (!worker) {
    worker = new Worker('snapshot-worker.js')
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = pending.get(event.data.id)
      if (!request) return
      pending.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result)
    }
    worker.onerror = () => {
      const error = new Error('后台校验启动或运行失败，未写入数据。')
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (result) => resolve(result as T), reject })
    try {
      worker!.postMessage({ id, job })
    } catch (reason) {
      pending.delete(id)
      reject(reason)
    }
  })
}

/** @param bytes - 完整备份字节。 @returns 保留全部既有校验的导入预览。 */
export function previewInBackground(bytes: Uint8Array): Promise<ImportPreview> {
  return runJob({ type: 'preview', bytes })
}
/** @param base64 - 原生返回的完整备份。 @returns 已校验预览，不写入数据。 */
export function previewBase64InBackground(base64: string): Promise<ImportPreview> {
  return runJob({ type: 'preview-base64', base64 })
}
/** @param json - 原生快照缓存。 @returns 重读并校验的完整业务快照。 */
export async function readInBackground(json: string): Promise<MobileSnapshot> {
  return (await runJob<ImportPreview>({ type: 'read', json })).snapshot
}
/** @param snapshot - 待提交数据。 @returns 校验后的快照及对应 JSON，不执行写入。 */
export function prepareInBackground(
  snapshot: MobileSnapshot
): Promise<{ snapshot: MobileSnapshot; json: string }> {
  return runJob({ type: 'prepare', snapshot })
}
/** @param snapshot - 已通过预览校验的数据。 @returns 供原生安全提交的完整 JSON。 */
export function serializeInBackground(snapshot: MobileSnapshot): Promise<string> {
  return runJob({ type: 'serialize', snapshot })
}
/** @param bytes - 浏览器文件字节。 @returns Base64 文件内容，不在界面逐块编码。 */
export function encodeInBackground(bytes: Uint8Array): Promise<string> {
  return runJob({ type: 'encode', bytes })
}
