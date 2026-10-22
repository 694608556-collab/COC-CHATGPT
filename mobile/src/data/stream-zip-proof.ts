// CRC proof shared by table and backup ZIP readers. Directory and local-header
// validation are performed independently before a native staging lease is ready.
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
