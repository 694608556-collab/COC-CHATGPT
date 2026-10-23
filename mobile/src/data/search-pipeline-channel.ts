import type { StreamProof } from './backup-stream'
import type { SearchProjectionPart, SearchProjectionParts } from './search-projection-parts'

/** Credentials only; no body bytes or native write capabilities cross this queue. */
export type SearchPipelineMessage =
  | { type: 'search-part'; nonce: string; part: SearchProjectionPart }
  | { type: 'search-seal'; nonce: string; proof: StreamProof & { chunks: number } }
  | { type: 'search-abort'; nonce: string; error: string }

/** Join the native event stream with its final sealed-source promise.
 * @param nonce Operation identity; late messages from another job are rejected.
 * @param maximumReadBytes Runtime fast-read memory budget, never a content quota.
 * @param signal Optional consumer cancellation.
 * @returns A reader input and a credential-only message sink; all failures abort the whole reader.
 */
export function createSearchPipelineChannel(nonce: string, maximumReadBytes: number, signal?: AbortSignal) {
  const queue: SearchProjectionPart[] = []
  let ended = false,
    failure: Error | undefined,
    total = 0
  let wake: (() => void) | undefined
  let resolveProof!: (proof: StreamProof & { chunks: number }) => void
  let rejectProof!: (error: Error) => void
  const sealed = new Promise<StreamProof & { chunks: number }>((resolve, reject) => {
    resolveProof = resolve
    rejectProof = reject
  })
  // The consumer may still be validating earlier pieces when native fails.
  void sealed.catch(() => undefined)
  const abort = (reason: Error) => {
    failure = reason
    ended = true
    queue.length = 0
    rejectProof(reason)
    wake?.()
  }
  const cancel = () => abort(new Error('搜索已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const input: SearchProjectionParts = {
    maximumReadBytes,
    sealed,
    parts: (async function* () {
      try {
        for (;;) {
          if (failure) throw failure
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          if (ended) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = undefined
        }
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    })()
  }
  return {
    input,
    /** @param message Same-operation credential or seal. @returns No value; invalid order poisons the reader. */
    push(message: SearchPipelineMessage): void {
      if (failure) return
      if (message.nonce !== nonce || ended) {
        abort(new Error('搜索分片操作身份或结束状态不符。'))
        return
      }
      if (message.type === 'search-abort') {
        abort(new Error(message.error))
        return
      }
      if (message.type === 'search-seal') {
        ended = true
        resolveProof(message.proof)
        wake?.()
        return
      }
      const bytes = message.part?.source?.bytes
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximumReadBytes - total) {
        abort(new Error('搜索分片超出本轮快路驻留预算。'))
        return
      }
      total += bytes
      queue.push(message.part)
      wake?.()
    },
    /** @returns No value; releases waiters without publishing a partial cache or result. */
    close(): void {
      signal?.removeEventListener('abort', cancel)
      abort(new Error('搜索分片通道已关闭。'))
    }
  }
}
