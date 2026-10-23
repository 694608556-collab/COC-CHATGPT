import { readBackupJsonStream } from './backup-stream'
import { compileBodyQuery, recordMessages } from './search'
import type { FilterPreset, SessionRecord } from '../../../src/shared/types'
import type { SearchMessageText } from './search-projection-messages'
import type { NativeBackupFile } from './backup-stream-native'
import type { StreamProof } from './backup-stream'
import { beginBodySearchCache } from './body-search-cache'
import { readSearchProjection } from './search-projection'
import type { LocalStreamSource } from './local-source-stream'
import { readSearchProjectionParts, type SearchProjectionParts } from './search-projection-parts'
import { checkStreamCancelled } from './stream-json'

export interface BodySearchHit {
  id: string
  matches: number
  excerpt: string
}
export class BodySearchCleanupError extends Error {}
export interface BodySearchResult {
  query: string
  hits: BodySearchHit[]
  revision: number
  presetKey: string
}
export interface NativeSearchSource {
  id: string
  revision: number
  source: NativeBackupFile
  /** Disposable cache budget only; larger inputs continue through the disk path. */
  cacheMemoryBytes?: number
  /** Native fast-read budget, never a content-size limit. */
  maximumReadBytes?: number
  /** Native original-grammar attestation, available only on a sealed search lease. */
  searchProjectionVersion?: 1 | 2 | 3
  originalSource?: StreamProof
  /** Native event stream admission; the client binds each part to this lease. */
  searchStream?: { nonce: string; chunks: number }
}
/** Shared search behavior, independent of whole-file or sealed-part transport. */
export interface BodySearchOptions {
  ids: string[]
  query: string
  preset: FilterPreset
  signal?: AbortSignal
  cache?: { generation: string; signature: string; maximumMemoryBytes?: number }
  /** Optional complete phase timing, never a change to result or validation. */
  measure?: boolean
}

/** Input proofs are required for whole files; parts receive their proof only at seal. */
export type BodySearchReadOptions = BodySearchOptions &
  (
    | {
        expectedSource: StreamProof
        nativeProjection?: LocalStreamSource & { version: 1 | 2 | 3 }
        nativeProjectionParts?: never
      }
    | { expectedSource?: never; nativeProjection?: never; nativeProjectionParts: SearchProjectionParts }
  )

/** Search a native parts lease with the same matcher, staging and final cache gate.
 * @param input Complete immutable fragment stream admitted by the main client.
 * @param options Original selection, filters, cancellation and disposable cache settings.
 * @returns Complete hits only after every source and graph proof succeeds.
 */
export function searchBodyParts(input: SearchProjectionParts, options: BodySearchOptions) {
  return searchBodyStream((async function* () {})(), { ...options, nativeProjectionParts: input })
}

/** Search complete bodies through the strict reader or an admitted native projection.
 * @param source Original whole-file stream, unused only for native projections.
 * @param options Required transport proof plus original search settings.
 * @returns Fully validated hits and whether a disposable cache was published.
 */
export async function searchBodyStream(source: AsyncIterable<Uint8Array>, options: BodySearchReadOptions) {
  const wanted = new Set(options.ids),
    seen = new Set<string>(),
    hits: BodySearchHit[] = []
  const query = options.query.trim()
  if (!query || query.length > 4096 || wanted.size !== options.ids.length)
    throw new Error('正文搜索范围或查询无效。')
  const matcher = compileBodyQuery(query)
  const timing: Record<string, number> = {}
  const measurePhase = options.measure
    ? (name: string, milliseconds: number) => {
        timing[name] = (timing[name] ?? 0) + milliseconds
      }
    : undefined
  const cache = options.cache
    ? await beginBodySearchCache(
        options.cache.generation,
        options.cache.signature,
        options.cache.maximumMemoryBytes
      )
    : undefined
  try {
    /** Stage complete search text under the same selection, cache and match rules.
     * @param record Validated metadata, with full bodies only on the generic path.
     * @param projected Complete rendered text from a native-validated read-only projection.
     * @returns Resolves after staging; publication still waits for the full source graph.
     */
    const stageRecord = async (record: SessionRecord, projected?: SearchMessageText[]) => {
      if (!wanted.has(record.id) || seen.has(record.id)) throw new Error('正文搜索来源场次不符。')
      seen.add(record.id)
      let matches = 0,
        excerpt = ''
      const projectionStarted = options.measure ? performance.now() : 0
      const messages = projected ?? recordMessages(record, options.preset)
      measurePhase?.('projectionBuildMs', performance.now() - projectionStarted)
      const cacheStarted = options.measure ? performance.now() : 0
      await cache?.append(record.id, seen.size - 1, messages)
      measurePhase?.('projectionCacheMs', performance.now() - cacheStarted)
      const matchStarted = options.measure ? performance.now() : 0
      for (const message of messages) {
        const count = matcher.countMessage(message.header, message.text)
        if (count && !matches) excerpt = matcher.excerpt(message.header + '\n' + message.text)
        matches += count
      }
      if (matches) {
        const hit = { id: record.id, matches, excerpt }
        hits.push(hit)
      }
      measurePhase?.('matchMs', performance.now() - matchStarted)
    }
    const read = options.nativeProjectionParts
      ? (settings: Parameters<typeof readBackupJsonStream>[1]) =>
          readSearchProjectionParts(options.nativeProjectionParts!, {
            ...settings,
            preset: options.preset,
            stageProjection: stageRecord
          })
      : options.nativeProjection
        ? (settings: Parameters<typeof readBackupJsonStream>[1]) =>
            readSearchProjection(options.nativeProjection!, {
              ...settings,
              searchProjectionVersion: options.nativeProjection!.version,
              preset: options.preset,
              stageProjection: stageRecord
            })
        : (settings: Parameters<typeof readBackupJsonStream>[1]) => readBackupJsonStream(source, settings)
    const preview = await read({
      maximumBytes: options.nativeProjectionParts?.maximumReadBytes ?? options.expectedSource!.bytes,
      expectedSource: options.expectedSource,
      signal: options.signal,
      measurePhase,
      stageRecord: (record) => stageRecord(record)
    })
    if (seen.size !== wanted.size || preview.metadata.records.length !== wanted.size)
      throw new Error('正文搜索场次未取齐。')
    checkStreamCancelled(options.signal)
    const cacheReady = (await cache?.commit()) ?? false
    return {
      query,
      hits,
      source: preview.source,
      records: seen.size,
      cacheReady,
      ...(options.measure ? { timing } : {})
    }
  } finally {
    cache?.close()
  }
}
