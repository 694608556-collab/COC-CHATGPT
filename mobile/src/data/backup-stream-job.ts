import { readLocalSourceStream } from './local-source-stream'
import { prepareRestoreStream } from './restore-stream'
import { writeCanonicalBackupZipStream } from './backup-zip-stream'
import { capacity } from './capacity'
import type { LocalStreamSource } from './local-source-stream'

export type BackupStreamJob =
  | { type: 'restore'; source: LocalStreamSource; format: 'json' | 'zip'; maximumStageBytes: number }
  | {
      type: 'zip'
      source: LocalStreamSource
      canonicalVersion: 1
      files: Array<LocalStreamSource & { name: string }>
      maximumBytes: number
    }

/** Only local proved-file reads and private-output callbacks. No native bridge,
 * directory write, revision mutation or user confirmation capability in Worker.
 */
export async function performBackupStreamJob(
  job: BackupStreamJob,
  write: (key: string, chunk: Uint8Array) => Promise<void>,
  signal?: AbortSignal
) {
  const source = readLocalSourceStream(job.source, { maximumBytes: job.source.bytes, signal })
  if (job.type === 'restore')
    return prepareRestoreStream(source, {
      format: job.format,
      expectedSource: job.source,
      maximumStageBytes: job.maximumStageBytes,
      signal,
      write
    })
  if (job.canonicalVersion !== 1) throw new Error('本机备份来源格式不兼容，不能打包。')
  return writeCanonicalBackupZipStream(
    source,
    job.source,
    job.files.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
      chunks: readLocalSourceStream(file, {
        maximumBytes: capacity.archiveFileBytes,
        allowEmpty: true,
        signal
      })
    })),
    (chunk) => write('output', chunk),
    { maximumBytes: job.maximumBytes, signal }
  )
}
