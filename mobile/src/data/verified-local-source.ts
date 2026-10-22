import { readSource } from './local-source'
import { capacity } from './capacity'
import type { LocalStreamSource } from './local-source-stream'

type Proof = { bytes: number; sha256: string }
// Only this module can register a stream, after readSource verifies its complete
// private byte array. Caller-supplied objects/flags cannot claim a proved input.
const proofs = new WeakMap<AsyncIterable<Uint8Array>, Proof>()

/** @param source Native immutable local-file credential. @param signal Search cancellation.
 * @returns A single-use stream owning fully SHA-256-verified bytes; no writable buffer escapes before parsing.
 */
export async function readVerifiedLocalChunks(source: LocalStreamSource, signal?: AbortSignal) {
  const cancelled = () => {
    if (signal?.aborted) throw new Error('备份处理已取消，未发布数据。')
  }
  cancelled()
  const credential = { url: source.url, bytes: source.bytes, sha256: source.sha256 }
  const bytes = await readSource(credential)
  cancelled()
  const iterator = (async function* () {
    for (let at = 0; at < bytes.length; at += capacity.transferChunkBytes) {
      cancelled()
      yield bytes.subarray(at, at + capacity.transferChunkBytes)
    }
  })()
  const stream: AsyncIterable<Uint8Array> = Object.freeze({ [Symbol.asyncIterator]: () => iterator })
  proofs.set(stream, { bytes: bytes.length, sha256: credential.sha256 })
  return stream
}

/** @param source Exact private iterator returned by the verified read.
 * @returns Its single-use proof, or undefined for every ordinary/wrapped/untrusted stream.
 */
export function claimVerifiedLocalProof(source: AsyncIterable<Uint8Array>): Proof | undefined {
  const proof = proofs.get(source)
  proofs.delete(source)
  return proof
}
