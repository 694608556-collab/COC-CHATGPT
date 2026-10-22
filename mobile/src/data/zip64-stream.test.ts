import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { readZipContainer, zip64Central, zip64End, Zip64Writer } from './zip64-stream'
import { capacity } from './capacity'
import { StreamSha256 } from './stream-sha256'

const maximumBytes = 64 * 1024 * 1024
const encoder = new TextEncoder()
function collector() {
  const parts: Uint8Array[] = []
  let block = new Uint8Array(capacity.transferChunkBytes),
    used = 0
  return {
    async sink(input: Uint8Array) {
      expect(input.length).toBeLessThanOrEqual(capacity.transferChunkBytes)
      for (let i = 0; i < input.length;) {
        const length = Math.min(input.length - i, block.length - used)
        block.set(input.subarray(i, i + length), used)
        used += length
        i += length
        if (used === block.length) {
          parts.push(block)
          block = new Uint8Array(block.length)
          used = 0
        }
      }
    },
    finish() {
      if (used) parts.push(block.slice(0, used))
      return parts
    }
  }
}
async function* chunks(parts: Uint8Array[], width = capacity.transferChunkBytes) {
  for (const part of parts) for (let i = 0; i < part.length; i += width) yield part.subarray(i, i + width)
}
const join = (parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

describe('ZIP64完整格式与真实资源范围', () => {
  it('超过32位的长度/偏移和65535项不会截断，超出精确计量范围明确失败', () => {
    const name = encoder.encode('正文.txt'),
      size = 0x100000000 + 123,
      offset = 0x200000000 + 7
    const central = zip64Central(name, size, 0x12345678, offset)
    const view = new DataView(central.buffer),
      at = 46 + name.length
    expect(view.getBigUint64(at + 4, true)).toBe(BigInt(size))
    expect(view.getBigUint64(at + 12, true)).toBe(BigInt(size))
    expect(view.getBigUint64(at + 20, true)).toBe(BigInt(offset))
    const end = new DataView(zip64End(65536, size, offset).buffer)
    expect(end.getBigUint64(32, true)).toBe(65536n)
    expect(end.getBigUint64(40, true)).toBe(BigInt(size))
    expect(end.getBigUint64(48, true)).toBe(BigInt(offset))
    expect(end.getBigUint64(64, true)).toBe(BigInt(size + offset))
    expect(() => zip64End(1, Number.MAX_SAFE_INTEGER, 1)).toThrow('精确')
  })

  it('正文内ZIP签名和跨分段描述符不被误认边界；旧解压器也能读取新格式', async () => {
    const body = encoder.encode('完整\0PK\u0003\u0004PK\u0007\bPK\u0001\u0002😀\r\n末尾')
    const output = collector(),
      writer = new Zip64Writer(output.sink, { maximumBytes })
    await writer.add('正文.txt', async (emit) => {
      for (const byte of body) await emit(Uint8Array.of(byte))
    })
    const proof = await writer.finish(),
      bytes = join(output.finish())
    expect(unzipSync(bytes)['正文.txt']).toEqual(body)
    const read: Uint8Array[] = []
    const result = await readZipContainer(
      () => chunks([bytes], 3),
      { maximumBytes, maximumExpandedBytes: maximumBytes, expectedSource: proof },
      async (entry) => {
        expect(entry.name).toBe('正文.txt')
        return {
          async push(part) {
            read.push(part.slice())
          },
          async end() {}
        }
      }
    )
    expect(join(read)).toEqual(body)
    expect(result.source).toEqual(proof)
    expect(result.expandedBytes).toBe(body.length)
    const view = new DataView(bytes.buffer)
    const descriptor = 30 + encoder.encode('正文.txt').length + 20 + body.length
    const central = descriptor + 24
    for (const position of [
      descriptor + 4,
      descriptor + 8,
      descriptor + 16,
      central + 42,
      bytes.length - 98 + 64
    ]) {
      const changed = bytes.slice()
      changed[position] = changed[position]! ^ 1
      await expect(
        readZipContainer(
          () => chunks([changed], 7),
          { maximumBytes, maximumExpandedBytes: maximumBytes },
          async () => ({ async push() {}, async end() {} })
        )
      ).rejects.toThrow('ZIP')
    }
    expect(view.getUint32(descriptor, true)).toBe(0x08074b50)
  })

  it('完整读写65536个成员及大于4MiB中央目录，末项和每个空文件均保留', async () => {
    const output = collector(),
      writer = new Zip64Writer(output.sink, { maximumBytes })
    const count = 65536
    for (let index = 0; index < count; index++)
      await writer.add(`file-${String(index).padStart(5, '0')}.txt`, async () => {})
    const proof = await writer.finish(),
      parts = output.finish()
    const last = parts.at(-1)!,
      end = new DataView(last.buffer, last.byteOffset + last.length - 98, 98)
    expect(end.getBigUint64(40, true)).toBeGreaterThan(4n * 1024n * 1024n)
    let visited = 0,
      finalName = ''
    const result = await readZipContainer(
      () => chunks(parts),
      { maximumBytes, maximumExpandedBytes: maximumBytes, expectedSource: proof },
      async (entry) => {
        visited++
        finalName = entry.name
        expect(entry.size).toBe(0)
        return {
          async push() {
            throw new Error('Empty entry must contain no data')
          },
          async end() {}
        }
      }
    )
    expect(visited).toBe(count)
    expect(finalName).toBe('file-65535.txt')
    expect(result).toEqual({ source: proof, expandedBytes: 0 })
  }, 60000)

  it('复读来源变化和暂存写入失败均拒绝；取消后关闭当前来源', async () => {
    const output = collector(),
      writer = new Zip64Writer(output.sink, { maximumBytes })
    await writer.add('body.txt', async (emit) => emit(encoder.encode('complete body')))
    await writer.finish()
    const bytes = join(output.finish())
    let pass = 0
    const changing = () => {
      const next = bytes.slice()
      if (pass++) next[65] = next[65]! ^ 1
      return chunks([next])
    }
    await expect(
      readZipContainer(changing, { maximumBytes, maximumExpandedBytes: maximumBytes }, async () => ({
        async push() {},
        async end() {}
      }))
    ).rejects.toThrow()
    let closed = 0
    const source = async function* () {
      try {
        yield* chunks([bytes], 13)
      } finally {
        closed++
      }
    }
    await expect(
      readZipContainer(source, { maximumBytes, maximumExpandedBytes: maximumBytes }, async () => ({
        async push() {
          throw new Error('disk full')
        },
        async end() {}
      }))
    ).rejects.toThrow('disk full')
    expect(closed).toBe(4)
    const digest = new StreamSha256()
    digest.update(bytes)
    expect(digest.bytes).toBe(bytes.length)
  })
})
