import type { LogbookPort } from '../data/native'
import type { MobileSnapshot } from '../data/types'
import type { SessionRecord } from '../../../src/shared/types'
import {
  prepareFetchUploadInBackground,
  uploadChunkInBackground,
  closeUploadInBackground
} from '../data/background'
import { fetchRecords } from './fetch-records'
import type { FetchProgress } from './fetch-records'
import { requestRecord } from '../data/network'

/**
 * Android 三槽流水线：最多持有三份响应，一次原子提交完整批次。
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
  let queue = Promise.resolve()
  let committed = false
  try {
    const fetched = await fetchRecords(port, targets, {
      onResult,
      onProgress,
      releaseBodies: true,
      async fetchAndStage(record) {
        const response = await requestRecord(port, record)
        const task = queue.then(async () => {
          const prepared = await prepareFetchUploadInBackground(snapshot, response.record, response.text)
          let upload: { id: string } | undefined
          try {
            upload = await port.beginSnapshotEdit!({
              expectedRevision,
              bytes: prepared.bytes,
              sha256: prepared.sha256
            })
            for (let index = 0; index < prepared.count; index++) {
              const base64 = await uploadChunkInBackground(prepared.id, index)
              await port.appendSnapshotEdit!({ id: upload.id, index, base64 })
            }
            await port.stageFetchResult!({ batchId: batch.id, id: upload.id })
            return prepared.record
          } finally {
            try {
              if (upload) await port.cancelSnapshotEdit!({ id: upload.id })
            } finally {
              await closeUploadInBackground(prepared.id)
            }
          }
        })
        queue = task.then(
          () => {},
          () => {}
        )
        return task
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
