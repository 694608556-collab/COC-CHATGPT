import { capacity } from './capacity'
import { checkStreamBudget, checkStreamCancelled } from './stream-json'
import { StreamSha256 } from './stream-sha256'
import type { StreamProof } from './backup-stream'

export interface LocalStreamSource extends StreamProof {
  url: string
  /** iOS WKURLSchemeHandler otherwise materializes the complete local file. */
  ranged?: boolean
}

/** Proven same-origin private/registered file only. No arrayBuffer fallback:
 * adapters without readable response bodies must reject this large-file path.
 * The caller must consume to EOF before treating staged output as validated.
 * maximumBytes is a trusted operation budget, never a write authorization.
 */
export async function* readLocalSourceStream(
  source: LocalStreamSource,
  options: { maximumBytes: number; attachment?: boolean; allowEmpty?: boolean; signal?: AbortSignal; nativeDigest?: boolean }
): AsyncGenerator<Uint8Array> {
  checkStreamBudget(options.maximumBytes)
  checkStreamCancelled(options.signal)
  const url = new URL(source.url)
  const current = new URL(location.href)
  if (
    url.protocol !== current.protocol ||
    url.hostname !== current.hostname ||
    url.port !== current.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(options.attachment ? '/_capacitor_content_/' : '/_capacitor_file_/')
  )
    throw new Error('只允许读取本应用的本地文件。')
  if (
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < (options.attachment || options.allowEmpty ? 0 : 1) ||
    source.bytes > options.maximumBytes ||
    !/^[0-9a-f]{64}$/.test(source.sha256)
  )
    throw new Error('本地文件长度或摘要证明无效。')
  const digest = new StreamSha256()
  // Resource-bounded SHA acceleration only; larger inputs retain complete
  // streaming SHA. Copies are private so consumers cannot mutate the proof.
  const nativeChunks: Uint8Array[] | undefined = options.nativeDigest && source.bytes <= 2 * 1024 * 1024 && globalThis.crypto?.subtle ? [] : undefined
  let offset = 0
  do {
    checkStreamCancelled(options.signal)
    if (source.ranged && source.bytes === 0) break
    const expected = source.ranged
      ? Math.min(capacity.transferChunkBytes, source.bytes - offset)
      : source.bytes
    const range = source.ranged ? { Range: `bytes=${offset}-${offset + expected - 1}` } : undefined
    const response = await fetch(url.href, {
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal,
      headers: range
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('此环境不支持分块读取本地文件，未尝试整库载入。')
    let complete = false,
      received = 0
    try {
      if (!response.ok) throw new Error('读取本地文件失败。')
      if (
        source.ranged &&
        (response.status !== 206 ||
          response.headers.get('content-range') !==
            `bytes ${offset}-${offset + expected - 1}/${source.bytes}`)
      )
        throw new Error('本机文件适配器未按有界片段读取，未尝试整库载入。')
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expected))
        throw new Error('本地文件声明长度已变化。')
      for (;;) {
        checkStreamCancelled(options.signal)
        const next = await reader.read()
        checkStreamCancelled(options.signal)
        if (next.done) break
        received += next.value.length
        if (received > expected) throw new Error('本地文件实际长度超过证明。')
        for (let start = 0; start < next.value.length; start += capacity.transferChunkBytes) {
          checkStreamCancelled(options.signal)
          const bytes = next.value.subarray(start, start + capacity.transferChunkBytes)
          if (nativeChunks) nativeChunks.push(bytes.slice())
          else digest.update(bytes)
          yield bytes
        }
      }
      if (received !== expected) throw new Error('本地文件完整长度或摘要已变化。')
      complete = true
      offset += received
    } finally {
      if (!complete) {
        try {
          await reader.cancel()
        } catch {
          /* Keep original validation/I/O failure. */
        }
      }
      reader.releaseLock()
    }
  } while (source.ranged && offset < source.bytes)
  let hash: string
  if (nativeChunks) {
    const bytes = new Uint8Array(offset)
    let at = 0
    for (const chunk of nativeChunks) { bytes.set(chunk, at); at += chunk.length }
    try {
      hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    } catch {
      for (const chunk of nativeChunks) digest.update(chunk)
      hash = digest.digest()
    }
  } else hash = digest.digest()
  checkStreamCancelled(options.signal)
  if (offset !== source.bytes || hash !== source.sha256)
    throw new Error('本地文件完整长度或摘要已变化。')
}
