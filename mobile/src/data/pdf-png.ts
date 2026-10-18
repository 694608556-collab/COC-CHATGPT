/** 一页原生 PNG 的无损 RGB 压缩流；不解码/重采样像素。 */
export interface PdfPngImage {
  /** 拼接的 PNG IDAT 数据，可由 PDF FlateDecode / PNG predictor 直接解码。 */
  bytes: Uint8Array
}

/**
 * 只接收应用自身不透明画布生成的固定尺寸 PNG，不作为外部图片导入解析器。
 * @param png - toBlob 返回的完整 PNG；不接受索引色、透明、交错或非八位图像。
 * @returns 原始 IDAT 压缩流；结构不完整时拒绝，调用方不发布当前文件。
 */
export function pdfImageFromPng(png: Uint8Array): PdfPngImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (png.length < 45 || !signature.every((value, i) => png[i] === value))
    throw new Error('PDF 页面编码不完整。')
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Uint8Array[] = []
  let position = 8,
    complete = false,
    size = 0
  while (position + 12 <= png.length) {
    const length = view.getUint32(position)
    if (length > png.length - position - 12) throw new Error('PDF 页面编码不完整。')
    const type = String.fromCharCode(...png.subarray(position + 4, position + 8))
    if (
      position === 8 &&
      (type !== 'IHDR' ||
        length !== 13 ||
        view.getUint32(position + 8) !== 1754 ||
        view.getUint32(position + 12) !== 1240 ||
        png[position + 16] !== 8 ||
        png[position + 17] !== 2 ||
        png[position + 18] !== 0 ||
        png[position + 19] !== 0 ||
        png[position + 20] !== 0)
    )
      throw new Error('此设备生成的 PNG 页面格式不兼容，未保存 PDF。')
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
  return { bytes }
}
