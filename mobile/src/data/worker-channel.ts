/** 三个独立租约通道；调用方仍限制最多两份展开正文，压缩候选不占展开名额。 */
export type FetchWorkerChannel = 'fetch-0' | 'fetch-1' | 'fetch-2'
/** 只读工作线程的固定通道；网络响应和原生上传数量由调用方另行约束。 */
type WorkerChannel = 'snapshot' | 'export' | FetchWorkerChannel
/** 任务成功/失败回调，按 number 序号配对，不存放文件权限。 */
interface PendingJob {
  /** 任务所属只读工作通道；单个线程失败不拒绝另一个通道的正常任务。 */
  channel: WorkerChannel
  /** 接收只读计算结果的回调。 */
  resolve(value: unknown): void
  /** 接收校验/工作线程错误的回调。 */
  reject(reason: Error): void
}
const workers = new Map<WorkerChannel, Worker>()
let sequence = 0
const pending = new Map<number, PendingJob>()
/** @param channel Isolated read-only computation channel. @param job Tagged local computation input.
 * @param transfer Buffers whose ownership the caller relinquishes. @returns Matched Worker result; channel failures reject only its own pending requests.
 */
export async function runWorkerJob<T>(
  channel: WorkerChannel,
  job: unknown,
  transfer: Transferable[] = []
): Promise<T> {
  if (typeof Worker === 'undefined') throw new Error('此 WebView 不支持后台校验，未写入数据。')
  let target = workers.get(channel)
  if (!target) {
    target = new Worker(channel === 'export' ? 'export-worker.js' : 'snapshot-worker.js')
    workers.set(channel, target)
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
      workers.delete(channel)
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
