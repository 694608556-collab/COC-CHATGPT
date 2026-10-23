// CRC proof shared by table and backup ZIP readers. Directory and local-header
// validation are performed independently before a native staging lease is ready.
const table = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  table[i] = c
}
const slices = [table]
for (let step = 1; step < 8; step++) {
  const next = new Uint32Array(256), previous = slices[step - 1]!
  for (let index = 0; index < 256; index++) next[index] = (previous[index]! >>> 8) ^ table[previous[index]! & 255]!
  slices.push(next)
}
const [t0, t1, t2, t3, t4, t5, t6, t7] = slices as [Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array]
export class StreamCrc32 {
  private state = 0xffffffff
  update(bytes: Uint8Array) {
    let c = this.state, i = 0
    for (; i + 8 <= bytes.length; i += 8) {
      c ^= bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)
      c = t7[c & 255]! ^ t6[(c >>> 8) & 255]! ^ t5[(c >>> 16) & 255]! ^ t4[c >>> 24]! ^ t3[bytes[i + 4]!]! ^ t2[bytes[i + 5]!]! ^ t1[bytes[i + 6]!]! ^ t0[bytes[i + 7]!]!
    }
    for (; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 255]! ^ (c >>> 8)
    this.state = c
  }
  get value() {
    return (this.state ^ 0xffffffff) >>> 0
  }
}
