import { readBackupJsonStream } from './backup-stream'
import { readBackupZipStream } from './backup-zip-stream'
import { StreamSha256 } from './stream-sha256'
import { checkStreamCancelled, checkStreamBudget } from './stream-json'
import { capacity } from './capacity'
import type { StreamProof, StreamBackupPreview } from './backup-stream'
import type { StreamAttachment } from './backup-zip-stream'

export interface RestoreStreamResult {
  preview: StreamBackupPreview
  candidate: StreamProof
  attachments: StreamAttachment[]
}
/** Internal restore candidate v1: R<complete record JSON> LF, then exactly one
 * M<bodyless complete metadata JSON> LF. No physical newline occurs in JSON
 * strings. This private protocol is never presented as a user backup format.
 * Native must independently validate every line, the complete graph, proofs,
 * permissions and CAS. Callbacks only write unpublished private candidates.
 */
export async function prepareRestoreStream(
  source: AsyncIterable<Uint8Array>,
  options: {
    format: 'json' | 'zip'
    expectedSource: StreamProof
    maximumStageBytes: number
    signal?: AbortSignal
    write(key: string, chunk: Uint8Array): Promise<void>
  }
): Promise<RestoreStreamResult> {
  checkStreamBudget(options.maximumStageBytes)
  const digest = new StreamSha256(),
    encoder = new TextEncoder()
  let staged = 0
  async function write(key: string, bytes: Uint8Array) {
    for (let offset = 0; offset < bytes.length; offset += capacity.transferChunkBytes) {
      checkStreamCancelled(options.signal)
      const chunk = bytes.subarray(offset, offset + capacity.transferChunkBytes)
      if (staged + chunk.length > options.maximumStageBytes)
        throw new Error('恢复暂存所需空间超过本次可用预算。')
      await options.write(key, chunk)
      staged += chunk.length
      if (key === 'candidate') digest.update(chunk)
    }
  }
  const read = {
    maximumBytes: options.expectedSource.bytes,
    expectedSource: options.expectedSource,
    signal: options.signal,
    preserveBodyTokens: true,
    stageRecord: async (
      record: import('../../../src/shared/types').SessionRecord,
      _index: number,
      json?: string
    ) => {
      if (!json) throw new Error('完整正文词元未取齐，不能恢复。')
      await write('candidate', encoder.encode('R' + json + '\n'))
    }
  }
  let preview: StreamBackupPreview,
    attachments: StreamAttachment[] = []
  if (options.format === 'zip') {
    const result = await readBackupZipStream(source, {
      ...read,
      maximumExpandedBytes: options.maximumStageBytes,
      stageAttachment: (path, bytes) => write('zip:' + path, bytes)
    })
    preview = result
    attachments = result.attachments
  } else preview = await readBackupJsonStream(source, read)
  await write('candidate', encoder.encode('M' + JSON.stringify(preview.metadata) + '\n'))
  return { preview, candidate: { bytes: digest.bytes, sha256: digest.digest() }, attachments }
}
