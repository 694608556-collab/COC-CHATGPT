import { capacity } from './capacity'
import { waitForAppFonts } from './fonts'
import { pdfImageFromPng } from './pdf-png'
import type { PdfPngImage } from './pdf-png'

/** 完整 PDF 的可观察生成状态；页数不是人为上限。 */
export interface PdfProgress {
  /** 批量导出当前文件序号；类型为 number | undefined，从 1 开始，由界面编排提供。 */
  fileIndex?: number
  /** 本次待导出的文件总数；类型为 number | undefined，不是场次数或页数。 */
  fileTotal?: number
  /** 当前阶段：排版、逐页绘制、保存回读。 */
  stage: 'layout' | 'render' | 'encode' | 'save'
  /** 已完成页数；排版时为 0。 */
  completed: number
  /** 排版完成后的实际总页数；排版时为 0。 */
  total: number
}
/** 有界页面缓冲、顺序写入的 PDF 选项；未提供 write 时仅供小文件调用方收集结果。 */
export interface PdfOptions {
  /** 可选取消信号；最终发布新文件前检查。 */
  signal?: AbortSignal
  /** 可选进度接收器；不修改场次数据。 */
  onProgress?: (progress: PdfProgress) => void
  /** 可选顺序字节接收器；每段不超过 256 KiB，resolve 后才发送下一段。 */
  write?: (bytes: Uint8Array) => Promise<void>
}
const encoder = new TextEncoder()

/** @param signal - 用户取消信号。 @returns 无返回值；已取消时抛标准 AbortError。 */
export function checkPdfCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消 PDF 导出。', 'AbortError')
}

/** @param signal - 用户取消信号。 @returns 下一轮事件循环后 resolve，允许旧 WebView 绘制进度及接收触摸。 */
async function yieldForPdf(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  checkPdfCancellation(signal)
}

/** @param canvas - 已复制原像素的不透明画布。 @returns 完整原生 PNG 字节，不在 JavaScript 中重新压缩。 */
async function nativePng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PDF 页面编码失败。'))), 'image/png')
  )
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(new Error('PDF 页面读取失败。'))
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * 沿用内置字体与原 A4 栅格排版，逐页写出 PDF 1.4；仅预编码下一页，不累积整份图像/Base64。
 * @param text - 已应用用户过滤设置的完整正文。
 * @param options - 顺序写入、取消及真实进度；发布/回读由归档接口负责。
 * @returns 未提供 write 时返回完整 PDF 字节；流式调用返回空数组，不重复保留整份文件。
 */
export async function textPdf(text: string, options: PdfOptions = {}): Promise<Uint8Array> {
  checkPdfCancellation(options.signal)
  options.onProgress?.({ stage: 'layout', completed: 0, total: 0 })
  await yieldForPdf(options.signal)
  await waitForAppFonts()
  const canvas = document.createElement('canvas')
  canvas.width = 1240
  canvas.height = 1754
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('此设备无法生成 PDF。')
  const target = document.createElement('canvas')
  let nextPage: Promise<PdfPngImage> | undefined
  try {
    ctx.font = '24px "SF Pro Text", "PingFang SC"'
    const lines: string[] = []
    // 只缓存短串，限制内存；同一发言人/常见前缀不反复跨 Canvas 测量边界。
    const widths = new Map<string, number>()
    /** @param value - 使用原字号/字体的完整候选行。 @returns 实际画布宽度，不按字符个数近似。 */
    function width(value: string): number {
      const known = widths.get(value)
      if (known !== undefined) return known
      const measured = ctx!.measureText(value).width
      if (value.length <= 128) {
        if (widths.size >= 8192) widths.clear()
        widths.set(value, measured)
      }
      return measured
    }
    let checkpoint = performance.now()
    // 短行一次测宽，普通长段落二分断行；复杂文字保留逐码点路径，三者都不跳过文字。
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (paragraph.length <= 256 && width(paragraph) <= 1068) {
        lines.push(paragraph)
      } else if (/^[\x20-\x7e\u3000-\u3029\u4e00-\u9fff\uff01-\uff60]+$/.test(paragraph)) {
        // 原字体中无连接/组合字符的中西文走有界指数探测和二分，仍按实际整行宽度贪心断行。
        // 连字脚本、组合音标、代理对等继续下面的原逐码点路径，不按 UTF-16 切开它们。
        let start = 0
        while (start < paragraph.length) {
          let low = start,
            high = Math.min(start + 16, paragraph.length)
          while (width(paragraph.slice(start, high)) <= 1068) {
            low = high
            if (high === paragraph.length) break
            high = Math.min(start + (high - start) * 2, paragraph.length)
          }
          while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2)
            if (width(paragraph.slice(start, middle)) <= 1068) low = middle
            else high = middle
          }
          lines.push(paragraph.slice(start, low))
          start = low
          if (performance.now() - checkpoint >= 8) {
            await yieldForPdf(options.signal)
            checkpoint = performance.now()
          }
        }
      } else {
        let value = ''
        for (const ch of paragraph) {
          if (width(value + ch) > 1068) {
            lines.push(value)
            value = ch
          } else value += ch
          if (performance.now() - checkpoint >= 8) {
            await yieldForPdf(options.signal)
            checkpoint = performance.now()
          }
        }
        lines.push(value)
      }
      if (performance.now() - checkpoint >= 8) {
        await yieldForPdf(options.signal)
        checkpoint = performance.now()
      }
    }
    const total = Math.max(1, Math.ceil(lines.length / 42))
    const retained: Uint8Array[] = []
    const offsets: number[] = [0]
    const pages: number[] = []
    let size = 0
    /** @param bytes - 已排序 PDF 字节。 @returns 接收器确认写入；超限前失败，不生成截断 PDF。 */
    async function write(bytes: Uint8Array): Promise<void> {
      checkPdfCancellation(options.signal)
      if (!Number.isSafeInteger(size + bytes.length)) throw new Error('PDF 字节数超出系统可精确计量范围。')
      size += bytes.length
      if (!options.write) {
        retained.push(bytes)
        return
      }
      for (let i = 0; i < bytes.length; i += capacity.transferChunkBytes) {
        checkPdfCancellation(options.signal)
        await options.write(bytes.subarray(i, i + capacity.transferChunkBytes))
      }
    }
    /** @param parts - 一页内的少量字符串和压缩像素。 @returns 单页顺序字节；不保留其他页图像。 */
    function join(parts: Array<string | Uint8Array>): Uint8Array {
      const encoded = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part))
      const bytes = new Uint8Array(encoded.reduce((sum, part) => sum + part.length, 0))
      let offset = 0
      for (const part of encoded) {
        bytes.set(part, offset)
        offset += part.length
      }
      return bytes
    }
    target.width = 1754
    target.height = 1240
    const opaque = target.getContext('2d', { alpha: false })
    if (!opaque) throw new Error('此设备无法生成 PDF。')
    // 只转置像素、不旋转文字布局；PDF 矩阵还原方向，移除恒为不透明的 alpha 通道。
    opaque.setTransform(0, 1, 1, 0, 0, 0)
    /** @param page - 从零开始的页号。 @returns 本页无损图像；至多一个尚未完成的编码任务。 */
    async function renderPage(page: number): Promise<PdfPngImage> {
      await yieldForPdf(options.signal)
      ctx!.fillStyle = '#fff'
      ctx!.fillRect(0, 0, 1240, 1754)
      ctx!.fillStyle = '#171717'
      ctx!.font = '24px "SF Pro Text", "PingFang SC"'
      lines.slice(page * 42, (page + 1) * 42).forEach((line, i) => ctx!.fillText(line, 86, 86 + i * 38))
      ctx!.font = '18px "SF Pro Text", "PingFang SC"'
      ctx!.fillText(String(page + 1), 600, 1710)
      opaque!.drawImage(canvas, 0, 0)
      const png = await nativePng(target)
      checkPdfCancellation(options.signal)
      return pdfImageFromPng(png)
    }
    await write(encoder.encode('%PDF-1.4\n%âãÏÓ\n'))
    nextPage = renderPage(0)
    for (let page = 0; page < total; page++) {
      options.onProgress?.({ stage: 'render', completed: page, total })
      const image = await nextPage!
      // 下一页的原生编码与当前页的顺序写入重叠；不会并行导出多个完整文件。
      nextPage = page + 1 < total ? renderPage(page + 1) : undefined
      void nextPage?.catch(() => undefined) // 写入先失败时，清理阶段仍等待在途编码，避免未处理拒绝。
      checkPdfCancellation(options.signal)
      const imageId = 3 + page * 3,
        contentId = imageId + 1,
        pageId = imageId + 2
      const imageHeader = `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1754 /Height 1240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 1754 >> /Length ${image.bytes.length} >>\nstream\n`
      const imageTail = '\nendstream\nendobj\n'
      const content = 'q\n0 -841.89 -595.28 0 595.28 841.89 cm\n/Im0 Do\nQ\n'
      const contentObject = `${contentId} 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`
      const pageObject = `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
      offsets[imageId] = size
      offsets[contentId] =
        size + encoder.encode(imageHeader).length + image.bytes.length + encoder.encode(imageTail).length
      offsets[pageId] = offsets[contentId]! + encoder.encode(contentObject).length
      pages.push(pageId)
      await write(join([imageHeader, image.bytes, imageTail, contentObject, pageObject]))
      options.onProgress?.({ stage: 'render', completed: page + 1, total })
    }
    offsets[1] = size
    await write(encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))
    offsets[2] = size
    await write(
      encoder.encode(
        `2 0 obj\n<< /Type /Pages /Count ${total} /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] >>\nendobj\n`
      )
    )
    const xref = size
    await write(
      encoder.encode(
        `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
          .slice(1)
          .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
          .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      )
    )
    checkPdfCancellation(options.signal)
    if (options.write) return new Uint8Array()
    return join(retained)
  } finally {
    await nextPage?.catch(() => undefined)
    // 编码已结束才释放两个复用画布，取消/失败也不保留整份页面缓冲。
    canvas.width = 0
    canvas.height = 0
    target.width = 0
    target.height = 0
  }
}
