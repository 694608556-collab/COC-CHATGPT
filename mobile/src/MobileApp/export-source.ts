import { Capacitor } from '@capacitor/core'
import type { LogbookPort, SavedDocument } from '../data/native'
import type { ModuleRecord, SessionRecord, FilterPreset } from '../../../src/shared/types'
import type { ExportFormat } from '../data/export'
import {
  openExportSourceInBackground,
  closeExportSourceInBackground,
  exportSourceFileInBackground,
  backupSourceInBackground
} from '../data/background'
import { checkPdfCancellation } from '../data/pdf'

/** 当前导出操作独占的不可变只读正文；调用者 finally 必须 close。 */
export interface NativeExportSession {
  /** @param module - 当前模组元数据。 @param records - 按顺序的目标元数据，正文不通过 UI 复制。 @param filters - 导出规则。 @param format - 无画布格式，PDF 的输入使用 txt。 @param combined - 是否合成。 @returns 完整文件字节，未发布共享文件。 */
  file(
    module: ModuleRecord,
    records: SessionRecord[],
    filters: FilterPreset,
    format: Exclude<ExportFormat, 'pdf'>,
    combined: boolean
  ): Promise<{ name: string; mime: string; bytes: Uint8Array }>
  /** @param name - 备份文件名。 @param files - 未提供为 JSON，否则为完整附件登记。 @returns 已核对完整正文和附件的备份，未发布共享文件。 */
  backup(name: string, files?: SavedDocument[]): Promise<{ name: string; mime: string; bytes: Uint8Array }>
  /** @returns 释放后台正文和原生私有文件后的确认；不会改场次、版本或旧归档。 */
  close(): Promise<void>
}

/**
 * 封装原生版本读取、后台完整性校验及租约释放，不将整批正文复制到界面。
 * @param port - 当前 Android 存储边界。
 * @param ids - 本次操作唯一的所有目标。
 * @param expectedRevision - 打开当前概览时的版本，任何陈旧/缺失/重复目标均拒绝。
 * @param signal - 可选 PDF 取消信号；在各异步读取阶段之间检查。
 * @returns 独占只读导出会话，打开失败自动清理；成功由调用者 finally 关闭。
 */
export async function openNativeExportSession(
  port: LogbookPort,
  ids: string[],
  expectedRevision: number,
  signal?: AbortSignal
): Promise<NativeExportSession> {
  checkPdfCancellation(signal)
  const source = await port.createExportSource({ ids, expectedRevision })
  let closed = false
  /** @returns 清理两个只读边界；原生文件无论后台通道是否已失败均尝试释放。 */
  async function close(): Promise<void> {
    if (closed) return
    try {
      await closeExportSourceInBackground(source.id)
    } finally {
      await port.releaseExportSource({ id: source.id })
      closed = true
    }
  }
  try {
    checkPdfCancellation(signal)
    if (source.revision !== expectedRevision) throw new Error('数据已变化，请重新读取。')
    await openExportSourceInBackground({ ...source, url: Capacitor.convertFileSrc(source.fileUri) }, ids)
    checkPdfCancellation(signal)
    return {
      async file(module, records, filters, format, combined) {
        if (closed) throw new Error('导出正文租约已关闭。')
        return exportSourceFileInBackground({
          id: source.id,
          moduleId: module.id,
          moduleName: module.name,
          ids: records.map((r) => r.id),
          filters,
          format,
          combined
        })
      },
      async backup(name, files) {
        if (closed) throw new Error('导出正文租约已关闭。')
        return backupSourceInBackground(
          source.id,
          name,
          files?.map((file) => ({
            name: file.name,
            url: Capacitor.convertFileSrc(file.uri),
            bytes: file.bytes,
            sha256: file.sha256
          }))
        )
      },
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}
