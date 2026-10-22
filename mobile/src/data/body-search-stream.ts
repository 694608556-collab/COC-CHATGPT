import { readBackupJsonStream } from './backup-stream'
import { compileBodyQuery, recordMessages } from './search'
import type { FilterPreset } from '../../../src/shared/types'
import type { NativeBackupFile } from './backup-stream-native'
import type { StreamProof } from './backup-stream'
import { beginBodySearchCache } from './body-search-cache'

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
}
export async function searchBodyStream(
  source: AsyncIterable<Uint8Array>,
  options: {
    expectedSource: StreamProof
    ids: string[]
    query: string
    preset: FilterPreset
    signal?: AbortSignal
    cache?: { generation: string; signature: string; maximumMemoryBytes?: number }
  }
) {
  const wanted = new Set(options.ids),
    seen = new Set<string>(),
    hits: BodySearchHit[] = []
  const query = options.query.trim()
  if (!query || query.length > 4096 || wanted.size !== options.ids.length)
    throw new Error('正文搜索范围或查询无效。')
  const matcher = compileBodyQuery(query)
  const cache = options.cache
    ? await beginBodySearchCache(
        options.cache.generation,
        options.cache.signature,
        options.cache.maximumMemoryBytes
      )
    : undefined
  try {
    const preview = await readBackupJsonStream(source, {
      maximumBytes: options.expectedSource.bytes,
      expectedSource: options.expectedSource,
      signal: options.signal,
      stageRecord: async (record) => {
        if (!wanted.has(record.id) || seen.has(record.id)) throw new Error('正文搜索来源场次不符。')
        seen.add(record.id)
        let matches = 0,
          excerpt = ''
        const messages = recordMessages(record, options.preset)
        await cache?.append(record.id, seen.size - 1, messages)
        for (const message of messages) {
          const text = message.header + '\n' + message.text,
            count = matcher.count(text)
          if (count && !matches) excerpt = matcher.excerpt(text)
          matches += count
        }
        if (matches) {
          const hit = { id: record.id, matches, excerpt }
          hits.push(hit)
        }
      }
    })
    if (seen.size !== wanted.size || preview.metadata.records.length !== wanted.size)
      throw new Error('正文搜索场次未取齐。')
    const cacheReady = (await cache?.commit()) ?? false
    return { query, hits, source: preview.source, records: seen.size, cacheReady }
  } finally {
    cache?.close()
  }
}
