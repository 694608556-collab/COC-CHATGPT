import { Inflate } from 'fflate'
import * as XLSX from 'xlsx'
import { StreamSha256 } from './stream-sha256'
import { StreamCrc32 } from './stream-zip-proof'
import { addStreamBytes, checkStreamBudget, checkStreamCancelled, utf8Size } from './stream-json'
import { capacity } from './capacity'
import { claimVerifiedTableProof } from './verified-table-source'
import { cellAddress, checkedMergeRange, xstring, createWorksheetEvents, TextValue, safeInteger } from './table-worksheet'
import type { Coc7WorksheetProjection } from './table-dom-worksheet'

type Cell = string | number | boolean | null
export interface TableGridStreamOptions {
  name: string
  format: 'csv' | 'xlsx'
  source(): AsyncIterable<Uint8Array>
  expectedSource: { bytes: number; sha256: string }
  maximumExpandedBytes: number
  signal?: AbortSignal
  /** Validate merge ranges without collecting them when the consumer does not
   * use merged-cell layout (the fixed single-character template). */
  collectMergedRanges?: boolean
  /** Internal capability for the fixed character template only. */
  coc7Projection?: Coc7WorksheetProjection
  measurePhase?(name: string, milliseconds: number): void
  measureWork?(name: string, milliseconds: number): void
  /** Only controls emitted detail objects; every cell is still validated. */
  wantsCellDetails?(sheet: string): boolean
  /** Private append-only native index; also holds small ZIP directory proofs. */
  writeString(index: number, value: string): Promise<void> | void
  readString(index: number): Promise<string> | string
  /** XLSX callbacks follow ZIP order. Consumers must stage/sort by this workbook order. */
  onSheetStart(info: { name: string; order: number; mergedRanges?: string[] }): Promise<void> | void
  onRow(row: { index: number; values: Cell[] }): Promise<void> | void
  onCell?(cell: {
    address: string
    type?: string
    formula?: string
    hasFormula: boolean
    value?: Cell
  }): Promise<void> | void
  onSheetEnd(): Promise<void> | void
}

function bounded(value: string) {
  addStreamBytes(0, utf8Size(value))
  return value
}
function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
function uint64(data: DataView, offset: number) {
  const value = data.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP数值超出可精确处理的范围。')
  return Number(value)
}

/** Every pass checks the complete source, including passes interested in one part. */
async function* proved(options: TableGridStreamOptions) {
  const input = options.source()
  const proof = claimVerifiedTableProof(input)
  if (proof && (proof.bytes !== options.expectedSource.bytes || proof.sha256 !== options.expectedSource.sha256))
    throw new Error('表格来源完整证明不一致。')
  const hash = proof ? undefined : new StreamSha256()
  let bytes = 0
  for await (const chunk of input) {
    checkStreamCancelled(options.signal)
    if (!chunk.length) continue
    if (
      chunk.length > capacity.transferChunkBytes ||
      bytes + chunk.length > options.expectedSource.bytes
    )
      throw new Error('表格来源长度或分段已变化。')
    bytes += chunk.length
    hash?.update(chunk)
    yield chunk
  }
  if (bytes !== options.expectedSource.bytes || (hash && hash.digest() !== options.expectedSource.sha256))
    throw new Error('表格来源完整长度或SHA-256已变化。')
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
      if (!next) throw new Error('表格ZIP文件被截断。')
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
  async finish() {
    while (await this.piece(capacity.transferChunkBytes)) {
      /* prove suffix */
    }
  }
}

interface ZipEntry {
  name: string
  offset: number
  flags: number
  method: number
  crc: number
  size: number
  compressed: number
}
interface ZipIndex {
  order: Array<{ offset: number; index: number }>
  paths: Map<string, number>
  directory: number
  end: number
  nextString: number
  payloads: Map<string, { entry: string; parts: Uint8Array[] }>
  payloadBytes: number
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
    throw new Error('XLSX条目路径无效。')
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

async function directory(options: TableGridStreamOptions): Promise<ZipIndex> {
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
  if (end < 0) throw new Error('XLSX完整ZIP结束目录缺失。')
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true)) throw new Error('不支持分卷ZIP工作簿。')
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
    await source.skipTo(at)
    const header = view(await source.read(56)),
      recordSize = uint64(header, 4)
    if (
      header.getUint32(0, true) !== 0x06064b50 ||
      recordSize < 44 ||
      at + 12 + recordSize !== centralEnd - 20 ||
      header.getUint32(16, true) ||
      header.getUint32(20, true)
    )
      throw new Error('ZIP64结束目录无效。')
    count = uint64(header, 32)
    size = uint64(header, 40)
    offset = uint64(header, 48)
    if (uint64(header, 24) !== count) throw new Error('ZIP64条目数量不一致。')
    centralEnd = at
    await source.finish()
  }
  if (!count || offset + size !== centralEnd || offset < 0) throw new Error('ZIP中央目录位置无效。')
  const source = new Bytes(proved(options)),
    order: ZipIndex['order'] = [],
    paths = new Map<string, number>()
  await source.skipTo(offset)
  for (let index = 0; index < count; index++) {
    const header = view(await source.read(46))
    if (header.getUint32(0, true) !== 0x02014b50) throw new Error('ZIP中央目录不完整。')
    const flags = header.getUint16(8, true),
      method = header.getUint16(10, true)
    if (flags & (1 | 0x40 | 0x2000) || ![0, 8].includes(method))
      throw new Error('不支持加密或此压缩方式的工作簿。')
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
    if (size > options.maximumExpandedBytes) throw new Error('工作簿解压内容超过本次可用空间。')
    const entry: ZipEntry = {
      name,
      offset: local,
      flags,
      method,
      crc: header.getUint32(16, true),
      size,
      compressed
    }
    await options.writeString(index, JSON.stringify(entry))
    paths.set(name, index)
    order.push({ offset: local, index })
  }
  if (source.offset !== centralEnd) throw new Error('ZIP中央目录长度不一致。')
  await source.finish()
  order.sort((a, b) => a.offset - b.offset)
  if (
    order[0]?.offset !== 0 ||
    order.some((entry, index) => index > 0 && entry.offset === order[index - 1]!.offset)
  )
    throw new Error('ZIP本地条目重叠或含未知前缀。')
  return { order, paths, directory: offset, end: centralEnd, nextString: count, payloads: new Map(), payloadBytes: 0 }
}

type PartSink = { push(bytes: Uint8Array): Promise<void>; end(): Promise<void> }
/** Directory records live in the native index. Only small offsets/path metadata remain in RAM. */
async function walkZip(
  options: TableGridStreamOptions,
  zip: ZipIndex,
  select: (entry: ZipEntry) => Promise<PartSink | undefined>,
  verifyAll = false
) {
  const source = new Bytes(proved(options))
  let expanded = 0
  for (let order = 0; order < zip.order.length; order++) {
    checkStreamCancelled(options.signal)
    const entry = JSON.parse(await options.readString(zip.order[order]!.index)) as ZipEntry
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
    const previous = zip.payloads.get(entry.name)
    const cached = previous?.entry === JSON.stringify(entry) ? previous : undefined
    const capture: Uint8Array[] | undefined = !cached && entry.size <= 8 * 1024 * 1024 - zip.payloadBytes ? [] : undefined
    let produced = 0,
      pending: Uint8Array[] = [],
      pendingBytes = 0
    const inspect = !!sink || verifyAll
    const inflate =
      inspect && !cached && entry.method === 8
        ? new Inflate((bytes) => {
            pendingBytes += bytes.length
            if (pendingBytes > 8 * 1024 * 1024) throw new Error('ZIP单个解压窗口超过独立内存预算。')
            pending.push(bytes)
          })
        : undefined
    // fflate 0.8.2 discards its output capacity after each push and retains
    // only the DEFLATE history. Reuse bounded scratch capacity between pushes
    // instead of allocating/copying a growing buffer for every backreference.
    // Its normal resizable decoder, length/CRC and final-state checks remain.
    const inflateScratch = inflate ? new Uint8Array(256 * 1024) : undefined
    let remaining = entry.compressed
    while (remaining) {
      checkStreamCancelled(options.signal)
      const bytes = await source.read(Math.min(4096, remaining))
      remaining -= bytes.length
      if (!inspect || cached) continue
      if (inflate) {
        const started = options.measureWork ? performance.now() : 0
        const internal = inflate as unknown as { o: Uint8Array }
        inflateScratch!.set(internal.o)
        internal.o = inflateScratch!
        inflate.push(bytes, !remaining)
        options.measureWork?.('inflateCpu', performance.now() - started)
      }
      else pending.push(bytes)
      for (const output of pending) {
        produced += output.length
        expanded += output.length
        if (produced > entry.size || expanded > options.maximumExpandedBytes)
          throw new Error('工作簿实际解压内容超过来源或空间预算。')
        const crcStart = options.measureWork ? performance.now() : 0
        crc.update(output)
        options.measureWork?.('crcCpu', performance.now() - crcStart)
        capture?.push(output.slice())
        const sinkStart = options.measureWork ? performance.now() : 0
        for (let offset = 0; sink && offset < output.length; offset += capacity.transferChunkBytes)
          await sink.push(output.subarray(offset, offset + capacity.transferChunkBytes))
        if (sink) options.measureWork?.('xmlSink', performance.now() - sinkStart)
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
    if (inspect && cached) {
      // Private, complete CRC-validated payloads are reusable only for the
      // exact entry metadata of this one source. Each walk still proves the
      // entire original source and local headers/descriptors. Cache overflow
      // keeps the same complete decompression path, without an input limit.
      expanded = addStreamBytes(expanded, entry.size)
      if (expanded > options.maximumExpandedBytes) throw new Error('工作簿实际解压内容超过来源或空间预算。')
      const sinkStart = options.measureWork ? performance.now() : 0
      for (const output of cached.parts) if (sink) await sink.push(output.slice())
      if (sink) options.measureWork?.('xmlSink', performance.now() - sinkStart)
    }
    if (inspect && !cached && (produced !== entry.size || crc.value !== entry.crc))
      throw new Error('工作簿条目完整长度或CRC校验失败。')
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
    if (inspect && !cached && capture) {
      zip.payloads.set(entry.name, { entry: JSON.stringify(entry), parts: capture })
      zip.payloadBytes += entry.size
    }
    await sink?.end()
  }
  if (source.offset !== zip.directory) throw new Error('ZIP条目未完整覆盖目录前内容。')
  await source.finish()
}

function entities(text: string) {
  if (!text.includes('&')) return text
  return text.replace(/&([^;]*);/g, (_, token: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (Object.prototype.hasOwnProperty.call(named, token)) return named[token]!
    const match = /^#(x[0-9a-f]+|[0-9]+)$/i.exec(token)
    if (!match) throw new Error('工作簿XML实体无效。')
    const code = match[1]![0]!.toLowerCase() === 'x' ? parseInt(match[1]!.slice(1), 16) : Number(match[1])
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error('工作簿XML字符无效。')
    return String.fromCodePoint(code)
  })
}
const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1)
type XmlEvents = {
  start(name: string, attrs: Record<string, string>): Promise<void> | void
  text(value: string): Promise<void> | void
  end(name: string): Promise<void> | void
  /** Exact syntax specialization for an empty, styled numeric cell. */
  emptyNumericCell?(address: string): Promise<void> | void
}

/** Small SAX tokenizer: no DOM, no DTD/external entity expansion, one bounded token. */
class Xml implements PartSink {
  private decoder?: TextDecoder
  private prefix = new Uint8Array()
  private buffer = ''
  private stack: string[] = []
  private root = false
  private tags = new Map<string, { name: string; local: string; closing: boolean; self: boolean; attrs: Record<string, string> }>()
  constructor(private events: XmlEvents) {}
  async push(bytes: Uint8Array) {
    if (!this.decoder) {
      const combined = new Uint8Array(this.prefix.length + bytes.length)
      combined.set(this.prefix)
      combined.set(bytes, this.prefix.length)
      if (combined.length < 3) {
        this.prefix = combined
        return
      }
      const encoding =
        combined[0] === 0xff && combined[1] === 0xfe
          ? 'utf-16le'
          : combined[0] === 0xfe && combined[1] === 0xff
            ? 'utf-16be'
            : 'utf-8'
      this.decoder = new TextDecoder(encoding, { fatal: true })
      bytes = combined
      this.prefix = new Uint8Array()
    }
    this.buffer += this.decoder.decode(bytes, { stream: true })
    await this.process(false)
  }
  private async process(final: boolean) {
    for (;;) {
      if (!this.buffer) return
      if (this.stack.length && this.events.emptyNumericCell) {
        // This pattern accepts the complete tag, including its only two
        // distinct quoted attributes. Every other spelling uses the general
        // XML validator. The cell callback still checks coordinates/order and
        // emits the same null field; no worksheet content is skipped.
        const empty = /^(?:<c r="[A-Z]+[1-9]\d*"(?: s="\d+")?\/>)+/.exec(this.buffer)
        if (empty) {
          if (this.stack.length >= 256) throw new Error('工作簿XML嵌套深度超出独立处理预算。')
          const addresses = /r="([A-Z]+[1-9]\d*)"/g
          let address: RegExpExecArray | null
          while ((address = addresses.exec(empty[0]))) {
            const pending = this.events.emptyNumericCell(address[1]!)
            if (pending) await pending
          }
          this.buffer = this.buffer.slice(empty[0].length)
          continue
        }
        // Exact complete scalar cell syntax. All values still pass the SAME
        // coordinate, string-index, type, numeric and row validators. Other
        // attributes, entities, formulae and partial chunks use generic XML.
        const scalar = /^<c r="([A-Z]+[1-9]\d*)"(?: s="\d+")?(?: t="(s|str|n|b|e)")?><v>([^<&]*)<\/v><\/c>/.exec(this.buffer)
        if (scalar) {
          if (this.stack.length + 2 > 256) throw new Error('工作簿XML嵌套深度超出独立处理预算。')
          let pending = this.events.start('c', { r: scalar[1]!, ...(scalar[2] ? { t: scalar[2] } : {}) })
          if (pending) await pending
          pending = this.events.start('v', {})
          if (pending) await pending
          pending = this.events.text(scalar[3]!)
          if (pending) await pending
          pending = this.events.end('v')
          if (pending) await pending
          pending = this.events.end('c')
          if (pending) await pending
          this.buffer = this.buffer.slice(scalar[0].length)
          continue
        }
      }
      if (this.buffer[0] !== '<') {
        let end = this.buffer.indexOf('<')
        if (end < 0) {
          if (!final) {
            const amp = this.buffer.lastIndexOf('&')
            end = amp >= 0 && this.buffer.indexOf(';', amp) < 0 ? amp : this.buffer.length
          } else end = this.buffer.length
        }
        if (!end) {
          bounded(this.buffer)
          return
        }
        const raw = this.buffer.slice(0, end)
        if (/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-f]+);)/i.test(raw))
          throw new Error('工作簿XML实体不完整。')
        if (!this.stack.length && raw.trim()) throw new Error('工作簿XML根节点外包含内容。')
        const pending = this.events.text(entities(raw))
        if (pending) await pending
        this.buffer = this.buffer.slice(end)
        continue
      }
      const special = this.buffer.startsWith('<!--')
        ? ['-->', 4]
        : this.buffer.startsWith('<![CDATA[')
          ? [']]>', 9]
          : this.buffer.startsWith('<?')
            ? ['?>', 2]
            : undefined
      if (special) {
        const end = this.buffer.indexOf(special[0] as string)
        if (end < 0) {
          if (final) throw new Error('工作簿XML特殊节点截断。')
          bounded(this.buffer)
          return
        }
        if (special[1] === 9) {
          if (!this.stack.length) throw new Error('XML CDATA位置无效。')
          const pending = this.events.text(this.buffer.slice(9, end))
          if (pending) await pending
        }
        this.buffer = this.buffer.slice(end + (special[0] as string).length)
        continue
      }
      if (this.buffer.startsWith('<!')) {
        if (!final && this.buffer.length < 9) return
        throw new Error('不支持包含DTD或声明扩展的工作簿XML。')
      }
      const token = /^<((?:[^"'<>]|"[^"]*"|'[^']*')*)>/.exec(this.buffer)
      const known = token && this.tags.get(token[1]!)
      if (known) {
        this.buffer = this.buffer.slice(token![0].length)
        if (known.closing) {
          if (this.stack.pop() !== known.name) throw new Error('工作簿XML标签不匹配。')
          const pending = this.events.end(known.local)
          if (pending) await pending
        } else {
          if (!this.stack.length) {
            if (this.root) throw new Error('工作簿XML有多个根节点。')
            this.root = true
          }
          this.stack.push(known.name)
          if (this.stack.length > 256) throw new Error('工作簿XML嵌套深度超出独立处理预算。')
          const pending = this.events.start(known.local, known.attrs)
          if (pending) await pending
          if (known.self) {
            this.stack.pop()
            const pending = this.events.end(known.local)
            if (pending) await pending
          }
        }
        continue
      }
      let quote = '',
        end = token ? token[0].length - 1 : -1
      for (let i = 1; end < 0 && i < this.buffer.length; i++) {
        const char = this.buffer[i]!
        if (quote) {
          if (char === quote) quote = ''
        } else if (char === '"' || char === "'") quote = char
        else if (char === '>') {
          end = i
          break
        }
      }
      if (end < 0) {
        if (final) throw new Error('工作簿XML标签截断。')
        bounded(this.buffer)
        return
      }
      const tag = this.buffer.slice(1, end)
      this.buffer = this.buffer.slice(end + 1)
      const closing = tag.startsWith('/'),
        self = /\/\s*$/.test(tag)
      const match = /^\s*([\w:.-]+)/.exec(closing ? tag.slice(1) : tag)
      if (!match) throw new Error('工作簿XML标签无效。')
      const name = match[1]!,
        attrs: Record<string, string> = Object.create(null)
      if (closing) {
        if (tag.slice(1 + match[0].length).trim() || this.stack.pop() !== name)
          throw new Error('工作簿XML标签不匹配。')
        this.rememberTag(tag, { name, local: localName(name), closing, self, attrs })
        const pending = this.events.end(localName(name))
        if (pending) await pending
        continue
      }
      let rest = tag.slice(match[0].length).replace(/\/\s*$/, '')
      while (rest.trim()) {
        const attr = /^\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/.exec(rest)
        if (!attr || Object.prototype.hasOwnProperty.call(attrs, attr[1]!))
          throw new Error('工作簿XML属性重复或格式无效。')
        const raw = attr[2]!.slice(1, -1)
        if (raw.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-f]+);)/i.test(raw))
          throw new Error('工作簿XML属性实体无效。')
        attrs[attr[1]!] = entities(raw)
        rest = rest.slice(attr[0].length)
      }
      this.rememberTag(tag, { name, local: localName(name), closing, self, attrs: Object.freeze(attrs) })
      if (!this.stack.length) {
        if (this.root) throw new Error('工作簿XML有多个根节点。')
        this.root = true
      }
      this.stack.push(name)
      if (this.stack.length > 256) throw new Error('工作簿XML嵌套深度超出独立处理预算。')
      const pending = this.events.start(localName(name), attrs)
      if (pending) await pending
      if (self) {
        this.stack.pop()
        const pending = this.events.end(localName(name))
        if (pending) await pending
      }
    }
  }
  private rememberTag(tag: string, parsed: { name: string; local: string; closing: boolean; self: boolean; attrs: Record<string, string> }) {
    // Syntax-only cache scoped to one XML part. Exact byte spelling is the
    // key; nesting, cell semantics and callbacks always run on every token.
    if (tag.length > 256) return
    if (this.tags.size >= 256) this.tags.delete(this.tags.keys().next().value!)
    this.tags.set(tag, parsed)
  }
  async end() {
    if (!this.decoder) this.decoder = new TextDecoder('utf-8', { fatal: true })
    this.buffer += this.decoder.decode(this.prefix) + this.decoder.decode()
    await this.process(true)
    if (this.stack.length || !this.root) throw new Error('工作簿XML根节点不完整。')
  }
}

function resolvePart(parent: string, target: string) {
  if (
    target.includes('\\') ||
    target.includes('\0') ||
    /[?#]/.test(target) ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  )
    throw new Error('工作簿关系目标无效。')
  const parts = target.startsWith('/') ? [] : parent.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('工作簿关系路径越界。')
      parts.pop()
    } else parts.push(decodeURIComponent(part))
  }
  return parts.join('/')
}
function relPart(part: string) {
  const at = part.lastIndexOf('/')
  return part.slice(0, at + 1) + '_rels/' + part.slice(at + 1) + '.rels'
}
function relations(parent: string, result: Map<string, { target: string; type: string }>) {
  return new Xml({
    text() {},
    end() {},
    start(name, attrs) {
      if (name !== 'Relationship') return
      if (!attrs.Id || !attrs.Target || !attrs.Type || result.has(attrs.Id))
        throw new Error('工作簿关系缺失或重复。')
      if (attrs.TargetMode === 'External') return
      result.set(attrs.Id, { target: resolvePart(parent, attrs.Target), type: attrs.Type })
    }
  })
}
async function xlsx(options: TableGridStreamOptions) {
  let phaseStart = performance.now()
  const phase = (name: string) => { const now = performance.now(); options.measurePhase?.(name, now - phaseStart); phaseStart = now }
  const collectMerges = options.collectMergedRanges !== false
  const zip = await directory(options),
    rootRels = new Map<string, { target: string; type: string }>()
  phase('zipDirectory')
  if (!zip.paths.has('_rels/.rels')) throw new Error('XLSX工作簿根关系缺失。')
  await walkZip(options, zip, async (entry) =>
    entry.name === '_rels/.rels' ? relations('', rootRels) : undefined
  )
  phase('rootRelationships')
  const office = [...rootRels.values()].filter((rel) => rel.type.endsWith('/officeDocument'))
  if (office.length !== 1 || !zip.paths.has(office[0]!.target)) throw new Error('XLSX工作簿主体缺失或重复。')
  const workbook = office[0]!.target,
    sheetRefs: Array<{ name: string; id: string }> = [],
    rels = new Map<string, { target: string; type: string }>()
  await walkZip(options, zip, async (entry) => {
    if (entry.name === relPart(workbook)) return relations(workbook, rels)
    if (entry.name !== workbook) return
    return new Xml({
      text() {},
      end() {},
      start(name, attrs) {
        if (name !== 'sheet') return
        const id = attrs['r:id'] ?? Object.entries(attrs).find(([key]) => key.endsWith(':id'))?.[1]
        if (!attrs.name || !id) throw new Error('工作表名称或关系缺失。')
        sheetRefs.push({ name: attrs.name, id })
      }
    })
  })
  if (!sheetRefs.length) throw new Error('XLSX没有可读取的工作表。')
  phase('workbookRelationships')
  const sheets = new Map<string, { name: string; order: number; cells: boolean }>(),
    sheetNames = new Set<string>()
  sheetRefs.forEach((sheet, order) => {
    const rel = rels.get(sheet.id)
    if (
      !rel ||
      !['/worksheet', '/chartsheet', '/dialogsheet', '/xlMacrosheet', '/xlIntlMacrosheet'].some((type) =>
        rel.type.endsWith(type)
      ) ||
      !zip.paths.has(rel.target) ||
      sheets.has(rel.target) ||
      sheetNames.has(sheet.name)
    )
      throw new Error('工作表关系缺失、重复或格式不受支持。')
    sheets.set(rel.target, { name: sheet.name, order, cells: rel.type.endsWith('/worksheet') })
    sheetNames.add(sheet.name)
  })
  const ssts = [...rels.values()].filter((rel) => rel.type.endsWith('/sharedStrings'))
  if (ssts.length > 1 || (ssts.length && !zip.paths.has(ssts[0]!.target)))
    throw new Error('工作簿共享字符串来源缺失或重复。')
  let nextIndex = zip.nextString,
    sstBase = -1,
    strings = 0
  const merges = new Map<string, number>()
  let projectedStrings: string[] | undefined
  // Validate every ZIP payload once, even unused images/styles. No skipped-corruption success.
  await walkZip(
    options,
    zip,
    async (entry) => {
      if (sheets.has(entry.name) && collectMerges) {
        const ranges: string[] = []
        let bytes = 0
        const xml = new Xml({
          text() {},
          end() {},
          start(name, attrs) {
            if (name !== 'mergeCell') return
            const range = checkedMergeRange(attrs.ref)
            bytes = addStreamBytes(bytes, utf8Size(range))
            ranges.push(range)
          }
        })
        return {
          push: (bytes) => xml.push(bytes),
          async end() {
            await xml.end()
            merges.set(entry.name, nextIndex)
            await options.writeString(nextIndex++, JSON.stringify(ranges))
          }
        }
      }
      if (entry.name !== ssts[0]?.target) return
      sstBase = nextIndex
      let active = false,
        text = new TextValue(),
        insideText = 0,
        phonetic = 0
      return new Xml({
        start(name) {
          if (name === 'si') {
            if (active) throw new Error('共享字符串嵌套无效。')
            active = true
            text = new TextValue()
          }
          if (name === 'rPh') phonetic++
          if (name === 't') insideText++
        },
        text(value) {
          if (active && insideText && !phonetic) text.add(value)
        },
        end(name) {
          if (name === 't') insideText--
          if (name === 'rPh') phonetic--
          if (name === 'si') {
            const index = nextIndex++
            strings++
            active = false
            return options.writeString(index, xstring(text.value()))
          }
        }
      })
    },
    true
  )
  phase('completeZipPayloadsAndStrings')
  await walkZip(options, zip, async (entry) => {
    const sheet = sheets.get(entry.name)
    if (!sheet) return
    const mergeIndex = merges.get(entry.name)
    if (collectMerges && mergeIndex === undefined) throw new Error('工作表合并范围预检缺失。')
    await options.onSheetStart({
      name: sheet.name,
      order: sheet.order,
      mergedRanges: collectMerges ? JSON.parse(await options.readString(mergeIndex!)) as string[] : []
    })
    // Chart/dialog/macro sheets have no imported cell grid in the legacy
    // adapter. Validate their XML and ZIP payload without executing content.
    if (!sheet.cells) {
      const xml = new Xml({ start(name, attrs) { if (!collectMerges && name === 'mergeCell') checkedMergeRange(attrs.ref) }, text() {}, end() {} })
      return {
        push: (bytes) => xml.push(bytes),
        async end() {
          await xml.end()
          await options.onSheetEnd()
        }
      }
    }
    const xml = new Xml(createWorksheetEvents(options.wantsCellDetails?.(sheet.name) === false
      ? { ...options, onCell: undefined } : options, strings, sstBase, collectMerges))
    const projection = options.coc7Projection
    if (!collectMerges && projection?.canUse() && entry.size <= 512 * 1024 && strings <= 32768) {
      const parts: Uint8Array[] = []
      let received = 0
      return {
        async push(bytes) {
          received += bytes.length
          if (received > entry.size || received > 512 * 1024) throw new Error('工作表展开长度已变化。')
          parts.push(bytes.slice())
        },
        async end() {
          if (received !== entry.size) throw new Error('工作表未完整读取。')
          if (!projectedStrings) {
            projectedStrings = []
            for (let index = 0; index < strings; index++) projectedStrings.push(await options.readString(sstBase + index))
          }
          const bytes = new Uint8Array(received)
          let offset = 0
          for (const part of parts) { bytes.set(part, offset); offset += part.length }
          const cells = await projection.run({ bytes, name: sheet.name, strings: projectedStrings })
          checkStreamCancelled(options.signal)
          if (cells) {
            for (const cell of cells) await options.onCell?.(cell)
          } else {
            for (const part of parts) await xml.push(part)
            await xml.end()
          }
          await options.onSheetEnd()
        }
      }
    }
    return {
      push: (bytes) => xml.push(bytes),
      async end() {
        await xml.end()
        await options.onSheetEnd()
      }
    }
  })
  phase('completeWorksheetValidation')
}

function csvSeparator(sample: string) {
  const directive = /^sep=(.)\r?\n|^sep=(.)\r/.exec(sample)
  if (directive) return { separator: directive[1] ?? directive[2]!, prefix: directive[0].length }
  const weights: Record<string, number> = { ',': 3, '\t': 2, ';': 1, '|': 0 },
    counts: Record<string, number> = {}
  let quoted = false
  for (const char of sample.slice(0, 1024)) {
    if (char === '"') quoted = !quoted
    else if (!quoted && Object.prototype.hasOwnProperty.call(weights, char))
      counts[char] = (counts[char] ?? 0) + 1
  }
  const choices = Object.keys(counts).length ? counts : weights
  const ordered = Object.keys(choices).sort((a, b) => choices[a]! - choices[b]! || weights[a]! - weights[b]!)
  return {
    separator: ordered[ordered.length - 1] ?? ',',
    prefix: 0
  }
}
async function csv(options: TableGridStreamOptions) {
  const iterator = proved(options)[Symbol.asyncIterator]()
  let decoder: TextDecoder | undefined
  let sniff = new Uint8Array()
  function decode(bytes: Uint8Array, final = false) {
    if (!decoder) {
      const prefix = new Uint8Array(sniff.length + bytes.length)
      prefix.set(sniff)
      prefix.set(bytes, sniff.length)
      if (prefix.length < 2 && !final) {
        sniff = prefix
        return ''
      }
      decoder = new TextDecoder(
        prefix[0] === 0xff && prefix[1] === 0xfe
          ? 'utf-16le'
          : prefix[0] === 0xfe && prefix[1] === 0xff
            ? 'utf-16be'
            : 'utf-8',
        { fatal: true }
      )
      sniff = new Uint8Array()
      bytes = prefix
    }
    return decoder.decode(bytes, { stream: !final })
  }
  let prefix = '',
    ended = false
  while (prefix.length < 1024 && !ended) {
    const next = await iterator.next()
    ended = !!next.done
    prefix += decode(next.done ? new Uint8Array() : next.value, !!next.done)
  }
  prefix = prefix.replace(/^\uFEFF/, '')
  const { separator, prefix: skip } = csvSeparator(prefix)
  let line = '',
    quoted = false,
    quotePending = false,
    first = true,
    row = 0,
    pendingCR = false,
    rowBytes = 0
  await options.onSheetStart({ name: 'Sheet1', order: 0 })
  async function emit() {
    // A fixed textual header prevents one row beginning with "ID", "sep=" or
    // "<" from accidentally invoking SheetJS's file-format sniffing again.
    const workbook = XLSX.read('__COC_STREAM_ROW__\n' + line + '\n', {
      type: 'string',
      FS: separator,
      cellFormula: true,
      cellNF: false,
      cellStyles: false,
      dense: false
    })
    const sheet = workbook.Sheets[workbook.SheetNames[0]!]!,
      range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1'),
      values: Cell[] = []
    for (let column = 0; column <= range.e.c; column++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: 1, c: column })]
      const value = cell?.v
      values.push(
        value == null
          ? null
          : ['string', 'number', 'boolean'].includes(typeof value)
            ? (value as Cell)
            : String(cell.w ?? value)
      )
      if (cell && options.onCell)
        await options.onCell({
          address: XLSX.utils.encode_cell({ r: row, c: column }),
          type: cell.t,
          ...(cell.f ? { formula: cell.f } : {}),
          hasFormula: !!cell.f,
          ...(value == null ? {} : { value: values[values.length - 1]! })
        })
    }
    await options.onRow({ index: row++, values })
    line = ''
    first = true
    rowBytes = 0
  }
  async function consumeCharacter(value: string) {
    checkStreamCancelled(options.signal)
    rowBytes = addStreamBytes(rowBytes, utf8Size(value))
    if (quotePending) {
      quotePending = false
      if (value === '"') {
        line += value
        return
      }
      quoted = false
    }
    if (quoted) {
      line += value
      if (value === '"') quotePending = true
    } else if (value === '\n' || value === '\r') {
      await emit()
      return
    } else {
      if (value === '"' && first) quoted = true
      line += value
      first = value === separator
    }
  }
  async function consume(text: string) {
    // Scan syntax characters only. Appending one character at a time would
    // create millions of rope nodes for an otherwise bounded manual-text cell.
    const syntax = new RegExp('["\\r\\n' + separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']', 'g')
    let position = 0
    async function plain(value: string) {
      if (!value) return
      checkStreamCancelled(options.signal)
      if (pendingCR) {
        pendingCR = false
        await consumeCharacter('\r')
      }
      if (quotePending) {
        quotePending = false
        quoted = false
      }
      rowBytes = addStreamBytes(rowBytes, utf8Size(value))
      line += value
      first = false
    }
    for (let match = syntax.exec(text); match; match = syntax.exec(text)) {
      await plain(text.slice(position, match.index))
      const char = match[0]
      position = match.index + char.length
      if (pendingCR) {
        pendingCR = false
        await consumeCharacter(char === '\n' ? '\n' : '\r')
        if (char === '\n') continue
      }
      if (char === '\r') pendingCR = true
      else await consumeCharacter(char)
    }
    await plain(text.slice(position))
  }
  await consume(prefix.slice(skip))
  while (!ended) {
    const next = await iterator.next()
    ended = !!next.done
    await consume(decode(next.done ? new Uint8Array() : next.value, !!next.done))
  }
  if (pendingCR) await consumeCharacter('\r')
  if (quoted && !quotePending) throw new Error('CSV引号内的字段未结束。')
  if (line.length) await emit()
  await options.onSheetEnd()
}

/** No file, row, field or sheet-count quota. Source proofs and actual operation resources remain enforced. */
export async function readTableGridStream(options: TableGridStreamOptions): Promise<void> {
  checkStreamBudget(options.expectedSource.bytes)
  checkStreamBudget(options.maximumExpandedBytes)
  if (!/^[a-f0-9]{64}$/.test(options.expectedSource.sha256)) throw new Error('表格来源摘要无效。')
  checkStreamCancelled(options.signal)
  if (options.format === 'csv') {
    if (options.expectedSource.bytes > options.maximumExpandedBytes)
      throw new Error('CSV文件超过本次可用处理空间。')
    await csv(options)
  } else if (options.format === 'xlsx') await xlsx(options)
  else throw new Error('此流式读取器只支持CSV和XLSX；旧XLS需使用兼容适配器。')
}
