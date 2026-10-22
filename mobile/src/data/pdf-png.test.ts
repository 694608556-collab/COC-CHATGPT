import { expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import { pdfImageFromPng } from './pdf-png'

const width = 1754,
  height = 1240
function chunk(type: string, bytes: Uint8Array) {
  const output = Buffer.alloc(bytes.length + 12)
  output.writeUInt32BE(bytes.length)
  output.write(type, 4)
  output.set(bytes, 8)
  let crc = 0xffffffff
  for (const byte of output.subarray(4, output.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4)
  return output
}
function fixture(transparent = false) {
  const stride = width * 4,
    encoded = Buffer.alloc((stride + 1) * height)
  const rgb = Buffer.alloc((width * 3 + 1) * height)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const raw = Buffer.alloc(stride),
      filter = y % 5
    for (let x = 0; x < width; x++) {
      const color = [x & 255, y & 255, (x + y) & 255]
      raw.set([...color, transparent && !x && !y ? 0 : 255], x * 4)
      rgb.set(color, y * (width * 3 + 1) + 1 + x * 3)
    }
    encoded[y * (stride + 1)] = filter
    for (let at = 0; at < stride; at++) {
      const a = at < 4 ? 0 : raw[at - 4]!,
        b = previous[at]!,
        c = at < 4 ? 0 : previous[at - 4]!
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c)
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][
        filter
      ]!
      encoded[y * (stride + 1) + 1 + at] = raw[at]! - predictor
    }
    previous = raw
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(encoded)),
    chunk('IEND', new Uint8Array())
  ])
  return { png, rgb }
}

it('不透明RGBA画布PNG保留全部RGB像素，正确还原五种逐行过滤，不采样或删正文', () => {
  const { png, rgb } = fixture()
  const result = pdfImageFromPng(png)
  expect(inflateSync(result.bytes).equals(rgb)).toBe(true)
})

it('拒绝非不透明RGBA页面，不能直接丢弃实际透明像素', () => {
  expect(() => pdfImageFromPng(fixture(true).png)).toThrow(/不透明|透明/)
})

it('原有RGB页面直接复用压缩数据，不重新采样或重压缩', () => {
  const { rgb } = fixture(),
    header = Buffer.alloc(13),
    compressed = deflateSync(rgb)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array())
  ])
  expect(Buffer.from(pdfImageFromPng(png).bytes).equals(compressed)).toBe(true)
})

it('完整页面仍拒绝CRC损坏和截断，不发布损坏的PDF图像', () => {
  const { png } = fixture(),
    bad = Buffer.from(png)
  bad[45] = bad[45]! ^ 1
  expect(() => pdfImageFromPng(bad)).toThrow('校验')
  expect(() => pdfImageFromPng(png.subarray(0, png.length - 4))).toThrow('不完整')
})
