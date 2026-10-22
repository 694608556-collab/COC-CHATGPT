import { capacity } from './capacity'
import { Capacitor } from '@capacitor/core'
import { encodeFileBase64 } from './bytes'
import type { LogbookPort, SavedDocument } from './native'

/**
 * 发布一个已生成的文字文件；超过 1 MiB 的文件按 256 KiB 顺序异步编码/传输，其余一次写入。
 * @param port - 已授权的本地归档边界，不修改场次或版本。
 * @param file - 后台生成的完整字节、文件名与 MIME。
 * @param purpose - 文件登记用途，默认正文导出；完整备份登记为 backup，避免下一次 ZIP 将自身递归打包。
 * @returns 新建唯一名称并回读校验的文件；失败清理当前暂存，不覆盖已有文件。
 */
export async function saveGeneratedExport(
  port: LogbookPort,
  file: { name: string; mime: string; bytes: Uint8Array },
  purpose: 'export' | 'backup' = 'export'
): Promise<SavedDocument> {
  if (file.bytes.length > capacity.archiveFileBytes) throw new Error('文件超过 64 MB，未保存。')
  // iOS retains its verified native writer until its separate spool implementation is available.
  if (file.bytes.length <= 1024 * 1024 || Capacitor.getPlatform() === 'ios')
    return port.writeArchive({
      name: file.name,
      mime: file.mime,
      base64: await encodeFileBase64(file.bytes),
      purpose
    })
  // 与 PDF 共用一个有界私有暂存；文字文件由不同的完成接口按原 MIME 发布。
  const { id } = await port.beginPdfArchive()
  try {
    for (let offset = 0; offset < file.bytes.length; offset += capacity.transferChunkBytes)
      await port.appendPdfArchive({
        id,
        base64: await encodeFileBase64(file.bytes.subarray(offset, offset + capacity.transferChunkBytes))
      })
    return await port.finishExportArchive({ id, name: file.name, mime: file.mime, purpose })
  } finally {
    await port.cancelPdfArchive({ id })
  }
}
