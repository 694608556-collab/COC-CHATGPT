import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { searchBodyStream } from './body-search-stream'
import { previewBackup } from './backup'
import { exampleBackup } from './fixtures'

afterEach(() => vi.restoreAllMocks())

it('一次模组正文搜索复用匹配器，不为每条消息重新编译同一个用户查询', async () => {
  const data = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const row = data.records[0]!
  data.records = Array.from({ length: 3 }, (_, index) => ({
    ...row,
    id: `public-regex-${index}`,
    order: index,
    rawContent: {
      ...row.rawContent!,
      messages: Array.from({ length: 650 }, (_, message) => ({
        ...row.rawContent!.messages[0]!,
        id: `public-${message}`,
        order: message,
        text: 'PUBLIC_QUERY a+b😀 公共正文'
      }))
    }
  }))
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const patterns = vi.spyOn(globalThis, 'RegExp')
  const result = await searchBodyStream(
    (async function* () {
      for (let offset = 0; offset < bytes.length; offset += 65536)
        yield bytes.subarray(offset, offset + 65536)
    })(),
    {
      expectedSource: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      ids: data.records.map((r) => r.id),
      query: 'a+b😀',
      preset: data.settings.filterPreset
    }
  )
  expect(result.hits.map((hit) => hit.matches)).toEqual([650, 650, 650])
  expect(
    patterns.mock.calls.length,
    'Query compilation must be per submitted query, not per message'
  ).toBeLessThan(100)
})
