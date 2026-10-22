// Incremental SHA-256 for bounded file streams; no whole-file ArrayBuffer.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2
])
const rotate = (v: number, n: number) => (v >>> n) | (v << (32 - n))

/** A single-use streaming digest. Call digest only after the input is complete. */
export class StreamSha256 {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  private words = new Uint32Array(64)
  private buffer = new Uint8Array(64)
  private used = 0
  private length = 0
  private ended = false
  get bytes() {
    return this.length
  }
  update(input: Uint8Array) {
    if (this.ended || !Number.isSafeInteger(this.length + input.length))
      throw new Error('摘要流已结束或字节数无效。')
    this.length += input.length
    let offset = 0
    if (this.used) {
      const n = Math.min(64 - this.used, input.length)
      this.buffer.set(input.subarray(0, n), this.used)
      this.used += n
      offset += n
      if (this.used === 64) {
        this.block(this.buffer, 0)
        this.used = 0
      }
    }
    while (offset + 64 <= input.length) {
      this.block(input, offset)
      offset += 64
    }
    if (offset < input.length) {
      this.buffer.set(input.subarray(offset))
      this.used = input.length - offset
    }
  }
  private block(input: Uint8Array, offset: number) {
    const w = this.words
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4
      w[i] = (input[p]! << 24) | (input[p + 1]! << 16) | (input[p + 2]! << 8) | input[p + 3]!
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!,
        y = w[i - 2]!
      w[i] =
        ((rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
          w[i - 16]! +
          (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10)) +
          w[i - 7]!) >>>
        0
    }
    const s = this.state
    let a = s[0]!,
      b = s[1]!,
      c = s[2]!,
      d = s[3]!,
      e = s[4]!,
      f = s[5]!,
      g = s[6]!,
      h = s[7]!
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    s[0] = (s[0]! + a) >>> 0
    s[1] = (s[1]! + b) >>> 0
    s[2] = (s[2]! + c) >>> 0
    s[3] = (s[3]! + d) >>> 0
    s[4] = (s[4]! + e) >>> 0
    s[5] = (s[5]! + f) >>> 0
    s[6] = (s[6]! + g) >>> 0
    s[7] = (s[7]! + h) >>> 0
  }
  digest(): string {
    if (this.ended) throw new Error('摘要流已结束。')
    this.ended = true
    const tail = new Uint8Array(this.used < 56 ? 64 : 128)
    tail.set(this.buffer.subarray(0, this.used))
    tail[this.used] = 0x80
    const view = new DataView(tail.buffer)
    view.setUint32(tail.length - 8, Math.floor(this.length / 0x20000000))
    view.setUint32(tail.length - 4, (this.length * 8) >>> 0)
    for (let i = 0; i < tail.length; i += 64) this.block(tail, i)
    return Array.from(this.state, (value) => value.toString(16).padStart(8, '0')).join('')
  }
}
