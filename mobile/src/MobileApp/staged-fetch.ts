import type { LogbookPort } from '../data/native'
import type { MobileSnapshot } from '../data/types'
import type { SessionRecord } from '../../../src/shared/types'
import {
  prepareUploadInBackground,
  uploadChunkInBackground,
  closeUploadInBackground
} from '../data/background'
import { fetchRecords } from './fetch-records'
import type { FetchProgress } from './fetch-records'

/** Android batch: at most three live response bodies; one disk-backed, atomic native commit. */
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
      stageResult(record) {
        const task = queue.then(async () => {
          const prepared = await prepareUploadInBackground({ ...snapshot, records: [record] })
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
          } finally {
            try {
              if (upload) await port.cancelSnapshotEdit!({ id: upload.id })
            } finally {
              await closeUploadInBackground(prepared.id)
            }
          }
        })
        queue = task.catch(() => {})
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
