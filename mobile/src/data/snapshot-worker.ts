import './snapshot-worker-compat'
import { performSnapshotJob } from './snapshot-job'
import type { SnapshotJob } from './snapshot-job'

/**
 * 接收只读任务并返回结果；异常不调用任何持久化能力。
 * @param event - 打包应用自身发送的任务序号及载荷。
 * @returns 无返回值，结果通过 message 发送给对应请求。
 */
async function processMessage(event: MessageEvent<{ id: number; job: SnapshotJob }>) {
  const { id, job } = event.data
  try {
    const result = await performSnapshotJob(job)
    self.postMessage({ id, result })
  } catch (reason) {
    self.postMessage({ id, error: reason instanceof Error ? reason.message : '后台校验失败，未写入数据。' })
  }
}
self.addEventListener('message', (event) => void processMessage(event))
