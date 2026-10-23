import { expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import { pdfImageFromPng } from './pdf-png'
import { rgbReferenceRows } from '../../tests/png-rgb-reference'

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
  expect(Buffer.from(rgbReferenceRows(inflateSync(result.bytes), width, height)).equals(rgb)).toBe(true)
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

it('即使PNG块CRC正确，也拒绝损坏的zlib Adler校验，不能发布损坏压缩流', () => {
  const { png } = fixture()
  const length = png.readUInt32BE(33)
  const compressed = Buffer.from(png.subarray(41, 41 + length))
  compressed[compressed.length - 1] = compressed[compressed.length - 1]! ^ 1
  const corrupted = Buffer.concat([
    png.subarray(0, 33),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array())
  ])
  expect(() => pdfImageFromPng(corrupted)).toThrow()
})

it('五种过滤的首尾像素均须逐一证明不透明，包括页面最后一个像素', () => {
  const { png } = fixture()
  const encoded = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))
  for (const y of [0, 1, 2, 3, 4, 1235, 1236, 1237, 1238, 1239]) {
    for (const x of [0, 1, width - 1]) {
      const changed = Buffer.from(encoded)
      const alpha = y * (width * 4 + 1) + 1 + x * 4 + 3
      changed[alpha] = changed[alpha]! ^ 1
      const invalid = Buffer.concat([
        png.subarray(0, 33),
        chunk('IDAT', deflateSync(changed)),
        chunk('IEND', new Uint8Array())
      ])
      expect(() => pdfImageFromPng(invalid), `alpha ${x},${y}`).toThrow(/不透明|透明/)
    }
  }
})

it('RGB和RGBA完整流均拒绝隐藏尾部、串接流、截断、错误行长和过滤码', () => {
  const { png, rgb } = fixture()
  const rgba = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))
  for (const [colorType, rows, stride] of [
    [2, rgb, width * 3 + 1],
    [6, rgba, width * 4 + 1]
  ] as const) {
    const header = Buffer.from(png.subarray(16, 29))
    header[9] = colorType
    const valid = deflateSync(rows)
    const wrongAdler = Buffer.from(valid)
    wrongAdler[wrongAdler.length - 1] = wrongAdler[wrongAdler.length - 1]! ^ 1
    const badFilter = Buffer.from(rows)
    badFilter[(height - 1) * stride] = 5
    const corruptions = [
      wrongAdler,
      Buffer.concat([valid.subarray(0, -4), Buffer.from([0]), valid.subarray(-4)]),
      Buffer.concat([valid.subarray(0, -4), deflateSync(Buffer.from('hidden')), valid.subarray(-4)]),
      Buffer.concat([valid.subarray(0, -5), valid.subarray(-4)]),
      deflateSync(rows.subarray(0, -1)),
      deflateSync(Buffer.concat([rows, Buffer.from([0])])),
      deflateSync(badFilter),
      Buffer.concat([Buffer.from([0x78, 0x20]), valid.subarray(2)])
    ]
    for (const [index, compressed] of corruptions.entries()) {
      const invalid = Buffer.concat([
        png.subarray(0, 8),
        chunk('IHDR', header),
        chunk('IDAT', compressed),
        chunk('IEND', new Uint8Array())
      ])
      expect(() => pdfImageFromPng(invalid), `${colorType} corruption ${index}`).toThrow()
    }
  }
})

it('不能静默忽略透明颜色、重复头、未知关键块或断开的IDAT序列', () => {
  const { png, rgb } = fixture()
  const header = Buffer.from(png.subarray(16, 29))
  header[9] = 2
  const compressed = deflateSync(rgb)
  const prefix = Buffer.concat([png.subarray(0, 8), chunk('IHDR', header)])
  const idat = chunk('IDAT', compressed),
    end = chunk('IEND', new Uint8Array())
  const invalids = [
    Buffer.concat([prefix, chunk('tRNS', Buffer.alloc(6)), idat, end]),
    Buffer.concat([prefix, chunk('IHDR', header), idat, end]),
    Buffer.concat([prefix, chunk('ABCD', Buffer.alloc(0)), idat, end]),
    Buffer.concat([
      prefix,
      chunk('IDAT', compressed.subarray(0, 5)),
      chunk('tEXt', Buffer.from('a\0b')),
      chunk('IDAT', compressed.subarray(5)),
      end
    ])
  ]
  for (const invalid of invalids) expect(() => pdfImageFromPng(invalid)).toThrow()
})
