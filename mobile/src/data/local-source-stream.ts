import { capacity } from './capacity'
import { checkStreamBudget, checkStreamCancelled } from './stream-json'
import { StreamSha256 } from './stream-sha256'
import type { StreamProof } from './backup-stream'

export interface LocalStreamSource extends StreamProof {
  url: string
}

/** Proven same-origin private/registered file only. No arrayBuffer fallback:
 * adapters without readable response bodies must reject this large-file path.
 * The caller must consume to EOF before treating staged output as validated.
 * maximumBytes is a trusted operation budget, never a write authorization.
 */
export async function* readLocalSourceStream(
  source: LocalStreamSource,
  options: { maximumBytes: number; attachment?: boolean; signal?: AbortSignal }
): AsyncGenerator<Uint8Array> {
  checkStreamBudget(options.maximumBytes)
  checkStreamCancelled(options.signal)
  const url = new URL(source.url)
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith(options.attachment ? '/_capacitor_content_/' : '/_capacitor_file_/')
  )
    throw new Error('只允许读取本应用的本地文件。')
  if (
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < (options.attachment ? 0 : 1) ||
    source.bytes > options.maximumBytes ||
    !/^[0-9a-f]{64}$/.test(source.sha256)
  )
    throw new Error('本地文件长度或摘要证明无效。')
  const response = await fetch(url.href, { cache: 'no-store', redirect: 'error', signal: options.signal })
  const reader = response.body?.getReader()
  if (!reader) throw new Error('此环境不支持分块读取本地文件，未尝试整库载入。')
  const digest = new StreamSha256()
  let complete = false
  try {
    if (!response.ok) throw new Error('读取本地文件失败。')
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== source.bytes))
      throw new Error('本地文件声明长度已变化。')
    for (;;) {
      checkStreamCancelled(options.signal)
      const next = await reader.read()
      checkStreamCancelled(options.signal)
      if (next.done) break
      if (digest.bytes + next.value.length > source.bytes) throw new Error('本地文件实际长度超过证明。')
      for (let offset = 0; offset < next.value.length; offset += capacity.transferChunkBytes) {
        checkStreamCancelled(options.signal)
        const bytes = next.value.subarray(offset, offset + capacity.transferChunkBytes)
        digest.update(bytes)
        yield bytes
      }
    }
    if (digest.bytes !== source.bytes || digest.digest() !== source.sha256)
      throw new Error('本地文件完整长度或摘要已变化。')
    complete = true
  } finally {
    if (!complete) {
      try {
        await reader.cancel()
      } catch {
        /* Preserve the original validation/I/O error. */
      }
    }
    reader.releaseLock()
  }
}
