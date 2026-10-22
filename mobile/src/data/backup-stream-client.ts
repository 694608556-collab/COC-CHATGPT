import { Capacitor } from '@capacitor/core'
import type { LogbookPort } from './native'
import type { FilterPreset } from '../../../src/shared/types'
import type { BodySearchResult } from './body-search-stream'
import { BodySearchCleanupError } from './body-search-stream'
import { checkStreamCancelled } from './stream-json'
import { performBackupStreamJob } from './backup-stream-job'
import { encodeBase64 } from './bytes'
import type { BackupStreamJob } from './backup-stream-job'
import type { RestoreStreamResult } from './restore-stream'
import type { StreamProof } from './backup-stream'
import type {
  BackupStreamPort,
  NativeRestoreSource,
  NativeBackupFile,
  LeasedBackupPreview
} from './backup-stream-native'

type Port = Required<BackupStreamPort>
function required(port: BackupStreamPort): Port {
  for (const method of [
    'appendBackupStage',
    'finishBackupPreview',
    'commitBackupRestore',
    'cancelBackupStage',
    'createBackupStream',
    'finishBackupExport'
  ] as const)
    if (!port[method]) throw new Error('本机适配器缺少完整大文件能力，请更新应用后重试。')
  return port as Port
}
const local = (file: NativeBackupFile) => ({
  bytes: file.bytes,
  sha256: file.sha256,
  url: Capacitor.convertFileSrc(file.fileUri),
  ranged: Capacitor.getPlatform() === 'ios'
})
function mime(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return (
    (
      {
        txt: 'text/plain',
        json: 'application/json',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pdf: 'application/pdf',
        csv: 'text/csv',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  )
}
async function run<T>(job: BackupStreamJob, port: Port, id: string, signal?: AbortSignal): Promise<T> {
  checkStreamCancelled(signal)
  if (typeof document === 'undefined') {
    const indexes = new Map<string, number>()
    return (await performBackupStreamJob(
      job,
      async (key, chunk) => {
        const index = indexes.get(key) ?? 0
        await port.appendBackupStage({ id, key, index, base64: encodeBase64(chunk) })
        indexes.set(key, index + 1)
      },
      signal
    )) as T
  }
  if (typeof Worker === 'undefined') throw new Error('此环境缺少后台大文件处理能力，未尝试整库载入。')
  const worker = new Worker('backup-stream-worker.js')
  let active = true
  let abort: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(new Error('搜索已取消。'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      worker.onmessage = async ({ data }) => {
        if (data.type === 'chunk') {
          try {
            await port.appendBackupStage({ id, key: data.key, index: data.index, base64: data.base64 })
            if (active) worker.postMessage({ type: 'ack', request: data.request })
          } catch (reason) {
            if (active)
              worker.postMessage({
                type: 'ack',
                request: data.request,
                error: reason instanceof Error ? reason.message : '私有暂存失败。'
              })
          }
        } else if (data.type === 'done') resolve(data.result)
        else if (data.type === 'failed') reject(new Error(data.error))
      }
      worker.onerror = () => reject(new Error('大文件后台处理器启动或运行失败，未发布数据。'))
      worker.postMessage({ type: 'start', job })
    })
  } finally {
    active = false
    if (abort) signal?.removeEventListener('abort', abort)
    worker.terminate()
  }
}
export async function previewNativeBackup(
  port: BackupStreamPort,
  source: NativeRestoreSource
): Promise<LeasedBackupPreview> {
  const device = required(port)
  try {
    const result = await run<RestoreStreamResult>(
      {
        type: 'restore',
        source: local(source),
        format: source.format,
        maximumStageBytes: source.maximumStageBytes
      },
      device,
      source.id
    )
    const ready = await device.finishBackupPreview({
      id: source.id,
      candidate: result.candidate,
      attachments: result.attachments.map((file) => ({
        zipPath: file.zipPath,
        name: file.name,
        mime: mime(file.name),
        bytes: file.bytes,
        sha256: file.sha256
      }))
    })
    if (
      ready.id !== source.id ||
      ready.revision !== source.revision ||
      ready.offlineRecords !== result.preview.offlineRecords
    )
      throw new Error('原生恢复预览证明不一致，不能确认。')
    return {
      lease: source.id,
      revision: source.revision,
      snapshot: result.preview.metadata,
      offlineRecords: ready.offlineRecords,
      warnings: result.preview.warnings
    }
  } catch (error) {
    try {
      await device.cancelBackupStage({ id: source.id })
    } catch {
      throw new Error(
        (error instanceof Error ? error.message : '预览失败。') + ' 私有暂存清理失败，请重开后重试。'
      )
    }
    throw error
  }
}
export async function exportNativeBackup(
  port: BackupStreamPort,
  revision: number,
  includeArchives: boolean,
  name: string
) {
  const device = required(port),
    lease = await device.createBackupStream({ expectedRevision: revision, includeArchives })
  let saved: Awaited<ReturnType<Port['finishBackupExport']>> | undefined
  try {
    if (lease.revision !== revision) throw new Error('备份版本证明不一致。')
    if (lease.source.canonicalVersion !== 1) throw new Error('本机备份来源格式不兼容，未尝试整库载入。')
    let proof: StreamProof | undefined
    if (includeArchives)
      proof = await run<StreamProof>(
        {
          type: 'zip',
          source: local(lease.source),
          canonicalVersion: lease.source.canonicalVersion,
          files: lease.files.map((file) => ({ ...local(file), name: file.name })),
          maximumBytes: lease.maximumBytes
        },
        device,
        lease.id
      )
    saved = await device.finishBackupExport({ id: lease.id, name, proof })
    return saved
  } finally {
    try {
      await device.cancelBackupStage({ id: lease.id })
    } catch (error) {
      if (saved) saved.warning = '备份已完整保存，但私有暂存清理失败，请重开后重试。'
      else throw error
    }
  }
}

/** Read-only search lease: no output staging, confirmation or publication. */
export async function searchNativeBodies(
  port: LogbookPort,
  ids: string[],
  revision: number,
  query: string,
  preset: FilterPreset,
  signal: AbortSignal
): Promise<BodySearchResult> {
  const trimmed = query.trim(),
    presetKey = JSON.stringify(preset)
  checkStreamCancelled(signal)
  if (!trimmed || trimmed.length > 4096) throw new Error('正文搜索查询无效或过长。')
  if (!ids.length) return { query: trimmed, hits: [], revision, presetKey }
  if (!port.createSearchSource) throw new Error('本机缺少逐场正文搜索能力。')
  const lease = await port.createSearchSource({ ids, expectedRevision: revision })
  try {
    checkStreamCancelled(signal)
    if (lease.revision !== revision) throw new Error('搜索数据版本已变化。')
    const result = await run<Awaited<ReturnType<typeof import('./body-search-stream').searchBodyStream>>>(
      { type: 'search', source: local(lease.source), ids, query: trimmed, preset },
      required(port),
      lease.id,
      signal
    )
    if (
      result.records !== ids.length ||
      result.source.bytes !== lease.source.bytes ||
      result.source.sha256 !== lease.source.sha256
    )
      throw new Error('完整搜索证明不一致。')
    const status = await port.getStatus()
    checkStreamCancelled(signal)
    if (status.revision !== revision) throw new Error('数据已变化，请重新搜索。')
    return { query: trimmed, hits: result.hits, revision, presetKey }
  } finally {
    try {
      await port.cancelBackupStage!({ id: lease.id })
    } catch {
      throw new BodySearchCleanupError('搜索读取暂存清理失败，请重开应用后重试；未发布搜索结果。')
    }
  }
}
