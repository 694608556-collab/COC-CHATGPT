/** 任务成功/失败回调，按 number 序号配对，不存放文件权限。 */
interface PendingJob {
  /** 任务所属只读工作通道；单个线程失败不拒绝另一个通道的正常任务。 */
  channel: 'snapshot' | 'export'
  /** 接收只读计算结果的回调。 */
  resolve(value: unknown): void
  /** 接收校验/工作线程错误的回调。 */
  reject(reason: Error): void
}
let worker: Worker | undefined
let exportWorker: Worker | undefined
let sequence = 0
const pending = new Map<number, PendingJob>()
/** @param channel Isolated read-only computation channel. @param job Tagged local computation input.
 * @param transfer Buffers whose ownership the caller relinquishes. @returns Matched Worker result; channel failures reject only its own pending requests.
 */
export async function runWorkerJob<T>(
  channel: 'snapshot' | 'export',
  job: unknown,
  transfer: Transferable[] = []
): Promise<T> {
  if (typeof Worker === 'undefined') throw new Error('此 WebView 不支持后台校验，未写入数据。')
  let target = channel === 'export' ? exportWorker : worker
  if (!target) {
    target = new Worker(channel === 'export' ? 'export-worker.js' : 'snapshot-worker.js')
    if (channel === 'export') exportWorker = target
    else worker = target
    target.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const request = pending.get(event.data.id)
      if (!request) return
      pending.delete(event.data.id)
      if (event.data.error) request.reject(new Error(event.data.error))
      else request.resolve(event.data.result)
    }
    const active = target
    target.onerror = () => {
      const error = new Error('后台校验启动或运行失败，未写入数据。')
      for (const [id, request] of pending)
        if (request.channel === channel) {
          request.reject(error)
          pending.delete(id)
        }
      active.terminate()
      if (channel === 'export') exportWorker = undefined
      else worker = undefined
    }
  }
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { channel, resolve: (result) => resolve(result as T), reject })
    try {
      target!.postMessage({ id, job }, transfer)
    } catch (reason) {
      pending.delete(id)
      reject(reason)
    }
  })
}
