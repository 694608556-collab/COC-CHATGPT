import type { ModuleRecord, SessionRecord, FilterPreset } from '../../../src/shared/types'
import { combinedExportName, recordExportName } from '../../../src/shared/export-filenames'
import { exportInBackground } from '../data/background'
import { encodeFileBase64 } from '../data/bytes'
import type { LogbookPort } from '../data/native'
import { checkPdfCancellation } from '../data/pdf'
import type { PdfProgress } from '../data/pdf'

/**
 * 只读工作线程生成完整过滤文本，再将原生排版放到独立后台线程；发布仍由调用者确认。
 * @param port - 当前 Android 存储接口，不接触其他应用。
 * @param id - 当前私有暂存标识，调用者 finally 负责取消/清理。
 * @param module - 归属模组。
 * @param records - 顺序完整正文。
 * @param filters - 当前阅读/导出过滤设置。
 * @param combined - 是否合成。
 * @param signal - 用户取消信号。
 * @param onProgress - 接收真实页数；文件落盘前仍可取消。
 * @param preparedText - 可选、已在同版本后台源中生成的完整 TXT 字节；提供后不再跨线程复制正文。
 * @returns 完整生成后的 PDF 文件名；不会发布外部文件或修改业务数据。
 */
export async function generateNativePdf(
  port: LogbookPort,
  id: string,
  module: ModuleRecord,
  records: SessionRecord[],
  filters: FilterPreset,
  combined: boolean,
  signal: AbortSignal,
  onProgress: (progress: PdfProgress) => void,
  preparedText?: { bytes: Uint8Array }
): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const name = combined
    ? combinedExportName(module.name, 'pdf')
    : recordExportName(module.name, records[0]!.name, records[0]!.playDate, 'pdf')
  checkPdfCancellation(signal)
  const file = preparedText ?? (await exportInBackground(module, records, filters, 'txt', combined))
  checkPdfCancellation(signal)
  for (let offset = 0; offset < file.bytes.length; offset += 256 * 1024) {
    checkPdfCancellation(signal)
    await port.appendPdfArchive({
      id,
      base64: await encodeFileBase64(file.bytes.subarray(offset, offset + 256 * 1024))
    })
  }
  checkPdfCancellation(signal)
  await port.renderTextPdf({ id })
  try {
    while (true) {
      checkPdfCancellation(signal)
      const state = await port.getTextPdfProgress({ id })
      checkPdfCancellation(signal)
      if (state.stage === 'failed') throw new Error(state.error || 'PDF 生成失败，未保存。')
      if (state.stage === 'cancelled') throw new DOMException('已取消 PDF 导出。', 'AbortError')
      onProgress({
        stage: state.stage === 'layout' ? 'layout' : state.stage === 'write' ? 'encode' : 'render',
        completed: state.pages,
        total: state.total
      })
      if (state.stage === 'ready') return { name, mime: 'application/pdf', bytes: new Uint8Array() }
      await new Promise<void>((resolve) => setTimeout(resolve, 32))
    }
  } finally {
    // 先发取消信号再等清理，避免 CPU 密集原生任务占住存储桥接队列。
    if (signal.aborted) await port.cancelPdfArchive({ id })
  }
}
