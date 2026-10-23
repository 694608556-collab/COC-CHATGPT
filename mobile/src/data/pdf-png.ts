import { Inflate, zlibSync } from 'fflate'
import { StreamCrc32 } from './stream-zip-proof'

/** 一页原生 PNG 的无损 RGB 压缩流；不重采样像素。 */
export interface PdfPngImage {
  /** 完整RGB压缩流，可由PDF FlateDecode / PNG predictor直接解码；无像素采样。 */
  bytes: Uint8Array
}

/**
 * 只接收应用自身不透明画布生成的固定尺寸 PNG，不作为外部图片导入解析器。
 * @param png - toBlob 返回的完整 PNG；接受RGB或全不透明RGBA，不接受索引色、实际透明、交错或非八位图像。
 * @returns RGB原样复用IDAT；RGBA逐像素证明不透明后无损重编码。格式不完整时拒绝发布。
 */
export function pdfImageFromPng(png: Uint8Array): PdfPngImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (png.length < 45 || !signature.every((value, i) => png[i] === value))
    throw new Error('PDF 页面编码不完整。')
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Uint8Array[] = []
  let position = 8,
    complete = false,
    size = 0,
    colorType = 2,
    endedIdat = false,
    palette = false
  while (position + 12 <= png.length) {
    const length = view.getUint32(position)
    if (length > png.length - position - 12) throw new Error('PDF 页面编码不完整。')
    const type = String.fromCharCode(...png.subarray(position + 4, position + 8))
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error('PDF 页面块格式无效。')
    const crc = new StreamCrc32()
    crc.update(png.subarray(position + 4, position + 8 + length))
    if (crc.value !== view.getUint32(position + 8 + length)) throw new Error('PDF 页面编码校验失败。')
    if (
      position === 8 &&
      (type !== 'IHDR' ||
        length !== 13 ||
        view.getUint32(position + 8) !== 1754 ||
        view.getUint32(position + 12) !== 1240 ||
        png[position + 16] !== 8 ||
        ![2, 6].includes(png[position + 17]!) ||
        png[position + 18] !== 0 ||
        png[position + 19] !== 0 ||
        png[position + 20] !== 0)
    )
      throw new Error('此设备生成的 PNG 页面格式不兼容，未保存 PDF。')
    if (position === 8) colorType = png[position + 17]!
    else if (type === 'IHDR') throw new Error('PDF 页面包含重复图像头。')
    if (type === 'tRNS') throw new Error('PDF 页面包含透明颜色，未保存文件。')
    if (type === 'PLTE') {
      if (palette || chunks.length || length === 0 || length > 768 || length % 3)
        throw new Error('PDF 页面调色板格式无效。')
      palette = true
    } else if (/^[A-Z]/.test(type) && !['IHDR', 'IDAT', 'IEND'].includes(type))
      throw new Error('PDF 页面包含不支持的关键块。')
    if (type === 'IDAT') {
      if (endedIdat) throw new Error('PDF 页面压缩块顺序无效。')
      const data = png.subarray(position + 8, position + 8 + length)
      chunks.push(data)
      size += length
    } else if (chunks.length) endedIdat = true
    position += length + 12
    if (type === 'IEND') {
      complete = length === 0 && position === png.length
      break
    }
  }
  if (!complete || !chunks.length) throw new Error('PDF 页面编码不完整。')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const decoded = checkedScanlines(bytes, colorType === 2 ? 3 : 4)
  if (colorType === 2) return { bytes }
  return { bytes: opaqueRgba(decoded) }
}

/** Validate the complete zlib envelope, DEFLATE ending, Adler checksum and PNG row geometry.
 * @param compressed All concatenated IDAT bytes, including the zlib header and checksum.
 * @param channels RGB or RGBA bytes per pixel of the fixed application canvas.
 * @returns Exactly the complete filtered scanlines; malformed input never reaches PDF publication.
 */
function checkedScanlines(compressed: Uint8Array, channels: 3 | 4): Uint8Array {
  if (
    compressed.length < 6 ||
    (compressed[0]! & 15) !== 8 ||
    compressed[0]! >>> 4 > 7 ||
    ((compressed[0]! << 8) + compressed[1]!) % 31 !== 0 ||
    (compressed[1]! & 32) !== 0
  )
    throw new Error('PDF 页面压缩格式无效。')
  const rowBytes = 1754 * channels + 1
  const decoded = new Uint8Array(rowBytes * 1240)
  let received = 0,
    complete = false,
    a = 1,
    b = 0
  const inflater = new Inflate((chunk, final) => {
    if (chunk.length > decoded.length - received) throw new Error('PDF 页面像素长度不符。')
    decoded.set(chunk, received)
    received += chunk.length
    // RFC 1950's 5552-byte blocks keep the sums exact without a modulus per byte.
    for (let start = 0; start < chunk.length; start += 5552) {
      const end = Math.min(start + 5552, chunk.length)
      for (let at = start; at < end; at++) {
        a += chunk[at]!
        b += a
      }
      a %= 65521
      b %= 65521
    }
    complete = final
  })
  const deflate = compressed.subarray(2, -4)
  for (let at = 0; at < deflate.length; at += 16384)
    inflater.push(deflate.subarray(at, at + 16384), at + 16384 >= deflate.length)
  // fflate 0.8.2 accepts a hidden suffix unless its pinned raw stream state is checked.
  const state = inflater as unknown as { s: { f?: number; l?: unknown; p: number }; p: Uint8Array }
  if (
    !complete ||
    received !== decoded.length ||
    !state.s.f ||
    state.s.l ||
    state.p.length !== Math.ceil(state.s.p / 8)
  )
    throw new Error('PDF 页面像素不完整或压缩流包含额外数据。')
  const checksum = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength).getUint32(
    compressed.length - 4
  )
  if (((b << 16) | a) >>> 0 !== checksum) throw new Error('PDF 页面压缩校验失败。')
  for (let at = 0; at < decoded.length; at += rowBytes)
    if (decoded[at]! > 4) throw new Error('PDF 页面过滤格式无效。')
  return decoded
}

/** @param decoded A complete, validated native eight-bit RGBA filtered scanline stream.
 * @returns Lossless RGB scanlines with PNG predictor rows. Runs in the export Worker.
 * Only the alpha channel is removed, after every pixel proves fully opaque.
 */
function opaqueRgba(decoded: Uint8Array): Uint8Array {
  const width = 1754,
    height = 1240,
    stride = width * 4
  const rgb = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)]!
    let destination = y * (width * 3 + 1)
    rgb[destination++] = filter
    // PNG predictors never mix channels: RGB residuals remain byte-identical when
    // the pixel stride changes from four to three. Only alpha needs reconstruction.
    // All preceding alpha bytes have already proved 255, including the prior row.
    const above = y ? 255 : 0
    const firstPredictor = filter === 0 || filter === 1 ? 0 : filter === 3 ? above >>> 1 : above
    const followingPredictor =
      filter === 0 ? 0 : filter === 2 ? above : filter === 3 ? (255 + above) >>> 1 : 255
    const first = y * (stride + 1) + 1
    if (decoded[first + 3] !== ((255 - firstPredictor) & 255))
      throw new Error('PDF 页面并非全不透明，未保存文件。')
    const expectedAlpha = (255 - followingPredictor) & 255
    for (let at = first; at < first + stride; at += 4) {
      if (at !== first && decoded[at + 3] !== expectedAlpha)
        throw new Error('PDF 页面并非全不透明，未保存文件。')
      rgb[destination++] = decoded[at]!
      rgb[destination++] = decoded[at + 1]!
      rgb[destination++] = decoded[at + 2]!
    }
  }
  return zlibSync(rgb, { level: 6 })
}

/** Read-only image conversion job; contains no file paths or publication permission. */
export interface PdfPngJob {
  type: 'pdf-png'
  png: Uint8Array
}
