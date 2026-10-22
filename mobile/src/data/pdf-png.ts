import { Unzlib, zlibSync } from 'fflate'
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
    colorType = 2
  while (position + 12 <= png.length) {
    const length = view.getUint32(position)
    if (length > png.length - position - 12) throw new Error('PDF 页面编码不完整。')
    const type = String.fromCharCode(...png.subarray(position + 4, position + 8))
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
    if (type === 'IDAT') {
      const data = png.subarray(position + 8, position + 8 + length)
      chunks.push(data)
      size += length
    }
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
  if (colorType === 2) return { bytes }
  return { bytes: opaqueRgba(bytes) }
}

/** @param compressed A complete native eight-bit RGBA scanline stream.
 * @returns Lossless RGB scanlines with PNG predictor rows. Runs in the export Worker.
 * Only the alpha channel is removed, after every pixel proves fully opaque.
 */
function opaqueRgba(compressed: Uint8Array): Uint8Array {
  const width = 1754,
    height = 1240,
    stride = width * 4
  const decoded = new Uint8Array((stride + 1) * height)
  let received = 0,
    complete = false
  const inflater = new Unzlib((chunk, final) => {
    if (chunk.length > decoded.length - received) throw new Error('PDF 页面像素长度不符。')
    decoded.set(chunk, received)
    received += chunk.length
    complete = final
  })
  inflater.push(compressed, true)
  if (!complete || received !== decoded.length) throw new Error('PDF 页面像素不完整。')
  const rgb = new Uint8Array((width * 3 + 1) * height)
  let previous = new Uint8Array(stride),
    row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (stride + 1)]!
    if (filter > 4) throw new Error('PDF 页面过滤格式无效。')
    for (let at = 0; at < stride; at++) {
      const a = at < 4 ? 0 : row[at - 4]!,
        b = previous[at]!,
        c = at < 4 ? 0 : previous[at - 4]!
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c)
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
      row[at] = (decoded[y * (stride + 1) + 1 + at]! + predictor) & 255
    }
    let destination = y * (width * 3 + 1) + 1
    for (let at = 0; at < stride; at += 4) {
      if (row[at + 3] !== 255) throw new Error('PDF 页面并非全不透明，未保存文件。')
      rgb[destination++] = row[at]!
      rgb[destination++] = row[at + 1]!
      rgb[destination++] = row[at + 2]!
    }
    const swap = previous
    previous = row
    row = swap
  }
  return zlibSync(rgb, { level: 6 })
}

/** Read-only image conversion job; contains no file paths or publication permission. */
export interface PdfPngJob {
  type: 'pdf-png'
  png: Uint8Array
}
