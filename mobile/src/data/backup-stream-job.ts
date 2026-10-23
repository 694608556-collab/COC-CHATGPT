import { readLocalSourceStream } from './local-source-stream'
import { prepareRestoreStream } from './restore-stream'
import { writeCanonicalBackupZipStream } from './backup-zip-stream'
import { searchBodyStream, searchBodyParts } from './body-search-stream'
import type { SearchProjectionParts } from './search-projection-parts'
import { searchBodyCache } from './body-search-cache'
import type { FilterPreset } from '../../../src/shared/types'
import type { LocalStreamSource } from './local-source-stream'
import { readVerifiedLocalChunks } from './verified-local-source'

export type BackupStreamJob =
  | {
      type: 'search-pipeline'
      nonce: string
      ids: string[]
      query: string
      preset: FilterPreset
      maximumReadBytes: number
      measureSearch?: boolean
      cache?: { generation: string; signature: string; maximumMemoryBytes?: number }
    }
  | {
      type: 'search'
      source: LocalStreamSource
      ids: string[]
      query: string
      preset: FilterPreset
      /** Native runtime budget for a fast read; larger files still use the full streaming path. */
      maximumReadBytes?: number
      /** Numeric phase diagnostics only; never accepts an input proof or authority. */
      measureSearch?: boolean
      /** Admitted only by the actual native adapter after a sealed original grammar proof. */
      nativeProjection?: 1 | 2 | 3
      cache?: { generation: string; signature: string; maximumMemoryBytes?: number }
    }
  | { type: 'search-cached'; generation: string; signature: string; ids: string[]; query: string }
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
  signal?: AbortSignal,
  pipeline?: SearchProjectionParts
) {
  if (job.type === 'search-pipeline') {
    if (!pipeline) throw new Error('搜索分片来源通道缺失。')
    return searchBodyParts(pipeline, {
      ids: job.ids,
      query: job.query,
      preset: job.preset,
      signal,
      cache: job.cache,
      measure: job.measureSearch
    })
  }
  if (job.type === 'search-cached')
    return searchBodyCache(job.generation, job.ids, job.signature, job.query, signal)
  const source = () => readLocalSourceStream(job.source, { maximumBytes: job.source.bytes, signal })
  if (job.type === 'search') {
    const readStarted = job.measureSearch ? performance.now() : 0
    let input: AsyncIterable<Uint8Array> = source()
    const projected =
      (job.nativeProjection === 1 || job.nativeProjection === 2 || job.nativeProjection === 3) &&
      Number.isSafeInteger(job.maximumReadBytes) &&
      job.source.bytes <= job.maximumReadBytes!
    if (
      !projected &&
      Number.isSafeInteger(job.maximumReadBytes) &&
      job.source.bytes <= job.maximumReadBytes!
    ) {
      // Reuse the proven old local-file read for ordinary data. Feed the same
      // strict per-record parser afterwards; fast transport does not skip validation.
      input = await readVerifiedLocalChunks(job.source, signal)
    }
    const readProofMs = job.measureSearch ? performance.now() - readStarted : 0
    const result = await searchBodyStream(input, {
      expectedSource: job.source,
      ids: job.ids,
      query: job.query,
      preset: job.preset,
      signal,
      cache: job.cache,
      measure: job.measureSearch,
      nativeProjection: projected ? { ...job.source, version: job.nativeProjection! } : undefined
    })
    return job.measureSearch ? { ...result, timing: { ...result.timing, readProofMs } } : result
  }
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
    source(),
    job.source,
    job.files.map((file) => ({
      name: file.name,
      bytes: file.bytes,
      sha256: file.sha256,
      chunks: readLocalSourceStream(file, {
        maximumBytes: Math.max(1, file.bytes),
        allowEmpty: true,
        signal
      })
    })),
    (chunk) => write('output', chunk),
    { maximumBytes: job.maximumBytes, signal }
  )
}
