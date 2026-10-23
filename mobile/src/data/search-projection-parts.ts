import type { StreamBackupPreview, StreamProof } from './backup-stream'
import type { LocalStreamSource } from './local-source-stream'
import { readSource } from './local-source'
import { addStreamBytes, checkStreamBudget, checkStreamCancelled } from './stream-json'
import {
  createSearchProjectionCollector,
  validateSearchProjectionRoot,
  type SearchProjectionReadOptions,
  type SearchProjectionRoot
} from './search-projection'

/** One immutable, independently sealed native projection fragment. */
export interface SearchProjectionPart {
  index: number
  kind: 'root' | 'records' | 'tail'
  source: LocalStreamSource
  /** Exclusively transferred local read; this consumer still verifies all bytes and SHA. */
  prefetched?: ArrayBuffer
}

/** Trusted native lease transport; the client binds nonce, identity and revision.
 * The final proof describes the projection, never the original source bytes.
 */
export interface SearchProjectionParts {
  parts: AsyncIterable<SearchProjectionPart>
  sealed: Promise<StreamProof & { chunks: number }>
  /** Runtime fast-read budget for all retained source bytes, not an input quota. */
  maximumReadBytes: number
}

/** Wait for the final native seal while preserving cancellation and rejection handling.
 * @param pending A settled-outcome promise that cannot create an unhandled rejection.
 * @param signal Cancellation for the current read-only operation.
 * @returns The sealed outcome, or rejects when this operation is cancelled.
 */
async function waitForSeal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkStreamCancelled(signal)
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new Error('备份处理已取消，未发布数据。'))
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Validate all sealed fragments and stage records before the final source proof arrives.
 * @param input Native-owned fragments in original byte order and their final projection seal.
 * @param options Original metadata, message, source-association and staging gates.
 * @returns A complete validated graph only after EOF, exact chunk count and full SHA agree.
 */
export async function readSearchProjectionParts(
  input: SearchProjectionParts,
  options: SearchProjectionReadOptions
): Promise<StreamBackupPreview> {
  checkStreamBudget(input.maximumReadBytes)
  checkStreamBudget(options.maximumBytes)
  checkStreamCancelled(options.signal)
  const pipelineStarted = options.measurePhase ? performance.now() : 0
  // A seal may fail while earlier records are still being staged. Observe that
  // rejection immediately, but never publish staged data on either outcome.
  const sealed = input.sealed.then(
    (proof) => ({ proof }),
    (error) => ({ error })
  )
  const maximumBytes = Math.min(input.maximumReadBytes, options.maximumBytes)
  const collector = createSearchProjectionCollector({ ...options, searchProjectionVersion: 3 })
  const chunks: Uint8Array[] = []
  let root: SearchProjectionRoot | undefined,
    total = 0,
    index = 0,
    groups = 0,
    ended = false
  for await (const part of input.parts) {
    checkStreamCancelled(options.signal)
    if (
      !part ||
      !Number.isSafeInteger(part.index) ||
      part.index !== index ||
      ended ||
      (index === 0 ? part.kind !== 'root' : part.kind !== 'records' && part.kind !== 'tail')
    )
      throw new Error('正文搜索投影片段缺失、重复或顺序无效。')
    if (
      !part.source ||
      !Number.isSafeInteger(part.source.bytes) ||
      part.source.bytes < 1 ||
      typeof part.source.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(part.source.sha256)
    )
      throw new Error('正文搜索投影片段证明无效。')
    const nextTotal = addStreamBytes(total, part.source.bytes)
    if (nextTotal > maximumBytes) throw new Error('正文搜索投影超过本次快速读取预算。')
    if (
      part.prefetched &&
      (!(part.prefetched instanceof ArrayBuffer) || part.prefetched.byteLength !== part.source.bytes)
    )
      throw new Error('正文搜索预读片段长度不符。')
    const readStarted = options.measurePhase ? performance.now() : 0
    const bytes = await readSource(
      part.source,
      false,
      part.prefetched ? new Uint8Array(part.prefetched) : undefined
    )
    checkStreamCancelled(options.signal)
    options.measurePhase?.('projectionReadProofMs', performance.now() - readStarted)
    const parseStarted = options.measurePhase ? performance.now() : 0
    // Preserve a BOM as a character: removing one at each part boundary could
    // accept concatenated bytes that are not the same valid JSON document.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (part.kind === 'root') {
      if (!/"records"\s*:\s*\[\s*$/.test(text)) throw new Error('正文搜索投影根片段无效。')
      const parsed: unknown = JSON.parse(text + ']}}')
      validateSearchProjectionRoot(parsed)
      if (parsed.snapshot.records.length !== 0) throw new Error('正文搜索投影根片段包含场次。')
      root = parsed
    } else if (part.kind === 'records') {
      if (!root || (groups === 0 ? text.startsWith(',') : !text.startsWith(',')))
        throw new Error('正文搜索投影场次分隔符无效。')
      const records: unknown[] = JSON.parse('[' + (groups === 0 ? text : text.slice(1)) + ']')
      if (!records.length) throw new Error('正文搜索投影场次片段为空。')
      options.measurePhase?.('projectionJsonParseMs', performance.now() - parseStarted)
      for (const value of records) await collector.stage(value)
      groups++
    } else {
      if (!root || text !== ']}}') throw new Error('正文搜索投影尾部无效。')
      ended = true
    }
    if (part.kind !== 'records')
      options.measurePhase?.('projectionJsonParseMs', performance.now() - parseStarted)
    chunks.push(bytes)
    total = nextTotal
    index++
  }
  checkStreamCancelled(options.signal)
  if (!root || !ended) throw new Error('正文搜索投影片段未完整结束。')
  const outcome = await waitForSeal(sealed, options.signal)
  if ('error' in outcome) throw outcome.error
  const proof = outcome.proof
  if (
    !proof ||
    !Number.isSafeInteger(proof.chunks) ||
    proof.chunks !== index ||
    !Number.isSafeInteger(proof.bytes) ||
    proof.bytes !== total ||
    typeof proof.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(proof.sha256) ||
    (options.expectedSource &&
      (proof.bytes !== options.expectedSource.bytes || proof.sha256 !== options.expectedSource.sha256))
  )
    throw new Error('完整搜索投影封存证明不符。')
  const proofStarted = options.measurePhase ? performance.now() : 0
  const complete = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    complete.set(chunk, offset)
    offset += chunk.length
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', complete))
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  checkStreamCancelled(options.signal)
  if (sha256 !== proof.sha256) throw new Error('完整搜索投影长度或摘要不符。')
  options.measurePhase?.('projectionFinalProofMs', performance.now() - proofStarted)
  options.measurePhase?.('projectionPipelineWallMs', performance.now() - pipelineStarted)
  return collector.finish(root, { bytes: total, sha256 })
}
