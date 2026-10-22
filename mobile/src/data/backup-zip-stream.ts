import { Unzip, UnzipInflate, Zip, ZipPassThrough } from 'fflate'
import { capacity } from './capacity'
import { StreamSha256 } from './stream-sha256'
import { checkStreamBudget, checkStreamCancelled } from './stream-json'
import { readBackupJsonStream, writeBackupJsonStream } from './backup-stream'
import type {
  StreamBackupPreview,
  StreamReadOptions,
  StreamProof,
  StreamWriteOptions,
  StreamBackupHeader
} from './backup-stream'
import type { SessionRecord } from '../../../src/shared/types'
import { StreamCrc32, ZipTail } from './stream-zip-proof'

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
  source: AsyncIterable<Uint8Array>,
  options: ZipStreamReadOptions
): Promise<StreamBackupPreview & { attachments: StreamAttachment[]; expandedBytes: number }> {
  checkStreamBudget(options.maximumBytes)
  checkStreamBudget(options.maximumExpandedBytes)
  const raw = new StreamSha256(),
    tail = new ZipTail(),
    proofs = new Map<string, StreamProof & { crc32: number }>(),
    names = new Set<string>()
  const queues: ChunkQueue[] = [],
    consumers: Promise<void>[] = []
  let preview: StreamBackupPreview | undefined,
    expandedBytes = 0,
    failure: Error | undefined
  const fail = (reason: unknown) => {
    failure ??= reason instanceof Error ? reason : new Error(String(reason))
    for (const queue of queues) queue.end(failure)
  }
  const unzip = new Unzip((file) => {
    try {
      safeZipPath(file.name)
      tail.observe(file.name)
      if (names.has(file.name)) throw new Error('ZIP 条目重复。')
      names.add(file.name)
      if (names.size > capacity.zipEntries) throw new Error('ZIP 条目数超过处理上限。')
      if (file.compression !== 0 && file.compression !== 8) throw new Error('ZIP 压缩格式不受支持。')
      if (file.originalSize !== undefined && file.originalSize > options.maximumExpandedBytes)
        throw new Error('ZIP 声明解压大小超过处理空间。')
      const queue = new ChunkQueue()
      queues.push(queue)
      const digest = new StreamSha256(),
        crc = new StreamCrc32()
      const consumer = (async () => {
        async function* checked() {
          for await (const bytes of queue) {
            digest.update(bytes)
            crc.update(bytes)
            yield bytes
          }
        }
        if (file.name === 'backup.json') {
          preview = await readBackupJsonStream(checked(), {
            ...options,
            maximumBytes: options.maximumExpandedBytes,
            expectedSource: undefined,
            archiveReferences: true
          })
        } else
          for await (const bytes of checked()) {
            checkStreamCancelled(options.signal)
            if (!file.name.endsWith('/') && digest.bytes > capacity.archiveFileBytes)
              throw new Error('ZIP 单个附件超过处理上限。')
            if (file.name.endsWith('/') && bytes.length) throw new Error('ZIP 目录条目含文件内容。')
            await options.stageAttachment?.(file.name, bytes)
          }
        proofs.set(file.name, { bytes: digest.bytes, sha256: digest.digest(), crc32: crc.value })
      })().catch(fail)
      consumers.push(consumer)
      file.ondata = (error, data, final) => {
        if (error) {
          fail(error)
          return
        }
        try {
          expandedBytes += data.length
          if (expandedBytes > options.maximumExpandedBytes) throw new Error('ZIP 实际解压大小超过处理空间。')
          queue.push(data)
          if (final) queue.end()
        } catch (error) {
          fail(error)
        }
      }
      file.start()
    } catch (error) {
      fail(error)
    }
  })
  unzip.register(UnzipInflate)
  try {
    for await (const bytes of source) {
      checkStreamCancelled(options.signal)
      if (bytes.length > capacity.transferChunkBytes || raw.bytes + bytes.length > options.maximumBytes)
        throw new Error('ZIP 输入分段或总量超过本次预算。')
      raw.update(bytes)
      // Small compressed slices bound the maximum synchronous inflation window.
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        if (failure) throw failure
        const part = bytes.subarray(offset, offset + 4096)
        tail.push(part)
        unzip.push(part, false)
        await Promise.all(queues.map((queue) => queue.drained()))
        if (failure) throw failure
      }
    }
    unzip.push(new Uint8Array(), true)
    await Promise.all(consumers)
    if (failure) throw failure
    if (!preview) throw new Error('ZIP 校验失败：缺少完整backup.json。')
    tail.verify(proofs)
    const sourceProof = { bytes: raw.bytes, sha256: raw.digest() }
    if (options.expectedSource) checkProof(sourceProof, options.expectedSource)
    for (const item of preview.archive.integrity)
      checkProof(proofs.get(item.zipPath), { bytes: item.size, sha256: item.hash })
    let attachmentBytes = 0
    const attachments = preview.archive.attachments.map((item) => {
      checkProof(proofs.get(item.zipPath), { bytes: item.size, sha256: item.hash })
      attachmentBytes += item.size
      if (attachmentBytes > capacity.attachmentTotalBytes) throw new Error('ZIP 待恢复附件超过处理上限。')
      return {
        zipPath: item.zipPath,
        name: item.archivePath.split(/[\\/]/).pop() || '归档文件',
        bytes: item.size,
        sha256: item.hash.toLowerCase()
      }
    })
    return {
      ...preview,
      source: sourceProof,
      attachments,
      expandedBytes,
      warnings: preview.warnings
        .filter((message) => !message.includes('此备份不含可恢复'))
        .concat(
          attachments.length
            ? [`将恢复 ${attachments.length} 份归档附件，创建新文件，不覆盖同名文件。`]
            : ['此备份不含可恢复的跑团归档附件。']
        )
    }
  } catch (error) {
    fail(error)
    await Promise.all(consumers)
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
  checkStreamBudget(options.maximumBytes)
  if (attachments.length > capacity.archiveAttachments) throw new Error('归档附件数量超过处理上限。')
  let total = 0
  const manifest = attachments.map((file, index) => {
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > capacity.archiveFileBytes ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('归档附件证明无效。')
    total += file.bytes
    if (total > capacity.attachmentTotalBytes) throw new Error('归档附件合计超过处理上限。')
    const archivePath = index + '-' + file.name.replace(/[\\/]/g, '_')
    const zipPath = 'archives/' + archivePath
    safeZipPath(zipPath)
    return { archivePath, zipPath, size: file.bytes, hash: file.sha256 }
  })
  const output = new StreamSha256(),
    pending: Uint8Array[] = []
  let failure: Error | undefined
  const zip = new Zip((error, bytes) => {
    if (error) failure = error
    else pending.push(bytes)
  })
  async function drain() {
    if (failure) throw failure
    while (pending.length) {
      const bytes = pending.shift()!
      for (let i = 0; i < bytes.length; i += capacity.transferChunkBytes) {
        checkStreamCancelled(options.signal)
        const chunk = bytes.subarray(i, i + capacity.transferChunkBytes)
        if (output.bytes + chunk.length >= 0xffffffff)
          throw new Error('ZIP32格式无法容纳此完整备份，请使用JSON备份。')
        if (output.bytes + chunk.length > options.maximumBytes) throw new Error('ZIP 备份超过本次可用空间。')
        await sink(chunk)
        output.update(chunk)
      }
    }
  }
  try {
    const json = new ZipPassThrough('backup.json')
    zip.add(json)
    await writeBackupJsonStream(
      metadata,
      records,
      async (bytes) => {
        json.push(bytes, false)
        await drain()
      },
      { ...options, archives: manifest }
    )
    json.push(new Uint8Array(), true)
    await drain()
    for (let index = 0; index < attachments.length; index++) {
      const file = attachments[index]!,
        entry = new ZipPassThrough(manifest[index]!.zipPath),
        digest = new StreamSha256()
      zip.add(entry)
      await drain()
      for await (const bytes of file.chunks) {
        checkStreamCancelled(options.signal)
        if (bytes.length > capacity.transferChunkBytes || digest.bytes + bytes.length > file.bytes)
          throw new Error('归档附件大小或分段已变化。')
        digest.update(bytes)
        entry.push(bytes, false)
        await drain()
      }
      checkProof({ bytes: digest.bytes, sha256: digest.digest() }, file)
      entry.push(new Uint8Array(), true)
      await drain()
    }
    zip.end()
    await drain()
    return { bytes: output.bytes, sha256: output.digest() }
  } finally {
    zip.terminate()
  }
}
