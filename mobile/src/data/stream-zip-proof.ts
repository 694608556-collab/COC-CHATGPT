// fflate's streaming unzip does not validate the complete central directory or
// entry CRC. Verify both independently before a native staging lease is ready.
const table = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  table[i] = c
}
export class StreamCrc32 {
  private state = 0xffffffff
  update(bytes: Uint8Array) {
    let c = this.state
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 255]! ^ (c >>> 8)
    this.state = c
  }
  get value() {
    return (this.state ^ 0xffffffff) >>> 0
  }
}

/** Bounded ring retains only directory metadata and the legal ZIP comment tail.
 * ZIP64/multi-volume archives require a separate adapter; never silently read
 * only a prefix of an unsupported container. This is a format/metadata budget,
 * independent of the future total-library storage policy.
 */
export class ZipTail {
  private ring = new Uint8Array(4 * 1024 * 1024 + 65557)
  private offset = 0
  private bytes = 0
  private local = new Map<
    string,
    {
      offset: number
      flags: number
      method: number
      crc: number
      compressed: number
      size: number
      header: number
      before: Uint8Array
    }
  >()
  push(input: Uint8Array) {
    for (let i = 0; i < input.length;) {
      const length = Math.min(input.length - i, this.ring.length - this.offset)
      this.ring.set(input.subarray(i, i + length), this.offset)
      this.offset = (this.offset + length) % this.ring.length
      this.bytes += length
      i += length
    }
  }
  observe(name: string) {
    const byte = (offset: number) => this.ring[offset % this.ring.length]!
    const u16 = (offset: number) => byte(offset) | (byte(offset + 1) << 8)
    const u32 = (offset: number) => (u16(offset) | (u16(offset + 2) << 16)) >>> 0
    for (let pos = this.bytes - 30; pos >= Math.max(0, this.bytes - 2 * 65535 - 4096 - 30); pos--) {
      if (u32(pos) !== 0x04034b50) continue
      const flags = u16(pos + 6),
        nameLength = u16(pos + 26),
        extra = u16(pos + 28)
      if (pos + 30 + nameLength + extra > this.bytes) continue
      const raw = Uint8Array.from({ length: nameLength }, (_, i) => byte(pos + 30 + i))
      const decoded =
        flags & 2048
          ? new TextDecoder('utf-8', { fatal: true }).decode(raw)
          : Array.from(raw, (value) => String.fromCharCode(value)).join('')
      if (decoded !== name) continue
      this.local.set(name, {
        offset: pos,
        flags,
        method: u16(pos + 8),
        crc: u32(pos + 14),
        compressed: u32(pos + 18),
        size: u32(pos + 22),
        header: 30 + nameLength + extra,
        before: Uint8Array.from({ length: Math.min(16, pos) }, (_, i) => byte(pos - Math.min(16, pos) + i))
      })
      return
    }
    throw new Error('ZIP 本地条目头缺失或过大。')
  }
  verify(entries: ReadonlyMap<string, { bytes: number; crc32: number }>) {
    const length = Math.min(this.bytes, this.ring.length),
      tail = new Uint8Array(length)
    if (this.bytes <= this.ring.length) tail.set(this.ring.subarray(0, length))
    else {
      tail.set(this.ring.subarray(this.offset))
      tail.set(this.ring.subarray(0, this.offset), this.ring.length - this.offset)
    }
    const view = new DataView(tail.buffer),
      base = this.bytes - length
    let end = -1
    for (let i = length - 22; i >= Math.max(0, length - 65557); i--)
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === length) {
        end = i
        break
      }
    if (end < 0) throw new Error('ZIP 结束目录缺失或尾部不完整。')
    const count = view.getUint16(end + 10, true),
      size = view.getUint32(end + 12, true),
      start = view.getUint32(end + 16, true)
    if (
      view.getUint16(end + 4, true) ||
      view.getUint16(end + 6, true) ||
      view.getUint16(end + 8, true) !== count ||
      count === 0xffff ||
      size === 0xffffffff ||
      start === 0xffffffff
    )
      throw new Error('当前流式适配器不支持多卷或ZIP64备份。')
    if (size > 4 * 1024 * 1024 || start < base || start + size !== base + end || count !== entries.size)
      throw new Error('ZIP 目录大小、数量或位置校验失败。')
    let pos = start - base
    const names = new Set<string>()
    const physical = [...this.local.values()].sort((a, b) => a.offset - b.offset)
    if (physical.length !== count || physical[0]?.offset !== 0)
      throw new Error('ZIP 本地条目数量或起始位置无效。')
    for (let index = 0; index < count; index++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP 文件目录不完整。')
      const flags = view.getUint16(pos + 8, true),
        method = view.getUint16(pos + 10, true)
      const crc = view.getUint32(pos + 16, true),
        compressed = view.getUint32(pos + 20, true),
        bytes = view.getUint32(pos + 24, true)
      const nameLength = view.getUint16(pos + 28, true),
        extra = view.getUint16(pos + 30, true),
        comment = view.getUint16(pos + 32, true)
      const next = pos + 46 + nameLength + extra + comment
      if (
        next > end ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        compressed === 0xffffffff ||
        bytes === 0xffffffff ||
        view.getUint16(pos + 34, true)
      )
        throw new Error('ZIP 目录参数或压缩方式不受支持。')
      const rawName = tail.subarray(pos + 46, pos + 46 + nameLength)
      const name =
        flags & 2048
          ? new TextDecoder('utf-8', { fatal: true }).decode(rawName)
          : Array.from(rawName, (byte) => String.fromCharCode(byte)).join('')
      const actual = entries.get(name)
      if (names.has(name) || !actual || actual.bytes !== bytes || actual.crc32 !== crc)
        throw new Error('ZIP 条目名称、完整长度或CRC校验失败。')
      const local = this.local.get(name)
      if (
        !local ||
        view.getUint32(pos + 42, true) !== local.offset ||
        flags !== local.flags ||
        method !== local.method ||
        local.offset + local.header + compressed + (flags & 8 ? 12 : 0) > start ||
        (!(flags & 8) && (local.crc !== crc || local.compressed !== compressed || local.size !== bytes))
      )
        throw new Error('ZIP 本地条目与最终目录不一致。')
      const order = physical.indexOf(local),
        nextLocal = physical[order + 1]
      const boundary = nextLocal?.offset ?? start
      const descriptorBytes = boundary - local.offset - local.header - compressed
      if (!(flags & 8)) {
        if (descriptorBytes !== 0) throw new Error('ZIP 压缩长度或条目边界不一致。')
      } else {
        if (descriptorBytes !== 12 && descriptorBytes !== 16) throw new Error('ZIP 数据描述符长度不一致。')
        const descriptor = nextLocal?.before ?? tail.subarray(start - base - 16, start - base)
        const proof = new DataView(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
        const offset = descriptor.byteLength - 12
        if (
          (descriptorBytes === 16 && proof.getUint32(0, true) !== 0x08074b50) ||
          proof.getUint32(offset, true) !== crc ||
          proof.getUint32(offset + 4, true) !== compressed ||
          proof.getUint32(offset + 8, true) !== bytes
        )
          throw new Error('ZIP 数据描述符长度或CRC校验失败。')
      }
      names.add(name)
      pos = next
    }
    if (pos !== end) throw new Error('ZIP 文件目录包含多余内容。')
  }
}
