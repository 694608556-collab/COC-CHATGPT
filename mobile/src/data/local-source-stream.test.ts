import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readLocalSourceStream } from './local-source-stream'

afterEach(() => vi.unstubAllGlobals())
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const bytes = new TextEncoder().encode('公开全文😀\n\0末尾'.repeat(40000))
const source = () => ({
  url: 'https://localhost/_capacitor_file_/public',
  bytes: bytes.length,
  sha256: sha(bytes)
})
const options = { maximumBytes: 4 * 1024 * 1024 }
async function consume(input: AsyncIterable<Uint8Array>) {
  const hash = createHash('sha256')
  let length = 0
  for await (const value of input) {
    expect(value.length).toBeLessThanOrEqual(256 * 1024)
    length += value.length
    hash.update(value)
  }
  return { bytes: length, sha256: hash.digest('hex') }
}
function mock(response: Response) {
  vi.stubGlobal('location', new URL('https://localhost/'))
  const fetch = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}
it('iOS自定义协议按协议/主机/端口校验，不把不同的null origin当作同源', async () => {
  const fetch = mock(new Response(bytes))
  vi.stubGlobal('location', new URL('capacitor://localhost/'))
  expect(
    await consume(
      readLocalSourceStream({ ...source(), url: 'capacitor://localhost/_capacitor_file_/public' }, options)
    )
  ).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
  fetch.mockClear()
  for (const url of [
    'other://localhost/_capacitor_file_/public',
    'capacitor://other/_capacitor_file_/public',
    'capacitor://localhost:123/_capacitor_file_/public',
    'capacitor://user:password@localhost/_capacitor_file_/public'
  ])
    await expect(consume(readLocalSourceStream({ ...source(), url }, options))).rejects.toThrow('本地文件')
  expect(fetch).not.toHaveBeenCalled()
})
it('iOS逐个256KiB Range核对完整证明，拒绝忽略Range及错误区间，不退回整份读取', async () => {
  vi.stubGlobal('location', new URL('https://localhost/'))
  let requests = 0
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const range = (options.headers as Record<string, string>).Range!
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number)
    expect(end! - start! + 1).toBeLessThanOrEqual(262144)
    requests++
    return new Response(bytes.slice(start!, end! + 1).buffer, {
      status: 206,
      headers: {
        'Content-Length': String(end! - start! + 1),
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`
      }
    })
  })
  vi.stubGlobal('fetch', fetch)
  expect(await consume(readLocalSourceStream({ ...source(), ranged: true }, options))).toEqual({
    bytes: bytes.length,
    sha256: sha(bytes)
  })
  expect(requests).toBe(Math.ceil(bytes.length / 262144))
  for (const response of [
    new Response(bytes),
    new Response(bytes.slice(0, 262144).buffer, {
      status: 206,
      headers: { 'Content-Range': `bytes 1-262144/${bytes.length}` }
    })
  ]) {
    mock(response)
    await expect(consume(readLocalSourceStream({ ...source(), ranged: true }, options))).rejects.toThrow(
      '片段'
    )
  }
})
it('本地完整分块长度/摘要一致，不调用整份arrayBuffer，附件允许空文件', async () => {
  const response = new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } })
  response.arrayBuffer = () => {
    throw new Error('whole-file allocation forbidden')
  }
  mock(response)
  expect(await consume(readLocalSourceStream(source(), options))).toEqual({
    bytes: bytes.length,
    sha256: sha(bytes)
  })
  mock(new Response(new Uint8Array()))
  expect(
    await consume(
      readLocalSourceStream(
        { url: 'https://localhost/_capacitor_content_/empty', bytes: 0, sha256: sha(new Uint8Array()) },
        { ...options, attachment: true }
      )
    )
  ).toEqual({ bytes: 0, sha256: sha(new Uint8Array()) })
})
it('远程/错误本地路径、无效证明和不可信预算在请求前拒绝', async () => {
  const fetch = mock(new Response(bytes))
  for (const input of [
    { ...source(), url: 'https://example.com/_capacitor_file_/public' },
    { ...source(), url: 'https://localhost/other' },
    { ...source(), bytes: -1 },
    { ...source(), sha256: 'bad' },
    { ...source(), bytes: options.maximumBytes + 1 }
  ])
    await expect(consume(readLocalSourceStream(input, options))).rejects.toThrow()
  await expect(consume(readLocalSourceStream(source(), { maximumBytes: Infinity }))).rejects.toThrow('预算')
  expect(fetch).not.toHaveBeenCalled()
})
it('声明/实际超长、截断、摘要变化和不支持流均拒绝', async () => {
  for (const response of [
    new Response(bytes, { headers: { 'content-length': '1' } }),
    new Response(bytes.subarray(0, bytes.length - 1)),
    new Response(new Uint8Array(bytes.length)),
    new Response(new Uint8Array(bytes.length + 1)),
    new Response(bytes, { status: 500 }),
    new Response(null)
  ]) {
    mock(response)
    await expect(consume(readLocalSourceStream(source(), options))).rejects.toThrow()
  }
})
it('背压、提前关闭、源异常和取消都终止读取，不产出完成证明', async () => {
  let cancelled = false
  mock(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
        },
        cancel() {
          cancelled = true
        }
      })
    )
  )
  const stream = readLocalSourceStream(source(), options)
  expect((await stream.next()).value?.length).toBe(256 * 1024)
  await stream.return(undefined)
  expect(cancelled).toBe(true)
  mock(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('read failed'))
        }
      })
    )
  )
  await expect(consume(readLocalSourceStream(source(), options))).rejects.toThrow('read failed')
  const controller = new AbortController()
  mock(new Response(bytes))
  const pending = readLocalSourceStream(source(), { ...options, signal: controller.signal })
  await pending.next()
  controller.abort()
  await expect(pending.next()).rejects.toThrow('取消')
})
