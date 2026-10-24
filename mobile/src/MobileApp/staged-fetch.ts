import type { LogbookPort } from '../data/native'
import type { MobileSnapshot } from '../data/types'
import type { SessionRecord } from '../../../src/shared/types'
import {
  prepareFetchUploadInBackground,
  uploadChunkInBackground,
  uploadTransferInBackground,
  closeUploadInBackground
} from '../data/background'
import { fetchRecords } from './fetch-records'
import type { FetchProgress } from './fetch-records'
import { requestRecord } from '../data/network'
import type { FetchWorkerChannel } from '../data/worker-channel'

/**
 * 双端十二个在途场次、最多两份展开正文与单通道上传，一次原子提交完整批次。
 * 第三个后台租约仅用于交叠压缩候选上传；未压缩候选一直持有展开名额。
 * 原生网络池最多六路；处理中的两场不会让后续下载空等。
 * @param port - 保留授权、来源、分段摘要及 CAS 校验的原生接口。
 * @param snapshot - 当前版本的完整关联元数据；不读取或上传其他场次的旧正文。
 * @param ids - 需要检测的目标标识，手动场次不请求网络。
 * @param expectedRevision - 用户开始检测时的版本，保存时仍须匹配。
 * @param onResult - 单场成功暂存后的无正文进度回调，不表示最终提交。
 * @param onProgress - 批次进度通知，失败也计入已处理数量。
 * @returns 全部目标元数据及最终提交版本；异常等待在途任务收尾后取消批次。
 */
export async function stagedFetch(
  port: LogbookPort,
  snapshot: MobileSnapshot,
  ids: string[],
  expectedRevision: number,
  onResult: (record: SessionRecord) => void,
  onProgress: (progress: FetchProgress) => void
) {
  const wanted = new Set(ids)
  const targets = snapshot.records
    .filter((r) => wanted.has(r.id) && r.sourceType === 'online')
    .map(({ rawContent, manualContent, ...metadata }) => metadata)
  if (!targets.length) return { fetched: [], saved: undefined }
  if (
    !port.beginFetchBatch ||
    !port.stageFetchResult ||
    !port.finishFetchBatch ||
    !port.cancelFetchBatch ||
    !port.beginSnapshotEdit ||
    !port.appendSnapshotEdit ||
    !port.cancelSnapshotEdit
  )
    throw new Error('批量暂存接口不可用。')
  const batch = await port.beginFetchBatch({ ids: targets.map((r) => r.id), expectedRevision })
  const losslessTransfer = typeof port.appendSnapshotEditEncoded === 'function'
  const available: FetchWorkerChannel[] = losslessTransfer
    ? ['fetch-0', 'fetch-1', 'fetch-2']
    : ['fetch-0', 'fetch-1']
  const waiting: Array<(channel: FetchWorkerChannel) => void> = []
  let expandedSlots = 2
  const waitingExpansion: Array<() => void> = []
  /** @returns 展开正文名额；上传中的未压缩字节仍占用此名额。 */
  async function acquireExpansion(): Promise<void> {
    if (expandedSlots > 0) {
      expandedSlots--
      return
    }
    await new Promise<void>((resolve) => waitingExpansion.push(resolve))
  }
  /** @returns 无；只有压缩字节已独立保留或整个租约释放后才交还展开名额。 */
  function releaseExpansion(): void {
    const next = waitingExpansion.shift()
    if (next) next()
    else expandedSlots++
  }
  /** @returns 空闲租约通道；持有到完整上传和清理结束，不与其他租约混用。 */
  async function acquireChannel(): Promise<FetchWorkerChannel> {
    return available.shift() ?? new Promise((resolve) => waiting.push(resolve))
  }
  /** @param channel - 已完成清理的正文槽位。 @returns 无；按等待顺序交给下一场。 */
  function releaseChannel(channel: FetchWorkerChannel): void {
    const next = waiting.shift()
    if (next) next(channel)
    else available.push(channel)
  }
  let queue = Promise.resolve()
  let committed = false
  try {
    const fetched = await fetchRecords(port, targets, {
      concurrency: 12,
      onResult,
      onProgress,
      releaseBodies: true,
      async fetchAndStage(record) {
        const response = await requestRecord(port, record)
        const channel = await acquireChannel()
        let prepared: Awaited<ReturnType<typeof prepareFetchUploadInBackground>> | undefined
        let expansionHeld = false
        try {
          await acquireExpansion()
          expansionHeld = true
          prepared = await prepareFetchUploadInBackground(
            snapshot,
            response.record,
            response.text,
            channel,
            losslessTransfer
          )
          const ready = prepared
          if (losslessTransfer && ready.keepsOriginalBytes === false) {
            releaseExpansion()
            expansionHeld = false
          }
          // 原生仍只有一份活动上传；后台下一场的完整校验不必等待磁盘暂存完成。
          const task = queue.then(async () => {
            let upload: { id: string } | undefined
            try {
              upload = await port.beginSnapshotEdit!({
                expectedRevision,
                bytes: ready.bytes,
                sha256: ready.sha256
              })
              for (let index = 0; index < ready.count; index++) {
                if (losslessTransfer) {
                  const part = await uploadTransferInBackground(ready.id, index, channel)
                  await port.appendSnapshotEditEncoded!({ id: upload.id, index, ...part })
                } else {
                  const base64 = await uploadChunkInBackground(ready.id, index, channel)
                  await port.appendSnapshotEdit!({ id: upload.id, index, base64 })
                }
              }
              await port.stageFetchResult!({ batchId: batch.id, id: upload.id })
              return ready.record
            } finally {
              if (upload) await port.cancelSnapshotEdit!({ id: upload.id })
            }
          })
          queue = task.then(
            () => {},
            () => {}
          )
          return await task
        } finally {
          try {
            if (prepared) await closeUploadInBackground(prepared.id, channel)
          } finally {
            if (expansionHeld) releaseExpansion()
            releaseChannel(channel)
          }
        }
      }
    })
    const saved = await port.finishFetchBatch({ id: batch.id })
    committed = true
    return { fetched, saved }
  } finally {
    // 原生完成提交已释放批次；不要让额外清理请求掩盖已保存的revision。
    if (!committed) await port.cancelFetchBatch({ id: batch.id })
  }
}
