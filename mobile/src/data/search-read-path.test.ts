import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { performBackupStreamJob } from './backup-stream-job'
import { exampleBackup } from './fixtures'
import { previewBackup } from './backup'
afterEach(() => vi.unstubAllGlobals())

it('资源预算允许时使用旧版快速读取，同时保留严格JSON和完整SHA校验；超预算继续分块搜索', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(exampleBackup()))
  const preset = (await previewBackup(bytes)).snapshot.settings.filterPreset
  vi.stubGlobal('location', new URL('https://localhost/'))
  let whole = 0,
    streamed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const response = new Response(bytes.slice().buffer)
      const getReader = response.body!.getReader.bind(response.body)
      response.arrayBuffer = async () => {
        whole++
        return bytes.slice().buffer
      }
      response.body!.getReader = ((...args: never[]) => {
        streamed++
        return getReader(...args)
      }) as typeof getReader
      return response
    })
  )
  const source = {
    url: 'https://localhost/_capacitor_file_/public',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  const job = { type: 'search' as const, source, ids: ['r1'], query: '离线', preset }
  const write = vi.fn(async () => {
    throw Error('Read-only search')
  })
  const fast = await performBackupStreamJob({ ...job, maximumReadBytes: bytes.length }, write)
  expect(whole).toBe(1)
  expect(streamed).toBe(0)
  const fallback = await performBackupStreamJob({ ...job, maximumReadBytes: bytes.length - 1 }, write)
  expect(whole).toBe(1)
  expect(streamed).toBeGreaterThan(0)
  expect(fast).toEqual(fallback)
  await expect(
    performBackupStreamJob(
      { ...job, maximumReadBytes: bytes.length, source: { ...source, sha256: '0'.repeat(64) } },
      write
    )
  ).rejects.toThrow('校验')
  expect(write).not.toHaveBeenCalled()
})

it.each(['"title":"one","title":"two",', '"title":"one","\\u0074itle":"two",'])(
  '快速读取仍拒绝正文内重复字段或转义别名：%s',
  async (injected) => {
    const seed = exampleBackup(),
      preset = (await previewBackup(new TextEncoder().encode(JSON.stringify(seed)))).snapshot.settings
        .filterPreset
    const original = JSON.stringify(seed)
    const changed = original.replace('"rawContent":{', '"rawContent":{' + injected)
    expect(changed).not.toBe(original)
    const bytes = new TextEncoder().encode(changed)
    vi.stubGlobal('location', new URL('https://localhost/'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes.slice().buffer))
    )
    const write = vi.fn(async () => {
      throw Error('Unexpected write')
    })
    await expect(
      performBackupStreamJob(
        {
          type: 'search',
          source: {
            url: 'https://localhost/_capacitor_file_/public',
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex')
          },
          maximumReadBytes: bytes.length,
          ids: ['r1'],
          query: '离线',
          preset
        },
        write
      )
    ).rejects.toThrow('重复')
    expect(write).not.toHaveBeenCalled()
  }
)
