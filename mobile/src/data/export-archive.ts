import { encodeBase64, encodeFileBase64 } from './bytes'
import type { LogbookPort, SavedDocument } from './native'

/**
 * 发布一个已生成的文字文件；超过 8 MiB 的文件按 256 KiB 顺序传输，其余原生异步编码后一次写入。
 * @param port - 已授权的本地归档边界，不修改场次或版本。
 * @param file - 后台生成的完整字节、文件名与 MIME。
 * @returns 新建唯一名称并回读校验的文件；失败清理当前暂存，不覆盖已有文件。
 */
export async function saveGeneratedExport(
  port: LogbookPort,
  file: { name: string; mime: string; bytes: Uint8Array }
): Promise<SavedDocument> {
  if (file.bytes.length > 64 * 1024 * 1024) throw new Error('文件超过 64 MB，未保存。')
  if (file.bytes.length <= 8 * 1024 * 1024)
    return port.writeArchive({ name: file.name, mime: file.mime, base64: await encodeFileBase64(file.bytes) })
  // 与 PDF 共用一个有界私有暂存；文字文件由不同的完成接口按原 MIME 发布。
  const { id } = await port.beginPdfArchive()
  try {
    for (let offset = 0; offset < file.bytes.length; offset += 256 * 1024)
      await port.appendPdfArchive({
        id,
        base64: encodeBase64(file.bytes.subarray(offset, offset + 256 * 1024))
      })
    return await port.finishExportArchive({ id, name: file.name, mime: file.mime })
  } finally {
    await port.cancelPdfArchive({ id })
  }
}
