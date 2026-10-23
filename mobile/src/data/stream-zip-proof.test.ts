import { expect, it } from 'vitest'
import { StreamCrc32 } from './stream-zip-proof'

function oracle(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
it('八字节CRC与独立逐位算法、标准向量、分段及非对齐视图完全一致', () => {
  const known = new StreamCrc32(); known.update(new TextEncoder().encode('123456789'))
  expect(known.value).toBe(0xcbf43926)
  const source = Uint8Array.from({ length: 16389 }, (_, index) => (index * 37 + (index >>> 3)) & 255)
  for (const offset of [0, 1, 3, 7]) for (const length of [0, 1, 7, 8, 9, 31, 16381]) {
    const bytes = source.subarray(offset, offset + length), whole = new StreamCrc32(), chunks = new StreamCrc32()
    whole.update(bytes)
    for (let at = 0; at < bytes.length; at += 13) chunks.update(bytes.subarray(at, at + 13))
    expect(whole.value).toBe(oracle(bytes)); expect(chunks.value).toBe(oracle(bytes))
  }
})
