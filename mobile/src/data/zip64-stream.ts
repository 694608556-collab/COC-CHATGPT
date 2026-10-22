import { Inflate } from 'fflate'
import { capacity } from './capacity'
import { StreamSha256 } from './stream-sha256'
import { StreamCrc32 } from './stream-zip-proof'
import { addStreamBytes, checkStreamBudget, checkStreamCancelled } from './stream-json'
import type { StreamProof, StreamWriteOptions } from './backup-stream'

export type ReopenableZipSource = AsyncIterable<Uint8Array> | (() => AsyncIterable<Uint8Array>)
interface ZipReadContext {
  source(): AsyncIterable<Uint8Array>
  maximumBytes: number
  maximumExpandedBytes: number
  signal?: AbortSignal
  proof?: StreamProof
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
function uint64(data: DataView, offset: number) {
  const value = data.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP数值超出可精确处理的范围。')
  return Number(value)
}

/** Every pass verifies all source bytes, including passes interested only in metadata. */
async function* proved(options: ZipReadContext) {
  const hash = new StreamSha256()
  for await (const chunk of options.source()) {
    checkStreamCancelled(options.signal)
    if (
      chunk.length > capacity.transferChunkBytes ||
      addStreamBytes(hash.bytes, chunk.length) > options.maximumBytes
    )
      throw new Error('ZIP来源分段或长度超过本次空间预算。')
    hash.update(chunk)
    yield chunk
  }
  const proof = { bytes: hash.bytes, sha256: hash.digest() }
  if (options.proof && (proof.bytes !== options.proof.bytes || proof.sha256 !== options.proof.sha256))
    throw new Error('ZIP来源完整长度或SHA-256摘要已变化。')
  options.proof = proof
}

class Bytes {
  private iterator: AsyncIterator<Uint8Array>
  private chunk: Uint8Array = new Uint8Array()
  private used = 0
  offset = 0
  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]()
  }
  async piece(maximum: number): Promise<Uint8Array | undefined> {
    while (this.used === this.chunk.length) {
      const next = await this.iterator.next()
      if (next.done) return
      this.chunk = next.value
      this.used = 0
    }
    const count = Math.min(maximum, this.chunk.length - this.used)
    const result = this.chunk.subarray(this.used, this.used + count)
    this.used += count
    this.offset += count
    return result
  }
  async read(length: number) {
    const result = new Uint8Array(length)
    let used = 0
    while (used < length) {
      const next = await this.piece(length - used)
      if (!next) throw new Error('ZIP文件被截断。')
      result.set(next, used)
      used += next.length
    }
    return result
  }
  async skipTo(offset: number) {
    if (offset < this.offset) throw new Error('ZIP条目位置倒退或重叠。')
    while (this.offset < offset)
      if (!(await this.piece(Math.min(capacity.transferChunkBytes, offset - this.offset))))
        throw new Error('ZIP条目位置超出文件。')
  }
  async close() {
    await this.iterator.return?.()
  }
  async finish() {
    while (await this.piece(capacity.transferChunkBytes)) {
      /* prove suffix */
    }
  }
}

export interface ZipEntry {
  name: string
  offset: number
  flags: number
  method: number
  crc: number
  size: number
  compressed: number
}
interface ZipIndex {
  order: ZipEntry[]
  paths: Map<string, number>
  directory: number
  end: number
}
const cp437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
function zipName(raw: Uint8Array, flags: number) {
  const name =
    flags & 0x800
      ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
      : Array.from(raw, (byte) => (byte < 128 ? String.fromCharCode(byte) : cp437[byte - 128])).join('')
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((x) => x === '..' || x === '.')
  )
    throw new Error('ZIP条目路径无效。')
  return name
}
function zip64(extra: Uint8Array, needed: boolean[]) {
  const data = view(extra)
  for (let offset = 0; offset < extra.length;) {
    if (offset + 4 > extra.length) throw new Error('ZIP扩展字段截断。')
    const tag = data.getUint16(offset, true),
      length = data.getUint16(offset + 2, true)
    offset += 4
    if (offset + length > extra.length) throw new Error('ZIP扩展字段越界。')
    if (tag === 1) {
      let cursor = offset
      return needed.map((yes, index) => {
        if (!yes) return undefined
        const width = index === 3 ? 4 : 8
        if (cursor + width > offset + length) throw new Error('ZIP64扩展字段缺失。')
        const value = width === 8 ? uint64(data, cursor) : data.getUint32(cursor, true)
        cursor += width
        return value
      })
    }
    offset += length
  }
  if (needed.some(Boolean)) throw new Error('ZIP64大小或偏移缺失。')
  return []
}

async function directory(options: ZipReadContext): Promise<ZipIndex> {
  const tail = new Uint8Array(65557 + 20)
  let received = 0
  for await (const chunk of proved(options)) {
    if (chunk.length >= tail.length) tail.set(chunk.subarray(chunk.length - tail.length))
    else {
      tail.copyWithin(0, chunk.length)
      tail.set(chunk, tail.length - chunk.length)
    }
    received += chunk.length
  }
  const start = Math.max(0, tail.length - received),
    data = view(tail)
  let end = -1
  for (let at = tail.length - 22; at >= start; at--)
    if (data.getUint32(at, true) === 0x06054b50 && at + 22 + data.getUint16(at + 20, true) === tail.length) {
      end = at
      break
    }
  if (end < 0) throw new Error('ZIP完整结束目录缺失。')
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true)) throw new Error('不支持分卷ZIP。')
  let count = data.getUint16(end + 10, true),
    size = data.getUint32(end + 12, true),
    offset = data.getUint32(end + 16, true)
  let centralEnd = received - tail.length + end
  if (data.getUint16(end + 8, true) !== count) throw new Error('ZIP目录条目数量不一致。')
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    if (
      end - 20 < start ||
      data.getUint32(end - 20, true) !== 0x07064b50 ||
      data.getUint32(end - 16, true) ||
      data.getUint32(end - 4, true) !== 1
    )
      throw new Error('ZIP64结束定位信息无效。')
    const at = uint64(data, end - 12),
      source = new Bytes(proved(options))
    try {
      await source.skipTo(at)
      const header = view(await source.read(56)),
        recordSize = uint64(header, 4)
      if (
        header.getUint32(0, true) !== 0x06064b50 ||
        recordSize < 44 ||
        addStreamBytes(addStreamBytes(at, 12), recordSize) !== centralEnd - 20 ||
        header.getUint32(16, true) ||
        header.getUint32(20, true)
      )
        throw new Error('ZIP64结束目录无效。')
      const wideCount = uint64(header, 32),
        wideSize = uint64(header, 40),
        wideOffset = uint64(header, 48)
      if (
        (count !== 0xffff && count !== wideCount) ||
        (size !== 0xffffffff && size !== wideSize) ||
        (offset !== 0xffffffff && offset !== wideOffset)
      )
        throw new Error('ZIP32与ZIP64目录字段不一致。')
      count = wideCount
      size = wideSize
      offset = wideOffset
      if (uint64(header, 24) !== count) throw new Error('ZIP64条目数量不一致。')
      centralEnd = at
      await source.finish()
    } finally {
      await source.close()
    }
  }
  if (!count || addStreamBytes(offset, size) !== centralEnd || offset < 0)
    throw new Error('ZIP中央目录位置无效。')
  const source = new Bytes(proved(options)),
    order: ZipIndex['order'] = [],
    paths = new Map<string, number>()
  try {
    await source.skipTo(offset)
    for (let index = 0; index < count; index++) {
      const header = view(await source.read(46))
      if (header.getUint32(0, true) !== 0x02014b50) throw new Error('ZIP中央目录不完整。')
      const flags = header.getUint16(8, true),
        method = header.getUint16(10, true)
      if (flags & (1 | 0x40 | 0x2000) || ![0, 8].includes(method))
        throw new Error('不支持加密或此压缩方式的ZIP。')
      const name = zipName(await source.read(header.getUint16(28, true)), flags)
      const extra = await source.read(header.getUint16(30, true))
      await source.read(header.getUint16(32, true))
      let size = header.getUint32(24, true),
        compressed = header.getUint32(20, true),
        local = header.getUint32(42, true),
        disk = header.getUint16(34, true)
      const wide = zip64(extra, [
        size === 0xffffffff,
        compressed === 0xffffffff,
        local === 0xffffffff,
        disk === 0xffff
      ])
      size = wide[0] ?? size
      compressed = wide[1] ?? compressed
      local = wide[2] ?? local
      disk = wide[3] ?? disk
      if (disk || local >= offset || paths.has(name)) throw new Error('ZIP条目重复、位置或磁盘无效。')
      if (size > options.maximumExpandedBytes) throw new Error('ZIP解压内容超过本次可用空间。')
      const entry: ZipEntry = {
        name,
        offset: local,
        flags,
        method,
        crc: header.getUint32(16, true),
        size,
        compressed
      }
      // Directory metadata uses actual available RAM, never a fixed byte or entry quota.
      paths.set(name, index)
      order.push(entry)
    }
    if (source.offset !== centralEnd) throw new Error('ZIP中央目录长度不一致。')
    await source.finish()
    order.sort((a, b) => a.offset - b.offset)
    if (
      order[0]?.offset !== 0 ||
      order.some((entry, index) => index > 0 && entry.offset === order[index - 1]!.offset)
    )
      throw new Error('ZIP本地条目重叠或含未知前缀。')
    return { order, paths, directory: offset, end: centralEnd }
  } finally {
    await source.close()
  }
}

type PartSink = { push(bytes: Uint8Array): Promise<void>; end(): Promise<void> }
/** Only directory metadata remains in RAM; complete entry contents are streamed. */
async function walkZip(
  options: ZipReadContext,
  zip: ZipIndex,
  select: (entry: ZipEntry) => Promise<PartSink | undefined>,
  verifyAll = false
) {
  const source = new Bytes(proved(options))
  let expanded = 0
  try {
    for (let order = 0; order < zip.order.length; order++) {
      checkStreamCancelled(options.signal)
      const entry = zip.order[order]!
      await source.skipTo(entry.offset)
      const header = view(await source.read(30))
      if (
        header.getUint32(0, true) !== 0x04034b50 ||
        header.getUint16(6, true) !== entry.flags ||
        header.getUint16(8, true) !== entry.method
      )
        throw new Error('ZIP本地条目头与目录不一致。')
      const name = zipName(await source.read(header.getUint16(26, true)), entry.flags)
      const extra = await source.read(header.getUint16(28, true))
      if (name !== entry.name) throw new Error('ZIP本地条目名称不一致。')
      let size = header.getUint32(22, true),
        compressed = header.getUint32(18, true)
      const wide = zip64(extra, [size === 0xffffffff, compressed === 0xffffffff, false, false])
      size = wide[0] ?? size
      compressed = wide[1] ?? compressed
      if (
        !(entry.flags & 8) &&
        (size !== entry.size || compressed !== entry.compressed || header.getUint32(14, true) !== entry.crc)
      )
        throw new Error('ZIP本地条目长度或CRC不一致。')
      const boundary = zip.order[order + 1]?.offset ?? zip.directory
      const descriptor = boundary - source.offset - entry.compressed
      if (entry.flags & 8 ? ![12, 16, 20, 24].includes(descriptor) : descriptor !== 0)
        throw new Error('ZIP条目压缩边界或描述符无效。')
      const sink = await select(entry),
        crc = new StreamCrc32()
      let produced = 0,
        pending: Uint8Array[] = [],
        pendingBytes = 0
      const inspect = !!sink || verifyAll
      const inflate =
        inspect && entry.method === 8
          ? new Inflate((bytes) => {
              pendingBytes += bytes.length
              if (pendingBytes > 8 * 1024 * 1024) throw new Error('ZIP单个解压窗口超过独立内存预算。')
              pending.push(bytes)
            })
          : undefined
      let remaining = entry.compressed
      while (remaining) {
        checkStreamCancelled(options.signal)
        const bytes = await source.read(Math.min(4096, remaining))
        remaining -= bytes.length
        if (!inspect) continue
        if (inflate) inflate.push(bytes, !remaining)
        else pending.push(bytes)
        for (const output of pending) {
          produced = addStreamBytes(produced, output.length)
          expanded = addStreamBytes(expanded, output.length)
          if (produced > entry.size || expanded > options.maximumExpandedBytes)
            throw new Error('ZIP实际解压内容超过来源或空间预算。')
          crc.update(output)
          for (let offset = 0; sink && offset < output.length; offset += capacity.transferChunkBytes)
            await sink.push(output.subarray(offset, offset + capacity.transferChunkBytes))
        }
        pending = []
        pendingBytes = 0
      }
      if (inflate) {
        // fflate 0.8.2 otherwise permits trailing bytes after a raw DEFLATE stream.
        // Its pinned incremental state exposes the final-block bit and unconsumed
        // input. Reject both truncation and an extra hidden compressed suffix.
        const state = inflate as unknown as { s: { f?: number; l?: unknown; p: number }; p: Uint8Array }
        if (!state.s.f || state.s.l || state.p.length !== Math.ceil(state.s.p / 8))
          throw new Error('ZIP压缩流未完整结束或包含额外数据。')
      }
      if (inspect && (produced !== entry.size || crc.value !== entry.crc))
        throw new Error('ZIP条目完整长度或CRC校验失败。')
      if (entry.name.endsWith('/') && entry.size) throw new Error('ZIP目录条目包含数据。')
      if (descriptor) {
        const proof = view(await source.read(descriptor)),
          signed = descriptor === 16 || descriptor === 24,
          at = signed ? 4 : 0,
          wide = descriptor >= 20
        if (
          (signed && proof.getUint32(0, true) !== 0x08074b50) ||
          proof.getUint32(at, true) !== entry.crc ||
          (wide ? uint64(proof, at + 4) : proof.getUint32(at + 4, true)) !== entry.compressed ||
          (wide ? uint64(proof, at + 12) : proof.getUint32(at + 8, true)) !== entry.size
        )
          throw new Error('ZIP数据描述符与目录不一致。')
      }
      await sink?.end()
    }
    if (source.offset !== zip.directory) throw new Error('ZIP条目未完整覆盖目录前内容。')
    await source.finish()
    return expanded
  } finally {
    await source.close()
  }
}

/** Production uses a reopenable native file lease. Single-use compatibility
 * callers retain their input in RAM; this path is not used for native backups. */
export async function readZipContainer(
  source: ReopenableZipSource,
  options: {
    maximumBytes: number
    maximumExpandedBytes: number
    expectedSource?: StreamProof
    signal?: AbortSignal
  },
  select: (entry: ZipEntry) => Promise<PartSink>
) {
  checkStreamBudget(options.maximumBytes)
  checkStreamBudget(options.maximumExpandedBytes)
  let open: () => AsyncIterable<Uint8Array>
  if (typeof source === 'function') open = source
  else {
    const parts: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of source) {
      checkStreamCancelled(options.signal)
      bytes = addStreamBytes(bytes, chunk.length)
      if (chunk.length > capacity.transferChunkBytes || bytes > options.maximumBytes)
        throw new Error('ZIP输入分段或长度超过本次空间预算。')
      parts.push(chunk.slice())
    }
    open = async function* () {
      yield* parts
    }
  }
  const context: ZipReadContext = { ...options, source: open, proof: options.expectedSource }
  const index = await directory(context)
  const expandedBytes = await walkZip(context, index, select, true)
  return { source: context.proof!, expandedBytes }
}

const encoder = new TextEncoder()
function binary(length: number) {
  const bytes = new Uint8Array(length)
  return { bytes, data: view(bytes) }
}
function put64(data: DataView, offset: number, value: number) {
  addStreamBytes(0, value)
  data.setBigUint64(offset, BigInt(value), true)
}
/** Header helpers expose ZIP64 counters for deterministic >4GiB boundary tests. */
export function zip64End(count: number, size: number, offset: number): Uint8Array {
  const { bytes, data } = binary(98)
  data.setUint32(0, 0x06064b50, true)
  put64(data, 4, 44)
  data.setUint16(12, 45, true)
  data.setUint16(14, 45, true)
  put64(data, 24, count)
  put64(data, 32, count)
  put64(data, 40, size)
  put64(data, 48, offset)
  data.setUint32(56, 0x07064b50, true)
  put64(data, 64, addStreamBytes(offset, size))
  data.setUint32(72, 1, true)
  data.setUint32(76, 0x06054b50, true)
  data.setUint16(84, 0xffff, true)
  data.setUint16(86, 0xffff, true)
  data.setUint32(88, 0xffffffff, true)
  data.setUint32(92, 0xffffffff, true)
  return bytes
}
export function zip64Central(name: Uint8Array, size: number, crc: number, offset: number) {
  if (name.length > 0xffff) throw new Error('ZIP文件名无法按格式编码。')
  const { bytes, data } = binary(46 + name.length + 28)
  data.setUint32(0, 0x02014b50, true)
  data.setUint16(4, 45, true)
  data.setUint16(6, 45, true)
  data.setUint16(8, 0x808, true)
  data.setUint16(14, 0x21, true)
  data.setUint32(16, crc, true)
  data.setUint32(20, 0xffffffff, true)
  data.setUint32(24, 0xffffffff, true)
  data.setUint16(28, name.length, true)
  data.setUint16(30, 28, true)
  data.setUint32(42, 0xffffffff, true)
  bytes.set(name, 46)
  const at = 46 + name.length
  data.setUint16(at, 1, true)
  data.setUint16(at + 2, 24, true)
  put64(data, at + 4, size)
  put64(data, at + 12, size)
  put64(data, at + 20, offset)
  return bytes
}

/** Stored ZIP64 with independent byte/CRC proofs. One bounded sink write is
 * acknowledged before the next. No 32-bit length/count truncation. */
export class Zip64Writer {
  private digest = new StreamSha256()
  private entries: Array<{ name: Uint8Array; size: number; crc: number; offset: number }> = []
  private names = new Set<string>()
  private ended = false
  constructor(
    private sink: (bytes: Uint8Array) => Promise<void>,
    private options: StreamWriteOptions
  ) {
    checkStreamBudget(options.maximumBytes)
  }
  private async emit(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i += capacity.transferChunkBytes) {
      checkStreamCancelled(this.options.signal)
      const part = bytes.subarray(i, i + capacity.transferChunkBytes)
      if (addStreamBytes(this.digest.bytes, part.length) > this.options.maximumBytes)
        throw new Error('ZIP备份超过本次可用空间。')
      await this.sink(part)
      this.digest.update(part)
    }
  }
  async add(name: string, produce: (emit: (bytes: Uint8Array) => Promise<void>) => Promise<unknown>) {
    if (this.ended || this.names.has(name)) throw new Error('ZIP条目已结束或名称重复。')
    this.names.add(name)
    const encoded = encoder.encode(name)
    zipName(encoded, 0x800)
    if (encoded.length > 0xffff) throw new Error('ZIP文件名无法按格式编码。')
    const offset = this.digest.bytes
    const { bytes, data } = binary(30 + encoded.length + 20)
    data.setUint32(0, 0x04034b50, true)
    data.setUint16(4, 45, true)
    data.setUint16(6, 0x808, true)
    data.setUint16(12, 0x21, true)
    data.setUint32(18, 0xffffffff, true)
    data.setUint32(22, 0xffffffff, true)
    data.setUint16(26, encoded.length, true)
    data.setUint16(28, 20, true)
    bytes.set(encoded, 30)
    data.setUint16(30 + encoded.length, 1, true)
    data.setUint16(32 + encoded.length, 16, true)
    await this.emit(bytes)
    const crc = new StreamCrc32()
    let size = 0
    await produce(async (chunk) => {
      size = addStreamBytes(size, chunk.length)
      crc.update(chunk)
      await this.emit(chunk)
    })
    const descriptor = binary(24)
    descriptor.data.setUint32(0, 0x08074b50, true)
    descriptor.data.setUint32(4, crc.value, true)
    put64(descriptor.data, 8, size)
    put64(descriptor.data, 16, size)
    await this.emit(descriptor.bytes)
    this.entries.push({ name: encoded, size, crc: crc.value, offset })
  }
  async finish(): Promise<StreamProof> {
    if (this.ended) throw new Error('ZIP输出已经结束。')
    this.ended = true
    const start = this.digest.bytes
    for (const entry of this.entries)
      await this.emit(zip64Central(entry.name, entry.size, entry.crc, entry.offset))
    await this.emit(zip64End(this.entries.length, this.digest.bytes - start, start))
    return { bytes: this.digest.bytes, sha256: this.digest.digest() }
  }
}
