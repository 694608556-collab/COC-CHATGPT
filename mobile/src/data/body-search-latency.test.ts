import { createHook } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { searchBodyStream } from './body-search-stream'
import { exampleBackup } from './fixtures'
import { previewBackup } from './backup'

it.each([1, 38])('%i场公开模组正文搜索不应为每个JSON字段创建串行Promise', async (count) => {
  const snapshot = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const first = snapshot.records[0]!
  snapshot.records = Array.from({ length: count }, (_, record) => ({
    ...first,
    id: `public-search-${record}`,
    order: record,
    rawContent: {
      ...first.rawContent!,
      messages: Array.from({ length: 650 }, (_, message) => ({
        ...first.rawContent!.messages[0]!,
        id: `public-message-${message}`,
        order: message,
        text: 'PUBLIC_QUERY_NEEDLE ' + 'x'.repeat(370)
      }))
    }
  }))
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)),
    expectedSource = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  async function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += 65536) yield bytes.subarray(offset, offset + 65536)
  }
  let promises = 0
  const hook = createHook({
    init(_id, type) {
      if (type === 'PROMISE') promises++
    }
  })
  const started = performance.now()
  hook.enable()
  let result: Awaited<ReturnType<typeof searchBodyStream>>
  try {
    result = await searchBodyStream(chunks(), {
      expectedSource,
      ids: snapshot.records.map((row) => row.id),
      query: 'PUBLIC_QUERY_NEEDLE',
      preset: snapshot.settings.filterPreset
    })
  } finally {
    hook.disable()
  }
  expect(result.hits).toHaveLength(count)
  expect(result.hits.every((hit) => hit.matches === 650)).toBe(true)
  console.log(
    JSON.stringify({
      fixture: 'public-module-body-search',
      records: count,
      messages: count * 650,
      bytes: bytes.length,
      promises,
      hostMs: performance.now() - started,
      phoneMeasurement: false
    })
  )
  expect(promises, 'Body parsing must await bounded chunks rather than every JSON token').toBeLessThan(10000)
})
