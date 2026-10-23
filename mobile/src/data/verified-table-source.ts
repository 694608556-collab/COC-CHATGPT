import { readLocalSourceStream } from './local-source-stream'
import type { LocalStreamSource } from './local-source-stream'
import { checkStreamCancelled } from './stream-json'

type Proof = { bytes: number; sha256: string }
const proofs = new WeakMap<AsyncIterable<Uint8Array>, Proof>()

/** Own a complete validated private file. Every replay yields copies: callers
 * cannot change the bytes whose proof is registered by this module alone.
 * The caller chooses this memory cache only within its resource budget;
 * larger files keep the complete streaming path, with no content quota.
 */
export async function createVerifiedTableReplay(source: LocalStreamSource, signal?: AbortSignal) {
  const credential = { ...source }
  const chunks: Uint8Array[] = []
  for await (const chunk of readLocalSourceStream(credential, { maximumBytes: credential.bytes, signal, nativeDigest: true }))
    chunks.push(chunk.slice())
  checkStreamCancelled(signal)
  return (): AsyncIterable<Uint8Array> => {
    const iterator = (async function* () {
      for (const chunk of chunks) {
        checkStreamCancelled(signal)
        yield chunk.slice()
      }
    })()
    const stream = Object.freeze({ [Symbol.asyncIterator]: () => iterator })
    proofs.set(stream, { bytes: credential.bytes, sha256: credential.sha256 })
    return stream
  }
}

/** Single-use evidence; ordinary or wrapped streams cannot claim it. */
export function claimVerifiedTableProof(stream: AsyncIterable<Uint8Array>): Proof | undefined {
  const proof = proofs.get(stream)
  proofs.delete(stream)
  return proof
}
