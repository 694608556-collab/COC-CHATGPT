import { renderLogText, renderWordHtml } from '../../../src/shared/document-renderer'
import type { FilterPreset, SessionRecord, ModuleRecord, NormalizedLog } from '../../../src/shared/types'
import { textPdf } from './pdf'
import type { PdfOptions } from './pdf'
import { createTextDocx } from './docx'
export { textPdf } from './pdf'
import { recordExportName, combinedExportName } from '../../../src/shared/export-filenames'
export type ExportFormat = 'raw' | 'txt' | 'doc' | 'dialogue-doc' | 'docx' | 'pdf'
export const EXPORT_LABELS: Record<ExportFormat, string> = {
  raw: '原始 JSON',
  txt: 'TXT',
  doc: '带图 DOC',
  'dialogue-doc': '纯对话 DOC',
  docx: 'DOCX',
  pdf: 'PDF'
}
export function asLog(record: SessionRecord): NormalizedLog {
  if (record.rawContent) return record.rawContent
  if (record.manualContent === undefined) throw new Error('此场次没有正文，无法导出：' + record.name)
  return {
    parserVersion: 1,
    messages: [
      {
        id: 'manual',
        order: 0,
        displayName: '',
        text: record.manualContent,
        type: 'text',
        isDiceCommand: false,
        isOffTopic: false,
        images: []
      }
    ]
  }
}
/** @param module - 所属模组。 @param records - 已按顺序加载完整正文的场次。 @param filters - 导出过滤设置。 @param format - 文件格式。 @param combined - 是否合成。 @param pdf - PDF 顺序写入/进度/取消；流式模式 bytes 为空。 @returns 文件名、类型及非流式文件字节；不发布文件或修改业务数据。 */
export async function createExport(
  module: ModuleRecord,
  records: SessionRecord[],
  filters: FilterPreset,
  format: ExportFormat,
  combined = false,
  pdf?: PdfOptions
) {
  filters = { ...filters, indentFirstLine: false, darkDisplay: false }
  if (!records.length) throw new Error('没有选中场次。')
  const sessions = records.map((record) => ({ record, log: asLog(record) }))
  const name = combined
    ? combinedExportName(module.name, format)
    : recordExportName(module.name, records[0]!.name, records[0]!.playDate, format)
  if (format === 'raw')
    return {
      name,
      mime: 'application/json',
      bytes: new TextEncoder().encode(
        JSON.stringify(
          combined ? sessions.map((s) => ({ record: s.record, log: s.log })) : sessions[0]!.log,
          null,
          2
        )
      )
    }
  const header = combined
    ? module.name +
      '\r\nKP：' +
      module.kps.join('、') +
      '\r\n' +
      module.pairs.map((p) => 'PC：' + p.pc + ' PL：' + p.pl).join('\r\n') +
      '\r\n\r\n'
    : ''
  if (format === 'doc' || format === 'dialogue-doc')
    return {
      name,
      mime: 'application/msword',
      bytes: new TextEncoder().encode(
        renderWordHtml(module, sessions, filters, format === 'doc', { cover: combined })
      )
    }
  if (format === 'docx') {
    return {
      name,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await createTextDocx(module, sessions, filters, combined)
    }
  }
  // 只有 TXT/PDF 需要纯文本；DOC/DOCX 不再重复过滤、拼接一份不会使用的大字符串。
  const text =
    header +
    sessions
      .map(
        (s) =>
          (combined ? s.record.name + ' · ' + (s.record.playDate || '') + '\r\n\r\n' : '') +
          (s.record.rawContent ? renderLogText(s.log, filters) : s.record.manualContent)
      )
      .join('\r\n\r\n')
  if (format === 'txt') return { name, mime: 'text/plain', bytes: new TextEncoder().encode(text) }
  return { name, mime: 'application/pdf', bytes: await textPdf(text, pdf) }
}
