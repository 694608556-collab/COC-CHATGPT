import { afterEach, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { createVerifiedTableReplay, claimVerifiedTableProof } from './verified-table-source'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const bytes = new TextEncoder().encode('complete immutable public source 中文😀')
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes.slice())))
  return { bytes, source: { url: 'https://localhost/_capacitor_file_/public', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } }
}
it('只在完整EOF和摘要通过后注册证明；重放交出的副本不能改变下一次完整输入', async () => {
  const { bytes, source } = fixture()
  const replay = await createVerifiedTableReplay(source)
  const first = replay()
  expect(claimVerifiedTableProof(first)).toEqual({ bytes: source.bytes, sha256: source.sha256 })
  expect(claimVerifiedTableProof(first)).toBeUndefined()
  for await (const copy of first) copy.fill(0)
  const second = replay(), output: Uint8Array[] = []
  for await (const chunk of second) output.push(chunk)
  expect(Buffer.concat(output)).toEqual(Buffer.from(bytes))
  expect(fetch).toHaveBeenCalledOnce()
  const ordinary = { bytes: source.bytes, sha256: source.sha256, verified: true,
    async *[Symbol.asyncIterator]() { yield bytes } }
  expect(claimVerifiedTableProof(ordinary)).toBeUndefined()
  const wrapped = { [Symbol.asyncIterator]: () => replay()[Symbol.asyncIterator]() }
  expect(claimVerifiedTableProof(wrapped)).toBeUndefined()
})
it('错误摘要、截断来源与取消都不能生成可重放证明', async () => {
  const { source } = fixture()
  await expect(createVerifiedTableReplay({ ...source, sha256: '0'.repeat(64) })).rejects.toThrow(/摘要/)
  await expect(createVerifiedTableReplay({ ...source, bytes: source.bytes + 1 })).rejects.toThrow(/长度|摘要/)
  const controller = new AbortController(); controller.abort()
  await expect(createVerifiedTableReplay(source, controller.signal)).rejects.toThrow(/取消/)
})

it('系统SHA完整覆盖原始字节且只调用一次；错误摘要不产生证明', async () => {
  const { bytes, source } = fixture()
  const digest = vi.fn(async (algorithm, input) => {
    expect(algorithm).toBe('SHA-256')
    expect(Buffer.from(input)).toEqual(Buffer.from(bytes))
    return webcrypto.subtle.digest(algorithm, input)
  })
  vi.stubGlobal('crypto', { subtle: { digest } })
  await createVerifiedTableReplay(source)
  expect(digest).toHaveBeenCalledOnce()
  await expect(createVerifiedTableReplay({ ...source, sha256: '0'.repeat(64) })).rejects.toThrow(/摘要/)
})

it('系统SHA不可用时执行完整流式SHA回退；取消后的系统SHA结果不产生证明', async () => {
  const { source } = fixture()
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => { throw Error('Unavailable') }) } })
  await createVerifiedTableReplay(source)
  await expect(createVerifiedTableReplay({ ...source, sha256: '0'.repeat(64) })).rejects.toThrow(/摘要/)
  const controller = new AbortController()
  vi.stubGlobal('crypto', { subtle: { digest: async (algorithm: string, bytes: Uint8Array) => {
    controller.abort()
    return webcrypto.subtle.digest(algorithm, bytes)
  } } })
  await expect(createVerifiedTableReplay(source, controller.signal)).rejects.toThrow(/取消/)
})
