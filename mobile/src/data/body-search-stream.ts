import { readBackupJsonStream } from './backup-stream'
import { countMatches, recordMessages, searchExcerpt } from './search'
import { utf8Size } from './stream-json'
import { capacity } from './capacity'
import type { FilterPreset } from '../../../src/shared/types'
import type { NativeBackupFile } from './backup-stream-native'
import type { StreamProof } from './backup-stream'

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
}
export async function searchBodyStream(
  source: AsyncIterable<Uint8Array>,
  options: {
    expectedSource: StreamProof
    ids: string[]
    query: string
    preset: FilterPreset
    signal?: AbortSignal
  }
) {
  const wanted = new Set(options.ids),
    seen = new Set<string>(),
    hits: BodySearchHit[] = []
  const query = options.query.trim()
  if (!query || query.length > 4096 || wanted.size !== options.ids.length)
    throw new Error('正文搜索范围或查询无效。')
  let resultBytes = 0
  const preview = await readBackupJsonStream(source, {
    maximumBytes: options.expectedSource.bytes,
    expectedSource: options.expectedSource,
    signal: options.signal,
    stageRecord: async (record) => {
      if (!wanted.has(record.id) || seen.has(record.id)) throw new Error('正文搜索来源场次不符。')
      seen.add(record.id)
      let matches = 0,
        excerpt = ''
      for (const message of recordMessages(record, options.preset)) {
        const text = message.header + '\n' + message.text,
          count = countMatches(text, query)
        if (count && !matches) excerpt = searchExcerpt(text, query)
        matches += count
      }
      if (matches) {
        const hit = { id: record.id, matches, excerpt }
        resultBytes += utf8Size(JSON.stringify(hit)) + 1
        if (resultBytes > capacity.snapshotRequestBytes)
          throw new Error('搜索结果摘要超过独立处理预算，请缩小查询范围。')
        hits.push(hit)
      }
    }
  })
  if (seen.size !== wanted.size || preview.metadata.records.length !== wanted.size)
    throw new Error('正文搜索场次未取齐。')
  return { query, hits, source: preview.source, records: seen.size }
}
