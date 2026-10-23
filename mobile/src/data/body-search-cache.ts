import { StreamSha256 } from './stream-sha256'
import { checkStreamCancelled } from './stream-json'
import { compileBodyQuery } from './search'
import type { BodySearchHit } from './body-search-stream'
import { encodeUtf8 } from './bytes'

type Message = { header: string; text: string }
const storeName = 'projection'

/** @returns A private disposable cache connection, or undefined when cache storage is unavailable. */
async function open(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return
  return new Promise((resolve) => {
    let settled = false
    const request = indexedDB.open('coc-private-body-search-cache-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => {
      if (settled) request.result.close()
      else {
        settled = true
        resolve(request.result)
      }
    }
    request.onerror = request.onblocked = () => {
      settled = true
      resolve(undefined)
    }
  })
}

/** @param database Private cache only. @param key Projection/manifest key. @returns Stored value; no business database access. */
function read<T>(database: IDBDatabase, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

/** @param text One record's projection. @returns Complete SHA-256; never retains the complete module in memory. */
async function hash(text: string): Promise<string> {
  const bytes = encodeUtf8(text)
  if (crypto.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
  }
  const digest = new StreamSha256()
  digest.update(bytes)
  return digest.digest()
}

interface Manifest {
  generation: string
  signature: string
  ready: boolean
}
interface Projection {
  id: string
  json: string
  sha256: string
}
type MemoryRow = { id: string; messages: Message[] }
let memory: { generation: string; signature: string; rows: MemoryRow[] } | undefined

/** @param generation Unpublished operation token. @param signature Exact selected IDs and filter preset.
 * @returns Disposable per-record writer. Storage failures disable reuse, never reject a valid search.
 */
export async function beginBodySearchCache(generation: string, signature: string, maximumMemoryBytes = 0) {
  memory = undefined
  let rows: MemoryRow[] | undefined =
    Number.isSafeInteger(maximumMemoryBytes) && maximumMemoryBytes > 0 ? [] : undefined
  let memoryBytes = 0
  let database: IDBDatabase | undefined
  let initialized = false,
    enabled = true
  async function update(action: (store: IDBObjectStore) => void, initialize = false) {
    if (!enabled || !database) return
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database!.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
        if (initialize) {
          store.clear()
          action(store)
        } else {
          const request = store.get('manifest')
          request.onsuccess = () => {
            if ((request.result as Manifest | undefined)?.generation === generation) action(store)
            else enabled = false
          }
        }
      })
    } catch {
      enabled = false
    }
  }
  async function disk(id: string, index: number, messages: readonly Message[]) {
    if (!enabled) return
    if (!initialized) {
      initialized = true
      try {
        database = await open()
      } catch {
        /* Optional cache only. */
      }
      enabled = !!database
      await update(
        (store) => store.put({ generation, signature, ready: false } satisfies Manifest, 'manifest'),
        true
      )
    }
    if (!enabled) return
    const json = JSON.stringify(messages.map(({ header, text }) => ({ header, text })))
    const sha256 = await hash(json)
    await update((store) => store.put({ id, json, sha256 } satisfies Projection, index))
  }
  return {
    /** @param id Validated record identity. @param index Source order. @param messages Filtered complete messages.
     * @returns Private cache staging only; the manifest remains unusable until full source validation succeeds.
     */
    async append(id: string, index: number, messages: readonly Message[]) {
      try {
        if (rows) {
          let estimate = 128
          for (const message of messages) estimate += 128 + 2 * (message.header.length + message.text.length)
          if (estimate <= maximumMemoryBytes - memoryBytes) {
            memoryBytes += estimate
            rows.push({ id, messages: messages.map(({ header, text }) => ({ header, text })) })
            return
          }
          const staged = rows
          rows = undefined
          for (let at = 0; at < staged.length; at++) await disk(staged[at]!.id, at, staged[at]!.messages)
        }
        await disk(id, index, messages)
      } catch {
        enabled = false
        rows = undefined
      }
    },
    /** @returns Publishes only the disposable cache manifest after complete source proof/graph checks. */
    async commit() {
      if (rows) {
        memory = { generation, signature, rows }
        rows = undefined
        return true
      }
      await update((store) =>
        store.put({ generation, signature, ready: true } satisfies Manifest, 'manifest')
      )
      return enabled
    },
    /** @returns Releases the cache connection; incomplete stages remain ineligible and are replaced next time. */
    close() {
      database?.close()
    }
  }
}

/** @param generation Client-admitted successful source token. @param ids Exact native record selection.
 * @param signature Exact selection/filter context. @param query Submitted literal text. @param signal Cancellation.
 * @returns Fully checked cached hits, or null to require a new native read. Only one record is loaded at a time.
 */
export async function searchBodyCache(
  generation: string,
  ids: string[],
  signature: string,
  query: string,
  signal?: AbortSignal
): Promise<BodySearchHit[] | null> {
  let database: IDBDatabase | undefined
  try {
    if (memory?.generation === generation && memory.signature === signature) {
      if (memory.rows.length !== ids.length) return null
      const matcher = compileBodyQuery(query),
        hits: BodySearchHit[] = []
      for (let index = 0; index < ids.length; index++) {
        checkStreamCancelled(signal)
        const row = memory.rows[index]!
        if (row.id !== ids[index]) return null
        let matches = 0,
          excerpt = ''
        for (const message of row.messages) {
          const count = matcher.countMessage(message.header, message.text)
          if (count && !matches) excerpt = matcher.excerpt(message.header + '\n' + message.text)
          matches += count
        }
        if (matches) hits.push({ id: row.id, matches, excerpt })
      }
      return hits
    }
    database = await open()
    if (!database) return null
    const manifest = await read<Manifest>(database, 'manifest')
    if (!manifest?.ready || manifest.generation !== generation || manifest.signature !== signature)
      return null
    const matcher = compileBodyQuery(query),
      hits: BodySearchHit[] = []
    for (let index = 0; index < ids.length; index++) {
      checkStreamCancelled(signal)
      const row = await read<Projection>(database, index)
      if (
        !row ||
        row.id !== ids[index] ||
        typeof row.json !== 'string' ||
        (await hash(row.json)) !== row.sha256
      )
        return null
      const messages: unknown = JSON.parse(row.json)
      if (!Array.isArray(messages)) return null
      let matches = 0,
        excerpt = ''
      for (const message of messages) {
        if (
          !message ||
          typeof message.header !== 'string' ||
          typeof message.text !== 'string' ||
          Object.keys(message).length !== 2
        )
          return null
        const count = matcher.countMessage(message.header, message.text)
        if (count && !matches) excerpt = matcher.excerpt(message.header + '\n' + message.text)
        matches += count
      }
      if (matches) hits.push({ id: row.id, matches, excerpt })
    }
    checkStreamCancelled(signal)
    return hits
  } catch {
    checkStreamCancelled(signal)
    return null
  } finally {
    database?.close()
  }
}
