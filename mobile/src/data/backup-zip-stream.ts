import { capacity } from './capacity'
import { StreamSha256 } from './stream-sha256'
import { addStreamBytes, checkStreamBudget, checkStreamCancelled } from './stream-json'
import { readBackupJsonStream, writeBackupJsonStream } from './backup-stream'
import type {
  StreamBackupPreview,
  StreamReadOptions,
  StreamProof,
  StreamWriteOptions,
  StreamBackupHeader
} from './backup-stream'
import type { SessionRecord } from '../../../src/shared/types'
import type { StreamArchiveReference } from './backup-stream'
import { readZipContainer, Zip64Writer } from './zip64-stream'
import type { ReopenableZipSource } from './zip64-stream'

/** One producer and one consumer; producer must await drained after each push. */
class ChunkQueue implements AsyncIterable<Uint8Array> {
  private values: Uint8Array[] = []
  private bytes = 0
  private done = false
  private inFlight = false
  private error?: Error
  private wake?: () => void
  private drain?: () => void
  push(value: Uint8Array) {
    if (this.done) throw new Error('ZIP 条目输出已结束。')
    this.bytes += value.length
    if (this.bytes > 8 * 1024 * 1024) throw new Error('ZIP 解压输出窗口超过上限。')
    if (value.length) this.values.push(value)
    this.wake?.()
    this.wake = undefined
  }
  end(error?: Error) {
    this.done = true
    this.error = error
    this.wake?.()
    if (error) this.drain?.()
  }
  async drained() {
    if (this.error) throw this.error
    if (this.values.length || this.inFlight)
      await new Promise<void>((resolve) => {
        this.drain = resolve
      })
    if (this.error) throw this.error
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.error) throw this.error
      const item = this.values.shift()
      if (item) {
        this.inFlight = true
        this.bytes -= item.length
        // Do not request more compressed input until the consumer resumes.
        for (let i = 0; i < item.length; i += capacity.transferChunkBytes)
          yield item.subarray(i, i + capacity.transferChunkBytes)
        this.inFlight = false
        if (!this.values.length) {
          this.drain?.()
          this.drain = undefined
        }
      } else if (this.done) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}
function safeZipPath(name: string) {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').includes('..')
  )
    throw new Error('ZIP 路径校验失败。')
}
function checkProof(actual: StreamProof | undefined, expected: StreamProof) {
  if (!actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256.toLowerCase())
    throw new Error('ZIP 文件存在性、大小或摘要校验失败。')
}
export interface ZipStreamReadOptions extends StreamReadOptions {
  maximumExpandedBytes: number
  /** Private attachment sink only. All data must be discarded if the preview fails or is cancelled. */
  stageAttachment?(path: string, chunk: Uint8Array): Promise<void>
}
export interface StreamAttachment {
  zipPath: string
  name: string
  bytes: number
  sha256: string
}

/** Streaming ZIP preview. Metadata/record/body validation is shared with JSON;
 * every entry is consumed, bounded and hashed, even when it is not restored.
 * Queue backpressure stops decompression while a staging sink is busy.
 */
export async function readBackupZipStream(
  source: ReopenableZipSource,
  options: ZipStreamReadOptions
): Promise<StreamBackupPreview & { attachments: StreamAttachment[]; expandedBytes: number }> {
  const proofs = new Map<string, StreamProof>()
  let preview: StreamBackupPreview | undefined
  let active: ChunkQueue | undefined
  let consumer: Promise<void> | undefined
  let failure: Error | undefined
  try {
    const result = await readZipContainer(source, options, async (entry) => {
      safeZipPath(entry.name)
      const queue = new ChunkQueue(),
        digest = new StreamSha256()
      active = queue
      failure = undefined
      consumer = (async () => {
        async function* checked() {
          for await (const bytes of queue) {
            digest.update(bytes)
            yield bytes
          }
        }
        if (entry.name === 'backup.json') {
          preview = await readBackupJsonStream(checked(), {
            ...options,
            maximumBytes: options.maximumExpandedBytes,
            expectedSource: undefined,
            archiveReferences: true
          })
        } else {
          for await (const bytes of checked()) {
            checkStreamCancelled(options.signal)
            if (entry.name.endsWith('/') && bytes.length) throw new Error('ZIP目录条目含文件内容。')
            await options.stageAttachment?.(entry.name, bytes)
          }
        }
        proofs.set(entry.name, { bytes: digest.bytes, sha256: digest.digest() })
      })().catch((reason: unknown) => {
        failure = reason instanceof Error ? reason : new Error(String(reason))
        queue.end(failure)
      })
      return {
        async push(bytes) {
          if (failure) throw failure
          queue.push(bytes)
          await queue.drained()
          if (failure) throw failure
        },
        async end() {
          queue.end()
          await consumer
          if (failure) throw failure
          active = undefined
        }
      }
    })
    if (!preview) throw new Error('ZIP校验失败：缺少完整backup.json。')
    for (const item of preview.archive.integrity)
      checkProof(proofs.get(item.zipPath), { bytes: item.size, sha256: item.hash })
    const attachments = preview.archive.attachments.map((item) => {
      checkProof(proofs.get(item.zipPath), { bytes: item.size, sha256: item.hash })
      return {
        zipPath: item.zipPath,
        name: item.archivePath.split(/[\\/]/).pop() || '归档文件',
        bytes: item.size,
        sha256: item.hash.toLowerCase()
      }
    })
    return {
      ...preview,
      ...result,
      attachments,
      warnings: preview.warnings
        .filter((message) => !message.includes('此备份不含可恢复'))
        .concat(
          attachments.length
            ? [`将恢复 ${attachments.length} 份归档附件，创建新文件，不覆盖同名文件。`]
            : ['此备份不含可恢复的跑团归档附件。']
        )
    }
  } catch (error) {
    active?.end(error instanceof Error ? error : new Error(String(error)))
    await consumer
    throw error
  }
}

export interface BackupStreamAttachment extends StreamProof {
  name: string
  chunks: AsyncIterable<Uint8Array>
}
/** Uncompressed streaming ZIP keeps the existing format and complete manifests;
 * no entry or body is omitted to make a limit pass. Publication remains native.
 */
export async function writeBackupZipStream(
  metadata: StreamBackupHeader,
  records: AsyncIterable<SessionRecord>,
  attachments: readonly BackupStreamAttachment[],
  sink: (chunk: Uint8Array) => Promise<void>,
  options: StreamWriteOptions
): Promise<StreamProof> {
  return writeZipContainer(attachments, sink, options, (manifest, emit) =>
    writeBackupJsonStream(metadata, records, emit, { ...options, archives: manifest })
  )
}

/** Native-generated canonical envelope v1 only: both adapters end their
 * independently validated immutable JSON with exactly two closing braces.
 * Copy all original business bytes verbatim and add manifests at those two
 * boundaries; never parse/stringify message.raw numeric tokens for export.
 */
export async function writeCanonicalBackupZipStream(
  source: AsyncIterable<Uint8Array>,
  expected: StreamProof,
  attachments: readonly BackupStreamAttachment[],
  sink: (chunk: Uint8Array) => Promise<void>,
  options: StreamWriteOptions
): Promise<StreamProof> {
  return writeZipContainer(attachments, sink, options, async (manifest, emit) => {
    const digest = new StreamSha256()
    let tail = new Uint8Array()
    for await (const bytes of source) {
      checkStreamCancelled(options.signal)
      if (bytes.length > capacity.transferChunkBytes || digest.bytes + bytes.length > expected.bytes)
        throw new Error('本机完整备份长度或分段已变化。')
      digest.update(bytes)
      const joined = new Uint8Array(tail.length + bytes.length)
      joined.set(tail)
      joined.set(bytes, tail.length)
      if (joined.length > 2) {
        const end = joined.length - 2
        for (let offset = 0; offset < end; offset += capacity.transferChunkBytes)
          await emit(joined.subarray(offset, Math.min(end, offset + capacity.transferChunkBytes)))
        tail = joined.slice(end)
      } else tail = joined
    }
    checkProof({ bytes: digest.bytes, sha256: digest.digest() }, expected)
    if (tail.length !== 2 || tail[0] !== 125 || tail[1] !== 125)
      throw new Error('本机完整备份结束标记无效，不能生成ZIP。')
    const text =
      ',"manifest":' +
      JSON.stringify(manifest) +
      ',"archiveEntries":' +
      JSON.stringify(manifest.map((item) => ({ path: item.archivePath, ownerType: 'record' }))) +
      '},"manifest":' +
      JSON.stringify(manifest) +
      '}'
    const bytes = new TextEncoder().encode(text)
    for (let offset = 0; offset < bytes.length; offset += capacity.transferChunkBytes)
      await emit(bytes.subarray(offset, offset + capacity.transferChunkBytes))
  })
}

async function writeZipContainer(
  attachments: readonly BackupStreamAttachment[],
  sink: (chunk: Uint8Array) => Promise<void>,
  options: StreamWriteOptions,
  produceJson: (
    manifest: StreamArchiveReference[],
    emit: (chunk: Uint8Array) => Promise<void>
  ) => Promise<unknown>
): Promise<StreamProof> {
  checkStreamBudget(options.maximumBytes)
  let total = 0
  const manifest = attachments.map((file, index) => {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('归档附件证明无效。')
    total = addStreamBytes(total, file.bytes)
    if (total > options.maximumBytes) throw new Error('归档附件超过本次可用空间。')
    const archivePath = index + '-' + file.name.replace(/[\\/]/g, '_')
    const zipPath = 'archives/' + archivePath
    safeZipPath(zipPath)
    return { archivePath, zipPath, size: file.bytes, hash: file.sha256 }
  })
  const writer = new Zip64Writer(sink, options)
  await writer.add('backup.json', (emit) => produceJson(manifest, emit))
  for (let index = 0; index < attachments.length; index++) {
    const file = attachments[index]!,
      digest = new StreamSha256()
    await writer.add(manifest[index]!.zipPath, async (emit) => {
      for await (const bytes of file.chunks) {
        checkStreamCancelled(options.signal)
        if (
          bytes.length > capacity.transferChunkBytes ||
          addStreamBytes(digest.bytes, bytes.length) > file.bytes
        )
          throw new Error('归档附件大小或分段已变化。')
        digest.update(bytes)
        await emit(bytes)
      }
      checkProof({ bytes: digest.bytes, sha256: digest.digest() }, file)
    })
  }
  return writer.finish()
}
